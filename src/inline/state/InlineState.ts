/**
 * 인라인 모드 상태 관리
 * 기존 activeErrors Map과 완전 호환되면서 확장된 상태 관리 제공
 */

import { InlineError } from '../../types/interfaces';
import { EnhancedInlineError, InlineModeState } from '../types/InlineTypes';
import { Logger } from '../../utils/logger';

export type StateChangeEvent = {
  type: 'error-added' | 'error-removed' | 'error-updated' | 'focus-changed' | 'mode-changed';
  errorId?: string;
  previousValue?: any;
  currentValue?: any;
  timestamp: number;
};

export type StateChangeListener = (event: StateChangeEvent) => void;

/**
 * 인라인 상태 관리자
 */
export class InlineStateManager {
  private state: InlineModeState;
  private listeners: Set<StateChangeListener> = new Set();
  
  // 기존 호환성을 위한 activeErrors Map (완전 동기화)
  public activeErrors: Map<string, InlineError> = new Map();
  
  // 성능 최적화를 위한 캐시
  private errorListCache: InlineError[] | null = null;
  private errorCountCache: number = 0;
  private lastCacheUpdate: number = 0;
  private cacheValidityMs: number = 100; // 100ms 캐시 유효성
  
  constructor(initialState?: Partial<InlineModeState>) {
    this.state = {
      isActive: false,
      activeErrors: new Map(),
      focusedErrorId: null,
      aiAnalysisInProgress: false,
      lastAnalysisTime: 0,
      ...initialState
    };
    
    Logger.log('InlineStateManager: 초기화 완료', { 
      initialErrorCount: this.state.activeErrors.size 
    });
  }
  
  /**
   * 오류 추가 (기존 activeErrors Map과 완전 동기화)
   */
  addError(error: InlineError): void {
    const previousError = this.state.activeErrors.get(error.uniqueId);
    
    // 향상된 오류 객체로 변환
    const enhancedError: EnhancedInlineError = {
      ...error,
      isHovered: false,
      isFocused: false,
      lastUpdate: Date.now(),
      shouldUpdate: true
    };
    
    // 내부 상태 업데이트
    this.state.activeErrors.set(error.uniqueId, enhancedError);
    
    // 기존 호환성 Map 동기화
    this.activeErrors.set(error.uniqueId, error);
    
    // 캐시 무효화
    this.invalidateCache();
    
    // 이벤트 발생
    this.notifyListeners({
      type: 'error-added',
      errorId: error.uniqueId,
      previousValue: previousError,
      currentValue: enhancedError,
      timestamp: Date.now()
    });
    
    Logger.log('InlineStateManager: 오류 추가', { 
      errorId: error.uniqueId,
      totalErrors: this.state.activeErrors.size
    });
  }
  
  /**
   * 오류 제거
   */
  removeError(errorId: string): boolean {
    const removedError = this.state.activeErrors.get(errorId);
    
    if (!removedError) {
      Logger.warn('InlineStateManager: 제거할 오류를 찾을 수 없음', { errorId });
      return false;
    }
    
    // 내부 상태에서 제거
    const deleted = this.state.activeErrors.delete(errorId);
    
    // 기존 호환성 Map 동기화
    this.activeErrors.delete(errorId);
    
    // 포커스된 오류가 제거되는 경우 포커스 해제
    if (this.state.focusedErrorId === errorId) {
      this.setFocusedError(null);
    }
    
    // 캐시 무효화
    this.invalidateCache();
    
    // 이벤트 발생
    this.notifyListeners({
      type: 'error-removed',
      errorId,
      previousValue: removedError,
      currentValue: null,
      timestamp: Date.now()
    });
    
    Logger.log('InlineStateManager: 오류 제거', { 
      errorId,
      removed: deleted,
      totalErrors: this.state.activeErrors.size
    });
    
    return deleted;
  }
  
