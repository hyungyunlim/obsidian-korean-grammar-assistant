/**
 * 포커스 상태 및 하이라이트 관리 담당 클래스
 * 키보드 네비게이션 시 포커스 이동 및 시각적 하이라이트를 처리
 */

import { createEl } from '../../utils/domUtils';
import { IPopupComponent, RenderContext } from '../types/PopupTypes';
import { Logger } from '../../utils/logger';

export interface FocusableElement {
  element: HTMLElement;
  index: number;
  type: 'error-card' | 'navigation-button' | 'action-button';
  isVisible: boolean;
  isEnabled: boolean;
}

export interface FocusState {
  currentIndex: number;
  totalItems: number;
  focusableElements: FocusableElement[];
  isEditMode: boolean;
  lastFocusTime: number;
}

export class FocusManager implements IPopupComponent {
  private focusState: FocusState;
  private containerElement?: HTMLElement;
  private eventListeners: Array<() => void> = [];
  private focusObserver?: MutationObserver;

  // CSS 클래스 상수
  private readonly FOCUS_CLASS = 'kga-keyboard-focused';
  private readonly FOCUS_HIGHLIGHT_CLASS = 'kga-focus-highlight';
  private readonly EDIT_MODE_CLASS = 'kga-edit-mode-active';

  constructor() {
    this.focusState = this.createInitialFocusState();
  }

  async initialize(context: RenderContext): Promise<void> {
    Logger.log('[FocusManager] 초기화 시작');
    
    this.focusState = {
      ...this.focusState,
      currentIndex: context.focus?.currentIndex || 0,
      totalItems: context.focus?.totalItems || 0,
      isEditMode: context.focus?.isEditMode || false
    };

    // DOM 변화 감지를 위한 Observer 설정
    this.setupFocusObserver();
    
    Logger.log('[FocusManager] 초기화 완료', { state: this.focusState });
  }

  render(): HTMLElement {
    const container = createEl('div', { cls: 'kga-focus-manager' });
    this.containerElement = container;
    
    // 포커스 하이라이트용 스타일 추가
    const style = createEl('style');
    style.textContent = this.getFocusStyles();
    container.appendChild(style);
    
    return container;
  }

  update(state: any): void {
    if (state.currentFocusIndex !== undefined) {
      this.setFocusIndex(state.currentFocusIndex);
    }
    
    if (state.isEditMode !== undefined) {
      this.setEditMode(state.isEditMode);
    }
  }

  dispose(): void {
    Logger.log('[FocusManager] 정리 시작');
    
    // 포커스 하이라이트 제거
    this.clearAllFocus();
    
    // Observer 정리
    if (this.focusObserver) {
      this.focusObserver.disconnect();
      this.focusObserver = undefined;
    }
    
    // 이벤트 리스너 정리
    this.eventListeners.forEach(cleanup => cleanup());
    this.eventListeners = [];
    
    this.containerElement = undefined;
    
    Logger.log('[FocusManager] 정리 완료');
  }

  isVisible(): boolean {
    return false; // UI 컴포넌트가 아님
  }

  // =============================================================================
  // 포커스 관리 핵심 메서드
  // =============================================================================

  /**
   * 포커스 인덱스 설정
   */
  setFocusIndex(index: number, totalItems?: number): void {
    const previousIndex = this.focusState.currentIndex;
    
    if (totalItems !== undefined) {
      this.focusState.totalItems = totalItems;
    }
    
    // 범위 검증
    if (index < 0) {
      index = Math.max(0, this.focusState.totalItems - 1);
    } else if (index >= this.focusState.totalItems) {
      index = 0;
    }
    
    this.focusState.currentIndex = index;
    this.focusState.lastFocusTime = Date.now();
    
    // 포커스 가능한 요소 목록 업데이트
    this.updateFocusableElements();
    
    // 포커스 하이라이트 적용
    this.applyFocusHighlight(previousIndex, index);
    
    Logger.debug('[FocusManager] 포커스 인덱스 변경', {
      from: previousIndex,
      to: index,
      totalItems: this.focusState.totalItems
    });
  }

