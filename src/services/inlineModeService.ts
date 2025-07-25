import { EditorView, WidgetType, Decoration, DecorationSet } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { Correction, InlineError } from '../types/interfaces';
import { Logger } from '../utils/logger';
import { globalInlineTooltip } from '../ui/inlineTooltip';
import { Scope, App } from 'obsidian';

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
      text-decoration-color: #ff0000 !important;
      text-decoration-thickness: 2px !important;
      background-color: rgba(255, 0, 0, 0.05) !important;
    `;
    
    // 설정에 따른 오버라이드
    if (this.underlineStyle !== 'wavy' || this.underlineColor !== '#ff0000') {
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
 * 오류 데코레이션 상태 필드
 */
export const errorDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    
    // 텍스트 변경이 있으면 해당 위치의 오류 제거
    if (tr.docChanged) {
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
          // Mark decoration을 사용하여 원본 텍스트를 유지하면서 스타일 적용
          return Decoration.mark({
            class: 'korean-grammar-error-inline',
            attributes: {
              'data-error-id': error.uniqueId,
              'data-original': error.correction.original,
              'data-corrected': JSON.stringify(error.correction.corrected),
              'role': 'button',
              'tabindex': '0',
              'style': `
                text-decoration-line: underline !important;
                text-decoration-style: ${underlineStyle} !important;
                text-decoration-color: ${underlineColor} !important;
                text-decoration-thickness: 2px !important;
                background-color: rgba(255, 0, 0, 0.05) !important;
                cursor: pointer !important;
              `
            }
          }).range(error.start, error.end);
        });
        
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
  private static keyboardScope: Scope | null = null;
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
    
    // 키보드 스코프 초기화
    this.initializeKeyboardScope();
    
    Logger.debug('인라인 모드: 에디터 뷰 설정됨');
  }

  /**
   * 이벤트 리스너 설정 (겹치는 오류 영역 처리 개선)
   */
  private static setupEventListeners(view: EditorView): void {
    const editorDOM = view.dom;
    
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
          
          Logger.debug(`새로운 오류 호버 시작: "${error.correction.original}" (ID: ${errorId})`);
          
          this.hoverTimeout = setTimeout(() => {
            // 호버 상태 업데이트 (실제 호버된 오류만 정확히 처리)
            this.currentHoveredError = error;
            this.handleErrorHover(error, target);
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
        const target = e.target as HTMLElement;
        if (target && target.classList && target.classList.contains('korean-grammar-error-inline')) {
          e.preventDefault();
          e.stopPropagation();
          
          const errorId = target.getAttribute('data-error-id');
          if (errorId && this.activeErrors.has(errorId)) {
            const error = this.activeErrors.get(errorId);
            if (error) {
              // 실제 클릭된 DOM 요소를 함께 전달
              this.handleErrorClick(error, target);
            }
          }
        }
      } catch (err) {
        Logger.error('클릭 이벤트 처리 중 오류:', err);
      }
    }, true);
    
    // 포커스 이벤트 (오류 요소 클릭 시)
    editorDOM.addEventListener('focus', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('korean-grammar-error-inline')) {
        const errorId = target.getAttribute('data-error-id');
        if (errorId && this.activeErrors.has(errorId)) {
          this.setFocusedError(this.activeErrors.get(errorId)!);
        }
      }
    }, true);
    
    Logger.debug('인라인 모드: 이벤트 리스너 설정됨 (정확한 호버 요소만 처리)');
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
   * 설정 업데이트
   */
  static updateSettings(settings: any): void {
    this.settings = settings;
    Logger.debug('인라인 모드: 설정 업데이트됨');
  }

  /**
   * 오류 표시
   */
  static showErrors(
    view: EditorView, 
    corrections: Correction[], 
    underlineStyle: string = 'wavy',
    underlineColor: string = '#ff0000'
  ): void {
    if (!view || !corrections.length) {
      Logger.warn('인라인 모드: 뷰나 교정 데이터가 없습니다.');
      return;
    }

    // 기존 오류 제거
    this.clearErrors(view);

    // 에디터 텍스트 가져오기
    const doc = view.state.doc;
    const fullText = doc.toString();

    // 교정 정보를 InlineError로 변환
    const errors: InlineError[] = [];
    
    corrections.forEach((correction, index) => {
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
          const uniqueId = `${index}_${occurrence}`;
          const lineInfo = doc.lineAt(foundIndex);
          
          const error: InlineError = {
            correction,
            start: foundIndex,
            end: foundIndex + searchText.length,
            line: lineInfo.number,
            ch: foundIndex - lineInfo.from,
            uniqueId,
            isActive: true
          };
          
          errors.push(error);
          this.activeErrors.set(uniqueId, error);
          
          Logger.debug(`오류 위치 설정: "${searchText}" at ${foundIndex}-${foundIndex + searchText.length}`);
          occurrence++;
        }
        
        searchIndex = foundIndex + 1;
      }
    });

    // 데코레이션 추가
    view.dispatch({
      effects: addErrorDecorations.of({ errors, underlineStyle, underlineColor })
    });

    Logger.log(`인라인 모드: ${errors.length}개 오류 표시됨`);
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
  static handleErrorHover(error: InlineError, hoveredElement?: HTMLElement): void {
    Logger.debug(`인라인 모드: 오류 호버 - ${error.correction.original}`);
    
    // 호버 시 툴팁 표시 (설정에서 활성화된 경우)
    if (this.settings?.inlineMode?.showTooltipOnHover) {
      // 실제 호버된 요소가 전달되면 그것을 사용, 없으면 기존 방식으로 찾기
      const targetElement = hoveredElement || this.findErrorElement(error);
      if (targetElement) {
        globalInlineTooltip.show(error, targetElement, 'hover');
      }
    }
  }

  /**
   * 오류 클릭 핸들러
   */
  static handleErrorClick(error: InlineError, clickedElement?: HTMLElement): void {
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
   * 현재 활성화된 오류 목록 반환
   */
  static getActiveErrors(): InlineError[] {
    return Array.from(this.activeErrors.values());
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

      // 툴팁 숨기기 (확실하게)
      if ((window as any).globalInlineTooltip) {
        (window as any).globalInlineTooltip.hide();
      }

      // 키보드 네비게이션 모드도 해제
      this.clearFocusedError();

      Logger.log(`인라인 모드: 텍스트 교체 완료 - "${error.correction.original}" → "${suggestion}" (${fromPos}-${toPos})`);

    } catch (err) {
      Logger.error('텍스트 교체 실패:', err);
      
      // 에러 발생 시에도 툴팁 숨기기
      if ((window as any).globalInlineTooltip) {
        (window as any).globalInlineTooltip.hide();
      }
    }
  }

  /**
   * 키보드 스코프 초기화
   */
  static initializeKeyboardScope(): void {
    // 기존 스코프가 있으면 제거
    if (this.keyboardScope) {
      this.keyboardScope = null;
    }

    // 새로운 스코프 생성 (전역 스코프를 부모로 설정)
    this.keyboardScope = new Scope();

    // CMD+Shift+Left: 이전 수정 제안
    this.keyboardScope.register(['Mod', 'Shift'], 'ArrowLeft', (evt) => {
      if (!this.currentFocusedError) return false;
      
      const suggestions = this.currentFocusedError.correction.corrected;
      this.currentSuggestionIndex = Math.max(0, this.currentSuggestionIndex - 1);
      this.updateTooltipHighlight();
      Logger.debug(`수정 제안 선택: ${suggestions[this.currentSuggestionIndex]} (${this.currentSuggestionIndex + 1}/${suggestions.length})`);
      return false; // 이벤트 전파 중단
    });

    // CMD+Shift+Right: 다음 수정 제안
    this.keyboardScope.register(['Mod', 'Shift'], 'ArrowRight', (evt) => {
      if (!this.currentFocusedError) return false;
      
      const suggestions = this.currentFocusedError.correction.corrected;
      this.currentSuggestionIndex = Math.min(suggestions.length - 1, this.currentSuggestionIndex + 1);
      this.updateTooltipHighlight();
      Logger.debug(`수정 제안 선택: ${suggestions[this.currentSuggestionIndex]} (${this.currentSuggestionIndex + 1}/${suggestions.length})`);
      return false;
    });

    // CMD+Enter: 선택된 제안 적용
    this.keyboardScope.register(['Mod'], 'Enter', (evt) => {
      if (!this.currentFocusedError) return false;
      
      const suggestions = this.currentFocusedError.correction.corrected;
      const selectedSuggestion = suggestions[this.currentSuggestionIndex];
      this.applySuggestion(this.currentFocusedError, selectedSuggestion);
      this.clearFocusedError();
      return false;
    });

    // Escape: 키보드 네비게이션 해제
    this.keyboardScope.register([], 'Escape', (evt) => {
      if (!this.currentFocusedError) return false;
      
      this.clearFocusedError();
      return false;
    });

    Logger.debug('인라인 모드: 키보드 스코프 초기화됨');
  }

  /**
   * 포커스된 오류 설정
   */
  static setFocusedError(error: InlineError): void {
    this.currentFocusedError = error;
    this.currentSuggestionIndex = 0;
    
    // 해당 오류 요소에 포커스 표시
    this.highlightFocusedError(error);
    
    // 키보드 스코프 활성화
    if (this.keyboardScope && this.app) {
      this.app.keymap.pushScope(this.keyboardScope);
    }
    
    Logger.debug(`오류 포커스 설정: ${error.correction.original}`);
  }

  /**
   * 포커스된 오류 해제
   */
  static clearFocusedError(): void {
    if (this.currentFocusedError) {
      this.removeFocusHighlight(this.currentFocusedError);
    }
    
    // 키보드 스코프 비활성화
    if (this.keyboardScope && this.app) {
      this.app.keymap.popScope(this.keyboardScope);
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
   * 포커스된 오류 하이라이트
   */
  static highlightFocusedError(error: InlineError): void {
    const elements = document.querySelectorAll(`[data-error-id="${error.uniqueId}"]`);
    elements.forEach(element => {
      const htmlElement = element as HTMLElement;
      htmlElement.style.outline = '2px solid var(--interactive-accent)';
      htmlElement.style.outlineOffset = '2px';
      htmlElement.style.borderRadius = '3px';
      htmlElement.setAttribute('tabindex', '0');
      htmlElement.focus();
    });
    
    Logger.debug(`오류 하이라이트 적용: ${error.uniqueId}`);
  }

  /**
   * 포커스 하이라이트 제거
   */
  static removeFocusHighlight(error: InlineError): void {
    const elements = document.querySelectorAll(`[data-error-id="${error.uniqueId}"]`);
    elements.forEach(element => {
      const htmlElement = element as HTMLElement;
      htmlElement.style.outline = '';
      htmlElement.style.outlineOffset = '';
      htmlElement.style.borderRadius = '';
      htmlElement.removeAttribute('tabindex');
    });
    
    Logger.debug(`오류 하이라이트 제거: ${error.uniqueId}`);
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
   * 툴팁의 수정 제안 하이라이트 업데이트
   */
  static updateTooltipHighlight(): void {
    const tooltip = document.querySelector('.korean-grammar-inline-tooltip');
    if (!tooltip) return;

    const suggestionButtons = tooltip.querySelectorAll('.suggestion-button');
    suggestionButtons.forEach((button, index) => {
      const htmlButton = button as HTMLElement;
      
      // 현재 호버 중인 버튼은 키보드 하이라이트를 적용하지 않음
      if (htmlButton.getAttribute('data-hovered') === 'true') {
        return;
      }
      
      if (index === this.currentSuggestionIndex) {
        htmlButton.style.background = 'var(--interactive-accent)';
        htmlButton.style.color = 'var(--text-on-accent)';
        htmlButton.style.fontWeight = '600';
        htmlButton.style.border = '1px solid var(--interactive-accent)';
      } else {
        htmlButton.style.background = 'var(--interactive-normal)';
        htmlButton.style.color = 'var(--text-normal)';
        htmlButton.style.fontWeight = 'normal';
        htmlButton.style.border = '1px solid var(--background-modifier-border)';
      }
    });
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
    
    // 키보드 스코프 정리
    if (this.keyboardScope) {
      this.keyboardScope = null;
    }
    
    // 툴팁 정리
    if ((window as any).globalInlineTooltip?.visible) {
      (window as any).globalInlineTooltip.hide();
    }
    
    Logger.debug('인라인 모드: 서비스 정리됨 (겹치는 영역 처리 포함)');
  }
}