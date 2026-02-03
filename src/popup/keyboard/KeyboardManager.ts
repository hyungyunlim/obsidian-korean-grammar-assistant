/**
 * 키보드 네비게이션 관리자
 * 키보드 스코프, 단축키 등록 및 관리를 담당
 */

import { createEl } from '../../utils/domUtils';
import { ShortcutHandler } from './ShortcutHandler';
import { FocusManager } from './FocusManager';
import { PopupState, KeyboardAction, KeyboardNavigationState, IPopupComponent, RenderContext } from '../types/PopupTypes';
import { Logger } from '../../utils/logger';
import { Platform, Scope } from 'obsidian';

export interface KeyboardEventResult {
  handled: boolean;
  action?: KeyboardAction;
  focusChanged?: boolean;
  preventDefault?: boolean;
}

export class KeyboardManager implements IPopupComponent {
  private shortcutHandler: ShortcutHandler;
  private focusManager: FocusManager;
  private keyboardScope: Scope;
  private app: any; // Obsidian App
  private isEnabled: boolean = false;
  private containerElement?: HTMLElement;
  private eventListeners: Array<() => void> = [];

  // 키보드 상태
  private keyboardState: KeyboardNavigationState;

  // 이벤트 콜백
  private onKeyboardActionCallback?: (action: KeyboardAction, event: KeyboardEvent) => Promise<boolean>;
  private onFocusChangeCallback?: (newFocusIndex: number) => void;

  constructor(app: any) {
    this.app = app;
    this.keyboardScope = new Scope();
    this.shortcutHandler = new ShortcutHandler();
    this.focusManager = new FocusManager();
    this.keyboardState = this.createInitialKeyboardState();
  }

  async initialize(context: RenderContext): Promise<void> {
    Logger.log('[KeyboardManager] 초기화 시작');
    
    // 컨텍스트에서 상태 설정
    this.keyboardState = {
      ...this.keyboardState,
      currentFocusIndex: context.focus?.currentIndex || 0,
      totalFocusableItems: context.focus?.totalItems || 0,
      isEditMode: context.focus?.isEditMode || false,
      keyboardHintsVisible: context.keyboard?.showHints !== false
    };

    // 하위 컴포넌트 초기화
    await this.shortcutHandler.initialize(context);
    await this.focusManager.initialize(context);
    
    // 키보드 스코프 설정
    this.setupKeyboardScope();
    
    Logger.log('[KeyboardManager] 초기화 완료', { state: this.keyboardState });
  }

  render(): HTMLElement {
    const container = createEl('div', { cls: 'keyboard-manager' });
    this.containerElement = container;
    
    // 키보드 힌트 표시 (데스크톱에서만)
    if (this.shouldShowKeyboardHints()) {
      const hintsContainer = this.createKeyboardHints();
      container.appendChild(hintsContainer);
    }
    
    return container;
  }

  update(state: Partial<PopupState>): void {
    let shouldUpdate = false;
    
    if (state.currentFocusIndex !== undefined && state.currentFocusIndex !== this.keyboardState.currentFocusIndex) {
      this.keyboardState.currentFocusIndex = state.currentFocusIndex;
      shouldUpdate = true;
    }
    
    if (shouldUpdate) {
      this.focusManager.update(state);
      this.updateKeyboardHints();
    }
  }

  dispose(): void {
    Logger.log('[KeyboardManager] 정리 시작');
    
    // 키보드 스코프 해제
    this.disableKeyboardNavigation();
    
    // 이벤트 리스너 정리
    this.eventListeners.forEach(cleanup => cleanup());
    this.eventListeners = [];
    
    // 하위 컴포넌트 정리
    this.shortcutHandler.dispose();
    this.focusManager.dispose();
    
    // 콜백 정리
    this.onKeyboardActionCallback = undefined;
    this.onFocusChangeCallback = undefined;
    this.containerElement = undefined;
    
    Logger.log('[KeyboardManager] 정리 완료');
  }

  isVisible(): boolean {
    return this.shouldShowKeyboardHints();
  }

  // =============================================================================
  // 키보드 네비게이션 핵심 메서드
  // =============================================================================

