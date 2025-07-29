/**
 * 단축키 처리 담당 클래스
 * 18개 키보드 단축키의 각각의 액션을 처리
 */

import { createEl } from '../../utils/domUtils';
import { KeyboardAction, IPopupComponent, RenderContext } from '../types/PopupTypes';
import { Logger } from '../../utils/logger';
import { Scope, Modifier } from 'obsidian';
import { KeyboardEventResult } from './KeyboardManager';

interface ShortcutDefinition {
  keys: string[];
  modifiers: Modifier[];
  action: KeyboardAction;
  description: string;
  editModeOnly?: boolean;
  longTextOnly?: boolean;
}

export class ShortcutHandler implements IPopupComponent {
  private shortcuts: ShortcutDefinition[] = [];
  private registeredKeys: Set<string> = new Set();

  constructor() {
    this.initializeShortcuts();
  }

  async initialize(context: RenderContext): Promise<void> {
    Logger.log('[ShortcutHandler] 초기화 시작');
    
    // 컨텍스트에 따른 단축키 필터링 (필요 시)
    this.shortcuts = this.shortcuts.filter(shortcut => {
      if (shortcut.longTextOnly && !context.pagination.isLongText) {
        return false;
      }
      return true;
    });
    
    Logger.log('[ShortcutHandler] 초기화 완료', { 
      totalShortcuts: this.shortcuts.length 
    });
  }

  render(): HTMLElement {
    // ShortcutHandler는 UI 컴포넌트가 아니므로 빈 div 반환
    return createEl('div', { cls: 'shortcut-handler-placeholder', attr: { style: 'display: none;' } });
  }

  update(): void {
    // 필요 시 단축키 상태 업데이트
  }

  dispose(): void {
    this.registeredKeys.clear();
    Logger.log('[ShortcutHandler] 정리 완료');
  }

  isVisible(): boolean {
    return false; // UI 컴포넌트가 아님
  }

  // =============================================================================
  // 단축키 등록 및 처리
  // =============================================================================

  /**
   * 키보드 스코프에 단축키 등록
   */
  registerShortcuts(keyboardScope: Scope): void {
    Logger.log('[ShortcutHandler] 단축키 등록 시작');
    
    this.shortcuts.forEach(shortcut => {
      try {
        const keyCombo = this.createKeyCombo(shortcut.modifiers, shortcut.keys);
        
        keyboardScope.register(shortcut.modifiers, shortcut.keys[0], (event) => {
          event.preventDefault();
          return this.handleShortcut(shortcut, event);
        });
        
        this.registeredKeys.add(keyCombo);
        
        Logger.debug('[ShortcutHandler] 단축키 등록', {
          combo: keyCombo,
          action: shortcut.action,
          description: shortcut.description
        });
        
      } catch (error) {
        Logger.error('[ShortcutHandler] 단축키 등록 실패', {
          shortcut: shortcut.action,
          error
        });
      }
    });
    
    Logger.log('[ShortcutHandler] 단축키 등록 완료', {
      registered: this.registeredKeys.size
    });
  }

  /**
   * 키보드 이벤트 처리
   */
  async handleKeyboardEvent(event: KeyboardEvent): Promise<KeyboardEventResult> {
    const matchedShortcut = this.findMatchingShortcut(event);
    
    if (!matchedShortcut) {
      return { handled: false };
    }

    return await this.handleShortcut(matchedShortcut, event);
  }

  /**
   * 특정 액션에 대한 단축키 정보 조회
   */
  getShortcutInfo(action: KeyboardAction): ShortcutDefinition | null {
    return this.shortcuts.find(s => s.action === action) || null;
  }

  /**
   * 모든 단축키 목록 조회
   */
  getAllShortcuts(): ShortcutDefinition[] {
    return [...this.shortcuts];
  }

  // =============================================================================
  // Private 메서드
  // =============================================================================

