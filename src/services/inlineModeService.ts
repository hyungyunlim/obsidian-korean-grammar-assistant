import { EditorView, WidgetType, Decoration, DecorationSet } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { Correction, InlineError } from '../types/interfaces';
import { Logger } from '../utils/logger';
import { globalInlineTooltip } from '../ui/inlineTooltip';
import { Scope, App, Platform } from 'obsidian';
import { Notice } from 'obsidian';
import { MarkdownView } from 'obsidian';
import { MorphemeUtils } from '../utils/morphemeUtils';
import { NotificationUtils } from '../utils/notificationUtils';
import { SpellCheckApiService } from './api';

/**
 * 오류 위젯 클래스
 * CodeMirror 6의 WidgetType을 확장하여 인라인 오류 표시
 */
class ErrorWidget extends WidgetType {
  constructor(
    private error: InlineError,
    private underlineStyle: string,
    private underlineColor: string,
    private onHover?: () => void,
    private onClick?: () => void
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'korean-grammar-error-inline';
    span.textContent = this.error.correction.original;
    
    // 강제로 스타일 적용 (text-decoration-line 사용)
    span.style.cssText = `
      display: inline !important;
      position: relative !important;
      cursor: pointer !important;
      text-decoration-line: underline !important;
      text-decoration-style: wavy !important;
      text-decoration-color: var(--color-red) !important;
      text-decoration-thickness: 2px !important;
      background-color: rgba(255, 0, 0, 0.05) !important;
      user-select: none !important;
      -webkit-user-select: none !important;
      -webkit-touch-callout: none !important;
    `;
    
    // 설정에 따른 오버라이드
    if (this.underlineStyle !== 'wavy' || this.underlineColor !== 'var(--color-red)') {
      span.style.textDecorationStyle = this.underlineStyle;
      span.style.textDecorationColor = this.underlineColor;
    }
    
    // 호버 이벤트 (300ms 딜레이)
    if (this.onHover) {
      let hoverTimeout: NodeJS.Timeout;
      
      span.addEventListener('mouseenter', (e) => {
        hoverTimeout = setTimeout(() => {
          this.onHover?.();
        }, 300);
      });
      
      span.addEventListener('mouseleave', (e) => {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
        }
      });
    }
    
    // 클릭 이벤트
    if (this.onClick) {
      span.addEventListener('click', (e) => {
        // 🔧 모바일에서는 터치 이벤트를 사용하므로 클릭 이벤트 무시
        if (Platform.isMobile) {
          Logger.debug('ErrorWidget: 모바일에서 클릭 이벤트 무시 (터치 이벤트 사용)');
          return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        this.onClick?.();
      });
    }
    
    // 접근성 속성 (aria-label 제거 - 네이티브 툴팁 방지)
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');
    
    Logger.debug(`오류 위젯 생성: ${this.error.correction.original}`);
    return span;
  }

  eq(other: ErrorWidget): boolean {
    return this.error.uniqueId === other.error.uniqueId && this.error.isActive === other.error.isActive;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    // 상태가 변경된 경우 DOM 업데이트
    if (!this.error.isActive) {
      dom.style.display = 'none';
      return true;
    }
    return false;
  }
}

/**
 * 오류 데코레이션 추가 Effect
 */
export const addErrorDecorations = StateEffect.define<{
  errors: InlineError[];
  underlineStyle: string;
  underlineColor: string;
}>({
  map: (val, change) => val
});

/**
 * 오류 데코레이션 제거 Effect
 */
export const removeErrorDecorations = StateEffect.define<string[]>({
  map: (val, change) => val
});

/**
 * 모든 오류 데코레이션 지우기 Effect
 */
export const clearAllErrorDecorations = StateEffect.define<boolean>({
  map: (val, change) => val
});

/**
 * 포커스된 오류 설정 Effect
 */
export const setFocusedErrorDecoration = StateEffect.define<string | null>({
  map: (val, change) => val
});

/**
 * 임시 제안 적용 모드 Effect (decoration 자동 제거 방지용)
 */
export const setTemporarySuggestionMode = StateEffect.define<boolean>({
  map: (val, change) => val
});

/**
 * 임시 제안 모드 상태 필드
 */
export const temporarySuggestionModeField = StateField.define<boolean>({
  create() {
    return false;
  },
  
  update(isTemporary, tr) {
    for (let effect of tr.effects) {
      if (effect.is(setTemporarySuggestionMode)) {
        return effect.value;
      }
    }
    return isTemporary;
  }
});

/**
 * 오류 데코레이션 상태 필드
 */
export const errorDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    
    // 임시 제안 모드 확인
    const isTemporaryMode = tr.state.field(temporarySuggestionModeField);
    
    // 임시 제안 모드가 아닐 때만 텍스트 변경 시 오류 제거
    if (tr.docChanged && !isTemporaryMode) {
      const changedRanges: { from: number; to: number }[] = [];
      tr.changes.iterChanges((fromA, toA, fromB, toB) => {
        changedRanges.push({ from: fromA, to: toA });
      });
      
      if (changedRanges.length > 0) {
        // 변경된 범위와 겹치는 데코레이션 제거
        decorations = decorations.update({
          filter: (from, to, decoration) => {
            return !changedRanges.some(range => 
              (from >= range.from && from <= range.to) ||
              (to >= range.from && to <= range.to) ||
              (from <= range.from && to >= range.to)
            );
          }
        });
        
        // activeErrors에서도 제거
        InlineModeService.removeErrorsInRanges(changedRanges);
        
        Logger.debug(`인라인 모드: 텍스트 변경으로 오류 제거됨 (${changedRanges.length}개 범위)`);
      }
    }
    
    for (let effect of tr.effects) {
      if (effect.is(addErrorDecorations)) {
        const { errors, underlineStyle, underlineColor } = effect.value;
        
        const newDecorations = errors.map(error => {
          // 포커스된 오류인지 확인 (현재는 항상 false이지만 나중에 상태 확인)
          const isFocused = false; // TODO: 포커스 상태 확인
          
          // Mark decoration을 사용하여 원본 텍스트를 유지하면서 스타일 적용
          return Decoration.mark({
            class: `korean-grammar-error-inline ${isFocused ? 'korean-grammar-focused' : ''}`,
            attributes: {
              'data-error-id': error.uniqueId,
              'data-original': error.correction.original,
              'data-corrected': JSON.stringify(error.correction.corrected),
              'role': 'button',
              'tabindex': '0'
            },
            // CSS에서 오버라이드되지 않도록 inclusive 방식 사용
            inclusive: false,
            // 🔧 클래스가 아닌 attributes에 스타일 적용
            tagName: isFocused ? 'mark' : 'span'
          }).range(error.start, error.end);
        });
        
        // ⚠️ CRITICAL: CodeMirror 6에서는 decoration이 from 위치 기준으로 정렬되어야 함
        newDecorations.sort((a, b) => a.from - b.from);
        
        decorations = decorations.update({
          add: newDecorations,
          sort: true
        });
      } else if (effect.is(removeErrorDecorations)) {
        const errorIds = effect.value;
        decorations = decorations.update({
          filter: (from, to, decoration) => {
            // Mark decoration의 attributes에서 error-id 확인
            const errorId = decoration.spec.attributes?.['data-error-id'];
            return errorId ? !errorIds.includes(errorId) : true;
          }
        });
      } else if (effect.is(clearAllErrorDecorations)) {
        decorations = Decoration.none;
      } else if (effect.is(setFocusedErrorDecoration)) {
        const focusedErrorId = effect.value;
        Logger.log(`🎯 포커스 decoration 업데이트: ${focusedErrorId}`);
        
        // 모든 decoration을 다시 생성해야 함 (포커스 상태 변경을 위해)
        // 현재 활성 오류들을 가져와서 다시 decoration 생성
        const activeErrorsArray = InlineModeService.getActiveErrors();
        Logger.debug(`🎯 포커스 decoration 업데이트 시작: ${activeErrorsArray.length}개 오류, 타겟: ${focusedErrorId}`);
        
        if (activeErrorsArray.length > 0) {
          const newDecorations = activeErrorsArray.map(error => {
            const isFocused = error.uniqueId === focusedErrorId;
            
            // 디버깅용 로그
            if (isFocused) {
              Logger.debug(`🎯 포커스 매칭: "${error.correction.original}" (${error.uniqueId}) at ${error.start}-${error.end}`);
            }
            
            return Decoration.mark({
              class: `korean-grammar-error-inline ${isFocused ? 'korean-grammar-focused' : ''}`,
              attributes: {
                'data-error-id': error.uniqueId,
                'data-original': error.correction.original,
                'data-corrected': JSON.stringify(error.correction.corrected),
                'role': 'button',
                'tabindex': '0',
                // 인라인 스타일로 강제 적용 (CSS 간섭 방지)
                'style': isFocused ? 
                  'outline: 3px solid var(--color-red) !important; outline-offset: 2px !important; border-radius: 4px !important; text-decoration-line: underline !important; text-decoration-style: wavy !important; text-decoration-color: var(--color-red) !important; text-decoration-thickness: 2px !important;' : 
                  InlineModeService.getErrorStyle('wavy', 'var(--color-red)')
              }
            }).range(error.start, error.end);
          });
          
          // ⚠️ CRITICAL: CodeMirror 6에서는 decoration이 from 위치 기준으로 정렬되어야 함
          newDecorations.sort((a, b) => a.from - b.from);
          
          // 기존 decoration을 모두 지우고 새로 설정
          decorations = Decoration.set(newDecorations);
        }
      }
    }
    
    return decorations;
  },
  
  provide: field => EditorView.decorations.from(field)
});

/**
 * 인라인 모드 서비스
 * 에디터 내에서 실시간 맞춤법 검사 및 오류 표시를 관리
 */
export class InlineModeService {
  private static activeErrors: Map<string, InlineError> = new Map();
  private static currentView: EditorView | null = null;
  private static settings: any = null;
  private static currentFocusedError: InlineError | null = null;
  private static currentSuggestionIndex: number = 0;
  // 🔧 레거시: 기존 키보드 스코프 방식 (Command Palette 방식으로 대체됨)
  // private static keyboardScope: Scope | null = null;
  private static app: App | null = null;
  private static currentHoveredError: InlineError | null = null;
  private static hoverTimeout: NodeJS.Timeout | null = null;

  /**
   * 에디터 뷰 및 설정 초기화
   */
  static setEditorView(view: EditorView, settings?: any, app?: App): void {
    this.currentView = view;
    if (settings) {
      this.settings = settings;
    }
    if (app) {
      this.app = app;
    }
    
    // 이벤트 리스너 추가
    this.setupEventListeners(view);
    
    // 🎹 키보드 단축키는 Command Palette 방식으로 변경됨 (registerCommands 메서드 참조)
    Logger.debug('인라인 모드: Command Palette 기반 키보드 단축키 사용');
    
    Logger.debug('인라인 모드: 에디터 뷰 설정됨');
  }