  /**
   * 다음 포커스로 이동
   */
  focusNext(): boolean {
    const nextIndex = (this.focusState.currentIndex + 1) % this.focusState.totalItems;
    this.setFocusIndex(nextIndex);
    return true;
  }

  /**
   * 이전 포커스로 이동
   */
  focusPrevious(): boolean {
    const prevIndex = this.focusState.currentIndex === 0 ? 
      this.focusState.totalItems - 1 : 
      this.focusState.currentIndex - 1;
    this.setFocusIndex(prevIndex);
    return true;
  }

  /**
   * 특정 요소로 포커스 이동
   */
  focusElement(element: HTMLElement): boolean {
    const focusableElement = this.focusState.focusableElements.find(
      fe => fe.element === element
    );
    
    if (!focusableElement) {
      Logger.warn('[FocusManager] 포커스할 수 없는 요소', { element });
      return false;
    }
    
    this.setFocusIndex(focusableElement.index);
    return true;
  }

  /**
   * 편집 모드 설정
   */
  setEditMode(isEditMode: boolean): void {
    if (this.focusState.isEditMode !== isEditMode) {
      this.focusState.isEditMode = isEditMode;
      this.updateEditModeStyles();
      
      Logger.log('[FocusManager] 편집 모드 변경', { isEditMode });
    }
  }

  /**
   * 현재 포커스된 요소로 스크롤
   */
  scrollToCurrentFocus(): void {
    const currentElement = this.getCurrentFocusElement();
    if (currentElement && currentElement.element) {
      currentElement.element.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
      
      Logger.debug('[FocusManager] 현재 포커스로 스크롤');
    }
  }

  // =============================================================================
  // 상태 조회 메서드
  // =============================================================================

  getCurrentFocusIndex(): number {
    return this.focusState.currentIndex;
  }

  getTotalFocusableItems(): number {
    return this.focusState.totalItems;
  }

  getCurrentFocusElement(): FocusableElement | null {
    return this.focusState.focusableElements.find(
      fe => fe.index === this.focusState.currentIndex
    ) || null;
  }

  getFocusState(): FocusState {
    return { ...this.focusState };
  }

  isEditMode(): boolean {
    return this.focusState.isEditMode;
  }

  // =============================================================================
  // Private 메서드
  // =============================================================================

  private createInitialFocusState(): FocusState {
    return {
      currentIndex: 0,
      totalItems: 0,
      focusableElements: [],
      isEditMode: false,
      lastFocusTime: Date.now()
    };
  }