  private initializeShortcuts(): void {
    this.shortcuts = [
      // 기본 네비게이션
      {
        keys: ['Tab'],
        modifiers: [],
        action: 'next-error',
        description: '다음 오류로 이동'
      },
      {
        keys: ['Tab'],
        modifiers: ['Shift'],
        action: 'prev-error',
        description: '이전 오류로 이동'
      },
      {
        keys: ['ArrowLeft'],
        modifiers: [],
        action: 'prev-suggestion',
        description: '이전 수정안'
      },
      {
        keys: ['ArrowRight'],
        modifiers: [],
        action: 'next-suggestion',
        description: '다음 수정안'
      },
      {
        keys: ['Enter'],
        modifiers: [],
        action: 'apply-current',
        description: '현재 수정안 적용'
      },
      {
        keys: ['Enter'],
        modifiers: ['Mod'],
        action: 'apply-all',
        description: '모든 변경사항 저장'
      },
      {
        keys: ['Escape'],
        modifiers: [],
        action: 'close-popup',
        description: '팝업 닫기'
      },

      // 편집 기능
      {
        keys: ['e'],
        modifiers: ['Mod'],
        action: 'edit-current',
        description: '현재 오류 편집'
      },
      {
        keys: ['a'],
        modifiers: ['Shift', 'Mod'],
        action: 'ai-analyze',
        description: 'AI 분석 실행'
      },
      {
        keys: ['e'],
        modifiers: ['Mod', 'Shift'],
        action: 'toggle-error-summary',
        description: '오류 상세 펼침/접힘'
      },

      // 일괄 작업
      {
        keys: ['ArrowRight'],
        modifiers: ['Mod', 'Shift'],
        action: 'bulk-next-suggestion',
        description: '모든 오류를 다음 제안으로'
      },
      {
        keys: ['ArrowLeft'],
        modifiers: ['Mod', 'Shift'],
        action: 'bulk-prev-suggestion',
        description: '모든 오류를 이전 제안으로'
      },

      // 페이지 네비게이션 (긴 텍스트용)
      {
        keys: ['ArrowUp'],
        modifiers: [],
        action: 'prev-page',
        description: '이전 페이지',
        longTextOnly: true
      },
      {
        keys: ['ArrowDown'],
        modifiers: [],
        action: 'next-page',
        description: '다음 페이지',
        longTextOnly: true
      },

      // 고급 기능
      {
        keys: ['h'],
        modifiers: ['Mod'],
        action: 'toggle-keyboard-hints',
        description: '키보드 힌트 토글'
      },
      {
        keys: ['r'],
        modifiers: ['Mod'],
        action: 'refresh-analysis',
        description: '분석 새로고침'
      },
      {
        keys: ['s'],
        modifiers: ['Mod'],
        action: 'save-settings',
        description: '설정 저장'
      },
      {
        keys: ['z'],
        modifiers: ['Mod'],
        action: 'undo-last-change',
        description: '마지막 변경 취소'
      }
    ];
  }

  private findMatchingShortcut(event: KeyboardEvent): ShortcutDefinition | null {
    const found = this.shortcuts.find(shortcut => {
      // 키 일치 확인
      const keyMatches = shortcut.keys.some(key => 
        key.toLowerCase() === event.key.toLowerCase() ||
        key === event.code
      );
      
      if (!keyMatches) return false;

      // 모디파이어 키 확인
      const requiredModifiers = new Set(shortcut.modifiers.map(m => m.toLowerCase()));
      const pressedModifiers = new Set();
      
      if (event.metaKey || event.ctrlKey) pressedModifiers.add('mod');
      if (event.shiftKey) pressedModifiers.add('shift');
      if (event.altKey) pressedModifiers.add('alt');

      // 정확한 모디파이어 일치 확인
      if (requiredModifiers.size !== pressedModifiers.size) return false;
      
      for (const modifier of requiredModifiers) {
        if (!pressedModifiers.has(modifier)) return false;
      }

      return true;
    });
    
    return found || null;
  }

  private async handleShortcut(shortcut: ShortcutDefinition, event: KeyboardEvent): Promise<KeyboardEventResult> {
    Logger.debug('[ShortcutHandler] 단축키 처리', {
      action: shortcut.action,
      description: shortcut.description
    });

    // 편집 모드 전용 단축키 확인
    if (shortcut.editModeOnly) {
      // 편집 모드 상태는 KeyboardManager에서 확인해야 함
      // 여기서는 액션만 반환하고 상위에서 처리
    }

    return {
      handled: true,
      action: shortcut.action,
      preventDefault: true
    };
  }

  private createKeyCombo(modifiers: string[], keys: string[]): string {
    const parts = [...modifiers, ...keys];
    return parts.join('+');
  }
}