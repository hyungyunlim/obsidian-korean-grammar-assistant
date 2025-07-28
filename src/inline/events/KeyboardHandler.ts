/**
 * 키보드 이벤트 처리
 * 기존 inlineModeService의 키보드 네비게이션 로직을 분리
 */

import { KeyboardEventData, EventHandler } from '../types/EventTypes';
import { InlineError } from '../../types/interfaces';
import { Logger } from '../../utils/logger';

interface KeyBinding {
  key: string;
  modifiers?: string[];
  action: string;
  description: string;
}

export class KeyboardHandler {
  private keyBindings: Map<string, KeyBinding> = new Map();
  private currentFocusedErrorId: string | null = null;
  private errorOrder: string[] = [];
  
  // 이벤트 콜백들
  private onKeyboardAction?: EventHandler<KeyboardEventData>;
  
  // 키보드 네비게이션 설정
  private navigationEnabled: boolean = true;
  private wrapNavigation: boolean = true; // 처음/끝에서 순환
  
  constructor() {
    this.setupDefaultKeyBindings();
    Logger.log('KeyboardHandler: 초기화 완료');
  }
  
  /**
   * 기본 키바인딩 설정
   */
  private setupDefaultKeyBindings(): void {
    const bindings: KeyBinding[] = [
      // 네비게이션
      { key: 'Tab', action: 'navigate', description: '다음 오류로 이동' },
      { key: 'Tab', modifiers: ['shift'], action: 'navigate', description: '이전 오류로 이동' },
      { key: 'ArrowRight', action: 'navigate', description: '다음 오류로 이동' },
      { key: 'ArrowLeft', action: 'navigate', description: '이전 오류로 이동' },
      { key: 'Home', action: 'navigate', description: '첫 번째 오류로 이동' },
      { key: 'End', action: 'navigate', description: '마지막 오류로 이동' },
      
      // 선택 및 편집
      { key: 'Enter', action: 'select', description: '현재 오류의 첫 번째 수정 제안 적용' },
      { key: 'Space', action: 'select', description: '다음 수정 제안으로 순환' },
      { key: 'e', modifiers: ['cmd'], action: 'edit', description: '현재 오류 편집 모드' },
      { key: 'e', modifiers: ['ctrl'], action: 'edit', description: '현재 오류 편집 모드 (Windows)' },
      
      // 일괄 작업
      { key: 'ArrowRight', modifiers: ['cmd', 'shift'], action: 'bulk-next', description: '모든 오류를 다음 제안으로' },
      { key: 'ArrowLeft', modifiers: ['cmd', 'shift'], action: 'bulk-prev', description: '모든 오류를 이전 제안으로' },
      
      // 기타
      { key: 'Escape', action: 'escape', description: '현재 작업 취소' },
      { key: 'F1', action: 'help', description: '키보드 단축키 도움말' }
    ];
    
    for (const binding of bindings) {
      const key = this.createKeyString(binding.key, binding.modifiers);
      this.keyBindings.set(key, binding);
    }
    
    Logger.log('KeyboardHandler: 기본 키바인딩 설정 완료', { 
      bindingCount: this.keyBindings.size 
    });
  }
  
  /**
   * 키 문자열 생성
   */
  private createKeyString(key: string, modifiers?: string[]): string {
    const parts: string[] = [];
    
    if (modifiers && modifiers.length > 0) {
      parts.push(...modifiers.sort());
    }
    
    parts.push(key.toLowerCase());
    return parts.join('-');
  }
  
  /**
   * 이벤트 콜백 등록
   */
  setEventHandler(handler: EventHandler<KeyboardEventData>): void {
    this.onKeyboardAction = handler;
    Logger.log('KeyboardHandler: 키보드 이벤트 핸들러 등록 완료');
  }
  
  /**
   * 키보드 이벤트 등록
   */
  registerKeyboardEvents(container: HTMLElement): void {
    container.addEventListener('keydown', this.handleKeyDown.bind(this), true);
    Logger.log('KeyboardHandler: 키보드 이벤트 등록 완료');
  }
  
  /**
   * 키보드 이벤트 해제
   */
  unregisterKeyboardEvents(container: HTMLElement): void {
    container.removeEventListener('keydown', this.handleKeyDown.bind(this), true);
    Logger.log('KeyboardHandler: 키보드 이벤트 해제 완료');
  }
  
  /**
   * 키다운 이벤트 처리
   */
  private async handleKeyDown(event: KeyboardEvent): Promise<void> {
    try {
      if (!this.navigationEnabled) {
        return;
      }
      
      // 키 조합 문자열 생성
      const modifiers: string[] = [];
      if (event.ctrlKey) modifiers.push('ctrl');
      if (event.metaKey) modifiers.push('cmd');
      if (event.shiftKey) modifiers.push('shift');
      if (event.altKey) modifiers.push('alt');
      
      const keyString = this.createKeyString(event.key, modifiers);
      const binding = this.keyBindings.get(keyString);
      
      if (!binding) {
        return; // 등록되지 않은 키 조합
      }
      
      Logger.log('KeyboardHandler: 키보드 액션 실행', {
        keyString,
        action: binding.action,
        currentFocus: this.currentFocusedErrorId
      });
      
      // 이벤트 기본 동작 방지
      event.preventDefault();
      event.stopPropagation();
      
      // 액션별 처리
      await this.executeAction(binding.action, event, modifiers);
      
    } catch (error) {
      Logger.error('KeyboardHandler: 키다운 이벤트 처리 중 오류', error);
    }
  }
  