  /**
   * 키보드 네비게이션 활성화
   */
  enableKeyboardNavigation(): void {
    if (this.isEnabled) {
      Logger.debug('[KeyboardManager] 키보드 네비게이션이 이미 활성화됨');
      return;
    }

    try {
      // Obsidian 앱에 키보드 스코프 등록
      this.app.keymap.pushScope(this.keyboardScope);
      this.isEnabled = true;
      
      Logger.log('[KeyboardManager] 키보드 네비게이션 활성화');
    } catch (error) {
      Logger.error('[KeyboardManager] 키보드 네비게이션 활성화 실패', { error });
    }
  }

  /**
   * 키보드 네비게이션 비활성화
   */
  disableKeyboardNavigation(): void {
    if (!this.isEnabled) {
      Logger.debug('[KeyboardManager] 키보드 네비게이션이 이미 비활성화됨');
      return;
    }

    try {
      // Obsidian 앱에서 키보드 스코프 해제
      this.app.keymap.popScope(this.keyboardScope);
      this.isEnabled = false;
      
      Logger.log('[KeyboardManager] 키보드 네비게이션 비활성화');
    } catch (error) {
      Logger.error('[KeyboardManager] 키보드 네비게이션 비활성화 실패', { error });
    }
  }

  /**
   * 키보드 이벤트 처리
   */
  async handleKeyboardEvent(event: KeyboardEvent): Promise<KeyboardEventResult> {
    if (!this.isEnabled) {
      return { handled: false };
    }

    // 편집 모드에서는 일부 키만 처리
    if (this.keyboardState.isEditMode && !this.isEditModeKey(event)) {
      return { handled: false };
    }

    // 단축키 처리
    const shortcutResult = await this.shortcutHandler.handleKeyboardEvent(event);
    if (shortcutResult.handled) {
      // 키보드 액션 콜백 호출
      if (shortcutResult.action && this.onKeyboardActionCallback) {
        const actionHandled = await this.onKeyboardActionCallback(shortcutResult.action, event);
        if (!actionHandled) {
          Logger.warn('[KeyboardManager] 키보드 액션이 처리되지 않음', { action: shortcutResult.action });
        }
      }
      
      return shortcutResult;
    }

    return { handled: false };
  }

  /**
   * 포커스 상태 업데이트
   */
  updateFocusState(focusIndex: number, totalItems: number): void {
    const previousIndex = this.keyboardState.currentFocusIndex;
    
    this.keyboardState.currentFocusIndex = focusIndex;
    this.keyboardState.totalFocusableItems = totalItems;
    
    // 포커스 관리자에 업데이트 전달
    this.focusManager.setFocusIndex(focusIndex, totalItems);
    
    // 포커스 변경 콜백 호출
    if (focusIndex !== previousIndex && this.onFocusChangeCallback) {
      this.onFocusChangeCallback(focusIndex);
    }
    
    Logger.debug('[KeyboardManager] 포커스 상태 업데이트', {
      from: previousIndex,
      to: focusIndex,
      totalItems
    });
  }

  /**
   * 편집 모드 상태 설정
   */
  setEditMode(isEditMode: boolean): void {
    if (this.keyboardState.isEditMode !== isEditMode) {
      this.keyboardState.isEditMode = isEditMode;
      this.focusManager.setEditMode(isEditMode);
      
      Logger.log('[KeyboardManager] 편집 모드 변경', { isEditMode });
    }
  }

  // =============================================================================
  // 상태 조회 메서드
  // =============================================================================

  getKeyboardState(): KeyboardNavigationState {
    return { ...this.keyboardState };
  }

  getCurrentFocusIndex(): number {
    return this.keyboardState.currentFocusIndex;
  }

  getTotalFocusableItems(): number {
    return this.keyboardState.totalFocusableItems;
  }

  isKeyboardEnabled(): boolean {
    return this.isEnabled;
  }

  isInEditMode(): boolean {
    return this.keyboardState.isEditMode;
  }

  // =============================================================================
  // 이벤트 콜백 설정
  // =============================================================================

