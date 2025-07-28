/**
 * 선택 영역 상태 관리
 * 텍스트 선택, 포커스, 네비게이션 상태를 추적
 */

import { EditorView } from '@codemirror/view';
import { InlineError } from '../../types/interfaces';
import { Logger } from '../../utils/logger';

export interface SelectionRange {
  from: number;
  to: number;
  text: string;
}

export interface FocusNavigationState {
  currentIndex: number;
  totalCount: number;
  errorIds: string[];
  canGoNext: boolean;
  canGoPrev: boolean;
}

/**
 * 선택 상태 관리자
 */
export class SelectionStateManager {
  private currentSelection: SelectionRange | null = null;
  private focusedErrorId: string | null = null;
  private errorNavigationOrder: string[] = [];
  private currentFocusIndex: number = -1;
  
  // 에디터 뷰 참조
  private editorView: EditorView | null = null;
  
  // 선택 히스토리
  private selectionHistory: (SelectionRange | null)[] = [];
  private maxHistorySize: number = 20;
  
  // 키보드 네비게이션 설정
  private navigationEnabled: boolean = true;
  private wrapNavigation: boolean = true;
  
  // 상태 변경 콜백
  private onSelectionChange?: (selection: SelectionRange | null) => void;
  private onFocusChange?: (errorId: string | null, navigationState: FocusNavigationState) => void;
  
  constructor() {
    Logger.log('SelectionStateManager: 초기화 완료');
  }
  
  /**
   * 에디터 뷰 설정
   */
  setEditorView(view: EditorView | null): void {
    this.editorView = view;
    
    if (view) {
      this.updateSelectionFromEditor();
    } else {
      this.clearSelection();
    }
    
    Logger.log('SelectionStateManager: 에디터 뷰 설정', { hasView: !!view });
  }
  
  /**
   * 콜백 설정
   */
  setCallbacks(callbacks: {
    onSelectionChange?: (selection: SelectionRange | null) => void;
    onFocusChange?: (errorId: string | null, navigationState: FocusNavigationState) => void;
  }): void {
    this.onSelectionChange = callbacks.onSelectionChange;
    this.onFocusChange = callbacks.onFocusChange;
    
    Logger.log('SelectionStateManager: 콜백 설정 완료');
  }
  
  /**
   * 에디터에서 현재 선택 영역 업데이트
   */
  updateSelectionFromEditor(): void {
    if (!this.editorView) {
      return;
    }
    
    const selection = this.editorView.state.selection.main;
    const from = selection.from;
    const to = selection.to;
    
    if (from === to) {
      // 커서만 있는 경우
      this.setSelection(null);
    } else {
      // 텍스트가 선택된 경우
      const text = this.editorView.state.doc.sliceString(from, to);
      this.setSelection({ from, to, text });
    }
  }
  
  /**
   * 선택 영역 설정
   */
  setSelection(selection: SelectionRange | null): void {
    const previousSelection = this.currentSelection;
    
    // 같은 선택이면 무시
    if (this.isSameSelection(previousSelection, selection)) {
      return;
    }
    
    this.currentSelection = selection;
    
    // 히스토리에 추가
    this.addToSelectionHistory(selection);
    
    // 콜백 호출
    if (this.onSelectionChange) {
      this.onSelectionChange(selection);
    }
    
    Logger.log('SelectionStateManager: 선택 영역 설정', {
      hasSelection: !!selection,
      range: selection ? `${selection.from}-${selection.to}` : null,
      textLength: selection?.text.length || 0
    });
  }
  
  /**
   * 현재 선택 영역 조회
   */
  getCurrentSelection(): SelectionRange | null {
    return this.currentSelection ? { ...this.currentSelection } : null;
  }
  
  /**
   * 선택 영역 지우기
   */
  clearSelection(): void {
    this.setSelection(null);
  }
  