  private setupFocusObserver(): void {
    this.focusObserver = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' || 
            (mutation.type === 'attributes' && 
             (mutation.attributeName === 'class' || mutation.attributeName === 'style'))) {
          shouldUpdate = true;
        }
      });
      
      if (shouldUpdate) {
        // 디바운스를 위해 지연 실행
        setTimeout(() => this.updateFocusableElements(), 50);
      }
    });

    // 전체 문서를 관찰
    this.focusObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }

  private updateFocusableElements(): void {
    const focusableElements: FocusableElement[] = [];
    
    // 오류 카드들 찾기
    const errorCards = document.querySelectorAll('.error-card');
    errorCards.forEach((card, index) => {
      const htmlCard = card as HTMLElement;
      focusableElements.push({
        element: htmlCard,
        index: index,
        type: 'error-card',
        isVisible: this.isElementVisible(htmlCard),
        isEnabled: !htmlCard.classList.contains('disabled')
      });
    });
    
    // 네비게이션 버튼들 찾기
    const navButtons = document.querySelectorAll('.pagination-button, .nav-button');
    navButtons.forEach((button, index) => {
      const htmlButton = button as HTMLElement;
      focusableElements.push({
        element: htmlButton,
        index: errorCards.length + index,
        type: 'navigation-button',
        isVisible: this.isElementVisible(htmlButton),
        isEnabled: !(htmlButton as HTMLButtonElement).disabled
      });
    });
    
    // 액션 버튼들 찾기
    const actionButtons = document.querySelectorAll('.header-button, .action-button');
    actionButtons.forEach((button, index) => {
      const htmlButton = button as HTMLElement;
      focusableElements.push({
        element: htmlButton,
        index: errorCards.length + navButtons.length + index,
        type: 'action-button',
        isVisible: this.isElementVisible(htmlButton),
        isEnabled: !(htmlButton as HTMLButtonElement).disabled
      });
    });
    
    // 보이고 활성화된 요소들만 필터링
    this.focusState.focusableElements = focusableElements.filter(
      fe => fe.isVisible && fe.isEnabled
    );
    
    // 총 항목 수 업데이트
    this.focusState.totalItems = this.focusState.focusableElements.length;
    
    // 현재 인덱스가 범위를 벗어나면 조정
    if (this.focusState.currentIndex >= this.focusState.totalItems) {
      this.focusState.currentIndex = Math.max(0, this.focusState.totalItems - 1);
    }
    
    Logger.debug('[FocusManager] 포커스 가능한 요소 업데이트', {
      totalElements: this.focusState.focusableElements.length,
      errorCards: errorCards.length,
      navButtons: navButtons.length,
      actionButtons: actionButtons.length
    });
  }

  private applyFocusHighlight(previousIndex: number, currentIndex: number): void {
    // 이전 포커스 제거
    if (previousIndex >= 0 && previousIndex < this.focusState.focusableElements.length) {
      const prevElement = this.focusState.focusableElements[previousIndex];
      if (prevElement) {
        prevElement.element.classList.remove(this.FOCUS_CLASS, this.FOCUS_HIGHLIGHT_CLASS);
      }
    }
    
    // 현재 포커스 적용
    const currentElement = this.focusState.focusableElements[currentIndex];
    if (currentElement) {
      currentElement.element.classList.add(this.FOCUS_CLASS, this.FOCUS_HIGHLIGHT_CLASS);
      
      // 요소가 화면에 보이도록 스크롤
      setTimeout(() => this.scrollToCurrentFocus(), 100);
    }
  }

  private clearAllFocus(): void {
    this.focusState.focusableElements.forEach(fe => {
      fe.element.classList.remove(this.FOCUS_CLASS, this.FOCUS_HIGHLIGHT_CLASS);
    });
  }

  private updateEditModeStyles(): void {
    const body = document.body;
    if (this.focusState.isEditMode) {
      body.classList.add(this.EDIT_MODE_CLASS);
    } else {
      body.classList.remove(this.EDIT_MODE_CLASS);
    }
  }

  private isElementVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  private getFocusStyles(): string {
    return `
      .${this.FOCUS_CLASS} {
        outline: 2px solid var(--interactive-accent) !important;
        outline-offset: 2px !important;
        position: relative !important;
        z-index: 1000 !important;
      }
      
      .${this.FOCUS_HIGHLIGHT_CLASS} {
        background-color: var(--interactive-hover) !important;
        transition: all 0.2s ease !important;
      }
      
      .error-card.${this.FOCUS_CLASS} {
        border-color: var(--interactive-accent) !important;
        box-shadow: 0 0 0 1px var(--interactive-accent) !important;
      }
      
      .${this.EDIT_MODE_CLASS} .${this.FOCUS_CLASS} {
        outline-color: var(--color-accent) !important;
      }
      
      @keyframes focusPulse {
        0% { opacity: 1; }
        50% { opacity: 0.7; }
        100% { opacity: 1; }
      }
      
      .${this.FOCUS_CLASS}.kga-focus-pulse {
        animation: focusPulse 1s ease-in-out infinite;
      }
    `;
  }
}