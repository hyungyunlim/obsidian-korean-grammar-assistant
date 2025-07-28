/**
 * 개별 오류 상태 관리
 * 각 오류의 상세한 상태 추적 및 히스토리 관리
 */

import { InlineError, AIAnalysisResult } from '../../types/interfaces';
import { EnhancedInlineError } from '../types/InlineTypes';
import { Logger } from '../../utils/logger';

export type ErrorStateChange = {
  field: keyof InlineError;
  previousValue: any;
  currentValue: any;
  timestamp: number;
};

export type ErrorLifecycleEvent = 
  | 'created'
  | 'updated'
  | 'focused'
  | 'unfocused'
  | 'hovered'
  | 'unhovered'
  | 'selected'
  | 'edited'
  | 'ai-analyzed'
  | 'corrected'
  | 'ignored'
  | 'removed';

/**
 * 개별 오류 상태 관리자
 */
export class ErrorStateManager {
  private errorId: string;
  private currentState: EnhancedInlineError;
  private stateHistory: ErrorStateChange[] = [];
  private lifecycleHistory: { event: ErrorLifecycleEvent; timestamp: number; data?: any }[] = [];
  
  // 상태 추적
  private isHovered: boolean = false;
  private isFocused: boolean = false;
  private isSelected: boolean = false;
  private isEditing: boolean = false;
  
  // 성능 메트릭
  private createdAt: number;
  private lastUpdatedAt: number;
  private updateCount: number = 0;
  
  // AI 관련 상태
  private aiAnalysisHistory: AIAnalysisResult[] = [];
  private userInteractionCount: number = 0;
  
  constructor(initialError: InlineError) {
    this.errorId = initialError.uniqueId;
    this.createdAt = Date.now();
    this.lastUpdatedAt = this.createdAt;
    
    this.currentState = {
      ...initialError,
      isHovered: false,
      isFocused: false,
      lastUpdate: this.createdAt,
      shouldUpdate: true
    };
    
    this.recordLifecycleEvent('created', { initialError });
    
    Logger.log('ErrorStateManager: 오류 상태 관리자 생성', { 
      errorId: this.errorId,
      original: initialError.correction.original
    });
  }
  
  /**
   * 현재 상태 조회
   */
  getCurrentState(): EnhancedInlineError {
    return { ...this.currentState };
  }
  
  /**
   * 기본 InlineError 형태로 조회
   */
  getInlineError(): InlineError {
    return {
      uniqueId: this.currentState.uniqueId,
      correction: this.currentState.correction,
      start: this.currentState.start,
      end: this.currentState.end,
      line: this.currentState.line,
      ch: this.currentState.ch,
      isActive: this.currentState.isActive,
      aiStatus: this.currentState.aiStatus,
      aiSelectedValue: this.currentState.aiSelectedValue,
      aiAnalysis: this.currentState.aiAnalysis
    };
  }
  
  /**
   * 상태 업데이트
   */
  updateState(updates: Partial<InlineError>): boolean {
    const hasChanges = this.detectChanges(updates);
    
    if (!hasChanges) {
      return false; // 변경사항 없음
    }
    
    // 변경사항 히스토리 기록
    for (const [field, newValue] of Object.entries(updates)) {
      const previousValue = (this.currentState as any)[field];
      
      if (previousValue !== newValue) {
        this.recordStateChange(field as keyof InlineError, previousValue, newValue);
      }
    }
    
    // 상태 업데이트
    this.currentState = {
      ...this.currentState,
      ...updates,
      lastUpdate: Date.now(),
      shouldUpdate: true
    };
    
    this.lastUpdatedAt = Date.now();
    this.updateCount++;
    
    this.recordLifecycleEvent('updated', { updates, updateCount: this.updateCount });
    
    Logger.log('ErrorStateManager: 상태 업데이트', {
      errorId: this.errorId,
      updatedFields: Object.keys(updates),
      updateCount: this.updateCount
    });
    
    return true;
  }
  