  /**
   * 오류 네비게이션 순서 업데이트
   */
  updateErrorNavigationOrder(errors: Map<string, InlineError>): void {
    // 시작 위치 기준으로 정렬
    this.errorNavigationOrder = Array.from(errors.keys()).sort((a, b) => {
      const errorA = errors.get(a);
      const errorB = errors.get(b);
      
      if (!errorA || !errorB) return 0;
      
      return errorA.start - errorB.start;
    });
    
    // 현재 포커스가 유효하지 않으면 인덱스 재조정
    if (this.focusedErrorId) {
      this.currentFocusIndex = this.errorNavigationOrder.indexOf(this.focusedErrorId);
      
      if (this.currentFocusIndex === -1) {
        this.setFocusedError(null);
      }
    }
    
    Logger.log('SelectionStateManager: 오류 네비게이션 순서 업데이트', {
      errorCount: this.errorNavigationOrder.length,
      currentFocusIndex: this.currentFocusIndex
    });
  }
  
  /**
   * 포커스된 오류 설정
   */
  setFocusedError(errorId: string | null): void {
    const previousFocusId = this.focusedErrorId;
    
    if (previousFocusId === errorId) {
      return; // 변경사항 없음
    }
    
    this.focusedErrorId = errorId;
    
    // 인덱스 업데이트
    if (errorId) {
      this.currentFocusIndex = this.errorNavigationOrder.indexOf(errorId);
    } else {
      this.currentFocusIndex = -1;
    }
    
    // 네비게이션 상태 생성
    const navigationState = this.createNavigationState();
    
    // 콜백 호출
    if (this.onFocusChange) {
      this.onFocusChange(errorId, navigationState);
    }
    
    Logger.log('SelectionStateManager: 포커스 설정', {
      previous: previousFocusId,
      current: errorId,
      index: this.currentFocusIndex,
      totalErrors: this.errorNavigationOrder.length
    });
  }
  
  /**
   * 다음 오류로 포커스 이동
   */
  focusNextError(): string | null {
    if (this.errorNavigationOrder.length === 0) {
      return null;
    }
    
    let nextIndex: number;
    
    if (this.currentFocusIndex === -1) {
      // 포커스가 없으면 첫 번째로
      nextIndex = 0;
    } else {
      nextIndex = this.currentFocusIndex + 1;
      
      // 마지막에 도달했을 때
      if (nextIndex >= this.errorNavigationOrder.length) {
        if (this.wrapNavigation) {
          nextIndex = 0; // 처음으로 순환
        } else {
          return null; // 이동 불가
        }
      }
    }
    
    const nextErrorId = this.errorNavigationOrder[nextIndex];
    this.setFocusedError(nextErrorId);
    
    return nextErrorId;
  }
  
  /**
   * 이전 오류로 포커스 이동
   */
  focusPrevError(): string | null {
    if (this.errorNavigationOrder.length === 0) {
      return null;
    }
    
    let prevIndex: number;
    
    if (this.currentFocusIndex === -1) {
      // 포커스가 없으면 마지막으로
      prevIndex = this.errorNavigationOrder.length - 1;
    } else {
      prevIndex = this.currentFocusIndex - 1;
      
      // 처음에 도달했을 때
      if (prevIndex < 0) {
        if (this.wrapNavigation) {
          prevIndex = this.errorNavigationOrder.length - 1; // 마지막으로 순환
        } else {
          return null; // 이동 불가
        }
      }
    }
    
    const prevErrorId = this.errorNavigationOrder[prevIndex];
    this.setFocusedError(prevErrorId);
    
    return prevErrorId;
  }
  
  /**
   * 첫 번째 오류로 포커스 이동
   */
  focusFirstError(): string | null {
    if (this.errorNavigationOrder.length === 0) {
      return null;
    }
    
    const firstErrorId = this.errorNavigationOrder[0];
    this.setFocusedError(firstErrorId);
    
    return firstErrorId;
  }
  
  /**
   * 마지막 오류로 포커스 이동
   */
  focusLastError(): string | null {
    if (this.errorNavigationOrder.length === 0) {
      return null;
    }
    
    const lastErrorId = this.errorNavigationOrder[this.errorNavigationOrder.length - 1];
    this.setFocusedError(lastErrorId);
    
    return lastErrorId;
  }
  
  /**
   * 현재 포커스된 오류 ID 조회
   */
  getFocusedErrorId(): string | null {
    return this.focusedErrorId;
  }
  
  /**
   * 현재 네비게이션 상태 조회
   */
  getNavigationState(): FocusNavigationState {
    return this.createNavigationState();
  }
  
  /**
   * 선택 히스토리 조회
   */
  getSelectionHistory(): (SelectionRange | null)[] {
    return [...this.selectionHistory];
  }
  