  setKeyboardActionCallback(callback: (action: KeyboardAction, event: KeyboardEvent) => Promise<boolean>): void {
    this.onKeyboardActionCallback = callback;
  }

  setFocusChangeCallback(callback: (newFocusIndex: number) => void): void {
    this.onFocusChangeCallback = callback;
  }

  // =============================================================================
  // Private 메서드
  // =============================================================================

  private createInitialKeyboardState(): KeyboardNavigationState {
    return {
      currentFocusIndex: 0,
      totalFocusableItems: 0,
      isEditMode: false,
      keyboardHintsVisible: true,
      lastNavigationTime: Date.now()
    };
  }

  private setupKeyboardScope(): void {
    // 기본 네비게이션 키들 등록
    this.registerBasicNavigationKeys();
    
    // 단축키 핸들러에서 상세 키 등록
    this.shortcutHandler.registerShortcuts(this.keyboardScope);
    
    Logger.log('[KeyboardManager] 키보드 스코프 설정 완료');
  }

  private registerBasicNavigationKeys(): void {
    // Tab 키 (다음 오류로 이동)
    this.keyboardScope.register([], 'Tab', (event) => {
      event.preventDefault();
      return this.handleKeyboardEvent(event);
    });

    // Shift+Tab 키 (이전 오류로 이동)
    this.keyboardScope.register(['Shift'], 'Tab', (event) => {
      event.preventDefault();
      return this.handleKeyboardEvent(event);
    });

    // Escape 키 (팝업 닫기)
    this.keyboardScope.register([], 'Escape', (event) => {
      return this.handleKeyboardEvent(event);
    });

    // Enter 키 (현재 선택 적용)
    this.keyboardScope.register([], 'Enter', (event) => {
      return this.handleKeyboardEvent(event);
    });
  }

  private isEditModeKey(event: KeyboardEvent): boolean {
    // 편집 모드에서 허용되는 키들
    const allowedKeys = ['Escape', 'Enter', 'Tab'];
    const allowedCombos = [
      { cmd: true, key: 'Enter' }, // Cmd+Enter (저장)
    ];

    if (allowedKeys.includes(event.key)) {
      return true;
    }

    return allowedCombos.some(combo => 
      (combo.cmd === event.metaKey || combo.cmd === event.ctrlKey) &&
      combo.key === event.key
    );
  }

  private shouldShowKeyboardHints(): boolean {
    // 모바일에서는 키보드 힌트 숨김
    return this.keyboardState.keyboardHintsVisible && !this.isMobile();
  }

  private isMobile(): boolean {
    return Platform.isMobile;
  }

  private createKeyboardHints(): HTMLElement {
    const hintsContainer = createEl('div', { cls: 'keyboard-hints' });
    
    const hints = [
      { key: 'Tab', desc: '다음 오류' },
      { key: 'Shift+Tab', desc: '이전 오류' },
      { key: '←/→', desc: '수정안 변경' },
      { key: 'Enter', desc: '적용' },
      { key: 'Cmd+E', desc: '편집' },
      { key: 'Esc', desc: '닫기' }
    ];

    hints.forEach(hint => {
      const hintElement = createEl('div', { cls: 'keyboard-hint' });
      
      const keyElement = createEl('kbd', { cls: 'keyboard-hint-key' });
      keyElement.textContent = hint.key;
      
      const descElement = createEl('span', { cls: 'keyboard-hint-desc' });
      descElement.textContent = hint.desc;
      
      hintElement.appendChild(keyElement);
      hintElement.appendChild(descElement);
      hintsContainer.appendChild(hintElement);
    });

    return hintsContainer;
  }

  private updateKeyboardHints(): void {
    // 키보드 힌트 UI 업데이트 (필요 시)
    const container = this.containerElement;
    if (!container) return;

    const hintsContainer = container.querySelector('.keyboard-hints');
    if (hintsContainer && !this.shouldShowKeyboardHints()) {
      hintsContainer.remove();
    } else if (!hintsContainer && this.shouldShowKeyboardHints()) {
      const newHints = this.createKeyboardHints();
      container.appendChild(newHints);
    }
  }
}