  /**
   * 액션 실행
   */
  private async executeAction(action: string, keyEvent: KeyboardEvent, modifiers: string[]): Promise<void> {
    if (!this.onKeyboardAction) {
      Logger.warn('KeyboardHandler: 키보드 액션 핸들러가 등록되지 않음');
      return;
    }
    
    let direction: 'next' | 'prev' | 'first' | 'last' | undefined;
    
    // 네비게이션 방향 결정
    if (action === 'navigate') {
      if (keyEvent.key === 'Tab') {
        direction = keyEvent.shiftKey ? 'prev' : 'next';
      } else if (keyEvent.key === 'ArrowRight') {
        direction = 'next';
      } else if (keyEvent.key === 'ArrowLeft') {
        direction = 'prev';
      } else if (keyEvent.key === 'Home') {
        direction = 'first';
      } else if (keyEvent.key === 'End') {
        direction = 'last';
      }
    }
    
    const keyboardData: KeyboardEventData = {
      errorId: this.currentFocusedErrorId || undefined,
      keyEvent,
      action: action as 'select' | 'focus' | 'navigate' | 'edit' | 'escape',
      direction
    };
    
    await this.onKeyboardAction(keyboardData);
  }
  
  /**
   * 오류 목록 업데이트
   */
  updateErrorList(errors: Map<string, InlineError>): void {
    // 시작 위치 기준으로 정렬
    this.errorOrder = Array.from(errors.keys()).sort((a, b) => {
      const errorA = errors.get(a);
      const errorB = errors.get(b);
      if (!errorA || !errorB) return 0;
      return errorA.start - errorB.start;
    });
    
    Logger.log('KeyboardHandler: 오류 목록 업데이트', { 
      errorCount: this.errorOrder.length 
    });
    
    // 현재 포커스가 유효하지 않으면 초기화
    if (this.currentFocusedErrorId && !errors.has(this.currentFocusedErrorId)) {
      this.currentFocusedErrorId = null;
    }
  }
  
  /**
   * 포커스된 오류 설정
   */
  setFocusedError(errorId: string | null): void {
    this.currentFocusedErrorId = errorId;
    Logger.log('KeyboardHandler: 포커스 변경', { errorId });
  }
  
  /**
   * 다음 포커스할 오류 찾기
   */
  getNextFocusableError(direction: 'next' | 'prev' | 'first' | 'last'): string | null {
    if (this.errorOrder.length === 0) {
      return null;
    }
    
    const currentIndex = this.currentFocusedErrorId 
      ? this.errorOrder.indexOf(this.currentFocusedErrorId)
      : -1;
    
    switch (direction) {
      case 'first':
        return this.errorOrder[0];
        
      case 'last':
        return this.errorOrder[this.errorOrder.length - 1];
        
      case 'next':
        if (currentIndex === -1) {
          return this.errorOrder[0];
        }
        const nextIndex = currentIndex + 1;
        if (nextIndex >= this.errorOrder.length) {
          return this.wrapNavigation ? this.errorOrder[0] : null;
        }
        return this.errorOrder[nextIndex];
        
      case 'prev':
        if (currentIndex === -1) {
          return this.errorOrder[this.errorOrder.length - 1];
        }
        const prevIndex = currentIndex - 1;
        if (prevIndex < 0) {
          return this.wrapNavigation ? this.errorOrder[this.errorOrder.length - 1] : null;
        }
        return this.errorOrder[prevIndex];
        
      default:
        return null;
    }
  }
  
  /**
   * 키바인딩 추가/수정
   */
  addKeyBinding(key: string, modifiers: string[] | undefined, action: string, description: string): void {
    const keyString = this.createKeyString(key, modifiers);
    const binding: KeyBinding = { key, modifiers, action, description };
    
    this.keyBindings.set(keyString, binding);
    
    Logger.log('KeyboardHandler: 키바인딩 추가', { keyString, action });
  }
  
  /**
   * 키바인딩 제거
   */
  removeKeyBinding(key: string, modifiers?: string[]): void {
    const keyString = this.createKeyString(key, modifiers);
    const removed = this.keyBindings.delete(keyString);
    
    Logger.log('KeyboardHandler: 키바인딩 제거', { keyString, removed });
  }
  
  /**
   * 모든 키바인딩 조회
   */
  getAllKeyBindings(): KeyBinding[] {
    return Array.from(this.keyBindings.values());
  }
  
  /**
   * 키보드 네비게이션 활성화/비활성화
   */
  setNavigationEnabled(enabled: boolean): void {
    this.navigationEnabled = enabled;
    Logger.log('KeyboardHandler: 네비게이션 상태 변경', { enabled });
  }
  
  /**
   * 순환 네비게이션 설정
   */
  setWrapNavigation(wrap: boolean): void {
    this.wrapNavigation = wrap;
    Logger.log('KeyboardHandler: 순환 네비게이션 설정', { wrap });
  }
  
  /**
   * 도움말 정보 생성
   */
  generateHelpText(): string {
    const lines: string[] = ['키보드 단축키:'];
    
    for (const binding of this.keyBindings.values()) {
      const keyText = binding.modifiers 
        ? `${binding.modifiers.join('+')}+${binding.key}`
        : binding.key;
      
      lines.push(`  ${keyText}: ${binding.description}`);
    }
    
    return lines.join('\n');
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      navigationEnabled: this.navigationEnabled,
      wrapNavigation: this.wrapNavigation,
      currentFocusedErrorId: this.currentFocusedErrorId,
      errorOrderCount: this.errorOrder.length,
      keyBindingCount: this.keyBindings.size,
      hasActionHandler: !!this.onKeyboardAction,
      errorOrder: this.errorOrder.slice(0, 5) // 처음 5개만 표시
    };
  }
}