  /**
   * 오류 업데이트
   */
  updateError(errorId: string, updates: Partial<InlineError>): boolean {
    const existingError = this.state.activeErrors.get(errorId);
    
    if (!existingError) {
      Logger.warn('InlineStateManager: 업데이트할 오류를 찾을 수 없음', { errorId });
      return false;
    }
    
    // 기존 오류와 업데이트 병합
    const updatedError: EnhancedInlineError = {
      ...existingError,
      ...updates,
      lastUpdate: Date.now(),
      shouldUpdate: true
    };
    
    // 내부 상태 업데이트
    this.state.activeErrors.set(errorId, updatedError);
    
    // 기존 호환성 Map 동기화 (EnhancedInlineError에서 InlineError로 변환)
    const compatibleError: InlineError = {
      uniqueId: updatedError.uniqueId,
      correction: updatedError.correction,
      start: updatedError.start,
      end: updatedError.end,
      line: updatedError.line,
      ch: updatedError.ch,
      isActive: updatedError.isActive,
      aiStatus: updatedError.aiStatus,
      aiSelectedValue: updatedError.aiSelectedValue,
      aiAnalysis: updatedError.aiAnalysis
    };
    
    this.activeErrors.set(errorId, compatibleError);
    
    // 캐시 무효화
    this.invalidateCache();
    
    // 이벤트 발생
    this.notifyListeners({
      type: 'error-updated',
      errorId,
      previousValue: existingError,
      currentValue: updatedError,
      timestamp: Date.now()
    });
    
    Logger.log('InlineStateManager: 오류 업데이트', { 
      errorId,
      updatedFields: Object.keys(updates)
    });
    
    return true;
  }
  
  /**
   * 모든 오류 제거
   */
  clearAllErrors(): void {
    const previousCount = this.state.activeErrors.size;
    
    // 내부 상태 초기화
    this.state.activeErrors.clear();
    
    // 기존 호환성 Map 동기화
    this.activeErrors.clear();
    
    // 포커스 해제
    this.setFocusedError(null);
    
    // 캐시 무효화
    this.invalidateCache();
    
    // 이벤트 발생
    this.notifyListeners({
      type: 'error-removed',
      previousValue: previousCount,
      currentValue: 0,
      timestamp: Date.now()
    });
    
    Logger.log('InlineStateManager: 모든 오류 제거', { previousCount });
  }
  
  /**
   * 오류 조회
   */
  getError(errorId: string): InlineError | undefined {
    const enhancedError = this.state.activeErrors.get(errorId);
    return enhancedError ? this.convertToInlineError(enhancedError) : undefined;
  }
  
  /**
   * 모든 오류 조회 (기존 호환성)
   */
  getAllErrors(): Map<string, InlineError> {
    return new Map(this.activeErrors);
  }
  
  /**
   * 오류 목록 조회 (캐싱된)
   */
  getErrorList(): InlineError[] {
    const now = Date.now();
    
    if (this.errorListCache && (now - this.lastCacheUpdate) < this.cacheValidityMs) {
      return this.errorListCache;
    }
    
    this.errorListCache = Array.from(this.activeErrors.values());
    this.lastCacheUpdate = now;
    
    return this.errorListCache;
  }
  
  /**
   * 오류 개수 조회 (캐싱된)
   */
  getErrorCount(): number {
    const now = Date.now();
    
    if ((now - this.lastCacheUpdate) < this.cacheValidityMs) {
      return this.errorCountCache;
    }
    
    this.errorCountCache = this.activeErrors.size;
    this.lastCacheUpdate = now;
    
    return this.errorCountCache;
  }
  
  /**
   * 포커스된 오류 설정
   */
  setFocusedError(errorId: string | null): void {
    const previousFocusId = this.state.focusedErrorId;
    
    if (previousFocusId === errorId) {
      return; // 변경사항 없음
    }
    
    // 이전 포커스 해제
    if (previousFocusId) {
      this.updateErrorInternal(previousFocusId, { isFocused: false });
    }
    
    // 새 포커스 설정
    this.state.focusedErrorId = errorId;
    
    if (errorId) {
      this.updateErrorInternal(errorId, { isFocused: true });
    }
    
    // 이벤트 발생
    this.notifyListeners({
      type: 'focus-changed',
      errorId: errorId || undefined,
      previousValue: previousFocusId,
      currentValue: errorId,
      timestamp: Date.now()
    });
    
    Logger.log('InlineStateManager: 포커스 변경', { 
      previous: previousFocusId,
      current: errorId 
    });
  }
  
  /**
   * 포커스된 오류 ID 조회
   */
  getFocusedErrorId(): string | null {
    return this.state.focusedErrorId;
  }
  
  /**
   * 인라인 모드 활성화 상태 설정
   */
  setActive(isActive: boolean): void {
    const previousState = this.state.isActive;
    
    if (previousState === isActive) {
      return; // 변경사항 없음
    }
    
    this.state.isActive = isActive;
    
    // 이벤트 발생
    this.notifyListeners({
      type: 'mode-changed',
      previousValue: previousState,
      currentValue: isActive,
      timestamp: Date.now()
    });
    
    Logger.log('InlineStateManager: 모드 변경', { 
      previous: previousState,
      current: isActive 
    });
  }
  