  /**
   * 포커스 상태 설정
   */
  setFocused(focused: boolean): void {
    if (this.isFocused === focused) {
      return; // 변경사항 없음
    }
    
    this.isFocused = focused;
    this.currentState.isFocused = focused;
    
    const event: ErrorLifecycleEvent = focused ? 'focused' : 'unfocused';
    this.recordLifecycleEvent(event);
    this.incrementUserInteraction();
    
    Logger.log('ErrorStateManager: 포커스 상태 변경', {
      errorId: this.errorId,
      focused
    });
  }
  
  /**
   * 호버 상태 설정
   */
  setHovered(hovered: boolean): void {
    if (this.isHovered === hovered) {
      return; // 변경사항 없음
    }
    
    this.isHovered = hovered;
    this.currentState.isHovered = hovered;
    
    const event: ErrorLifecycleEvent = hovered ? 'hovered' : 'unhovered';
    this.recordLifecycleEvent(event);
    
    Logger.log('ErrorStateManager: 호버 상태 변경', {
      errorId: this.errorId,
      hovered
    });
  }
  
  /**
   * 선택 상태 설정
   */
  setSelected(selected: boolean): void {
    if (this.isSelected === selected) {
      return;
    }
    
    this.isSelected = selected;
    
    if (selected) {
      this.recordLifecycleEvent('selected');
      this.incrementUserInteraction();
    }
    
    Logger.log('ErrorStateManager: 선택 상태 변경', {
      errorId: this.errorId,
      selected
    });
  }
  
  /**
   * 편집 상태 설정
   */
  setEditing(editing: boolean, editedValue?: string): void {
    if (this.isEditing === editing) {
      return;
    }
    
    this.isEditing = editing;
    
    if (editing) {
      this.recordLifecycleEvent('edited', { editedValue });
      this.incrementUserInteraction();
    }
    
    Logger.log('ErrorStateManager: 편집 상태 변경', {
      errorId: this.errorId,
      editing,
      editedValue
    });
  }
  
  /**
   * AI 분석 결과 적용
   */
  applyAIAnalysis(result: AIAnalysisResult): void {
    // AI 분석 히스토리 기록
    this.aiAnalysisHistory.push(result);
    
    // 상태 업데이트
    const updates: Partial<InlineError> = {
      aiAnalysis: {
        selectedValue: result.selectedValue,
        confidence: result.confidence,
        reasoning: result.reasoning,
        isExceptionProcessed: result.isExceptionProcessed
      },
      aiStatus: result.isExceptionProcessed ? 'exception' : 'corrected',
      aiSelectedValue: result.selectedValue
    };
    
    this.updateState(updates);
    this.recordLifecycleEvent('ai-analyzed', { result });
    
    Logger.log('ErrorStateManager: AI 분석 결과 적용', {
      errorId: this.errorId,
      confidence: result.confidence,
      selectedValue: result.selectedValue
    });
  }
  
  /**
   * 교정 완료 처리
   */
  markAsCorrected(correctedValue: string): void {
    const updates: Partial<InlineError> = {
      aiSelectedValue: correctedValue,
      aiStatus: 'corrected'
    };
    
    this.updateState(updates);
    this.recordLifecycleEvent('corrected', { correctedValue });
    this.incrementUserInteraction();
    
    Logger.log('ErrorStateManager: 교정 완료 처리', {
      errorId: this.errorId,
      correctedValue
    });
  }
  
  /**
   * 무시 처리
   */
  markAsIgnored(): void {
    const updates: Partial<InlineError> = {
      aiStatus: 'exception'
    };
    
    this.updateState(updates);
    this.recordLifecycleEvent('ignored');
    this.incrementUserInteraction();
    
    Logger.log('ErrorStateManager: 무시 처리', { errorId: this.errorId });
  }
  
  /**
   * 상태 히스토리 조회
   */
  getStateHistory(): ErrorStateChange[] {
    return [...this.stateHistory];
  }
  
  /**
   * 라이프사이클 히스토리 조회
   */
  getLifecycleHistory(): typeof this.lifecycleHistory {
    return [...this.lifecycleHistory];
  }
  
  /**
   * AI 분석 히스토리 조회
   */
  getAIAnalysisHistory(): AIAnalysisResult[] {
    return [...this.aiAnalysisHistory];
  }
  
