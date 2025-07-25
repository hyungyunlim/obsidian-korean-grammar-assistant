import { EditorView, WidgetType, Decoration, DecorationSet } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { Correction, InlineError } from '../types/interfaces';
import { Logger } from '../utils/logger';
import { globalInlineTooltip } from '../ui/inlineTooltip';
import { Scope, App, Platform } from 'obsidian';

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
 * 포커스된 오류 설정 Effect
 */
export const setFocusedErrorDecoration = StateEffect.define<string | null>({
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
              'tabindex': '0',
              'style': isFocused ? '' : `
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
                'style': isFocused ? '' : `
                  text-decoration-line: underline !important;
                  text-decoration-style: wavy !important;
                  text-decoration-color: #ff0000 !important;
                  text-decoration-thickness: 2px !important;
                  background-color: rgba(255, 0, 0, 0.05) !important;
                  cursor: pointer !important;
                `
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
    
    // 키보드 스코프 초기화 (App 인스턴스가 있을 때만)
    if (app) {
      this.initializeKeyboardScope();
    } else {
      Logger.debug('setEditorView: App 인스턴스가 없어 키보드 스코프 초기화 건너뜀');
    }
    
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
          
          // 짧은 딜레이 후 툴팁 표시
          setTimeout(() => {
            this.handleErrorTooltip(error, target);
          }, 50);
        }
      }
      
      touchTarget = null;
      touchStartTime = 0;
    }, { passive: true });

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
    underlineColor: string = '#ff0000',
    app?: App
  ): void {
    if (!view || !corrections.length) {
      Logger.warn('인라인 모드: 뷰나 교정 데이터가 없습니다.');
      return;
    }

    // 뷰 설정은 setEditorView에서 처리되므로 여기서는 생략
    // (중복 초기화 방지)

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
          // 🎯 위치 정보를 포함한 더 정확한 uniqueId 생성 (겹치는 오류 구분을 위해)
          const uniqueId = `${index}_${occurrence}_${foundIndex}`;
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
          
          Logger.debug(`🎯 오류 위치 설정: "${searchText}" (${uniqueId}) at ${foundIndex}-${foundIndex + searchText.length}`);
          occurrence++;
        }
        
        searchIndex = foundIndex + 1;
      }
    });

    // 🔧 겹치는 오류 병합 (분절 하이라이팅 방지)
    const mergedErrors = this.mergeOverlappingErrors(errors);
    Logger.debug(`🔧 오류 병합: ${errors.length}개 → ${mergedErrors.length}개`);

    // 데코레이션 추가
    view.dispatch({
      effects: addErrorDecorations.of({ errors: mergedErrors, underlineStyle, underlineColor })
    });

    Logger.log(`인라인 모드: ${mergedErrors.length}개 오류 표시됨 (병합 후)`);
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
   * 오류 툴팁 표시 핸들러 (바로 적용하지 않고 툴팁만 표시)
   */
  static handleErrorTooltip(error: InlineError, targetElement?: HTMLElement): void {
    Logger.log(`인라인 모드: 오류 툴팁 표시 - ${error.correction.original}`);
    
    try {
      // 실제 타겟 요소가 전달되면 그것을 사용, 없으면 기존 방식으로 찾기
      const element = targetElement || this.findErrorElement(error);
      if (element) {
        globalInlineTooltip.show(error, element, 'click');
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

    // decoration 업데이트를 위해 다시 표시
    const mergedErrors = [mergedError];
    this.currentView.dispatch({
      effects: addErrorDecorations.of({ 
        errors: mergedErrors, 
        underlineStyle: 'wavy', 
        underlineColor: '#ff0000' 
      })
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
   * 키보드 스코프 초기화
   */
  static initializeKeyboardScope(): void {
    if (!this.app) {
      Logger.warn('App 인스턴스가 없어 키보드 스코프를 초기화할 수 없습니다');
      return;
    }

    // 기존 스코프가 있으면 제거
    if (this.keyboardScope) {
      this.app.keymap.popScope(this.keyboardScope);
      this.keyboardScope = null;
      Logger.debug('기존 키보드 스코프 제거됨');
    }

    // 새로운 스코프 생성 (앱의 전역 스코프를 부모로 설정)
    this.keyboardScope = new Scope(this.app.scope);

    Logger.log('인라인 모드: 키보드 스코프 생성 시작');

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
      
      const suggestions = this.currentFocusedError.correction.corrected;
      if (!suggestions || suggestions.length === 0) {
        Logger.log('❌ 제안이 없음');
        return false;
      }
      
      this.currentSuggestionIndex = Math.max(0, this.currentSuggestionIndex - 1);
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
      
      const suggestions = this.currentFocusedError.correction.corrected;
      if (!suggestions || suggestions.length === 0) {
        Logger.log('❌ 제안이 없음');
        return false;
      }
      
      this.currentSuggestionIndex = Math.min(suggestions.length - 1, this.currentSuggestionIndex + 1);
      this.updateTooltipHighlight();
      Logger.log(`✅ 다음 제안: ${suggestions[this.currentSuggestionIndex]} (${this.currentSuggestionIndex + 1}/${suggestions.length})`);
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
      
      const suggestions = this.currentFocusedError.correction.corrected;
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
      
      const suggestions = this.currentFocusedError.correction.corrected;
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