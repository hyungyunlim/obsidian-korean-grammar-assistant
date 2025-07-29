/**
 * 팝업 상태 관리자
 * 팝업의 모든 상태를 중앙에서 관리하며 변경 이벤트를 제공
 */

import { PopupState, IPopupStateManager, PaginationState, LayoutState, FocusState, AIIntegrationState } from '../types/PopupTypes';
import { Logger } from '../../utils/logger';

export type StateChangeListener = (state: PopupState, changedFields: string[]) => void;

/**
 * 팝업 상태 관리자 구현
 */
export class PopupStateManager implements IPopupStateManager {
  private state: PopupState;
  private listeners: Set<StateChangeListener> = new Set();
  
  // 하위 상태 관리자들
  private paginationState: PaginationState;
  private layoutState: LayoutState;
  private focusState: FocusState;
  private aiState: AIIntegrationState;
  
  // 상태 변경 추적을 위한 이전 상태
  private previousState: PopupState;
  
  constructor(initialState?: Partial<PopupState>) {
    // 기본 상태 초기화
    this.state = {
      isVisible: false,
      isAiAnalyzing: false,
      currentPreviewPage: 0,
      totalPreviewPages: 1,
      isLongText: false,
      isErrorSummaryExpanded: true,
      currentFocusIndex: 0,
      lastUpdate: Date.now(),
      ...initialState
    };
    
    // 하위 상태들 초기화
    this.paginationState = {
      pageBreaks: [],
      charsPerPage: 800,
      currentPage: 0,
      totalPages: 1,
      dynamicSizing: true,
      lastSizeUpdate: Date.now()
    };
    
    this.layoutState = {
      areaVisibility: {
        header: true,
        preview: true,
        summary: true,
        footer: true
      },
      areaSizes: {
        header: { width: 0, height: 0 },
        preview: { width: 0, height: 0 },
        summary: { width: 0, height: 0 },
        footer: { width: 0, height: 0 }
      },
      responsiveEnabled: true,
      currentBreakpoint: 'desktop',
      customClasses: []
    };
    
    this.focusState = {
      currentIndex: 0,
      totalCount: 0,
      wrapAround: true,
      highlightEnabled: true,
      lastFocusChange: Date.now()
    };
    
    this.aiState = {
      isAnalyzing: false,
      results: [],
      tokenUsage: {
        estimated: 0,
        threshold: 1000
      },
      lastAnalysisTime: 0
    };
    
    this.previousState = { ...this.state };
    
    Logger.log('PopupStateManager: 초기화 완료', {
      initialState: this.state
    });
  }
  
  /**
   * 현재 상태 조회
   */
  getState(): PopupState {
    return { ...this.state };
  }
  
  /**
   * 페이지네이션 상태 조회
   */
  getPaginationState(): PaginationState {
    return { ...this.paginationState };
  }
  
  /**
   * 레이아웃 상태 조회
   */
  getLayoutState(): LayoutState {
    return { ...this.layoutState };
  }
  
  /**
   * 포커스 상태 조회
   */
  getFocusState(): FocusState {
    return { ...this.focusState };
  }
  
  /**
   * AI 상태 조회
   */
  getAIState(): AIIntegrationState {
    return { ...this.aiState };
  }
  
  /**
   * 상태 업데이트
   */
  updateState(updates: Partial<PopupState>): void {
    this.previousState = { ...this.state };
    
    // 변경된 필드 추적
    const changedFields: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (this.state[key as keyof PopupState] !== value) {
        changedFields.push(key);
        (this.state as any)[key] = value;
      }
    }
    