  /**
   * 인라인 모드 활성화 상태 조회
   */
  isActive(): boolean {
    return this.state.isActive;
  }
  
  /**
   * AI 분석 진행 상태 설정
   */
  setAIAnalysisInProgress(inProgress: boolean): void {
    this.state.aiAnalysisInProgress = inProgress;
    
    if (!inProgress) {
      this.state.lastAnalysisTime = Date.now();
    }
    
    Logger.log('InlineStateManager: AI 분석 상태 변경', { inProgress });
  }
  
  /**
   * AI 분석 진행 상태 조회
   */
  isAIAnalysisInProgress(): boolean {
    return this.state.aiAnalysisInProgress;
  }
  
  /**
   * 상태 변경 리스너 추가
   */
  addStateChangeListener(listener: StateChangeListener): void {
    this.listeners.add(listener);
    Logger.log('InlineStateManager: 상태 변경 리스너 추가', { 
      listenerCount: this.listeners.size 
    });
  }
  
  /**
   * 상태 변경 리스너 제거
   */
  removeStateChangeListener(listener: StateChangeListener): void {
    const removed = this.listeners.delete(listener);
    Logger.log('InlineStateManager: 상태 변경 리스너 제거', { 
      removed,
      listenerCount: this.listeners.size 
    });
  }
  
  /**
   * 모든 리스너 제거
   */
  clearStateChangeListeners(): void {
    this.listeners.clear();
    Logger.log('InlineStateManager: 모든 상태 변경 리스너 제거');
  }
  
  /**
   * 내부 오류 업데이트 (이벤트 발생 없음)
   */
  private updateErrorInternal(errorId: string, updates: Partial<EnhancedInlineError>): void {
    const existingError = this.state.activeErrors.get(errorId);
    
    if (existingError) {
      const updatedError = { ...existingError, ...updates };
      this.state.activeErrors.set(errorId, updatedError);
      
      // 기존 호환성 Map 동기화 (필요한 경우만)
      if (updates.uniqueId || updates.correction || updates.start !== undefined || 
          updates.end !== undefined || updates.aiStatus || updates.aiSelectedValue) {
        this.activeErrors.set(errorId, this.convertToInlineError(updatedError));
      }
    }
  }
  
  /**
   * EnhancedInlineError를 InlineError로 변환
   */
  private convertToInlineError(enhanced: EnhancedInlineError): InlineError {
    return {
      uniqueId: enhanced.uniqueId,
      correction: enhanced.correction,
      start: enhanced.start,
      end: enhanced.end,
      line: enhanced.line,
      ch: enhanced.ch,
      isActive: enhanced.isActive,
      aiStatus: enhanced.aiStatus,
      aiSelectedValue: enhanced.aiSelectedValue,
      aiAnalysis: enhanced.aiAnalysis
    };
  }
  
  /**
   * 캐시 무효화
   */
  private invalidateCache(): void {
    this.errorListCache = null;
    this.errorCountCache = 0;
    this.lastCacheUpdate = 0;
  }
  
  /**
   * 리스너들에게 이벤트 알림
   */
  private notifyListeners(event: StateChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        Logger.error('InlineStateManager: 리스너 실행 중 오류', { error, event });
      }
    }
  }
  
  /**
   * 전체 상태 조회 (디버깅용)
   */
  getFullState(): InlineModeState & { listenerCount: number } {
    return {
      ...this.state,
      listenerCount: this.listeners.size
    };
  }
  
  /**
   * 상태 통계
   */
  getStateStats(): {
    errorCount: number;
    focusedErrorId: string | null;
    isActive: boolean;
    aiAnalysisInProgress: boolean;
    lastAnalysisTime: number;
    listenerCount: number;
    cacheStatus: {
      hasErrorListCache: boolean;
      errorCountCache: number;
      lastCacheUpdate: number;
    };
  } {
    return {
      errorCount: this.getErrorCount(),
      focusedErrorId: this.state.focusedErrorId,
      isActive: this.state.isActive,
      aiAnalysisInProgress: this.state.aiAnalysisInProgress,
      lastAnalysisTime: this.state.lastAnalysisTime,
      listenerCount: this.listeners.size,
      cacheStatus: {
        hasErrorListCache: !!this.errorListCache,
        errorCountCache: this.errorCountCache,
        lastCacheUpdate: this.lastCacheUpdate
      }
    };
  }
}