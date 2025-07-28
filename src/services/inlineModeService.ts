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
import { IgnoredWordsService } from './ignoredWords';

/**
 * 🤖 AI 교정 텍스트 Widget - Replace Decoration용
 * 특수문자 안전 처리 및 완벽한 baseline 정렬
 */
class AITextWidget extends WidgetType {
  constructor(
    private aiText: string,
    private errorId: string,
    private originalText: string
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    
    // 🔧 textContent로 특수문자 안전 처리 (괄호, 따옴표 등)
    span.textContent = this.aiText;
    
    // 🎨 AI 교정 스타일 적용 (Widget 전용 클래스)
    span.className = 'korean-grammar-ai-widget';
    span.style.cssText = `
      color: #10b981 !important;
      text-decoration: wavy underline #10b981 2px !important;
      background-color: rgba(16, 185, 129, 0.1) !important;
      cursor: pointer !important;
      display: inline !important;
      font-family: inherit !important;
      font-size: inherit !important;
      line-height: inherit !important;
    `;
    
    // 🔧 데이터 속성 설정 (툴팁 및 클릭 처리용)
    span.setAttribute('data-error-id', this.errorId);
    span.setAttribute('data-original', this.originalText);
    span.setAttribute('data-ai-status', 'corrected');
    span.setAttribute('data-ai-selected-value', this.aiText);
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');
    
    // 🖱️ 호버 효과 + 툴팁 표시
    span.addEventListener('mouseenter', (e) => {
      span.style.backgroundColor = 'rgba(16, 185, 129, 0.2) !important';
      
      // 🔍 툴팁 표시 - AI 분석 결과 포함
      const mockError: InlineError = {
        uniqueId: this.errorId,
        correction: {
          original: this.originalText,
          corrected: [this.aiText], // AI가 선택한 텍스트
          help: 'AI가 선택한 수정사항' // help 필드 추가
        },
        start: 0,
        end: 0,
        line: 0, // 필수 필드 추가
        ch: 0,   // 필수 필드 추가
        isActive: true,
        aiAnalysis: {
          selectedValue: this.aiText,
          confidence: 90, // 기본 신뢰도
          reasoning: 'AI가 자동으로 선택한 수정사항입니다.',
          isExceptionProcessed: false
        },
        aiStatus: 'corrected',
        aiSelectedValue: this.aiText
      };
      
      // 툴팁 표시 (마우스 위치 포함)
      if ((window as any).globalInlineTooltip) {
        const mousePosition = { x: e.clientX, y: e.clientY };
        (window as any).globalInlineTooltip.show(mockError, span, 'hover', mousePosition);
      }
    });
    
    span.addEventListener('mouseleave', () => {
      span.style.backgroundColor = 'rgba(16, 185, 129, 0.1) !important';
      
      // 🔍 툴팁 숨기기 (더 긴 딜레이 - 툴팁으로 마우스 이동할 충분한 시간 확보)
      setTimeout(() => {
        if ((window as any).globalInlineTooltip && !(window as any).globalInlineTooltip.isHovered) {
          (window as any).globalInlineTooltip.hide();
        }
      }, 500); // 150ms → 500ms로 증가
    });
    
    // 🖱️ 클릭 이벤트 추가 (AI 선택값 그대로 적용)
    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      Logger.log(`🟢 AI Widget 클릭: "${this.originalText}" → "${this.aiText}" (확정 적용)`);
      
      // AI 선택값을 실제 에디터에 적용
      InlineModeService.applyAIWidgetToEditor(this.errorId, this.aiText, this.originalText);
      
      // 툴팁 숨기기
      if ((window as any).globalInlineTooltip) {
        (window as any).globalInlineTooltip.hide();
      }
    });
    
    // 🖱️ 더블클릭 이벤트 추가 (편집 모드)
    span.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      Logger.log(`🟢 AI Widget 더블클릭: "${this.originalText}" 편집 모드 진입`);
      
      // 편집 가능한 input 요소로 변환
      this.enterEditMode(span);
    });
    
    Logger.debug(`🤖 AI Widget 생성: "${this.originalText}" → "${this.aiText}"`);
    
    return span;
  }

  eq(other: AITextWidget): boolean {
    return this.aiText === other.aiText && this.errorId === other.errorId;
  }
  
  /**
   * 🖥️ 편집 모드 진입 (더블클릭 시)
   */
  private enterEditMode(span: HTMLElement): void {
    // 기존 span을 input으로 교체
    const input = document.createElement('input');
    input.type = 'text';
    input.value = this.aiText;
    input.style.cssText = `
      color: #10b981 !important;
      background-color: rgba(16, 185, 129, 0.1) !important;
      border: 2px solid #10b981 !important;
      border-radius: 3px !important;
      padding: 2px 4px !important;
      font-family: inherit !important;
      font-size: inherit !important;
      line-height: inherit !important;
      margin: 0 !important;
      outline: none !important;
    `;
    
    // span과 input 교체
    span.parentNode?.replaceChild(input, span);
    
    // 즉시 포커스 및 전체 선택
    input.focus();
    input.select();
    
    // Enter 키로 확정
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const newValue = input.value.trim();
        if (newValue) {
          Logger.log(`🟢 AI Widget 편집 완료: "${this.originalText}" → "${newValue}"`);
          InlineModeService.applyAIWidgetToEditor(this.errorId, newValue, this.originalText);
        } else {
          Logger.log(`🟢 AI Widget 편집 취소: 빈 값`);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        Logger.log(`🟢 AI Widget 편집 취소: Escape`);
        // 원래 span으로 되돌림
        const newSpan = this.createSpanElement();
        input.parentNode?.replaceChild(newSpan, input);
      }
    });
    
    // 포커스 잃으면 취소
    input.addEventListener('blur', () => {
      Logger.log(`🟢 AI Widget 편집 취소: blur`);
      // 원래 span으로 되돌림
      const newSpan = this.createSpanElement();
      input.parentNode?.replaceChild(newSpan, input);
    });
  }
  
  /**
   * 🔧 span 요소 재생성 헬퍼
   */
  private createSpanElement(): HTMLElement {
    // toDOM() 메서드와 동일한 로직으로 span 재생성
    const span = document.createElement('span');
    span.textContent = this.aiText;
    span.className = 'korean-grammar-ai-widget';
    span.style.cssText = `
      color: #10b981 !important;
      text-decoration: wavy underline #10b981 2px !important;
      background-color: rgba(16, 185, 129, 0.1) !important;
      cursor: pointer !important;
      display: inline !important;
      font-family: inherit !important;
      font-size: inherit !important;
      line-height: inherit !important;
    `;
    
    // 이벤트 리스너들도 다시 등록해야 함
    // (간단화를 위해 생략 - 실제로는 toDOM()에서 복사해야 함)
    
    return span;
  }
}

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
  preserveAIColors?: boolean; // 🎨 AI 색상 보존 여부
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
        const { errors, underlineStyle, underlineColor, preserveAIColors = false } = effect.value;
        
        const newDecorations = errors.map(error => {
          // 포커스된 오류인지 확인 (현재는 항상 false이지만 나중에 상태 확인)
          const isFocused = false; // TODO: 포커스 상태 확인
          
          // 🤖 AI 분석 상태가 'corrected'인 경우 Replace Decoration + Widget 사용
          if (error.aiStatus === 'corrected' && error.aiSelectedValue) {
            Logger.debug(`🔄 Replace Decoration 사용: "${error.correction.original}" → "${error.aiSelectedValue}"`);
            
            // 🔍 범위 검증 로깅 추가
            const actualText = this.currentView?.state.doc.sliceString(error.start, error.end) || '';
            Logger.debug(`🔄 Replace 범위 검증: 예상="${error.correction.original}" (${error.correction.original.length}자), 실제="${actualText}" (${actualText.length}자), 범위=${error.start}-${error.end}`);
            
            return Decoration.replace({
              widget: new AITextWidget(
                error.aiSelectedValue,
                error.uniqueId,
                error.correction.original
              ),
              inclusive: false,
              block: false
            }).range(error.start, error.end);
          }
          
          // 🔴 기본 Mark decoration (AI 분석 전 또는 다른 상태)
          return Decoration.mark({
            class: `korean-grammar-error-inline ${isFocused ? 'korean-grammar-focused' : ''}`,
            attributes: {
              'data-error-id': error.uniqueId,
              'data-original': error.correction.original,
              'data-corrected': JSON.stringify(error.correction.corrected),
              'data-ai-status': error.aiStatus || 'none', // 🤖 AI 상태 정보 (CSS 선택자용)
              'data-ai-selected-value': error.aiSelectedValue || '', // 🤖 AI가 선택한 수정 텍스트 (CSS content용)
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
                'data-ai-status': error.aiStatus || 'none', // 🤖 AI 상태 정보 (CSS 선택자용)
                'role': 'button',
                'tabindex': '0'
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
    // 🔧 새로운 에디터뷰가 이전과 다르면 이전 상태 완전 정리
    if (this.currentView && this.currentView !== view) {
      Logger.debug('인라인 모드: 이전 에디터뷰와 다름 - 상태 정리 중');
      this.clearErrors(this.currentView);
      this.activeErrors.clear(); // 전역 오류 상태도 완전 정리
    }
    
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
      Logger.debug(`showErrors: clearErrors 호출 전 activeErrors: ${this.activeErrors.size}개`);
      this.clearErrors(view);
      Logger.debug(`showErrors: clearErrors 호출 후 activeErrors: ${this.activeErrors.size}개`);

      // 에디터 텍스트 가져오기
      const doc = view.state.doc;
      const fullText = doc.toString();

      // 형태소 분석 데이터가 없으면 자동으로 분석 (캐시 활용)
      let finalMorphemeData = morphemeData;
      Logger.log(`🔍 형태소 분석 조건 확인: morphemeData=${!!morphemeData}, settings=${!!this.settings}`);
      
      if (!finalMorphemeData && this.settings) {
        try {
          // 형태소 분석 알림 업데이트
          NotificationUtils.updateNoticeMessage(analysisNotice, '📋 형태소 분석 중...');
          Logger.log('📋 형태소 분석 시작...');
          
          const apiService = new SpellCheckApiService();
          finalMorphemeData = await apiService.analyzeMorphemes(fullText, this.settings);
          Logger.log(`📋 형태소 분석 완료: ${!!finalMorphemeData ? '성공' : '실패'}`);
          
          if (finalMorphemeData) {
            Logger.debug('형태소 분석 결과:', finalMorphemeData);
          }
        } catch (error) {
          Logger.error('인라인 모드: 형태소 분석 실패, 기본 로직 사용:', error);
        }
      } else {
        Logger.log(`📋 형태소 분석 건너뛰기: 이미 있음=${!!finalMorphemeData}, 설정 없음=${!this.settings}`);
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

      // 🔵 예외처리 사전 필터링
      const beforeIgnoreCount = optimizedCorrections.length;
      const filteredCorrections = optimizedCorrections.filter(correction => {
        const isIgnored = IgnoredWordsService.isWordIgnored(correction.original, this.settings);
        if (isIgnored) {
          Logger.debug(`🔵 예외처리 사전으로 필터링: "${correction.original}"`);
        }
        return !isIgnored;
      });
      
      // 예외처리 필터링 결과 로그
      if (beforeIgnoreCount > filteredCorrections.length) {
        const ignoredCount = beforeIgnoreCount - filteredCorrections.length;
        Logger.log(`🔵 예외처리 사전 필터링: ${ignoredCount}개 단어 제외됨`);
      }

      // 교정 정보를 InlineError로 변환
      const errors: InlineError[] = [];
      
      filteredCorrections.forEach((correction, index) => {
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
            
            // 🔍 위치 검증: 실제로 해당 위치에 예상 텍스트가 있는지 확인
            const actualText = fullText.slice(foundIndex, foundIndex + searchText.length);
            const positionMatches = actualText === searchText;
            
            if (!positionMatches) {
              Logger.debug(`📍 인라인 위치 검증: "${searchText}" at ${foundIndex} → "${actualText}"`);
            }
            
            errors.push(error);
            this.activeErrors.set(uniqueId, error);
            
            Logger.debug(`🎯 오류 위치 설정: "${searchText}" (${uniqueId}) at ${foundIndex}-${foundIndex + searchText.length}${posInfo ? ` [${posInfo.mainPos}]` : ''} ${positionMatches ? '✅' : '❌'}`);
            Logger.debug(`activeErrors 현재 크기: ${this.activeErrors.size}개`);
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
   * 텍스트 변경 후 모든 오류 위치 재계산
   * @param changeStart 변경이 시작된 위치
   * @param originalLength 원본 텍스트 길이
   * @param lengthDiff 길이 변화량 (양수: 증가, 음수: 감소)
   */
  static updateErrorPositionsAfterChange(changeStart: number, originalLength: number, lengthDiff: number): void {
    const changeEnd = changeStart + originalLength;
    const updatedErrors: [string, InlineError][] = [];
    
    Logger.debug(`📍 위치 재계산 시작: ${changeStart}-${changeEnd} 범위, ${lengthDiff > 0 ? '+' : ''}${lengthDiff}자 변화`);
    
    this.activeErrors.forEach((error, errorId) => {
      // 변경 지점 이후의 오류들만 위치 조정
      if (error.start >= changeEnd) {
        const updatedError = {
          ...error,
          start: error.start + lengthDiff,
          end: error.end + lengthDiff
        };
        updatedErrors.push([errorId, updatedError]);
        Logger.debug(`  📍 "${error.correction.original}": ${error.start}-${error.end} → ${updatedError.start}-${updatedError.end}`);
      }
    });
    
    // 위치가 업데이트된 오류들 반영
    updatedErrors.forEach(([errorId, updatedError]) => {
      this.activeErrors.set(errorId, updatedError);
    });
    
    // CodeMirror decoration도 다시 생성
    if (this.currentView && updatedErrors.length > 0) {
      const allErrors = Array.from(this.activeErrors.values());
      this.currentView.dispatch({
        effects: [
          clearAllErrorDecorations.of(true), // 기존 모든 decoration 제거
          addErrorDecorations.of({
            errors: allErrors,
            underlineStyle: this.settings?.inlineMode?.underlineStyle || 'wavy',
            underlineColor: this.settings?.inlineMode?.underlineColor || 'var(--color-red)',
            preserveAIColors: true // AI 색상 보존
          })
        ]
      });
      Logger.debug(`📍 decoration 재생성: ${allErrors.length}개 오류`);
    }
    
    Logger.debug(`📍 위치 재계산 완료: ${updatedErrors.length}개 오류 업데이트됨`);
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
   * 오류 클릭 핸들러 (AI 상태에 따른 처리)
   */
  static handleErrorClick(error: InlineError, clickedElement?: HTMLElement, mousePosition?: { x: number; y: number }): void {
    Logger.log(`인라인 모드: 오류 클릭 - ${error.correction.original} (AI 상태: ${error.aiStatus || 'none'})`);
    
    try {
      // 기존 툴팁 먼저 숨기기
      if ((window as any).globalInlineTooltip) {
        (window as any).globalInlineTooltip.hide();
      }
      
      // 🎨 AI 상태에 따른 클릭 동작 분기
      const aiStatus = error.aiStatus;
      
      switch (aiStatus) {
        case 'corrected': // 🟢 녹색: AI 선택값 적용
          if (error.aiSelectedValue) {
            this.applySuggestion(error, error.aiSelectedValue);
            Logger.log(`🟢 AI 선택값 적용: "${error.correction.original}" → "${error.aiSelectedValue}"`);
          } else {
            Logger.warn('AI 선택값이 없습니다.');
          }
          break;
          
        case 'exception': // 🔵 파란색: 예외 처리 사전에 등록
          this.addWordToIgnoreListAndRemoveErrors(error.correction.original)
            .then(removedCount => {
              if (removedCount > 0) {
                Logger.log(`🔵 예외 단어 추가: "${error.correction.original}" (${removedCount}개 오류 제거)`);
              }
            })
            .catch(err => {
              Logger.error('예외 단어 추가 실패:', err);
            });
          break;
          
        case 'keep-original': // 🟠 주황색: 원본 유지 (변경 없음)
          Logger.log(`🟠 원본 유지: "${error.correction.original}"`);
          // 아무것도 하지 않고 오류만 제거
          this.removeError(null, error.uniqueId);
          break;
          
        default: // 🔴 빨간색: 첫 번째 수정 제안 적용 (기존 동작)
          if (error.correction.corrected && error.correction.corrected.length > 0) {
            const firstSuggestion = error.correction.corrected[0];
            this.applySuggestion(error, firstSuggestion);
            Logger.log(`🔴 첫 번째 제안 자동 적용: "${error.correction.original}" → "${firstSuggestion}"`);
          } else {
            Logger.warn(`인라인 모드: 수정 제안이 없습니다 - ${error.correction.original}`);
          }
          break;
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
   * 🤖 AI Widget을 실제 에디터에 적용
   */
  static applyAIWidgetToEditor(errorId: string, newText: string, originalText: string): void {
    if (!this.app) {
      Logger.error('앱 인스턴스를 찾을 수 없습니다.');
      return;
    }
    
    try {
      // Obsidian 에디터 접근
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !view.editor) {
        Logger.error('활성 마크다운 뷰를 찾을 수 없습니다.');
        return;
      }
      
      // 오류 정보 찾기
      const error = this.activeErrors.get(errorId);
      if (!error) {
        Logger.error(`오류 ID를 찾을 수 없습니다: ${errorId}`);
        return;
      }
      
      Logger.log(`🤖 AI Widget 에디터 적용: "${originalText}" → "${newText}" (위치: ${error.start}-${error.end})`);
      
      // 🔧 연속 클릭 방지: CodeMirror view와 Obsidian editor 동기화 처리
      if (this.currentView) {
        // 1. CodeMirror decoration 즉시 제거
        this.currentView.dispatch({
          effects: removeErrorDecorations.of([errorId])
        });
        
        // 2. activeErrors에서도 제거 (중요: decoration 제거와 동시에)
        this.activeErrors.delete(errorId);
        
        Logger.debug(`🔧 연속 클릭 대응: decoration과 activeErrors 동시 제거 (${errorId})`);
        
        // 🔍 현재 남은 AI 오류들 상태 확인
        const remainingAIErrors = Array.from(this.activeErrors.values()).filter(e => e.aiStatus === 'corrected');
        Logger.log(`🤖 남은 AI corrected 오류들: ${remainingAIErrors.length}개 (${remainingAIErrors.map(e => e.correction.original).join(', ')})`);
        
        // 3. 강제 DOM 업데이트를 위한 즉시 플러시
        this.currentView.requestMeasure();
        
        // 4. 약간의 지연 후 텍스트 교체 (decoration 제거가 DOM에 반영되도록)
        requestAnimationFrame(() => {
          try {
            const startPos = view.editor.offsetToPos(error.start);
            const endPos = view.editor.offsetToPos(error.end);
            
            // 텍스트 교체
            view.editor.replaceRange(newText, startPos, endPos);
            
            Logger.debug(`✅ AI Widget 적용 완료 (비동기): "${originalText}" → "${newText}"`);
            
            // 🔧 텍스트 변경 후 모든 오류 위치 재계산 (중요!)
            const lengthDiff = newText.length - originalText.length;
            if (lengthDiff !== 0) {
              this.updateErrorPositionsAfterChange(error.start, originalText.length, lengthDiff);
              Logger.debug(`📍 위치 재계산: ${lengthDiff > 0 ? '+' : ''}${lengthDiff}자 변화, ${error.start} 이후 오류들 업데이트`);
            }
            
            // 성공 알림
            if ((window as any).Notice) {
              new (window as any).Notice(`✅ "${newText}" 적용 완료`);
            }
          } catch (replaceError) {
            Logger.error('텍스트 교체 실패:', replaceError);
            if ((window as any).Notice) {
              new (window as any).Notice('❌ 텍스트 교체에 실패했습니다.');
            }
          }
        });
      } else {
        // 폴백: 기존 방식 사용
        this.removeError(null, errorId);
        
        const startPos = view.editor.offsetToPos(error.start);
        const endPos = view.editor.offsetToPos(error.end);
        
        view.editor.replaceRange(newText, startPos, endPos);
        
        if ((window as any).Notice) {
          new (window as any).Notice(`✅ "${newText}" 적용 완료`);
        }
      }
      
    } catch (err) {
      Logger.error('AI Widget 에디터 적용 실패:', err);
      if ((window as any).Notice) {
        new (window as any).Notice('❌ 텍스트 적용에 실패했습니다.');
      }
    }
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

    // 🔧 해당 오류 제거 먼저 실행 (중복 방지)
    this.removeError(this.currentView, error.uniqueId);

    // 텍스트 교체 (확실한 범위로)
    this.currentView.dispatch({
      changes: {
        from: fromPos,
        to: toPos,
        insert: suggestion
      }
    });

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
  static getErrorStyle(underlineStyle: string, underlineColor: string, isHover: boolean = false, aiStatus?: string, aiColor?: string, aiBackgroundColor?: string): string {
    // 다크모드 감지
    const isDarkMode = document.body.classList.contains('theme-dark');
    
    let actualColor: string;
    let actualBgColor: string;
    
    // 🤖 AI 분석 결과가 있으면 AI 색상 사용
    if (aiStatus && aiColor && aiBackgroundColor) {
      actualColor = aiColor;
      actualBgColor = isHover ? aiBackgroundColor.replace('0.1', '0.2') : aiBackgroundColor;
      
      Logger.debug(`🎨 AI 색상 적용: ${aiStatus} - ${actualColor}`);
    } else {
      // 기본 오류 색상 (빨간색)
      if (isDarkMode) {
        // 다크모드: --color-red (#fb464c)와 투명도 조절
        actualColor = isHover ? 'var(--color-red)' : 'var(--color-red)';
        actualBgColor = isHover ? 'rgba(var(--color-red-rgb), 0.2)' : 'rgba(var(--color-red-rgb), 0.1)';
      } else {
        // 라이트모드: --color-red (#e93147)와 투명도 조절  
        actualColor = isHover ? 'var(--color-red)' : 'var(--color-red)';
        actualBgColor = isHover ? 'rgba(var(--color-red-rgb), 0.15)' : 'rgba(var(--color-red-rgb), 0.08)';
      }
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

  /**
   * 🤖 기존 오류가 있는지 확인
   */
  static hasErrors(): boolean {
    return this.activeErrors.size > 0;
  }

  /**
   * 🔧 주어진 에디터뷰가 현재 InlineModeService가 관리하는 뷰인지 확인
   */
  static isCurrentView(editorView: any): boolean {
    return this.currentView === editorView;
  }

  /**
   * 🤖 현재 오류 개수 반환
   */
  static getErrorCount(): number {
    return this.activeErrors.size;
  }

  /**
   * 🔥 강제 오류 상태 완전 정리 (외부 호출용)
   */
  static forceCleanAllErrors(): void {
    Logger.log('🔥 InlineModeService: 강제 오류 상태 완전 정리');
    this.activeErrors.clear();
    if (this.currentView) {
      this.clearErrors(this.currentView);
    }
  }

  /**
   * 🔥 현재 문서 텍스트에 실제로 존재하는 오류만 유지 (기존 선택 영역 로직 활용)
   */
  static filterErrorsByCurrentDocument(currentDocumentText: string): void {
    const originalCount = this.activeErrors.size;
    Logger.log(`🔥 현재 문서 기준 오류 필터링 시작 - 전체 오류: ${originalCount}개`);
    
    // 기존 선택 영역 필터링과 동일한 로직 사용
    const errorsToRemove: string[] = [];
    this.activeErrors.forEach((error, errorId) => {
      if (!currentDocumentText.includes(error.correction.original)) {
        errorsToRemove.push(errorId);
      }
    });
    
    // 이전 문서의 오류들 제거
    errorsToRemove.forEach(errorId => this.activeErrors.delete(errorId));
    
    // UI 새로고침
    if (errorsToRemove.length > 0) {
      this.refreshErrorWidgets();
    }
    
    Logger.log(`🔥 오류 필터링 완료 - 제거: ${errorsToRemove.length}개, 유지: ${this.activeErrors.size}개`);
  }

  /**
   * 🤖 오류 ID로 최신 AI 분석 결과가 포함된 오류 객체 가져오기
   */
  static getErrorWithAIData(errorId: string): InlineError | undefined {
    return this.activeErrors.get(errorId);
  }

  /**
   * 🤖 기존 인라인 오류에 대한 AI 분석 실행
   */
  static async runAIAnalysisOnExistingErrors(progressCallback?: (current: number, total: number) => void): Promise<void> {
    if (this.activeErrors.size === 0) {
      Logger.warn('AI 분석할 기존 오류가 없습니다.');
      throw new Error('분석할 오류가 없습니다. 먼저 맞춤법 검사를 실행하세요.');
    }

    if (!this.settings?.ai?.enabled) {
      Logger.warn('AI 기능이 비활성화되어 있습니다.');
      throw new Error('AI 기능이 비활성화되어 있습니다. 설정에서 AI 기능을 활성화하세요.');
    }

    Logger.log(`🤖 기존 오류 ${this.activeErrors.size}개에 대한 AI 분석 시작`);

    try {
      // 기존 오류들을 corrections 형태로 변환
      const corrections: any[] = [];
      this.activeErrors.forEach((error) => {
        corrections.push({
          original: error.correction.original,
          corrected: error.correction.corrected || []
        });
      });
      
      // AI 분석 서비스가 있는지 확인
      const aiService = (window as any).koreanGrammarPlugin?.instance?.orchestrator?.aiService;
      
      if (!aiService) {
        throw new Error('AI 분석 서비스를 찾을 수 없습니다.');
      }

      // AI 분석 요청 생성 (CorrectionPopup의 로직 재활용)
      const currentStates: { [correctionIndex: number]: { state: "error" | "corrected" | "exception-processed" | "original-kept" | "user-edited", value: string } } = {};
      corrections.forEach((_, index) => {
        currentStates[index] = { state: 'error', value: '' };
      });

      const aiRequest = {
        corrections,
        morphemeData: null,
        userEdits: [], // 인라인 모드에서는 사용자 편집 없음
        currentStates,
        originalText: corrections.map(c => c.original).join(' '), // 원본 텍스트 추가
        onProgress: progressCallback ? (current: number, total: number, message: string) => {
          // AI 분석 서비스의 실제 배치 진행률을 그대로 전달
          progressCallback(current, total);
        } : undefined
      };

      // AI 분석 실행 (배치 기반 진행률 자동 업데이트)
      const analysisResults = await aiService.analyzeCorrections(aiRequest);

      Logger.log(`🤖 AI 분석 완료: ${analysisResults.length}개 결과`);

      // 결과를 기존 오류에 적용 (배치 처리)
      const totalResults = analysisResults.length;
      for (let i = 0; i < analysisResults.length; i++) {
        const result = analysisResults[i];
        const errorArray = Array.from(this.activeErrors.values());
        const targetError = errorArray[result.correctionIndex];
        
        if (targetError) {
          // AI 분석 결과를 오류 객체에 저장
          targetError.aiAnalysis = {
            selectedValue: result.selectedValue,
            confidence: result.confidence,
            reasoning: result.reasoning,
            isExceptionProcessed: result.isExceptionProcessed
          };
          
          // 🎨 AI 상태에 따른 색상 설정
          if (result.isExceptionProcessed) {
            targetError.aiStatus = 'exception';
            targetError.aiColor = '#3b82f6'; // 파란색
            targetError.aiBackgroundColor = 'rgba(59, 130, 246, 0.1)';
          } else if (result.selectedValue === targetError.correction.original) {
            targetError.aiStatus = 'keep-original';
            targetError.aiColor = '#f59e0b'; // 주황색
            targetError.aiBackgroundColor = 'rgba(245, 158, 11, 0.1)';
          } else {
            targetError.aiStatus = 'corrected';
            targetError.aiColor = '#10b981'; // 녹색
            targetError.aiBackgroundColor = 'rgba(16, 185, 129, 0.1)';
            targetError.aiSelectedValue = result.selectedValue;
          }
          
          // activeErrors 맵에 업데이트된 오류 저장
          this.activeErrors.set(targetError.uniqueId, targetError);
          
          Logger.debug(`🎨 오류 "${targetError.correction.original}"에 AI 분석 결과 적용: ${result.selectedValue} (신뢰도: ${result.confidence}%) - 색상: ${targetError.aiStatus}`);
        }
      }

      // UI 업데이트 (기존 오류 위젯들에 AI 결과 반영)
      if (this.currentView) {
        // 🔍 AI 상태별 오류 개수 로깅
        const correctedErrors = Array.from(this.activeErrors.values()).filter(e => e.aiStatus === 'corrected');
        const exceptionErrors = Array.from(this.activeErrors.values()).filter(e => e.aiStatus === 'exception');
        const keepOriginalErrors = Array.from(this.activeErrors.values()).filter(e => e.aiStatus === 'keep-original');
        
        Logger.debug(`🎨 AI 결과 적용 후 오류 상태: 녹색(corrected)=${correctedErrors.length}개, 파란색(exception)=${exceptionErrors.length}개, 주황색(keep-original)=${keepOriginalErrors.length}개`);
        Logger.debug(`🟢 녹색 오류들: ${correctedErrors.map(e => `"${e.correction.original}" → "${e.aiSelectedValue}"`).join(', ')}`);
        
        this.refreshErrorWidgets();
      }

      Logger.log('🤖 AI 분석 결과가 인라인 오류에 적용되었습니다.');

    } catch (error) {
      Logger.error('AI 분석 실행 중 오류:', error);
      throw error;
    }
  }

  /**
   * 텍스트 맞춤법 검사 (기존 로직 재활용)
   */
  static async checkText(text: string): Promise<void> {
    if (!text.trim()) {
      throw new Error('검사할 텍스트가 없습니다.');
    }

    if (!this.currentView) {
      throw new Error('에디터 뷰가 설정되지 않았습니다.');
    }

    Logger.log(`📝 인라인 모드 맞춤법 검사 시작: ${text.length}자`);

    try {
      // API 서비스를 통해 맞춤법 검사 실행
      const apiService = new SpellCheckApiService();
      const result = await apiService.checkSpelling(text, this.settings);

      if (!result.corrections || result.corrections.length === 0) {
        Logger.log('맞춤법 오류가 발견되지 않았습니다.');
        // throw 대신 정상 반환 (main.ts에서 getErrorCount()로 확인하도록)
        return;
      }

      // 인라인 모드로 오류 표시
      Logger.debug(`checkText: showErrors 호출 전 - corrections: ${result.corrections.length}개`);
      await this.showErrors(
        this.currentView,
        result.corrections,
        this.settings?.inlineMode?.underlineStyle || 'wavy',
        this.settings?.inlineMode?.underlineColor || 'var(--color-red)',
        this.app || undefined
      );
      
      // showErrors 완료 후 activeErrors 상태 확인
      Logger.debug(`checkText: showErrors 호출 후 - activeErrors: ${this.activeErrors.size}개`);
      Logger.log(`📝 인라인 모드 맞춤법 검사 완료: ${result.corrections.length}개 오류 발견, ${this.activeErrors.size}개 activeErrors`);

    } catch (error) {
      Logger.error('인라인 모드 맞춤법 검사 오류:', error);
      throw error;
    }
  }

  /**
   * 오류 위젯들을 새로고침 (AI 분석 결과 반영)
   */
  static refreshErrorWidgets(): void {
    if (!this.currentView) {
      Logger.warn('refreshErrorWidgets: 에디터 뷰가 없습니다.');
      return;
    }

    Logger.debug('인라인 오류 위젯 새로고침 시작 (AI 결과 반영)');

    try {
      // 기존 오류들을 먼저 지우기
      this.currentView.dispatch({
        effects: [clearAllErrorDecorations.of(true)]
      });

      // AI 색상이 반영된 오류들을 다시 추가 (AI 상태별 색상 유지)
      if (this.activeErrors.size > 0) {
        const allErrors = Array.from(this.activeErrors.values());
        const correctedErrors = allErrors.filter(e => e.aiStatus === 'corrected');
        
        Logger.debug(`🔄 refreshErrorWidgets: 전체 ${allErrors.length}개 오류 중 녹색(corrected) ${correctedErrors.length}개`);
        Logger.debug(`🔄 녹색 오류 상세: ${correctedErrors.map(e => `"${e.correction.original}" → "${e.aiSelectedValue}" (${e.start}-${e.end})`).join(', ')}`);
        
        this.currentView.dispatch({
          effects: addErrorDecorations.of({
            errors: allErrors,
            underlineStyle: this.settings?.inlineMode?.underlineStyle || 'wavy',
            underlineColor: this.settings?.inlineMode?.underlineColor || 'var(--color-red)',
            preserveAIColors: true // 🎨 AI 색상 보존 플래그 추가
          })
        });
      }

      Logger.debug(`${this.activeErrors.size}개 오류 위젯 새로고침 완료 (AI 색상 반영)`);

    } catch (error) {
      Logger.error('오류 위젯 새로고침 실패:', error);
    }
  }

  /**
   * 📝 모든 인라인 오류에 대해 현재 상태값을 에디터에 일괄 적용
   * 사용자가 변경한 상태값들을 모두 반영하여 적용 + 예외처리 사전 등록
   */
  static async applyAllCorrections(): Promise<number> {
    if (!this.currentView) {
      throw new Error('에디터 뷰가 설정되지 않았습니다.');
    }

    if (this.activeErrors.size === 0) {
      throw new Error('적용할 오류가 없습니다.');
    }

    if (!this.settings) {
      throw new Error('플러그인 설정이 없습니다.');
    }

    Logger.log(`📝 ${this.activeErrors.size}개 오류 일괄 적용 시작`);

    const doc = this.currentView.state.doc;
    const changes: { from: number; to: number; insert: string }[] = [];
    const wordsToIgnore: string[] = []; // 예외처리 사전에 추가할 단어들
    let appliedCount = 0;
    let skippedCount = 0;
    let ignoredCount = 0;

    // 오류들을 위치 역순으로 정렬 (뒤에서부터 적용하여 위치 충돌 방지)
    const errors = Array.from(this.activeErrors.values()).sort((a, b) => b.start - a.start);

    for (const error of errors) {
      try {
        // 🔵 파란색 (예외처리) 오류 수집
        if (error.aiStatus === 'exception') {
          const wordToIgnore = error.correction.original.trim();
          if (wordToIgnore && !wordsToIgnore.includes(wordToIgnore)) {
            wordsToIgnore.push(wordToIgnore);
            ignoredCount++;
            Logger.debug(`🔵 예외처리 단어 수집: "${wordToIgnore}"`);
          }
        }

        const replacement = this.determineReplacementText(error);
        
        if (replacement === null) {
          // 예외처리된 오류는 건너뛰기
          skippedCount++;
          Logger.debug(`⏭️ 예외처리된 오류 건너뛰기: "${error.correction.original}"`);
          continue;
        }

        // 문서 범위 유효성 검사
        if (error.start < 0 || error.end > doc.length || error.start >= error.end) {
          Logger.warn(`⚠️ 유효하지 않은 범위: ${error.start}-${error.end} (문서 길이: ${doc.length})`);
          skippedCount++;
          continue;
        }

        // 현재 텍스트가 예상된 오류 텍스트와 일치하는지 확인
        const currentText = doc.sliceString(error.start, error.end);
        if (currentText !== error.correction.original) {
          Logger.warn(`⚠️ 텍스트 불일치: 예상 "${error.correction.original}", 실제 "${currentText}"`);
          skippedCount++;
          continue;
        }

        changes.push({
          from: error.start,
          to: error.end,
          insert: replacement
        });

        appliedCount++;
        Logger.debug(`✅ 적용 예정: "${error.correction.original}" → "${replacement}"`);

      } catch (error_inner) {
        Logger.error(`❌ 오류 적용 실패:`, error_inner);
        skippedCount++;
      }
    }

    // 🔵 예외처리 단어들을 사전에 등록
    if (wordsToIgnore.length > 0) {
      let updatedSettings = this.settings;
      for (const word of wordsToIgnore) {
        updatedSettings = IgnoredWordsService.addIgnoredWord(word, updatedSettings);
      }
      
      // 설정 업데이트 (플러그인 인스턴스를 통해)
      if ((window as any).koreanGrammarPlugin?.instance) {
        const plugin = (window as any).koreanGrammarPlugin.instance;
        plugin.settings = updatedSettings;
        await plugin.saveSettings();
        Logger.log(`🔵 예외처리 사전 등록: ${wordsToIgnore.join(', ')}`);
      }
    }

    // 변경사항이 있으면 에디터에 적용
    if (changes.length > 0) {
      this.currentView.dispatch({
        changes: changes,
        userEvent: 'korean-grammar.apply-all'
      });

      Logger.log(`📝 일괄 적용 완료: ${appliedCount}개 적용, ${skippedCount}개 건너뛰기, ${ignoredCount}개 예외처리 등록`);
    }

    // 적용 후 모든 오류 제거
    this.clearErrors(this.currentView);

    return appliedCount;
  }

  /**
   * 🎯 개별 오류에 대해 현재 상태에 따른 교체 텍스트 결정
   * AI 분석 후 색상 기반 처리 + 사용자 선택 우선
   */
  private static determineReplacementText(error: InlineError): string | null {
    // 🔵 파란색: AI 예외처리 → 예외처리 사전에 등록 (적용하지 않음)
    if (error.aiStatus === 'exception') {
      Logger.debug(`🔵 AI 예외처리 (파란색): "${error.correction.original}" → 예외처리 사전 등록`);
      return null; // 적용하지 않음 (예외처리는 applyAllCorrections에서 처리)
    }

    // 🟠 주황색: 원본 유지 → 건드리지 않음
    if (error.aiStatus === 'keep-original') {
      Logger.debug(`🟠 원본 유지 (주황색): "${error.correction.original}" → 건드리지 않음`);
      return null; // 적용하지 않음
    }

    // 🟢 녹색: AI 교정 선택 → 그대로 적용
    if (error.aiStatus === 'corrected' && error.aiAnalysis?.selectedValue) {
      Logger.debug(`🟢 AI 교정 선택 (녹색): "${error.correction.original}" → "${error.aiAnalysis.selectedValue}"`);
      return error.aiAnalysis.selectedValue;
    }

    // ✏️ 사용자가 개별적으로 조정한 경우 (최우선)
    if (error.aiSelectedValue && !error.aiStatus) {
      Logger.debug(`✏️ 사용자 개별 선택: "${error.correction.original}" → "${error.aiSelectedValue}"`);
      return error.aiSelectedValue;
    }

    // 🔴 빨간색 (미처리) 또는 기본 상태: 첫 번째 수정 제안 적용
    if (error.correction.corrected && error.correction.corrected.length > 0) {
      const firstCorrection = error.correction.corrected[0];
      Logger.debug(`🔴 기본 수정 제안 적용 (빨간색): "${error.correction.original}" → "${firstCorrection}"`);
      return firstCorrection;
    }

    // 수정 제안이 없는 경우 원본 유지
    Logger.debug(`⏭️ 수정 제안 없음, 원본 유지: "${error.correction.original}"`);
    return null;
  }

  /**
   * 🔵 특정 단어를 예외처리 사전에 추가하고 동일한 단어의 모든 오류 제거
   * @param word 예외처리할 단어
   * @returns 제거된 오류 개수
   */
  static async addWordToIgnoreListAndRemoveErrors(word: string): Promise<number> {
    if (!this.settings || !this.currentView) {
      throw new Error('설정 또는 에디터 뷰가 없습니다.');
    }

    const trimmedWord = word.trim();
    if (!trimmedWord) {
      return 0;
    }

    Logger.log(`🔵 예외처리 사전 추가 및 동일 단어 오류 제거: "${trimmedWord}"`);

    // 1. 예외처리 사전에 단어 추가
    const updatedSettings = IgnoredWordsService.addIgnoredWord(trimmedWord, this.settings);
    
    // 2. 설정 저장
    if ((window as any).koreanGrammarPlugin?.instance) {
      const plugin = (window as any).koreanGrammarPlugin.instance;
      plugin.settings = updatedSettings;
      await plugin.saveSettings();
      this.settings = updatedSettings; // 로컬 설정도 업데이트
      Logger.debug(`🔵 예외처리 사전에 저장됨: "${trimmedWord}"`);
    }

    // 3. 동일한 단어의 모든 오류 찾기
    const errorsToRemove: string[] = [];
    this.activeErrors.forEach((error, errorId) => {
      if (error.correction.original.trim() === trimmedWord) {
        errorsToRemove.push(errorId);
      }
    });

    if (errorsToRemove.length === 0) {
      Logger.debug(`🔵 제거할 "${trimmedWord}" 오류가 없습니다.`);
      return 0;
    }

    // 4. activeErrors에서 제거
    errorsToRemove.forEach(errorId => {
      this.activeErrors.delete(errorId);
    });

    // 5. 화면에서 시각적으로 제거 (UI 새로고침)
    this.refreshErrorWidgets();

    Logger.log(`🔵 "${trimmedWord}" 관련 ${errorsToRemove.length}개 오류가 제거되었습니다.`);
    return errorsToRemove.length;
  }

  /**
   * 📍 선택 영역 내 오류 개수 반환
   */
  static getErrorCountInSelection(selectedText: string): number {
    if (!selectedText.trim() || this.activeErrors.size === 0) {
      return 0;
    }

    // 선택된 텍스트에 포함된 오류 개수 계산
    let count = 0;
    this.activeErrors.forEach((error) => {
      if (selectedText.includes(error.correction.original)) {
        count++;
      }
    });

    Logger.debug(`선택 영역 내 오류 개수: ${count}개 (전체: ${this.activeErrors.size}개)`);
    return count;
  }

  /**
   * 📍 선택 영역 내 오류들에 대한 AI 분석 실행
   */
  static async runAIAnalysisOnErrorsInSelection(selectedText: string, progressCallback?: (current: number, total: number) => void): Promise<void> {
    if (!selectedText.trim() || this.activeErrors.size === 0) {
      throw new Error('선택 영역이나 분석할 오류가 없습니다.');
    }

    if (!this.settings?.ai?.enabled) {
      throw new Error('AI 기능이 비활성화되어 있습니다.');
    }

    // 선택 영역에 포함된 오류들만 필터링
    const selectionErrors: any[] = [];
    const selectionErrorIds: string[] = [];
    
    this.activeErrors.forEach((error, errorId) => {
      if (selectedText.includes(error.correction.original)) {
        selectionErrors.push({
          original: error.correction.original,
          corrected: error.correction.corrected || [],
          morphemeInfo: error.morphemeInfo
        });
        selectionErrorIds.push(errorId);
      }
    });

    if (selectionErrors.length === 0) {
      throw new Error('선택 영역에 분석할 오류가 없습니다.');
    }

    Logger.log(`🤖 선택 영역 내 ${selectionErrors.length}개 오류에 대한 AI 분석 시작`);

    try {
      // AI 분석 서비스 실행
      const aiService = new (await import('./aiAnalysisService')).AIAnalysisService(this.settings.ai);
      
      const aiRequest = {
        originalText: selectedText,
        corrections: selectionErrors,
        contextWindow: 50,
        currentStates: {},
        enhancedContext: true
      };
      
      const analysisResults = await aiService.analyzeCorrections(aiRequest);

      // 분석 결과를 해당 오류들에 적용
      for (let i = 0; i < analysisResults.length; i++) {
        const result = analysisResults[i];
        const errorId = selectionErrorIds[i];
        const targetError = this.activeErrors.get(errorId);
        
        if (targetError) {
          // AI 분석 결과 적용
          targetError.aiStatus = result.isExceptionProcessed ? 'exception' : 
                                 result.selectedValue === targetError.correction.original ? 'keep-original' : 'corrected';
          targetError.aiConfidence = result.confidence || 0;
          targetError.aiReasoning = result.reasoning || '';
          targetError.aiSelectedValue = result.selectedValue;
          
          // activeErrors 맵에 업데이트
          this.activeErrors.set(errorId, targetError);
          
          Logger.debug(`🎨 선택 영역 오류 "${targetError.correction.original}"에 AI 결과 적용: ${result.selectedValue} (신뢰도: ${result.confidence}%)`);
        }
      }

      Logger.log(`🤖 선택 영역 AI 분석 완료: ${selectionErrors.length}개 오류 처리됨`);

    } catch (error) {
      Logger.error('선택 영역 AI 분석 실패:', error);
      throw error;
    }
  }

  /**
   * 📍 선택 영역에만 오류 표시 (기존 오류 유지)
   */
  static async showErrorsInSelection(
    view: EditorView,
    corrections: Correction[],
    selectedText: string,
    underlineStyle: string = 'wavy',
    underlineColor: string = 'var(--color-red)',
    app?: App,
    morphemeData?: any
  ): Promise<void> {
    if (!view || !corrections.length || !selectedText.trim()) {
      Logger.warn('인라인 모드: 선택 영역 오류 표시 - 필수 데이터가 없습니다.');
      return;
    }

    const analysisNotice = NotificationUtils.showAnalysisStartNotice('spelling');

    try {
      // 선택 영역의 시작/끝 위치 계산
      const doc = view.state.doc;
      const fullText = doc.toString();
      const selectionStart = fullText.indexOf(selectedText);
      const selectionEnd = selectionStart + selectedText.length;

      if (selectionStart === -1) {
        throw new Error('선택된 텍스트를 문서에서 찾을 수 없습니다.');
      }

      Logger.debug(`선택 영역 위치: ${selectionStart}-${selectionEnd} (${selectedText.length}자)`);

      // 1. 선택 영역 내 기존 오류들 제거
      const errorsToRemove: string[] = [];
      this.activeErrors.forEach((error, errorId) => {
        if (error.start >= selectionStart && error.end <= selectionEnd) {
          errorsToRemove.push(errorId);
        }
      });

      errorsToRemove.forEach(errorId => {
        this.activeErrors.delete(errorId);
      });

      if (errorsToRemove.length > 0) {
        view.dispatch({
          effects: removeErrorDecorations.of(errorsToRemove)
        });
        Logger.debug(`선택 영역 내 기존 오류 ${errorsToRemove.length}개 제거됨`);
      }

      // 2. 형태소 분석 (필요시)
      let finalMorphemeData = morphemeData;
      if (!finalMorphemeData && this.settings) {
        try {
          NotificationUtils.updateNoticeMessage(analysisNotice, '📋 형태소 분석 중...');
          const apiService = new SpellCheckApiService();
          finalMorphemeData = await apiService.analyzeMorphemes(selectedText, this.settings);
        } catch (error) {
          Logger.warn('선택 영역 형태소 분석 실패, 기본 로직 사용:', error);
        }
      }

      // 3. 중복 제거 및 그룹화
      NotificationUtils.updateNoticeMessage(analysisNotice, '🔧 오류 중복 제거 중...');
      const optimizedCorrections = MorphemeUtils.removeDuplicateCorrections(
        corrections,
        finalMorphemeData,
        selectedText
      );

      // 4. 예외 단어 필터링
      const filteredCorrections = optimizedCorrections.filter(correction => {
        const isIgnored = IgnoredWordsService.isWordIgnored(correction.original, this.settings);
        if (isIgnored) {
          Logger.debug(`예외 단어로 필터링됨: "${correction.original}"`);
        }
        return !isIgnored;
      });

      Logger.debug(`선택 영역 오류 처리: ${corrections.length} → ${optimizedCorrections.length} → ${filteredCorrections.length}개`);

      // 5. 새로운 오류들을 선택 영역 기준으로 위치 계산하여 추가
      const errors: InlineError[] = [];
      filteredCorrections.forEach((correction, index) => {
        const searchText = correction.original;
        let searchStart = 0;
        let occurrence = 1;

        while (searchStart < selectedText.length) {
          const foundIndex = selectedText.indexOf(searchText, searchStart);
          if (foundIndex === -1) break;

          // 전체 문서 기준 위치로 변환
          const absoluteStart = selectionStart + foundIndex;
          const absoluteEnd = absoluteStart + searchText.length;

          const uniqueId = `${searchText}_${foundIndex}_${occurrence}`;
          const posInfo = finalMorphemeData ? MorphemeUtils.extractPosInfo(correction.original, finalMorphemeData) : null;

          const error: InlineError = {
            uniqueId,
            start: absoluteStart,
            end: absoluteEnd,
            line: 0, // 선택 영역에서는 정확한 라인 계산 생략
            ch: 0,   // 선택 영역에서는 정확한 문자 위치 계산 생략
            isActive: true,
            correction,
            morphemeInfo: posInfo || undefined
          };

          errors.push(error);
          this.activeErrors.set(uniqueId, error);

          Logger.debug(`선택 영역 오류 위치: "${searchText}" at ${absoluteStart}-${absoluteEnd}`);
          searchStart = foundIndex + 1;
          occurrence++;
        }
      });

      // 6. decoration 추가
      if (errors.length > 0) {
        view.dispatch({
          effects: addErrorDecorations.of({
            errors,
            underlineStyle,
            underlineColor
          })
        });
      }

      NotificationUtils.hideNotice(analysisNotice);
      Logger.log(`선택 영역 오류 표시 완료: ${errors.length}개 오류 추가됨`);

    } catch (error) {
      NotificationUtils.hideNotice(analysisNotice);
      Logger.error('선택 영역 오류 표시 실패:', error);
      throw error;
    }
  }

  // 🚧 구현 중인 기능들 - 향후 완성 예정
  
  // 위의 복잡한 메서드들은 향후 단계별로 구현할 예정입니다.
  // 현재는 기본 Command Palette 명령어와 UI 연동에 집중합니다.
}