  /**
   * 상태 통계
   */
  getStats(): {
    errorId: string;
    createdAt: number;
    lastUpdatedAt: number;
    updateCount: number;
    userInteractionCount: number;
    stateHistoryCount: number;
    lifecycleHistoryCount: number;
    aiAnalysisCount: number;
    currentStatus: {
      isHovered: boolean;
      isFocused: boolean;
      isSelected: boolean;
      isEditing: boolean;
      aiStatus: string | undefined;
    };
    performance: {
      ageMs: number;
      timeSinceLastUpdateMs: number;
      avgTimeBetweenUpdates: number;
    };
  } {
    const now = Date.now();
    const ageMs = now - this.createdAt;
    const timeSinceLastUpdateMs = now - this.lastUpdatedAt;
    const avgTimeBetweenUpdates = this.updateCount > 1 
      ? ageMs / (this.updateCount - 1) 
      : 0;
    
    return {
      errorId: this.errorId,
      createdAt: this.createdAt,
      lastUpdatedAt: this.lastUpdatedAt,
      updateCount: this.updateCount,
      userInteractionCount: this.userInteractionCount,
      stateHistoryCount: this.stateHistory.length,
      lifecycleHistoryCount: this.lifecycleHistory.length,
      aiAnalysisCount: this.aiAnalysisHistory.length,
      currentStatus: {
        isHovered: this.isHovered,
        isFocused: this.isFocused,
        isSelected: this.isSelected,
        isEditing: this.isEditing,
        aiStatus: this.currentState.aiStatus
      },
      performance: {
        ageMs,
        timeSinceLastUpdateMs,
        avgTimeBetweenUpdates
      }
    };
  }
  
  /**
   * 변경사항 감지
   */
  private detectChanges(updates: Partial<InlineError>): boolean {
    for (const [key, newValue] of Object.entries(updates)) {
      const currentValue = (this.currentState as any)[key];
      
      if (this.hasChanged(currentValue, newValue)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 값 변경 여부 확인 (깊은 비교)
   */
  private hasChanged(current: any, newValue: any): boolean {
    if (current === newValue) {
      return false;
    }
    
    // 객체나 배열의 경우 JSON 비교 (간단한 경우만)
    if (typeof current === 'object' && typeof newValue === 'object') {
      if (current === null || newValue === null) {
        return current !== newValue;
      }
      
      try {
        return JSON.stringify(current) !== JSON.stringify(newValue);
      } catch {
        return true; // JSON 변환 실패 시 변경된 것으로 간주
      }
    }
    
    return true;
  }
  
  /**
   * 상태 변경 기록
   */
  private recordStateChange(field: keyof InlineError, previousValue: any, currentValue: any): void {
    const change: ErrorStateChange = {
      field,
      previousValue,
      currentValue,
      timestamp: Date.now()
    };
    
    this.stateHistory.push(change);
    
    // 히스토리 크기 제한 (최근 100개만 유지)
    if (this.stateHistory.length > 100) {
      this.stateHistory = this.stateHistory.slice(-100);
    }
  }
  
  /**
   * 라이프사이클 이벤트 기록
   */
  private recordLifecycleEvent(event: ErrorLifecycleEvent, data?: any): void {
    this.lifecycleHistory.push({
      event,
      timestamp: Date.now(),
      data
    });
    
    // 히스토리 크기 제한 (최근 50개만 유지)
    if (this.lifecycleHistory.length > 50) {
      this.lifecycleHistory = this.lifecycleHistory.slice(-50);
    }
  }
  
  /**
   * 사용자 상호작용 카운트 증가
   */
  private incrementUserInteraction(): void {
    this.userInteractionCount++;
  }
  
  /**
   * 상태 초기화 (제거 준비)
   */
  dispose(): void {
    this.recordLifecycleEvent('removed');
    
    // 메모리 정리
    this.stateHistory.length = 0;
    this.lifecycleHistory.length = 0;
    this.aiAnalysisHistory.length = 0;
    
    Logger.log('ErrorStateManager: 상태 관리자 정리', {
      errorId: this.errorId,
      finalStats: this.getStats()
    });
  }
}