  /**
   * 이벤트 리스너 설정 (겹치는 오류 영역 처리 개선)
   */
  private static setupEventListeners(view: EditorView): void {
    const editorDOM = view.dom;
    
    // 🎯 커서 위치 변경 모니터링 설정
    this.setupCursorMonitoring(view);
    
    // 호버 이벤트 (정확한 호버된 요소만 처리)
    editorDOM.addEventListener('mouseenter', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('korean-grammar-error-inline')) {
        const errorId = target.getAttribute('data-error-id');
        if (errorId && this.activeErrors.has(errorId)) {
          const error = this.activeErrors.get(errorId)!;
          
          // 이미 동일한 오류에 호버 중이면 무시
          if (this.currentHoveredError?.uniqueId === errorId) {
            Logger.debug(`이미 호버 중인 오류: ${error.correction.original}`);
            return;
          }
          
          // 이전 호버 타이머 취소
          this.clearHoverTimeout();
          
          // CSS :hover 상태가 처리하므로 별도 스타일 적용 불필요
          
          Logger.debug(`새로운 오류 호버 시작: "${error.correction.original}" (ID: ${errorId})`);
          
          // 🔧 마우스 위치 정보 수집
          const mousePosition = { x: e.clientX, y: e.clientY };
          
          // 🎯 컨텍스트 기반 호버 영역 확장
          this.expandHoverAreaByMorphemes(target, error);
          
          this.hoverTimeout = setTimeout(() => {
            // 호버 상태 업데이트 (실제 호버된 오류만 정확히 처리)
            this.currentHoveredError = error;
            this.handleErrorHover(error, target, mousePosition);
          }, 300);
        }
      }
    }, true);
    
    editorDOM.addEventListener('mouseleave', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('korean-grammar-error-inline')) {
        const errorId = target.getAttribute('data-error-id');
        
        // 현재 호버 중인 오류에서 벗어날 때만 처리
        if (this.currentHoveredError?.uniqueId === errorId) {
          Logger.debug(`오류 호버 종료: "${this.currentHoveredError.correction.original}" (ID: ${errorId})`);
          
          // CSS :hover 상태가 자동으로 해제되므로 별도 스타일 복원 불필요
          
          this.clearHoverTimeout();
          
          // 지연 후 호버 상태 해제 (툴팁으로 마우스 이동 시간 확보)
          setTimeout(() => {
            if (this.currentHoveredError?.uniqueId === errorId) {
              this.currentHoveredError = null;
              // 툴팁 자체 호버 처리에 맡김 (강제 숨김 제거)
            }
          }, 150);
        }
      }
    }, true);
    
    // 클릭 이벤트 (안전한 처리)
    editorDOM.addEventListener('click', (e) => {
      try {
        // 🔧 모바일에서는 터치 이벤트를 사용하므로 클릭 이벤트 무시
        if (Platform.isMobile) {
          Logger.debug('모바일에서 클릭 이벤트 무시 (터치 이벤트 사용)');
          return;
        }
        
        const target = e.target as HTMLElement;
        if (target && target.classList && target.classList.contains('korean-grammar-error-inline')) {
          e.preventDefault();
          e.stopPropagation();
          
          const errorId = target.getAttribute('data-error-id');
          if (errorId && this.activeErrors.has(errorId)) {
            const error = this.activeErrors.get(errorId);
            if (error) {
              // 🔧 마우스 위치 정보를 함께 전달
              const mousePosition = { x: e.clientX, y: e.clientY };
              this.handleErrorClick(error, target, mousePosition);
            }
          }
        }
      } catch (err) {
        Logger.error('클릭 이벤트 처리 중 오류:', err);
      }
    }, true);
    
    // 포커스 이벤트 (오류 요소 클릭 시) - 무한 루프 방지 가드 추가
    editorDOM.addEventListener('focus', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('korean-grammar-error-inline')) {
        const errorId = target.getAttribute('data-error-id');
        if (errorId && this.activeErrors.has(errorId)) {
          const error = this.activeErrors.get(errorId)!;
          
          // 이미 같은 오류가 포커스되어 있으면 무한 루프 방지를 위해 스킵
          if (this.currentFocusedError && this.currentFocusedError.uniqueId === error.uniqueId) {
            Logger.debug(`이미 포커스된 오류 스킵: ${error.uniqueId}`);
            return;
          }
          
          this.setFocusedError(error);
        }
      }
    }, true);
    
    Logger.debug('인라인 모드: 이벤트 리스너 설정됨 (정확한 호버 요소만 처리)');

    // 모바일 터치 이벤트 추가
    this.setupMobileTouchEvents(editorDOM);
  }

  /**
   * 모바일 터치 이벤트 설정
   */
  private static setupMobileTouchEvents(editorDOM: HTMLElement): void {
    if (!Platform.isMobile) {
      Logger.debug('데스크톱 환경: 터치 이벤트 등록하지 않음');
      return;
    }

    let touchTimer: NodeJS.Timeout | null = null;
    let touchTarget: HTMLElement | null = null;
    let touchStartTime: number = 0;
    const TOUCH_HOLD_DURATION = 600; // 600ms 롱프레스
    const MAX_TOUCH_MOVE = 10; // 10px 이내 움직임만 허용
    let touchStartPos = { x: 0, y: 0 };

    Logger.log('📱 모바일 터치 이벤트 등록');

    // 터치 시작
    editorDOM.addEventListener('touchstart', (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      
      if (target.classList.contains('korean-grammar-error-inline')) {
        // 🔧 iOS 기본 텍스트 선택 방지
        e.preventDefault();
        
        const touch = e.touches[0];
        touchStartPos = { x: touch.clientX, y: touch.clientY };
        touchStartTime = Date.now();
        touchTarget = target;
        
        const errorId = target.getAttribute('data-error-id');
        if (errorId && this.activeErrors.has(errorId)) {
          const error = this.activeErrors.get(errorId)!;
          
          // 롱프레스 타이머 시작 (툴팁보다 우선)
          touchTimer = setTimeout(() => {
            if (touchTarget === target && this.activeErrors.has(errorId)) {
              Logger.log(`📱 롱프레스로 바로 수정: ${error.correction.original}`);
              
              // 햅틱 피드백
              if ('vibrate' in navigator) {
                navigator.vibrate(50);
              }
              
              // 첫 번째 제안으로 바로 수정
              if (error.correction.corrected && error.correction.corrected.length > 0) {
                const firstSuggestion = error.correction.corrected[0];
                this.applySuggestion(error, firstSuggestion);
                Logger.log(`📱 롱프레스 수정 완료: "${error.correction.original}" → "${firstSuggestion}"`);
              }
              
              // 터치 상태 정리
              touchTarget = null;
              touchTimer = null;
            }
          }, TOUCH_HOLD_DURATION);
          
          Logger.debug(`📱 터치 시작: ${error.correction.original}`);
        }
      }
    }, { passive: false });

    // 터치 끝
    editorDOM.addEventListener('touchend', (e: TouchEvent) => {
      const wasTouchTimer = touchTimer !== null;
      
      // 롱프레스 타이머 취소
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
      
      // 터치 시간이 짧으면 일반 터치로 간주하여 툴팁 표시
      const touchDuration = Date.now() - touchStartTime;
      if (touchDuration < TOUCH_HOLD_DURATION && touchTarget && wasTouchTimer) {
        const target = touchTarget;
        const errorId = target.getAttribute('data-error-id');
        
        if (errorId && this.activeErrors.has(errorId)) {
          const error = this.activeErrors.get(errorId)!;
          Logger.log(`📱 짧은 터치로 툴팁 표시 (${touchDuration}ms): ${error.correction.original}`);
          
          // 🔧 클릭 이벤트 방지
          e.preventDefault();
          e.stopPropagation();
          
          // 짧은 딜레이 후 툴팁 표시
          setTimeout(() => {
            // 🔧 터치 위치 정보를 함께 전달
            const touchPosition = { x: touchStartPos.x, y: touchStartPos.y };
            this.handleErrorTooltip(error, target, touchPosition);
          }, 50);
        }
      }
      
      touchTarget = null;
      touchStartTime = 0;
    }, { passive: false });

    // 터치 취소
    editorDOM.addEventListener('touchcancel', () => {
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
        Logger.debug('📱 터치 취소됨');
      }
      touchTarget = null;
      touchStartTime = 0;
    }, { passive: true });

    // 터치 이동 (스크롤 감지로 롱프레스 취소)
    editorDOM.addEventListener('touchmove', (e: TouchEvent) => {
      if (touchTimer && touchTarget) {
        const touch = e.touches[0];
        const moveDistance = Math.sqrt(
          Math.pow(touch.clientX - touchStartPos.x, 2) + 
          Math.pow(touch.clientY - touchStartPos.y, 2)
        );
        
        // 일정 거리 이상 움직이면 롱프레스 취소
        if (moveDistance > MAX_TOUCH_MOVE) {
          clearTimeout(touchTimer);
          touchTimer = null;
          touchTarget = null;
          Logger.debug(`📱 터치 이동으로 롱프레스 취소 (${Math.round(moveDistance)}px)`);
        }
      }
    }, { passive: true });

    Logger.log('📱 모바일 터치 이벤트 설정 완료');
    Logger.log('  • 터치: 툴팁 표시');
    Logger.log('  • 롱프레스 (600ms): 첫 번째 제안으로 바로 수정');
    Logger.log('  • 햅틱 피드백 지원');
  }

  /**
   * 호버 타이머 정리
   */
  private static clearHoverTimeout(): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }
  }

  /**
   * 🎯 커서 위치 변경 모니터링 설정
   */
  private static setupCursorMonitoring(view: EditorView): void {
    if (!this.app) return;

    // 간단한 포커스 체크를 위한 인터벌 설정 (성능상 문제없음)
    setInterval(() => {
      this.checkCursorPosition();
    }, 500); // 0.5초마다 체크

    Logger.debug('🎯 커서 위치 모니터링 설정 완료');
  }

  /**
   * 🎯 커서 위치 체크 (주기적 호출)
   */
  private static checkCursorPosition(): void {
    // 현재 포커스된 오류가 있을 때만 처리
    if (!this.currentFocusedError || !this.app) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const editor = view.editor;
    const cursor = editor.getCursor();
    const cursorOffset = editor.posToOffset(cursor);

    // 커서가 포커스된 오류 범위를 벗어났는지 확인
    if (cursorOffset < this.currentFocusedError.start || cursorOffset > this.currentFocusedError.end) {
      Logger.debug(`🎯 커서가 포커스 영역을 벗어남: ${cursorOffset} (범위: ${this.currentFocusedError.start}-${this.currentFocusedError.end})`);
      
      // 🔧 수정 롤링 후 커서가 벗어나면 해당 오류를 완전히 제거
      const focusedErrorId = this.currentFocusedError.uniqueId;
      
      // 포커스 해제
      this.clearFocusedError();
      
      // 툴팁도 숨기기
      if ((window as any).globalInlineTooltip) {
        (window as any).globalInlineTooltip.hide();
      }
      
      // 해당 오류를 activeErrors에서 제거하고 decoration도 제거
      if (this.activeErrors.has(focusedErrorId)) {
        this.activeErrors.delete(focusedErrorId);
        
        // decoration 제거
        if (this.currentView) {
          this.currentView.dispatch({
            effects: [removeErrorDecorations.of([focusedErrorId])]
          });
        }
        
        Logger.debug(`🔧 수정 롤링 후 오류 완전 제거: ${focusedErrorId}`);
      }
    }
  }

  /**
   * 🎯 현재 커서 위치에 있는 오류 찾기
   */
  static findErrorAtCursor(): InlineError | null {
    if (!this.app) return null;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;

    const editor = view.editor;
    const cursor = editor.getCursor();
    const cursorOffset = editor.posToOffset(cursor);

    // 모든 활성 오류 중에서 커서 위치가 포함된 오류 찾기
    for (const [, error] of this.activeErrors) {
      if (cursorOffset >= error.start && cursorOffset <= error.end) {
        Logger.debug(`🎯 커서 위치에서 오류 발견: "${error.correction.original}" (${error.start}-${error.end})`);
        return error;
      }
    }

    Logger.debug(`🎯 커서 위치에 오류 없음: ${cursorOffset}`);
    return null;
  }


  /**
   * 설정 업데이트
   */
  static updateSettings(settings: any): void {
    this.settings = settings;
    Logger.debug('인라인 모드: 설정 업데이트됨');
  }

  /**
   * 오류 표시 (형태소 API 통합)
   */
  static async showErrors(
    view: EditorView, 
    corrections: Correction[], 
    underlineStyle: string = 'wavy',
    underlineColor: string = 'var(--color-red)',
    app?: App,
    morphemeData?: any
  ): Promise<void> {
    if (!view || !corrections.length) {
      Logger.warn('인라인 모드: 뷰나 교정 데이터가 없습니다.');
      return;
    }

    // 알림 시작
    const analysisNotice = NotificationUtils.showAnalysisStartNotice('spelling');

    try {
      // 뷰 설정은 setEditorView에서 처리되므로 여기서는 생략
      // (중복 초기화 방지)

      // 기존 오류 제거
      this.clearErrors(view);

      // 에디터 텍스트 가져오기
      const doc = view.state.doc;
      const fullText = doc.toString();

      // 형태소 분석 데이터가 없으면 자동으로 분석 (캐시 활용)
      let finalMorphemeData = morphemeData;
      if (!finalMorphemeData && this.settings) {
        try {
          // 형태소 분석 알림 업데이트
          NotificationUtils.updateNoticeMessage(analysisNotice, '📋 형태소 분석 중...');
          
          const apiService = new SpellCheckApiService();
          finalMorphemeData = await apiService.analyzeMorphemes(fullText, this.settings);
          Logger.debug('인라인 모드: 형태소 분석 완료');
        } catch (error) {
          Logger.warn('인라인 모드: 형태소 분석 실패, 기본 로직 사용:', error);
        }
      }

      // 형태소 API 활용한 중복 제거
      const originalCount = corrections.length;
      const optimizedCorrections = MorphemeUtils.removeDuplicateCorrections(
        corrections, 
        finalMorphemeData, 
        fullText
      );
      
      // 중복 제거 결과 알림
      if (originalCount > optimizedCorrections.length) {
        NotificationUtils.showDuplicateRemovalNotice(
          originalCount, 
          optimizedCorrections.length, 
          !!finalMorphemeData,
          1500
        );
      }

      // 교정 정보를 InlineError로 변환
      const errors: InlineError[] = [];
      
      optimizedCorrections.forEach((correction, index) => {
        const searchText = correction.original;
        let searchIndex = 0;
        let occurrence = 0;
        
        while (true) {
          const foundIndex = fullText.indexOf(searchText, searchIndex);
          if (foundIndex === -1) break;
          
          // 단어 경계 검사 (정확한 매칭을 위해)
          const beforeChar = foundIndex > 0 ? fullText[foundIndex - 1] : ' ';
          const afterChar = foundIndex + searchText.length < fullText.length ? fullText[foundIndex + searchText.length] : ' ';
          
          // 한글/영문 단어 경계 확인 (선택적)
          const isWordBoundary = this.isValidWordBoundary(beforeChar, afterChar, searchText);
          
          if (isWordBoundary) {
            // 🎯 위치 정보를 포함한 더 정확한 uniqueId 생성 (겹치는 오류 구분을 위해)
            const uniqueId = `${index}_${occurrence}_${foundIndex}`;
            const lineInfo = doc.lineAt(foundIndex);
            
            // 형태소 정보 추출 (있다면)
            const posInfo = finalMorphemeData ? 
              MorphemeUtils.extractPosInfo(searchText, finalMorphemeData) : undefined;
            
            const error: InlineError = {
              correction,
              start: foundIndex,
              end: foundIndex + searchText.length,
              line: lineInfo.number,
              ch: foundIndex - lineInfo.from,
              uniqueId,
              isActive: true,
              morphemeInfo: posInfo // 형태소 정보 추가
            };
            
            errors.push(error);
            this.activeErrors.set(uniqueId, error);
            
            Logger.debug(`🎯 오류 위치 설정: "${searchText}" (${uniqueId}) at ${foundIndex}-${foundIndex + searchText.length}${posInfo ? ` [${posInfo.mainPos}]` : ''}`);
            occurrence++;
          }
          
          searchIndex = foundIndex + 1;
        }
      });

      // 🔧 겹치는 오류 병합 (분절 하이라이팅 방지)
      const mergedErrors = this.mergeOverlappingErrors(errors);
      Logger.log(`🔧 오류 병합: ${errors.length}개 → ${mergedErrors.length}개`);
      
      // 병합된 오류 정보 간단 로그
      const mergedCount = mergedErrors.filter(err => err.originalErrors && err.originalErrors.length > 1).length;
      if (mergedCount > 0) {
        Logger.debug(`🔧 병합된 오류: ${mergedCount}개`);
      }

      // 데코레이션 추가
      view.dispatch({
        effects: addErrorDecorations.of({ errors: mergedErrors, underlineStyle, underlineColor })
      });

      // 완료 알림
      NotificationUtils.hideNotice(analysisNotice);
      NotificationUtils.showAnalysisCompleteNotice('spelling', mergedErrors.length, 2000);

    } catch (error) {
      Logger.error('인라인 모드 오류 표시 실패:', error);
      
      // 오류 알림
      NotificationUtils.hideNotice(analysisNotice);
      NotificationUtils.showApiErrorNotice('general', error.message);
    }

    Logger.log(`인라인 모드: 맞춤법 검사 처리 완료`);
  }

  /**
   * 겹치는 오류들을 병합하여 분절된 하이라이팅 방지
   */
  private static mergeOverlappingErrors(errors: InlineError[]): InlineError[] {
    if (errors.length <= 1) return errors;

    // 위치 기준으로 정렬
    const sortedErrors = [...errors].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return a.end - b.end;
    });

    const merged: InlineError[] = [];
    let current = sortedErrors[0];

    for (let i = 1; i < sortedErrors.length; i++) {
      const next = sortedErrors[i];
      
      // 겹치거나 매우 가까운 경우 병합 (1글자 이내 간격)
      const isOverlapping = current.end > next.start;
      const isAdjacent = current.end >= next.start - 1;
      
      if (isOverlapping || isAdjacent) {
        const doc = this.currentView?.state.doc;
        const mergedStart = Math.min(current.start, next.start);
        const mergedEnd = Math.max(current.end, next.end);
        const mergedText = doc?.sliceString(mergedStart, mergedEnd) || '';
        
        // 디버그 정보 개선 (병합 전 텍스트 저장)
        const currentText = doc?.sliceString(current.start, current.end) || current.correction.original;
        const nextText = doc?.sliceString(next.start, next.end) || next.correction.original;
        
        // 원본 오류들 수집 (재귀적으로 병합된 경우도 고려)
        const originalErrors: InlineError[] = [];
        if (current.isMerged && current.originalErrors) {
          originalErrors.push(...current.originalErrors);
        } else {
          originalErrors.push(current);
        }
        
        if (next.isMerged && next.originalErrors) {
          originalErrors.push(...next.originalErrors);
        } else {
          originalErrors.push(next);
        }
        
        // 병합된 교정 제안 생성 (중복 제거)
        const mergedCorrected = [...new Set([
          ...current.correction.corrected,
          ...next.correction.corrected
        ])];
        
        // 병합된 오류 생성
        const mergedError: InlineError = {
          correction: {
            original: mergedText,
            corrected: mergedCorrected,
            help: current.correction.help || next.correction.help
          },
          start: mergedStart,
          end: mergedEnd,
          line: current.line,
          ch: current.ch,
          uniqueId: `merged_${current.uniqueId}_${next.uniqueId}`,
          isActive: true,
          isMerged: true,
          originalErrors: originalErrors // 원본 오류들 보존
        };
        
        // activeErrors 맵 업데이트
        this.activeErrors.delete(current.uniqueId);
        this.activeErrors.delete(next.uniqueId);
        this.activeErrors.set(mergedError.uniqueId, mergedError);
        
        current = mergedError;
        
        Logger.debug(`🔗 오류 병합: "${currentText}" (${current.start}-${current.end}) + "${nextText}" (${next.start}-${next.end}) → "${mergedText}" (${mergedStart}-${mergedEnd}), 원본 오류 ${originalErrors.length}개 보존`);
      } else {
        // 겹치지 않으면 현재 오류를 결과에 추가하고 다음으로 이동
        merged.push(current);
        current = next;
      }
    }
    
    // 마지막 오류 추가
    merged.push(current);
    
    return merged;
  }

  /**
   * 특정 오류 제거
   */
  static removeError(view: EditorView | null, errorId: string): void {
    const targetView = view || this.currentView;
    if (!targetView || !this.activeErrors.has(errorId)) return;

    this.activeErrors.delete(errorId);
    
    targetView.dispatch({
      effects: removeErrorDecorations.of([errorId])
    });

    Logger.debug(`인라인 모드: 오류 제거됨 (${errorId})`);
  }

  /**
   * 모든 오류 제거
   */
  static clearErrors(view: EditorView): void {
    if (!view) return;

    this.activeErrors.clear();
    
    view.dispatch({
      effects: clearAllErrorDecorations.of(true)
    });

    Logger.debug('인라인 모드: 모든 오류 제거됨');
  }

  /**
   * 특정 범위의 오류들을 activeErrors에서 제거
   */
  static removeErrorsInRanges(ranges: { from: number; to: number }[]): void {
    const errorsToRemove: string[] = [];
    
    this.activeErrors.forEach((error, errorId) => {
      const errorOverlaps = ranges.some(range => 
        (error.start >= range.from && error.start <= range.to) ||
        (error.end >= range.from && error.end <= range.to) ||
        (error.start <= range.from && error.end >= range.to)
      );
      
      if (errorOverlaps) {
        errorsToRemove.push(errorId);
      }
    });
    
    errorsToRemove.forEach(errorId => {
      this.activeErrors.delete(errorId);
    });
    
    if (errorsToRemove.length > 0) {
      Logger.debug(`인라인 모드: activeErrors에서 ${errorsToRemove.length}개 오류 제거됨`);
    }
  }

  /**
   * 텍스트 범위의 오류 제거 (사용자 편집 시)
   */
  static removeErrorsInRange(view: EditorView, from: number, to: number): void {
    if (!view) return;

    const errorsToRemove: string[] = [];
    
    this.activeErrors.forEach((error, errorId) => {
      // 편집 범위와 겹치는 오류 찾기
      if (error.start < to && error.end > from) {
        errorsToRemove.push(errorId);
      }
    });

    if (errorsToRemove.length > 0) {
      errorsToRemove.forEach(id => this.activeErrors.delete(id));
      
      view.dispatch({
        effects: removeErrorDecorations.of(errorsToRemove)
      });

      Logger.debug(`인라인 모드: 범위 내 ${errorsToRemove.length}개 오류 제거됨`);
    }
  }

  /**
   * 오류 호버 핸들러
   */
  static handleErrorHover(error: InlineError, hoveredElement?: HTMLElement, mousePosition?: { x: number; y: number }): void {
    Logger.debug(`인라인 모드: 오류 호버 - ${error.correction.original}`);
    
    // 🎯 새로운 통합 툴팁 방식: 플랫폼과 설정에 따른 스마트 판단
    const shouldShowTooltip = this.shouldShowTooltipOnInteraction('hover');
    
    if (shouldShowTooltip) {
      // 실제 호버된 요소가 전달되면 그것을 사용, 없으면 기존 방식으로 찾기
      const targetElement = hoveredElement || this.findErrorElement(error);
      if (targetElement && (window as any).globalInlineTooltip) {
        // 툴팁 표시 (마우스 위치 정보 포함)
        (window as any).globalInlineTooltip.show(error, targetElement, 'hover', mousePosition);
      }
    }
  }

  /**
   * 오류 클릭 핸들러
   */
  static handleErrorClick(error: InlineError, clickedElement?: HTMLElement, mousePosition?: { x: number; y: number }): void {
    Logger.log(`인라인 모드: 오류 클릭 - ${error.correction.original}`);
    
    try {
      // 기존 툴팁 먼저 숨기기
      if ((window as any).globalInlineTooltip) {
        (window as any).globalInlineTooltip.hide();
      }
      
      // 첫 번째 수정 제안으로 바로 적용
      if (error.correction.corrected && error.correction.corrected.length > 0) {
        const firstSuggestion = error.correction.corrected[0];
        this.applySuggestion(error, firstSuggestion);
        Logger.log(`인라인 모드: 첫 번째 제안 자동 적용 - "${error.correction.original}" → "${firstSuggestion}"`);
      } else {
        Logger.warn(`인라인 모드: 수정 제안이 없습니다 - ${error.correction.original}`);
      }
    } catch (err) {
      Logger.error('오류 클릭 처리 중 문제 발생:', err);
      
      // 에러 발생 시에도 툴팁 숨기기
      if ((window as any).globalInlineTooltip) {
        (window as any).globalInlineTooltip.hide();
      }
    }
  }

  /**
   * 오류 툴팁 표시 핸들러 (바로 적용하지 않고 툴팁만 표시)
   */
  static handleErrorTooltip(error: InlineError, targetElement?: HTMLElement, touchPosition?: { x: number; y: number }): void {
    Logger.log(`인라인 모드: 오류 툴팁 표시 - ${error.correction.original}`);
    
    try {
      // 실제 타겟 요소가 전달되면 그것을 사용, 없으면 기존 방식으로 찾기
      const element = targetElement || this.findErrorElement(error);
      if (element) {
        // 🔧 마우스/터치 위치 정보를 툴팁에 전달
        globalInlineTooltip.show(error, element, 'click', touchPosition);
      } else {
        Logger.warn(`인라인 모드: 타겟 요소를 찾을 수 없습니다 - ${error.correction.original}`);
      }
    } catch (err) {
      Logger.error('오류 툴팁 표시 중 문제 발생:', err);
    }
  }

  /**
   * 현재 활성화된 오류 목록 반환 (위치 기준 정렬)
   */
  static getActiveErrors(): InlineError[] {
    const errors = Array.from(this.activeErrors.values());
    
    // 🎯 키보드 네비게이션 개선: 위치 기준으로 정렬하여 순차적 이동 보장
    return errors.sort((a, b) => {
      // 1차: 시작 위치 기준 정렬
      if (a.start !== b.start) {
        return a.start - b.start;
      }
      // 2차: 끝 위치 기준 정렬 (겹치는 경우 짧은 것 우선)
      if (a.end !== b.end) {
        return a.end - b.end;
      }
      // 3차: uniqueId 기준 정렬 (안정적인 순서 보장)
      return a.uniqueId.localeCompare(b.uniqueId);
    });
  }

  /**
   * 특정 위치의 오류 찾기
   */
  static getErrorAtPosition(pos: number): InlineError | null {
    for (const error of this.activeErrors.values()) {
      if (pos >= error.start && pos <= error.end) {
        return error;
      }
    }
    return null;
  }

  /**
   * 오류에 해당하는 DOM 요소 찾기 (위치 기반 정확한 매칭)
   */
  static findErrorElement(error: InlineError): HTMLElement | null {
    // 먼저 data-error-id로 정확한 요소 찾기
    const exactElement = document.querySelector(`[data-error-id="${error.uniqueId}"]`);
    if (exactElement) {
      return exactElement as HTMLElement;
    }
    
    // 폴백: 클래스명과 텍스트로 해당 요소 찾기 (기존 방식)
    const errorElements = document.querySelectorAll('.korean-grammar-error-inline');
    
    for (let i = 0; i < errorElements.length; i++) {
      const element = errorElements[i];
      if (element.textContent === error.correction.original) {
        Logger.warn(`정확한 ID 매칭 실패, 텍스트 기반 매칭 사용: ${error.correction.original}`);
        return element as HTMLElement;
      }
    }
    
    Logger.warn(`오류 요소를 찾을 수 없음: ${error.correction.original} (ID: ${error.uniqueId})`);
    return null;
  }

  /**
   * 수정 제안 적용
   */
  static applySuggestion(error: InlineError, suggestion: string): void {
    if (!this.currentView) {
      Logger.error('에디터 뷰가 설정되지 않음');
      return;
    }

    try {
      // 병합된 오류인 경우 개별 적용 처리
      if (error.isMerged && error.originalErrors) {
        this.applyIndividualSuggestion(error, suggestion);
        return;
      }

      // 일반 오류인 경우 기존 로직 사용
      this.applySingleSuggestion(error, suggestion);
    } catch (err) {
      Logger.error('수정 제안 적용 중 오류:', err);
    }
  }

  /**
   * 개별 교정 제안 적용 (병합된 오류에서 특정 부분만 교체)
   */
  private static applyIndividualSuggestion(mergedError: InlineError, suggestion: string): void {
    if (!mergedError.originalErrors || !this.currentView) return;

    // 제안과 일치하는 원본 오류 찾기
    const targetError = mergedError.originalErrors.find(originalError => 
      originalError.correction.corrected.includes(suggestion)
    );

    if (!targetError) {
      Logger.warn(`일치하는 원본 오류를 찾을 수 없음: ${suggestion}`);
      return;
    }

    Logger.debug(`🎯 개별 교정 적용: "${targetError.correction.original}" → "${suggestion}" (${targetError.start}-${targetError.end})`);

    // 개별 오류만 교체
    this.applySingleSuggestion(targetError, suggestion);

    // 병합된 오류에서 해당 원본 오류 제거
    mergedError.originalErrors = mergedError.originalErrors.filter(err => err.uniqueId !== targetError.uniqueId);
    
    // 원본 오류가 모두 처리되면 병합된 오류도 제거
    if (mergedError.originalErrors.length === 0) {
      this.removeError(this.currentView, mergedError.uniqueId);
    } else {
      // 남은 오류들로 병합된 오류 업데이트
      this.updateMergedErrorAfterIndividualApplication(mergedError);
    }
  }

  /**
   * 단일 오류에 대한 교정 제안 적용
   */
  private static applySingleSuggestion(error: InlineError, suggestion: string): void {
    if (!this.currentView) return;

    // 현재 문서에서 실제 텍스트 확인
    const doc = this.currentView.state.doc;
    const actualText = doc.sliceString(error.start, error.end);
    
    Logger.debug(`텍스트 교체 시도: 범위[${error.start}-${error.end}], 예상="${error.correction.original}", 실제="${actualText}", 교체="${suggestion}"`);
    
    // 실제 텍스트가 예상과 다르면 정확한 위치 재검색
    let fromPos = error.start;
    let toPos = error.end;
    
    if (actualText !== error.correction.original) {
      Logger.warn(`텍스트 불일치 감지, 재검색 시도: "${error.correction.original}"`);
      
      // 전체 문서에서 해당 텍스트 재검색
      const fullText = doc.toString();
      const searchIndex = fullText.indexOf(error.correction.original, Math.max(0, error.start - 100));
      
      if (searchIndex !== -1) {
        fromPos = searchIndex;
        toPos = searchIndex + error.correction.original.length;
        Logger.debug(`재검색 성공: 새 범위[${fromPos}-${toPos}]`);
      } else {
        Logger.error(`재검색 실패: "${error.correction.original}" 텍스트를 찾을 수 없음`);
        return;
      }
    }

    // 텍스트 교체 (확실한 범위로)
    this.currentView.dispatch({
      changes: {
        from: fromPos,
        to: toPos,
        insert: suggestion
      }
    });

    // 해당 오류 제거 (교체 후)
    this.removeError(this.currentView, error.uniqueId);

    // 툴팁 유지 모드가 아닐 때만 툴팁 숨기기
    const isKeepOpenMode = (window as any).tooltipKeepOpenMode;
    if (!isKeepOpenMode) {
      // 툴팁 숨기기 (확실하게)
      if ((window as any).globalInlineTooltip) {
        (window as any).globalInlineTooltip.hide();
      }
      
      // 키보드 네비게이션 모드도 해제
      this.clearFocusedError();
    } else {
      Logger.debug('툴팁 유지 모드: 툴팁 숨기기 건너뜀');
    }

    // 최종 적용 시 임시 제안 모드 해제
    if (this.currentView) {
      this.currentView.dispatch({
        effects: [setTemporarySuggestionMode.of(false)]
      });
      Logger.debug('🎯 최종 적용: 임시 제안 모드 해제');
    }

    Logger.log(`인라인 모드: 교정 완료 - "${error.correction.original}" → "${suggestion}"`);
  }

  /**
   * 개별 적용 후 병합된 오류 업데이트
   */
  private static updateMergedErrorAfterIndividualApplication(mergedError: InlineError): void {
    if (!mergedError.originalErrors || !this.currentView) return;

    // 남은 원본 오류들로 새로운 범위 계산
    const remainingErrors = mergedError.originalErrors;
    const newStart = Math.min(...remainingErrors.map(err => err.start));
    const newEnd = Math.max(...remainingErrors.map(err => err.end));
    
    const doc = this.currentView.state.doc;
    const newText = doc.sliceString(newStart, newEnd);
    
    // 남은 교정 제안들 수집
    const remainingCorrected = [...new Set(
      remainingErrors.flatMap(err => err.correction.corrected)
    )];

    // 병합된 오류 정보 업데이트
    mergedError.start = newStart;
    mergedError.end = newEnd;
    mergedError.correction.original = newText;
    mergedError.correction.corrected = remainingCorrected;

    // activeErrors 맵 업데이트
    this.activeErrors.set(mergedError.uniqueId, mergedError);

    // decoration 업데이트를 위해 다시 표시 (getErrorStyle 메서드 사용)
    const mergedErrors = [mergedError];
    
    Logger.debug(`🔧 병합된 오류 decoration 업데이트: "${mergedError.correction.original}"`);
    
    // 🔧 기존 병합된 오류의 decoration을 먼저 제거하고 새로 추가
    // CSS 클래스 기반 스타일링 사용 (하드코딩된 색상 제거)
    // 🔧 다크모드 디버깅: 강제로 다크모드 감지 및 색상 적용
    const isDarkMode = document.body.classList.contains('theme-dark');
    const debugColor = isDarkMode ? '#fb464c' : '#e93147'; // 다크모드에서 강제 색상
    
    Logger.debug(`🎨 다크모드 감지: ${isDarkMode}, 적용 색상: ${debugColor}`);
    
    this.currentView.dispatch({
      effects: [
        removeErrorDecorations.of([mergedError.uniqueId]), // 기존 제거
        addErrorDecorations.of({ 
          errors: mergedErrors, 
          underlineStyle: 'wavy', 
          underlineColor: isDarkMode ? debugColor : 'var(--color-red)'  // 다크모드에서만 강제 색상
        })
      ]
    });

    // 툴팁이 표시 중이면 업데이트된 내용으로 다시 표시
    if ((window as any).globalInlineTooltip && (window as any).globalInlineTooltip.visible) {
      setTimeout(() => {
        const errorElement = this.findErrorElement(mergedError);
        if (errorElement && (window as any).globalInlineTooltip) {
          // 기존 툴팁 숨기고 새로 표시
          (window as any).globalInlineTooltip.hide();
          setTimeout(() => {
            (window as any).globalInlineTooltip.show(mergedError, errorElement, 'click');
          }, 50);
        }
      }, 100);
    }

    Logger.debug(`🔄 병합된 오류 업데이트: ${remainingErrors.length}개 오류 남음, 새 범위[${newStart}-${newEnd}], 툴팁 재표시 예약`);
  }

  /**
   * 🔧 레거시 메서드: 키보드 스코프 초기화 (Command Palette 방식으로 대체됨)
   */
  static initializeKeyboardScope(): void {
    Logger.log('🔧 레거시: initializeKeyboardScope 호출됨 - Command Palette 방식으로 변경됨');
    Logger.log('💡 사용법: Command Palette (Cmd+P)에서 "Korean Grammar Assistant" 검색');
    Logger.log('💡 또는 Settings > Hotkeys에서 직접 단축키 설정');
    return;

    /* 🔧 레거시 코드 (Command Palette 방식으로 대체됨)
    
    // Cmd+Option+J: 다음 오류로 이동 (맥 친화적 조합)
    this.keyboardScope.register(['Mod', 'Alt'], 'KeyJ', (evt) => {
      Logger.log('🎹 Cmd+Option+J 키 감지됨');
      // 인라인 모드가 활성화되지 않았으면 이벤트 패스
      if (this.activeErrors.size === 0 || !this.currentView) {
        Logger.log(`❌ 조건 실패: activeErrors.size=${this.activeErrors.size}, currentView=${!!this.currentView}`);
        return false;
      }
      
      // 정렬된 오류 배열 사용 (위치 기준)
      const sortedErrors = this.getActiveErrors();
      const currentIndex = this.currentFocusedError 
        ? sortedErrors.findIndex(error => error.uniqueId === this.currentFocusedError!.uniqueId)
        : -1;
      
      const nextIndex = (currentIndex + 1) % sortedErrors.length;
      const nextError = sortedErrors[nextIndex];
      if (nextError) {
        // 기존 툴팁 먼저 숨기기
        if ((window as any).globalInlineTooltip) {
          (window as any).globalInlineTooltip.hide();
        }
        
        this.setFocusedError(nextError);
        Logger.log(`✅ 다음 오류로 이동: ${nextError.correction.original}`);
      } else {
        Logger.warn('❌ 다음 오류를 찾을 수 없음');
      }
      
      evt.preventDefault();
      return false;
    });
    
    // Cmd+Option+K: 이전 오류로 이동 (맥 친화적 조합)
    this.keyboardScope.register(['Mod', 'Alt'], 'KeyK', (evt) => {
      Logger.log('🎹 Cmd+Option+K 키 감지됨');
      if (this.activeErrors.size === 0 || !this.currentView) {
        Logger.log(`❌ 조건 실패: activeErrors.size=${this.activeErrors.size}, currentView=${!!this.currentView}`);
        return false;
      }
      
      // 정렬된 오류 배열 사용 (위치 기준)
      const sortedErrors = this.getActiveErrors();
      const currentIndex = this.currentFocusedError 
        ? sortedErrors.findIndex(error => error.uniqueId === this.currentFocusedError!.uniqueId)
        : -1;
      
      const prevIndex = currentIndex <= 0 ? sortedErrors.length - 1 : currentIndex - 1;
      const prevError = sortedErrors[prevIndex];
      if (prevError) {
        // 기존 툴팁 먼저 숨기기
        if ((window as any).globalInlineTooltip) {
          (window as any).globalInlineTooltip.hide();
        }
        
        this.setFocusedError(prevError);
        Logger.log(`✅ 이전 오류로 이동: ${prevError.correction.original}`);
      } else {
        Logger.warn('❌ 이전 오류를 찾을 수 없음');
      }
      
      evt.preventDefault();
      return false;
    });
    
    // Cmd+Option+H: 이전 제안 (맥 친화적 조합)
    this.keyboardScope.register(['Mod', 'Alt'], 'KeyH', (evt) => {
      Logger.log('🎹 Cmd+Option+H 키 감지됨');
      if (!this.currentFocusedError || !this.currentView || !this.currentFocusedError.correction) {
        Logger.log('❌ 포커스된 오류가 없거나 조건 실패');
        return false;
      }
      
      // 🎯 원문 포함한 전체 제안 목록 (원문 → 제안1 → 제안2 → ...)
      const suggestions = [this.currentFocusedError.correction.original, ...this.currentFocusedError.correction.corrected];
      if (!suggestions || suggestions.length === 0) {
        Logger.log('❌ 제안이 없음');
        return false;
      }
      
      // 🎯 순환 구조로 이전 제안 인덱스 이동 (처음에서 끝으로)
      this.currentSuggestionIndex = (this.currentSuggestionIndex - 1 + suggestions.length) % suggestions.length;
      this.updateTooltipHighlight();
      Logger.log(`✅ 이전 제안: ${suggestions[this.currentSuggestionIndex]} (${this.currentSuggestionIndex + 1}/${suggestions.length})`);
      evt.preventDefault();
      return false;
    });
    
    // Cmd+Option+L: 다음 제안 (맥 친화적 조합)
    this.keyboardScope.register(['Mod', 'Alt'], 'KeyL', (evt) => {
      Logger.log('🎹 Cmd+Option+L 키 감지됨');
      if (!this.currentFocusedError || !this.currentView || !this.currentFocusedError.correction) {
        Logger.log('❌ 포커스된 오류가 없거나 조건 실패');
        return false;
      }
      
      // 🎯 원문 포함한 전체 제안 목록 (원문 → 제안1 → 제안2 → ...)
      const suggestions = [this.currentFocusedError.correction.original, ...this.currentFocusedError.correction.corrected];
      if (!suggestions || suggestions.length === 0) {
        Logger.log('❌ 제안이 없음');
        return false;
      }
      
      // 🎯 순환 구조로 다음 제안 인덱스 이동 (끝에서 처음으로)
      this.currentSuggestionIndex = (this.currentSuggestionIndex + 1) % suggestions.length;
      
      // 🎯 실제 텍스트에 바로 반영 (Notice 대신)
      this.applyCurrentSuggestionTemporarily();
      
      // Notice 제거 - 텍스트에서 직접 확인 가능
      // new Notice(`다음 제안: ${suggestions[this.currentSuggestionIndex]} (${this.currentSuggestionIndex + 1}/${suggestions.length})`);
      Logger.log(`✅ 다음 제안 적용: ${suggestions[this.currentSuggestionIndex]} (${this.currentSuggestionIndex + 1}/${suggestions.length})`);
      evt.preventDefault();
      return false;
    });
    
    // Cmd+Option+Enter: 제안 적용 (맥 친화적 조합)
    this.keyboardScope.register(['Mod', 'Alt'], 'Enter', (evt) => {
      Logger.log('🎹 Cmd+Option+Enter 키 감지됨');
      if (!this.currentFocusedError || !this.currentView || !this.currentFocusedError.correction) {
        Logger.log('❌ 포커스된 오류가 없거나 조건 실패');
        return false;
      }
      
      // 🎯 원문 포함한 전체 제안 목록 (원문 → 제안1 → 제안2 → ...)
      const suggestions = [this.currentFocusedError.correction.original, ...this.currentFocusedError.correction.corrected];
      if (!suggestions || suggestions.length === 0) {
        Logger.log('❌ 제안이 없음');
        return false;
      }
      
      const selectedSuggestion = suggestions[this.currentSuggestionIndex];
      const originalText = this.currentFocusedError.correction.original;
      this.applySuggestion(this.currentFocusedError, selectedSuggestion);
      this.clearFocusedError();
      Logger.log(`✅ 제안 적용: "${originalText}" → "${selectedSuggestion}"`);
      evt.preventDefault();
      return false;
    });
    
    // Cmd+Option+Escape: 포커스 해제 (맥 친화적 조합)
    this.keyboardScope.register(['Mod', 'Alt'], 'Escape', (evt) => {
      Logger.log('🎹 Cmd+Option+Escape 키 감지됨');
      if (!this.currentFocusedError || !this.currentView) {
        Logger.log('❌ 포커스된 오류가 없음');
        return false;
      }
      
      this.clearFocusedError();
      Logger.log('✅ 키보드 네비게이션 해제');
      evt.preventDefault();
      return false;
    });

    // 백업 키 조합들 (기존 사용자를 위해 유지)
    // Ctrl+Shift+Enter: 제안 적용 (호환성 유지)
    this.keyboardScope.register(['Ctrl', 'Shift'], 'Enter', (evt) => {
      Logger.log('🎹 Ctrl+Shift+Enter 키 감지됨 (호환성)');
      if (!this.currentFocusedError || !this.currentView || !this.currentFocusedError.correction) return false;
      
      // 🎯 원문 포함한 전체 제안 목록 (원문 → 제안1 → 제안2 → ...)
      const suggestions = [this.currentFocusedError.correction.original, ...this.currentFocusedError.correction.corrected];
      if (!suggestions || suggestions.length === 0) return false;
      
      const selectedSuggestion = suggestions[this.currentSuggestionIndex];
      const originalText = this.currentFocusedError.correction.original;
      this.applySuggestion(this.currentFocusedError, selectedSuggestion);
      this.clearFocusedError();
      Logger.log(`✅ 제안 적용 (호환성): "${originalText}" → "${selectedSuggestion}"`);
      evt.preventDefault();
      return false;
    });

    // 대안 키 조합들 (더 간단한 접근성)
    // Option+]: 다음 오류로 이동
    this.keyboardScope.register(['Alt'], 'BracketRight', (evt) => {
      Logger.log('🎹 Option+] 키 감지됨');
      if (this.activeErrors.size === 0 || !this.currentView) {
        Logger.log(`❌ 조건 실패: activeErrors.size=${this.activeErrors.size}, currentView=${!!this.currentView}`);
        return false;
      }
      
      const sortedErrors = this.getActiveErrors();
      const currentIndex = this.currentFocusedError 
        ? sortedErrors.findIndex(error => error.uniqueId === this.currentFocusedError!.uniqueId)
        : -1;
      
      const nextIndex = (currentIndex + 1) % sortedErrors.length;
      const nextError = sortedErrors[nextIndex];
      if (nextError) {
        if ((window as any).globalInlineTooltip) {
          (window as any).globalInlineTooltip.hide();
        }
        this.setFocusedError(nextError);
        Logger.log(`✅ 다음 오류로 이동 (Option+]): ${nextError.correction.original}`);
      }
      
      evt.preventDefault();
      return false;
    });

    // Option+[: 이전 오류로 이동
    this.keyboardScope.register(['Alt'], 'BracketLeft', (evt) => {
      Logger.log('🎹 Option+[ 키 감지됨');
      if (this.activeErrors.size === 0 || !this.currentView) {
        Logger.log(`❌ 조건 실패: activeErrors.size=${this.activeErrors.size}, currentView=${!!this.currentView}`);
        return false;
      }
      
      const sortedErrors = this.getActiveErrors();
      const currentIndex = this.currentFocusedError 
        ? sortedErrors.findIndex(error => error.uniqueId === this.currentFocusedError!.uniqueId)
        : -1;
      
      const prevIndex = currentIndex <= 0 ? sortedErrors.length - 1 : currentIndex - 1;
      const prevError = sortedErrors[prevIndex];
      if (prevError) {
        if ((window as any).globalInlineTooltip) {
          (window as any).globalInlineTooltip.hide();
        }
        this.setFocusedError(prevError);
        Logger.log(`✅ 이전 오류로 이동 (Option+[): ${prevError.correction.original}`);
      }
      
      evt.preventDefault();
      return false;
    });

    // 스코프를 앱의 키맵에 푸시
    this.app.keymap.pushScope(this.keyboardScope);

    Logger.log('🎹 인라인 모드: 키보드 스코프 초기화 완료!');
    Logger.log('📋 사용 가능한 키 조합:');
    Logger.log('  • Cmd+Option+J/K: 다음/이전 오류');
    Logger.log('  • Cmd+Option+H/L: 이전/다음 제안');
    Logger.log('  • Cmd+Option+Enter: 제안 적용');
    Logger.log('  • Cmd+Option+Escape: 포커스 해제');
    Logger.log('  • Option+[/]: 이전/다음 오류 (대안)');
    Logger.log('  • Ctrl+Shift+Enter: 제안 적용 (호환성)');
    */
  }

  /**
   * 포커스된 오류 설정
   */
  static setFocusedError(error: InlineError): void {
    // 이전 포커스 제거
    if (this.currentFocusedError) {
      this.removeFocusHighlight(this.currentFocusedError);
    }
    
    this.currentFocusedError = error;
    this.currentSuggestionIndex = 0;
    
    // 해당 오류 요소에 포커스 표시
    this.highlightFocusedError(error);
    
    // 에디터 커서를 해당 오류 위치로 이동
    this.moveEditorCursorToError(error);
    
    Logger.debug(`오류 포커스 설정: ${error.correction.original}`);
  }

  /**
   * 포커스된 오류 해제
   */
  static clearFocusedError(): void {
    if (this.currentFocusedError) {
      this.removeFocusHighlight(this.currentFocusedError);
    }
    
    this.currentFocusedError = null;
    this.currentSuggestionIndex = 0;
    
    // 툴팁 숨기기
    if ((window as any).globalInlineTooltip) {
      (window as any).globalInlineTooltip.hide();
    }
    
    Logger.debug('오류 포커스 해제');
  }

  /**
   * 포커스된 오류에 대한 툴팁 표시
   */
  static showTooltipForFocusedError(): void {
    if (!this.currentFocusedError) return;
    
    // 오류에 해당하는 DOM 요소 찾기
    const elements = document.querySelectorAll(`[data-error-id="${this.currentFocusedError.uniqueId}"]`);
    if (elements.length > 0) {
      const targetElement = elements[0] as HTMLElement;
      globalInlineTooltip.show(this.currentFocusedError, targetElement, 'click');
      Logger.debug(`포커스된 오류에 툴팁 표시: ${this.currentFocusedError.correction.original}`);
    }
  }

  /**
   * 포커스된 오류 하이라이트 (CodeMirror 6 decoration 사용)
   */
  static highlightFocusedError(error: InlineError): void {
    if (!this.currentView) {
      Logger.warn('에디터 뷰가 없어 포커스 하이라이트 실패');
      return;
    }
    
    Logger.log(`🎯 CodeMirror decoration으로 포커스 하이라이트: "${error.correction.original}" (${error.uniqueId}) at ${error.start}-${error.end}`);
    
    // 현재 모든 활성 오류 로그 (디버깅용)
    const allErrors = this.getActiveErrors();
    Logger.debug(`🎯 현재 활성 오류들: ${allErrors.map(e => `"${e.correction.original}"(${e.uniqueId})[${e.start}-${e.end}]`).join(', ')}`);
    
    // StateEffect를 사용해서 decoration 업데이트
    this.currentView.dispatch({
      effects: [setFocusedErrorDecoration.of(error.uniqueId)]
    });
    
    Logger.log(`🎯 포커스 decoration dispatch 완료: ${error.uniqueId}`);
  }

  /**
   * 에디터 커서를 오류 위치로 이동
   */
  static moveEditorCursorToError(error: InlineError): void {
    if (!this.currentView) return;
    
    try {
      // 에디터 커서를 오류 시작 위치로 이동
      const cursorPos = error.start;
      this.currentView.dispatch({
        selection: { anchor: cursorPos, head: cursorPos },
        scrollIntoView: true
      });
      
      Logger.debug(`커서 이동: ${error.correction.original} (위치: ${error.start})`);
    } catch (e) {
      Logger.warn('커서 이동 실패:', e);
    }
  }

  /**
   * 포커스 하이라이트 제거 (CodeMirror 6 decoration 사용)
   */
  static removeFocusHighlight(error: InlineError): void {
    if (!this.currentView) {
      Logger.warn('에디터 뷰가 없어 포커스 하이라이트 제거 실패');
      return;
    }
    
    Logger.debug(`🔄 포커스 decoration 제거: "${error.correction.original}"`);
    
    // StateEffect를 사용해서 포커스 해제 (null로 설정)
    this.currentView.dispatch({
      effects: [setFocusedErrorDecoration.of(null)]
    });
    
    Logger.debug(`🔄 포커스 decoration 제거 완료`);
  }

  /**
   * 단어 경계 유효성 검사
   */
  static isValidWordBoundary(beforeChar: string, afterChar: string, searchText: string): boolean {
    // 구두점이나 특수문자는 대부분 유효한 경계
    const punctuation = /[\s.,;:!?'"()[\]{}<>]/;
    
    // 간단한 경계 검사 (대부분의 경우 true 반환)
    return true;
  }

  /**
   * 툴팁의 수정 제안 하이라이트 업데이트 - 제거됨 (사용자 요청)
   */
  static updateTooltipHighlight(): void {
    // 키보드 네비게이션 하이라이트 기능 비활성화
    // 모든 제안 버튼이 동일한 색깔로 표시됨
    return;
  }

  /**
   * 서비스 정리 (메모리 누수 방지)
   */
  static cleanup(): void {
    this.activeErrors.clear();
    this.currentView = null;
    this.settings = null;
    this.currentFocusedError = null;
    this.currentSuggestionIndex = 0;
    this.currentHoveredError = null;
    
    // 타이머 정리
    this.clearHoverTimeout();
    
    // 🔧 레거시: 키보드 스코프 정리 (Command Palette 방식에서는 불필요)
    // if (this.keyboardScope) {
    //   this.keyboardScope = null;
    // }
    
    // 툴팁 정리
    if ((window as any).globalInlineTooltip?.visible) {
      (window as any).globalInlineTooltip.hide();
    }
    
    Logger.debug('인라인 모드: 서비스 정리됨 (겹치는 영역 처리 포함)');
  }

  /**
   * 인라인 모드 명령어 등록 (Command Palette 방식)
   */
  static registerCommands(plugin: any): void {
    Logger.log('🎹 인라인 모드: 명령어 등록 시작');

    // 다음 오류로 이동
    plugin.addCommand({
      id: 'inline-next-error',
      name: '다음 문법 오류로 이동',
      callback: () => {
        // 인라인 모드가 활성화되고 오류가 있는지 확인
        if (this.activeErrors.size === 0) {
          new Notice('현재 감지된 문법 오류가 없습니다. 인라인 모드를 활성화하고 문법 검사를 실행해주세요.');
          return;
        }

        // 🎯 커서 위치 기반으로 다음 오류 찾기
        const nextError = this.findNextErrorFromCursor();
        
        if (nextError) {
          // 기존 툴팁 숨기기
          if ((window as any).globalInlineTooltip) {
            (window as any).globalInlineTooltip.hide();
          }
          
          // 오류 위치로 이동 및 포커스 설정
          this.moveToError(nextError);
          this.setFocusedError(nextError);
          
          // Notice 제거 - 더 깔끔한 UX
          // new Notice(`다음 오류: "${nextError.correction.original}"`);
          Logger.log(`✅ 다음 오류로 이동: ${nextError.correction.original}`);
        } else {
          new Notice('다음 오류를 찾을 수 없습니다.');
        }
      }
    });

    // 이전 오류로 이동
    plugin.addCommand({
      id: 'inline-previous-error',
      name: '이전 문법 오류로 이동',
      callback: () => {
        if (this.activeErrors.size === 0) {
          new Notice('현재 감지된 문법 오류가 없습니다. 인라인 모드를 활성화하고 문법 검사를 실행해주세요.');
          return;
        }

        // 🎯 커서 위치 기반으로 이전 오류 찾기
        const previousError = this.findPreviousErrorFromCursor();
        
        if (previousError) {
          // 기존 툴팁 숨기기
          if ((window as any).globalInlineTooltip) {
            (window as any).globalInlineTooltip.hide();
          }
          
          // 오류 위치로 이동 및 포커스 설정
          this.moveToError(previousError);
          this.setFocusedError(previousError);
          
          // Notice 제거 - 더 깔끔한 UX  
          // new Notice(`이전 오류: "${previousError.correction.original}"`);
          Logger.log(`✅ 이전 오류로 이동: ${previousError.correction.original}`);
        } else {
          new Notice('이전 오류를 찾을 수 없습니다.');
        }
      }
    });

    // 다음 제안으로 이동
    plugin.addCommand({
      id: 'inline-next-suggestion',
      name: '다음 제안 선택',
      callback: () => {
        // 🎯 스마트 포커스: 포커스된 오류가 없으면 커서 위치에서 찾기
        if (!this.currentFocusedError) {
          const errorAtCursor = this.findErrorAtCursor();
          if (errorAtCursor) {
            this.setFocusedError(errorAtCursor);
            Logger.log(`🎯 커서 위치에서 자동 포커스: ${errorAtCursor.correction.original}`);
          } else {
            new Notice('현재 포커스된 문법 오류가 없습니다. 커서를 오류 단어에 위치시키거나 먼저 오류를 선택해주세요.');
            return;
          }
        }
        
                 if (!this.currentFocusedError || !this.currentFocusedError.correction) {
           new Notice('현재 오류에 대한 제안이 없습니다.');
           return;
         }

        // 🎯 원문 포함한 전체 제안 목록 (원문 → 제안1 → 제안2 → ...)
        const suggestions = [this.currentFocusedError.correction.original, ...this.currentFocusedError.correction.corrected];
        if (!suggestions || suggestions.length === 0) {
          new Notice('현재 오류에 대한 제안이 없습니다.');
          return;
        }

        // 🎯 순환 구조로 다음 제안 인덱스 이동 (끝에서 처음으로)  
        this.currentSuggestionIndex = (this.currentSuggestionIndex + 1) % suggestions.length;
        
        // 🎯 실제 텍스트에 바로 반영 (Notice 대신)
        this.applyCurrentSuggestionTemporarily();
        
        // Notice 제거 - 텍스트에서 직접 확인 가능
        // new Notice(`다음 제안: ${suggestions[this.currentSuggestionIndex]} (${this.currentSuggestionIndex + 1}/${suggestions.length})`);
        Logger.log(`✅ 다음 제안 적용: ${suggestions[this.currentSuggestionIndex]} (${this.currentSuggestionIndex + 1}/${suggestions.length})`);
      }
    });

    // 이전 제안으로 이동
    plugin.addCommand({
      id: 'inline-previous-suggestion',
      name: '이전 제안 선택',
      callback: () => {
        // 🎯 스마트 포커스: 포커스된 오류가 없으면 커서 위치에서 찾기
        if (!this.currentFocusedError) {
          const errorAtCursor = this.findErrorAtCursor();
          if (errorAtCursor) {
            this.setFocusedError(errorAtCursor);
            Logger.log(`🎯 커서 위치에서 자동 포커스: ${errorAtCursor.correction.original}`);
          } else {
            new Notice('현재 포커스된 문법 오류가 없습니다. 커서를 오류 단어에 위치시키거나 먼저 오류를 선택해주세요.');
            return;
          }
        }
        
        if (!this.currentFocusedError || !this.currentFocusedError.correction) {
          new Notice('현재 오류에 대한 제안이 없습니다.');
          return;
        }

        // 🎯 원문 포함한 전체 제안 목록 (원문 → 제안1 → 제안2 → ...)
        const suggestions = [this.currentFocusedError.correction.original, ...this.currentFocusedError.correction.corrected];
        if (!suggestions || suggestions.length === 0) {
          new Notice('현재 오류에 대한 제안이 없습니다.');
          return;
        }

        // 🎯 순환 구조로 이전 제안 인덱스 이동 (처음에서 끝으로)
        this.currentSuggestionIndex = (this.currentSuggestionIndex - 1 + suggestions.length) % suggestions.length;
        
        // 🎯 실제 텍스트에 바로 반영 (Notice 대신)
        this.applyCurrentSuggestionTemporarily();
        
        // Notice 제거 - 텍스트에서 직접 확인 가능
        // new Notice(`이전 제안: ${suggestions[this.currentSuggestionIndex]} (${this.currentSuggestionIndex + 1}/${suggestions.length})`);
        Logger.log(`✅ 이전 제안 적용: ${suggestions[this.currentSuggestionIndex]} (${this.currentSuggestionIndex + 1}/${suggestions.length})`);
      }
    });

    // 선택된 제안 적용
    plugin.addCommand({
      id: 'inline-apply-suggestion',
      name: '선택된 제안 적용',
      callback: () => {
        if (!this.currentFocusedError || !this.currentView || !this.currentFocusedError.correction) {
          new Notice('현재 포커스된 문법 오류가 없습니다. 먼저 오류를 선택해주세요.');
          return;
        }

        // 🎯 원문 포함한 전체 제안 목록 (원문 → 제안1 → 제안2 → ...)
        const suggestions = [this.currentFocusedError.correction.original, ...this.currentFocusedError.correction.corrected];
        if (!suggestions || suggestions.length === 0) {
          new Notice('현재 오류에 대한 제안이 없습니다.');
          return;
        }

        const selectedSuggestion = suggestions[this.currentSuggestionIndex];
        const originalText = this.currentFocusedError.correction.original;
        this.applySuggestion(this.currentFocusedError, selectedSuggestion);
        this.clearFocusedError();
        new Notice(`제안 적용: "${originalText}" → "${selectedSuggestion}"`);
        Logger.log(`✅ 제안 적용: "${originalText}" → "${selectedSuggestion}"`);
      }
    });

    // 키보드 네비게이션 해제
    plugin.addCommand({
      id: 'inline-unfocus',
      name: '문법 오류 포커스 해제',
      callback: () => {
        if (!this.currentFocusedError || !this.currentView) {
          new Notice('현재 포커스된 문법 오류가 없습니다.');
          return;
        }

        this.clearFocusedError();
        new Notice('문법 오류 포커스를 해제했습니다.');
        Logger.log('✅ 키보드 네비게이션 해제');
      }
    });

    // 인라인 모드 토글
    plugin.addCommand({
      id: 'toggle-inline-mode',
      name: '한국어 문법 인라인 모드 토글',
      callback: () => {
        // 설정에서 인라인 모드 토글
        const currentState = plugin.settings?.inlineMode?.enabled || false;
        if (plugin.settings?.inlineMode) {
          plugin.settings.inlineMode.enabled = !currentState;
          plugin.saveSettings();
          
          if (plugin.settings.inlineMode.enabled) {
            plugin.enableInlineMode();
            Logger.log('✅ 인라인 모드 활성화');
          } else {
            plugin.disableInlineMode();
            Logger.log('✅ 인라인 모드 비활성화');
          }
        }
      }
    });

    Logger.log('🎹 인라인 모드: 명령어 등록 완료!');
    Logger.log('📋 등록된 명령어:');
    Logger.log('  • Korean Grammar Assistant: 다음 문법 오류로 이동');
    Logger.log('  • Korean Grammar Assistant: 이전 문법 오류로 이동');
    Logger.log('  • Korean Grammar Assistant: 다음 제안 선택');
    Logger.log('  • Korean Grammar Assistant: 이전 제안 선택');
    Logger.log('  • Korean Grammar Assistant: 선택된 제안 적용');
    Logger.log('  • Korean Grammar Assistant: 문법 오류 포커스 해제');
    Logger.log('  • Korean Grammar Assistant: 한국어 문법 인라인 모드 토글');
    Logger.log('💡 Command Palette (Cmd+P)에서 검색하거나 Hotkeys에서 단축키를 설정하세요!');
  }

  /**
   * 🎯 통합 툴팁 표시 판단: 플랫폼과 설정에 따른 스마트 결정
   */
  static shouldShowTooltipOnInteraction(interactionType: 'hover' | 'click'): boolean {
    if (!this.settings?.inlineMode) return false;
    
    const { tooltipTrigger } = this.settings.inlineMode;
    
    // 새로운 통합 설정이 없으면 레거시 설정 사용 (하위 호환성)
    if (!tooltipTrigger) {
      return interactionType === 'hover' 
        ? this.settings.inlineMode.showTooltipOnHover 
        : this.settings.inlineMode.showTooltipOnClick;
    }
    
    // 통합 설정에 따른 판단
    switch (tooltipTrigger) {
      case 'disabled':
        return false;
        
      case 'hover':
        return interactionType === 'hover' && !Platform.isMobile;
        
      case 'click':
        return interactionType === 'click';
        
      case 'auto':
      default:
        // 플랫폼별 자동 최적화
        if (Platform.isMobile) {
          // 모바일: 클릭만 지원
          return interactionType === 'click';
        } else {
          // 데스크톱: 호버 우선, 클릭도 지원
          return true; // 호버와 클릭 모두 허용
        }
    }
  }

  /**
   * 🎯 커서 위치 기반 가장 가까운 다음 오류 찾기
   */
  static findNextErrorFromCursor(): InlineError | null {
    if (!this.app || this.activeErrors.size === 0) {
      return null;
    }

    try {
      // 현재 활성 MarkdownView 얻기
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !view.editor) {
        Logger.warn('현재 활성 Markdown 에디터가 없습니다');
        return null;
      }

      // 현재 커서 위치 얻기
      const cursor = view.editor.getCursor();
      const cursorOffset = view.editor.posToOffset(cursor);
      
      Logger.debug(`커서 위치: line ${cursor.line}, ch ${cursor.ch}, offset ${cursorOffset}`);

      // 활성 오류들을 시작 위치 기준으로 정렬
      const sortedErrors = Array.from(this.activeErrors.values()).sort((a, b) => a.start - b.start);
      
      // 커서 위치보다 뒤에 있는 첫 번째 오류 찾기
      for (const error of sortedErrors) {
        if (error.start > cursorOffset) {
          Logger.debug(`다음 오류 발견: "${error.correction.original}" at offset ${error.start}`);
          return error;
        }
      }

      // 뒤에 오류가 없으면 첫 번째 오류로 순환
      if (sortedErrors.length > 0) {
        const firstError = sortedErrors[0];
        Logger.debug(`마지막까지 도달, 첫 번째 오류로 순환: "${firstError.correction.original}"`);
        return firstError;
      }
      
      return null;
    } catch (error) {
      Logger.error('다음 오류 찾기 중 오류:', error);
      return null;
    }
  }

  /**
   * 🎯 커서 위치 기반 가장 가까운 이전 오류 찾기
   */
  static findPreviousErrorFromCursor(): InlineError | null {
    if (!this.app || this.activeErrors.size === 0) {
      return null;
    }

    try {
      // 현재 활성 MarkdownView 얻기
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !view.editor) {
        Logger.warn('현재 활성 Markdown 에디터가 없습니다');
        return null;
      }

      // 현재 커서 위치 얻기
      const cursor = view.editor.getCursor();
      const cursorOffset = view.editor.posToOffset(cursor);
      
      Logger.debug(`커서 위치: line ${cursor.line}, ch ${cursor.ch}, offset ${cursorOffset}`);

      // 활성 오류들을 시작 위치 기준으로 정렬 (역순)
      const sortedErrors = Array.from(this.activeErrors.values()).sort((a, b) => b.start - a.start);
      
      // 커서 위치보다 앞에 있는 첫 번째 오류 찾기
      for (const error of sortedErrors) {
        if (error.end < cursorOffset) { // end 사용해서 오류 영역을 완전히 지나친 경우만
          Logger.debug(`이전 오류 발견: "${error.correction.original}" at offset ${error.start}-${error.end}`);
          return error;
        }
      }

      // 앞에 오류가 없으면 마지막 오류로 순환
      if (sortedErrors.length > 0) {
        const lastError = sortedErrors[0]; // 역순 정렬이므로 첫 번째가 가장 뒤의 오류
        Logger.debug(`처음까지 도달, 마지막 오류로 순환: "${lastError.correction.original}"`);
        return lastError;
      }
      
      return null;
    } catch (error) {
      Logger.error('이전 오류 찾기 중 오류:', error);
      return null;
    }
  }

  /**
   * 🎯 오류 위치로 커서 이동 및 뷰 스크롤
   */
  static moveToError(error: InlineError): void {
    if (!this.app) {
      Logger.warn('App 인스턴스가 없어 오류 위치로 이동할 수 없습니다');
      return;
    }

    try {
      // 현재 활성 MarkdownView 얻기
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !view.editor) {
        Logger.warn('현재 활성 Markdown 에디터가 없습니다');
        return;
      }

      const editor = view.editor;
      
      // 오류 시작 위치를 EditorPosition으로 변환
      const startPos = editor.offsetToPos(error.start);
      const endPos = editor.offsetToPos(error.end);
      
      Logger.debug(`오류 위치로 이동: "${error.correction.original}" at line ${startPos.line}, ch ${startPos.ch}`);
      
      // 커서를 오류 시작 위치로 이동
      editor.setCursor(startPos);
      
      // 오류 영역을 선택 (선택적)
      // editor.setSelection(startPos, endPos);
      
      // 해당 영역을 화면에 표시되도록 스크롤
      const range = { from: startPos, to: endPos };
      editor.scrollIntoView(range, true); // center: true로 중앙에 표시
      
      // 에디터에 포커스 (사용자가 바로 편집할 수 있도록)
      editor.focus();
      
    } catch (error) {
      Logger.error('오류 위치로 이동 중 문제 발생:', error);
    }
  }

  /**
   * 🎯 포커스된 오류에 현재 제안을 임시로 반영
   */
  static applyCurrentSuggestionTemporarily(): void {
    if (!this.currentFocusedError || !this.app) {
      return;
    }

    try {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !view.editor) {
        Logger.warn('현재 활성 Markdown 에디터가 없습니다');
        return;
      }

      // 🎯 원문 포함한 전체 제안 목록 사용
      const suggestions = [this.currentFocusedError.correction.original, ...this.currentFocusedError.correction.corrected];
      if (!suggestions || suggestions.length === 0) {
        return;
      }

      const currentSuggestion = suggestions[this.currentSuggestionIndex];
      const editor = view.editor;
      
      // 🎯 현재 문서의 실제 텍스트 확인 (정확한 길이 계산을 위해)
      const actualCurrentText = editor.getRange(
        editor.offsetToPos(this.currentFocusedError.start),
        editor.offsetToPos(this.currentFocusedError.end)
      );
      
      Logger.debug(`🔍 실제 텍스트 확인: "${actualCurrentText}" → "${currentSuggestion}"`);
      
      // 🎯 1단계: 임시 제안 모드 먼저 활성화 (decoration 자동 제거 방지)
      if (this.currentView) {
        this.currentView.dispatch({
          effects: [setTemporarySuggestionMode.of(true)]
        });
        Logger.debug(`🎯 임시 제안 모드 활성화됨`);
      }
      
      // 오류 위치를 EditorPosition으로 변환
      const startPos = editor.offsetToPos(this.currentFocusedError.start);
      const endPos = editor.offsetToPos(this.currentFocusedError.end);
      
      // 🎯 2단계: 기존 텍스트를 현재 제안으로 교체 (이제 decoration이 제거되지 않음)
      editor.replaceRange(currentSuggestion, startPos, endPos);
      
      // 🎯 정확한 길이 차이 계산 (현재 실제 텍스트 기준)
      const lengthDiff = currentSuggestion.length - actualCurrentText.length;
      
      // 현재 오류의 새로운 end 위치 계산
      this.currentFocusedError.end = this.currentFocusedError.start + currentSuggestion.length;
      
      // 다른 오류들의 위치도 조정 (현재 오류 이후에 있는 것들)
      for (const [, error] of this.activeErrors) {
        if (error.start > this.currentFocusedError.start) {
          error.start += lengthDiff;
          error.end += lengthDiff;
        }
      }
      
      // 커서를 수정된 텍스트 끝으로 이동
      const newEndPos = editor.offsetToPos(this.currentFocusedError.start + currentSuggestion.length);
      editor.setCursor(newEndPos);
      
      // 🎯 3단계: 포커스 decoration 강제 재적용 (안정적 하이라이팅 유지)
      if (this.currentView && this.currentFocusedError) {
        // 약간의 지연을 두고 decoration 재적용 (DOM 업데이트 완료 후)
        requestAnimationFrame(() => {
          if (this.currentView && this.currentFocusedError) {
            this.currentView.dispatch({
              effects: [setFocusedErrorDecoration.of(this.currentFocusedError.uniqueId)]
            });
            Logger.debug(`🎯 포커스 decoration 재적용 완료: ${this.currentFocusedError.uniqueId} (${this.currentFocusedError.start}-${this.currentFocusedError.end})`);
          }
        });
        
        Logger.debug(`🎯 임시 제안 모드에서 포커스 유지: ${this.currentFocusedError.uniqueId} (${this.currentFocusedError.start}-${this.currentFocusedError.end})`);
      }
      
    } catch (error) {
      Logger.error('임시 제안 적용 중 오류:', error);
    }
  }

  /**
   * 다크모드를 고려한 오류 스타일을 생성합니다.
   */
  static getErrorStyle(underlineStyle: string, underlineColor: string, isHover: boolean = false): string {
    // 다크모드 감지
    const isDarkMode = document.body.classList.contains('theme-dark');
    
    // CSS 변수를 사용하여 Obsidian 테마와 호환성 확보
    let actualColor: string;
    let actualBgColor: string;
    
    // Obsidian 표준 색상 변수 사용
    if (isDarkMode) {
      // 다크모드: --color-red (#fb464c)와 투명도 조절
      actualColor = isHover ? 'var(--color-red)' : 'var(--color-red)';
      actualBgColor = isHover ? 'rgba(var(--color-red-rgb), 0.2)' : 'rgba(var(--color-red-rgb), 0.1)';
    } else {
      // 라이트모드: --color-red (#e93147)와 투명도 조절  
      actualColor = isHover ? 'var(--color-red)' : 'var(--color-red)';
      actualBgColor = isHover ? 'rgba(var(--color-red-rgb), 0.15)' : 'rgba(var(--color-red-rgb), 0.08)';
    }
    
    return `text-decoration-line: underline !important; text-decoration-style: ${underlineStyle} !important; text-decoration-color: ${actualColor} !important; text-decoration-thickness: 2px !important; background-color: ${actualBgColor} !important; cursor: pointer !important;`;
  }

  /**
   * 🎯 컨텍스트 기반 호버 영역 확장
   * 주변 형태소 정보를 활용하여 더 넓은 호버 영역 제공
   */
  private static expandHoverAreaByMorphemes(element: HTMLElement, error: InlineError): void {
    if (!error.morphemeInfo || !this.currentView) {
      Logger.debug(`형태소 정보 없음, 호버 영역 확장 생략: ${error.correction.original}`);
      return;
    }

    try {
      // 현재 오류 위치에서 토큰 경계 찾기
      const tokenBoundaries = this.getTokenBoundaries(error);
      if (!tokenBoundaries) return;

      // 확장된 호버 영역 스타일 적용
      const expandedStyle = this.createExpandedHoverStyle(tokenBoundaries);
      
      // 가상의 확장된 호버 영역 생성 (실제 DOM 조작 없이 감지 영역만 확장)
      this.createExpandedHoverZone(element, expandedStyle, error);
      
      Logger.debug(`🎯 호버 영역 확장: ${error.correction.original} (토큰: ${tokenBoundaries.startToken}-${tokenBoundaries.endToken})`);
      
    } catch (err) {
      Logger.warn('호버 영역 확장 실패:', err);
    }
  }

  /**
   * 형태소 정보 기반 토큰 경계 계산
   */
  private static getTokenBoundaries(error: InlineError): { startToken: number; endToken: number; contextText: string } | null {
    if (!error.morphemeInfo || !this.currentView) return null;

    try {
      const doc = this.currentView.state.doc;
      const errorStart = error.start;
      const errorEnd = error.end;
      
      // 앞뒤 30자 컨텍스트 윈도우
      const contextStart = Math.max(0, errorStart - 30);
      const contextEnd = Math.min(doc.length, errorEnd + 30);
      const contextText = doc.sliceString(contextStart, contextEnd);
      
      // 형태소 정보에서 토큰 경계 찾기
      const relativeErrorStart = errorStart - contextStart;
      const relativeErrorEnd = errorEnd - contextStart;
      
      // 단어 경계까지 확장 (공백, 구두점 기준)
      let expandedStart = relativeErrorStart;
      let expandedEnd = relativeErrorEnd;
      
      // 앞쪽으로 확장 (최대 한 토큰)
      while (expandedStart > 0) {
        const char = contextText[expandedStart - 1];
        if (/[\s.,!?;:\-()[\]{}'"'""''…]/.test(char)) break;
        if (/[가-힣]/.test(char) && expandedStart <= relativeErrorStart - 10) break; // 최대 10자까지만
        expandedStart--;
      }
      
      // 뒤쪽으로 확장 (최대 한 토큰)
      while (expandedEnd < contextText.length) {
        const char = contextText[expandedEnd];
        if (/[\s.,!?;:\-()[\]{}'"'""''…]/.test(char)) break;
        if (/[가-힣]/.test(char) && expandedEnd >= relativeErrorEnd + 10) break; // 최대 10자까지만
        expandedEnd++;
      }
      
      return {
        startToken: contextStart + expandedStart,
        endToken: contextStart + expandedEnd,
        contextText: contextText.slice(expandedStart, expandedEnd)
      };
      
    } catch (err) {
      Logger.warn('토큰 경계 계산 실패:', err);
      return null;
    }
  }

  /**
   * 확장된 호버 스타일 생성
   */
  private static createExpandedHoverStyle(boundaries: { startToken: number; endToken: number; contextText: string }): string {
    const isDarkMode = document.body.classList.contains('theme-dark');
    
    return `
      position: relative;
      z-index: 2;
      &::before {
        content: '';
        position: absolute;
        left: -5px;
        right: -5px;
        top: -2px;
        bottom: -2px;
        background: ${isDarkMode ? 'rgba(var(--color-red-rgb), 0.05)' : 'rgba(var(--color-red-rgb), 0.03)'};
        border-radius: 3px;
        pointer-events: none;
        z-index: -1;
      }
    `;
  }

  /**
   * 확장된 호버 감지 영역 생성
   */
  private static createExpandedHoverZone(originalElement: HTMLElement, style: string, error: InlineError): void {
    // 기존 확장 영역 제거
    const existingZone = originalElement.parentElement?.querySelector('.korean-grammar-expanded-hover');
    if (existingZone) {
      existingZone.remove();
    }

    // 새로운 확장 감지 영역 생성 (가상)
    const expandedZone = document.createElement('span');
    expandedZone.className = 'korean-grammar-expanded-hover';
    expandedZone.style.cssText = `
      position: absolute;
      left: -8px;
      right: -8px;
      top: -3px;
      bottom: -3px;
      pointer-events: auto;
      z-index: 1;
      opacity: 0;
    `;
    
    // 확장 영역에 호버 이벤트 추가
    expandedZone.addEventListener('mouseenter', () => {
      Logger.debug(`🎯 확장 호버 영역 진입: ${error.correction.original}`);
      // 원본 요소와 동일한 호버 효과
      if (!this.currentHoveredError || this.currentHoveredError.uniqueId !== error.uniqueId) {
        this.currentHoveredError = error;
        this.handleErrorHover(error, originalElement);
      }
    });
    
    expandedZone.addEventListener('mouseleave', () => {
      Logger.debug(`🎯 확장 호버 영역 이탈: ${error.correction.original}`);
      // 지연 후 호버 해제 (툴팁으로 이동 시간 확보)
      setTimeout(() => {
        if (this.currentHoveredError?.uniqueId === error.uniqueId) {
          this.currentHoveredError = null;
        }
      }, 200);
    });

    // DOM에 추가 (상대 위치)
    if (originalElement.parentElement) {
      originalElement.style.position = 'relative';
      originalElement.appendChild(expandedZone);
    }
  }
}