    // 마지막 업데이트 시간 갱신
    if (changedFields.length > 0) {
      this.state.lastUpdate = Date.now();
      changedFields.push('lastUpdate');
      
      Logger.debug('PopupStateManager: 상태 업데이트', {
        changedFields,
        newState: this.state
      });
      
      // 리스너들에게 변경 알림
      this.notifyListeners(changedFields);
    }
  }
  
  /**
   * 페이지네이션 상태 업데이트
   */
  updatePaginationState(updates: Partial<PaginationState>): void {
    const changedFields: string[] = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (this.paginationState[key as keyof PaginationState] !== value) {
        changedFields.push(`pagination.${key}`);
        (this.paginationState as any)[key] = value;
      }
    }
    
    if (changedFields.length > 0) {
      this.paginationState.lastSizeUpdate = Date.now();
      
      // 메인 상태도 동기화
      this.updateState({
        currentPreviewPage: this.paginationState.currentPage,
        totalPreviewPages: this.paginationState.totalPages,
        isLongText: this.paginationState.totalPages > 1
      });
      
      Logger.debug('PopupStateManager: 페이지네이션 상태 업데이트', {
        changedFields,
        paginationState: this.paginationState
      });
    }
  }
  
  /**
   * 레이아웃 상태 업데이트
   */
  updateLayoutState(updates: Partial<LayoutState>): void {
    const changedFields: string[] = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (this.layoutState[key as keyof LayoutState] !== value) {
        changedFields.push(`layout.${key}`);
        (this.layoutState as any)[key] = value;
      }
    }
    
    if (changedFields.length > 0) {
      Logger.debug('PopupStateManager: 레이아웃 상태 업데이트', {
        changedFields,
        layoutState: this.layoutState
      });
      
      // 상태 변경 알림
      this.notifyListeners(changedFields);
    }
  }
  
  /**
   * 포커스 상태 업데이트
   */
  updateFocusState(updates: Partial<FocusState>): void {
    const changedFields: string[] = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (this.focusState[key as keyof FocusState] !== value) {
        changedFields.push(`focus.${key}`);
        (this.focusState as any)[key] = value;
      }
    }
    
    if (changedFields.length > 0) {
      this.focusState.lastFocusChange = Date.now();
      
      // 메인 상태도 동기화
      this.updateState({
        currentFocusIndex: this.focusState.currentIndex
      });
      
      Logger.debug('PopupStateManager: 포커스 상태 업데이트', {
        changedFields,
        focusState: this.focusState
      });
    }
  }
  
  /**
   * AI 상태 업데이트
   */
  updateAIState(updates: Partial<AIIntegrationState>): void {
    const changedFields: string[] = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (this.aiState[key as keyof AIIntegrationState] !== value) {
        changedFields.push(`ai.${key}`);
        (this.aiState as any)[key] = value;
      }
    }
    
    if (changedFields.length > 0) {
      // 메인 상태도 동기화
      this.updateState({
        isAiAnalyzing: this.aiState.isAnalyzing
      });
      
      Logger.debug('PopupStateManager: AI 상태 업데이트', {
        changedFields,
        aiState: this.aiState
      });
    }
  }
  
  /**
   * 상태 리스너 등록
   */
  addStateListener(listener: StateChangeListener): void {
    this.listeners.add(listener);
    Logger.debug('PopupStateManager: 상태 리스너 추가', {
      listenerCount: this.listeners.size
    });
  }
  
  /**
   * 상태 리스너 제거
   */
  removeStateListener(listener: StateChangeListener): void {
    const removed = this.listeners.delete(listener);
    Logger.debug('PopupStateManager: 상태 리스너 제거', {
      removed,
      listenerCount: this.listeners.size
    });
  }
  
  /**
   * 모든 상태 리스너 제거
   */
  removeAllStateListeners(): void {
    this.listeners.clear();
    Logger.debug('PopupStateManager: 모든 상태 리스너 제거');
  }
  
  /**
   * 상태 초기화
   */
  resetState(): void {
    const initialState: PopupState = {
      isVisible: false,
      isAiAnalyzing: false,
      currentPreviewPage: 0,
      totalPreviewPages: 1,
      isLongText: false,
      isErrorSummaryExpanded: true,
      currentFocusIndex: 0,
      lastUpdate: Date.now()
    };
    
    this.previousState = { ...this.state };
    this.state = initialState;
    
    // 하위 상태들도 초기화
    this.paginationState = {
      pageBreaks: [],
      charsPerPage: 800,
      currentPage: 0,
      totalPages: 1,
      dynamicSizing: true,
      lastSizeUpdate: Date.now()
    };
    
    this.focusState = {
      currentIndex: 0,
      totalCount: 0,
      wrapAround: true,
      highlightEnabled: true,
      lastFocusChange: Date.now()
    };
    
    this.aiState = {
      isAnalyzing: false,
      results: [],
      tokenUsage: {
        estimated: 0,
        threshold: 1000
      },
      lastAnalysisTime: 0
    };
    
    Logger.log('PopupStateManager: 상태 초기화 완료');
    
    // 초기화 알림
    this.notifyListeners(Object.keys(this.state));
  }
  
  /**
   * 특정 페이지로 이동
   */
  goToPage(pageIndex: number): void {
    if (pageIndex < 0 || pageIndex >= this.paginationState.totalPages) {
      Logger.warn('PopupStateManager: 잘못된 페이지 인덱스', { pageIndex, totalPages: this.paginationState.totalPages });
      return;
    }
    
    this.updatePaginationState({
      currentPage: pageIndex
    });
    
    Logger.log('PopupStateManager: 페이지 이동', { pageIndex });
  }
  
  /**
   * 다음 페이지로 이동
   */
  goToNextPage(): boolean {
    if (this.paginationState.currentPage < this.paginationState.totalPages - 1) {
      this.goToPage(this.paginationState.currentPage + 1);
      return true;
    }
    return false;
  }
  
  /**
   * 이전 페이지로 이동
   */
  goToPrevPage(): boolean {
    if (this.paginationState.currentPage > 0) {
      this.goToPage(this.paginationState.currentPage - 1);
      return true;
    }
    return false;
  }
  
  /**
   * 오류 요약 영역 토글
   */
  toggleErrorSummary(): void {
    this.updateState({
      isErrorSummaryExpanded: !this.state.isErrorSummaryExpanded
    });
    
    Logger.log('PopupStateManager: 오류 요약 토글', {
      expanded: this.state.isErrorSummaryExpanded
    });
  }
  
  /**
   * 포커스 이동
   */
  moveFocus(direction: 'next' | 'prev' | 'first' | 'last'): boolean {
    const { currentIndex, totalCount, wrapAround } = this.focusState;
    let newIndex = currentIndex;
    
    switch (direction) {
      case 'next':
        newIndex = currentIndex + 1;
        if (newIndex >= totalCount) {
          newIndex = wrapAround ? 0 : totalCount - 1;
        }
        break;
        
      case 'prev':
        newIndex = currentIndex - 1;
        if (newIndex < 0) {
          newIndex = wrapAround ? totalCount - 1 : 0;
        }
        break;
        
      case 'first':
        newIndex = 0;
        break;
        
      case 'last':
        newIndex = Math.max(0, totalCount - 1);
        break;
    }
    
    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < totalCount) {
      this.updateFocusState({
        currentIndex: newIndex
      });
      
      Logger.debug('PopupStateManager: 포커스 이동', {
        direction,
        from: currentIndex,
        to: newIndex
      });
      
      return true;
    }
    
    return false;
  }
  
  /**
   * 리스너들에게 상태 변경 알림
   */
  private notifyListeners(changedFields: string[]): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state, changedFields);
      } catch (error) {
        Logger.error('PopupStateManager: 리스너 실행 중 오류', { error, changedFields });
      }
    }
  }
  
  /**
   * 상태 통계 정보
   */
  getStateStats(): {
    listenerCount: number;
    lastUpdate: number;
    paginationInfo: {
      currentPage: number;
      totalPages: number;
      charsPerPage: number;
    };
    focusInfo: {
      currentIndex: number;
      totalCount: number;
    };
    aiInfo: {
      isAnalyzing: boolean;
      resultCount: number;
      lastAnalysisTime: number;
    };
  } {
    return {
      listenerCount: this.listeners.size,
      lastUpdate: this.state.lastUpdate,
      paginationInfo: {
        currentPage: this.paginationState.currentPage,
        totalPages: this.paginationState.totalPages,
        charsPerPage: this.paginationState.charsPerPage
      },
      focusInfo: {
        currentIndex: this.focusState.currentIndex,
        totalCount: this.focusState.totalCount
      },
      aiInfo: {
        isAnalyzing: this.aiState.isAnalyzing,
        resultCount: this.aiState.results.length,
        lastAnalysisTime: this.aiState.lastAnalysisTime
      }
    };
  }
  
  /**
   * 전체 상태 디버그 정보
   */
  getDebugInfo(): any {
    return {
      mainState: this.state,
      paginationState: this.paginationState,
      layoutState: this.layoutState,
      focusState: this.focusState,
      aiState: this.aiState,
      stats: this.getStateStats()
    };
  }
}