  /**
   * 에디터에서 특정 범위 선택
   */
  selectRangeInEditor(from: number, to: number): void {
    if (!this.editorView) {
      Logger.warn('SelectionStateManager: 에디터 뷰가 없어 선택할 수 없음');
      return;
    }
    
    try {
      this.editorView.dispatch({
        selection: { anchor: from, head: to },
        scrollIntoView: true
      });
      
      // 선택 상태 업데이트
      const text = this.editorView.state.doc.sliceString(from, to);
      this.setSelection({ from, to, text });
      
      Logger.log('SelectionStateManager: 에디터에서 범위 선택', {
        from, to, textLength: text.length
      });
      
    } catch (error) {
      Logger.error('SelectionStateManager: 범위 선택 실패', error);
    }
  }
  
  /**
   * 특정 오류 위치로 스크롤 및 선택
   */
  selectError(error: InlineError): void {
    this.selectRangeInEditor(error.start, error.end);
    this.setFocusedError(error.uniqueId);
  }
  
  /**
   * 네비게이션 설정 업데이트
   */
  updateNavigationSettings(settings: {
    navigationEnabled?: boolean;
    wrapNavigation?: boolean;
  }): void {
    if (settings.navigationEnabled !== undefined) {
      this.navigationEnabled = settings.navigationEnabled;
    }
    
    if (settings.wrapNavigation !== undefined) {
      this.wrapNavigation = settings.wrapNavigation;
    }
    
    Logger.log('SelectionStateManager: 네비게이션 설정 업데이트', {
      navigationEnabled: this.navigationEnabled,
      wrapNavigation: this.wrapNavigation
    });
  }
  
  /**
   * 네비게이션 상태 생성
   */
  private createNavigationState(): FocusNavigationState {
    const totalCount = this.errorNavigationOrder.length;
    const currentIndex = this.currentFocusIndex;
    
    let canGoNext = false;
    let canGoPrev = false;
    
    if (totalCount > 0 && this.navigationEnabled) {
      if (currentIndex === -1) {
        // 포커스가 없으면 양방향 모두 가능
        canGoNext = true;
        canGoPrev = true;
      } else {
        // 순환 네비게이션 고려
        canGoNext = this.wrapNavigation || currentIndex < totalCount - 1;
        canGoPrev = this.wrapNavigation || currentIndex > 0;
      }
    }
    
    return {
      currentIndex,
      totalCount,
      errorIds: [...this.errorNavigationOrder],
      canGoNext,
      canGoPrev
    };
  }
  
  /**
   * 선택 영역 비교
   */
  private isSameSelection(a: SelectionRange | null, b: SelectionRange | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    
    return a.from === b.from && a.to === b.to && a.text === b.text;
  }
  
  /**
   * 선택 히스토리에 추가
   */
  private addToSelectionHistory(selection: SelectionRange | null): void {
    // 중복 제거 (마지막과 같으면 추가하지 않음)
    const lastSelection = this.selectionHistory[this.selectionHistory.length - 1];
    
    if (this.isSameSelection(lastSelection, selection)) {
      return;
    }
    
    this.selectionHistory.push(selection);
    
    // 히스토리 크기 제한
    if (this.selectionHistory.length > this.maxHistorySize) {
      this.selectionHistory = this.selectionHistory.slice(-this.maxHistorySize);
    }
  }
  
  /**
   * 상태 초기화
   */
  reset(): void {
    this.currentSelection = null;
    this.focusedErrorId = null;
    this.errorNavigationOrder = [];
    this.currentFocusIndex = -1;
    this.selectionHistory = [];
    this.editorView = null;
    
    Logger.log('SelectionStateManager: 상태 초기화 완료');
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      hasSelection: !!this.currentSelection,
      currentSelection: this.currentSelection,
      focusedErrorId: this.focusedErrorId,
      currentFocusIndex: this.currentFocusIndex,
      errorNavigationOrder: this.errorNavigationOrder,
      navigationSettings: {
        navigationEnabled: this.navigationEnabled,
        wrapNavigation: this.wrapNavigation
      },
      selectionHistoryCount: this.selectionHistory.length,
      hasEditorView: !!this.editorView,
      hasCallbacks: {
        onSelectionChange: !!this.onSelectionChange,
        onFocusChange: !!this.onFocusChange
      }
    };
  }
}