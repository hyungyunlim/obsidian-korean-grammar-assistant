/**
 * 인라인 모드 핵심 오케스트레이터
 * 기존 InlineModeService의 모든 기능을 유지하면서 모듈화
 */

import { EditorView } from '@codemirror/view';
import { App, MarkdownView } from 'obsidian';
import { EnhancedInlineError, InlineModeState, InlineModeConfig } from '../types/InlineTypes';
import { IEventSubscriber } from '../types/EventTypes';
import { InlineError, Correction, AIAnalysisResult } from '../../types/interfaces';
import { Logger } from '../../utils/logger';
import { DecorationManager, decorationState } from '../decorations/DecorationManager';
import { EventManager } from '../events/EventManager';
import { ClickEventData, HoverEventData, KeyboardEventData, TouchEventData } from '../types/EventTypes';
import { InlineStateManager } from '../state/InlineState';
import { SelectionStateManager } from '../state/SelectionState';

export class InlineModeCore implements IEventSubscriber {
  private app: App;
  private state: InlineModeState;
  private config: InlineModeConfig;
  
  // 하위 매니저들
  private decorationManager: DecorationManager; // Phase 2에서 구현됨
  private eventManager: EventManager; // Phase 3에서 구현됨
  private stateManager: InlineStateManager; // Phase 4에서 구현됨
  private selectionManager: SelectionStateManager; // Phase 4에서 구현됨
  private aiIntegration: any = null;
  
  // 기존 호환성을 위한 속성들
  public activeErrors: Map<string, InlineError> = new Map();
  public isInlineMode: boolean = false;
  
  constructor(app: App, config?: Partial<InlineModeConfig>) {
    this.app = app;
    this.config = {
      enableHover: true,
      enableKeyboard: true,
      autoFocus: true,
      debounceMs: 150,
      maxErrors: 1000,
      ...config
    };
    
    this.state = {
      isActive: false,
      activeErrors: new Map(),
      focusedErrorId: null,
      aiAnalysisInProgress: false,
      lastAnalysisTime: 0
    };
    
    // 매니저들 초기화
    this.decorationManager = DecorationManager.getInstance();
    this.eventManager = new EventManager();
    this.stateManager = new InlineStateManager(this.state);
    this.selectionManager = new SelectionStateManager();
    
    // 이벤트 구독 설정
    this.eventManager.subscribe(this);
    
    // 상태 관리자 콜백 설정
    this.setupStateManagerCallbacks();
    
    // 기존 activeErrors Map을 상태 관리자와 동기화
    this.activeErrors = this.stateManager.activeErrors;
    
    Logger.log('InlineModeCore: 초기화 완료', { config: this.config });
  }
  
  /**
   * 상태 관리자 콜백 설정
   */
  private setupStateManagerCallbacks(): void {
    // 상태 변경 리스너 등록
    this.stateManager.addStateChangeListener((event) => {
      Logger.log('InlineModeCore: 상태 변경 이벤트', { 
        type: event.type,
        errorId: event.errorId
      });
      
      // 데코레이션 업데이트
      if (event.type === 'error-added' || event.type === 'error-updated' || event.type === 'error-removed') {
        this.updateDecorations();
      }
      
      // 포커스 변경 시 데코레이션 업데이트
      if (event.type === 'focus-changed') {
        this.decorationManager.setFocusedError(event.currentValue);
        this.eventManager.setFocusedError(event.currentValue);
        this.selectionManager.setFocusedError(event.currentValue);
      }
    });
    
    // 선택 관리자 콜백 설정
    this.selectionManager.setCallbacks({
      onSelectionChange: (selection) => {
        Logger.log('InlineModeCore: 선택 영역 변경', { 
          hasSelection: !!selection,
          range: selection ? `${selection.from}-${selection.to}` : null
        });
      },
      onFocusChange: (errorId, navigationState) => {
        Logger.log('InlineModeCore: 포커스 네비게이션 변경', {
          errorId,
          currentIndex: navigationState.currentIndex,
          totalCount: navigationState.totalCount
        });
        
        // 상태 관리자와 동기화
        this.stateManager.setFocusedError(errorId);
      }
    });
    
    Logger.log('InlineModeCore: 상태 관리자 콜백 설정 완료');
  }
  
  /**
   * 인라인 모드 활성화
   * 기존 InlineModeService.enableInlineMode()와 호환
   */
  async enableInlineMode(): Promise<void> {
    try {
      Logger.log('InlineModeCore: 인라인 모드 활성화 시작');
      
      // 상태 관리자를 통해 활성화 상태 설정
      this.stateManager.setActive(true);
      
      // 기존 호환성 유지
      this.isInlineMode = true;
      
      // 현재 에디터 뷰 가져오기
      const view = this.getCurrentEditorView();
      if (!view) {
        Logger.warn('InlineModeCore: 활성 에디터 뷰를 찾을 수 없음');
        return;
      }
      
      // 데코레이션 매니저 초기화
      this.decorationManager.initialize(view);
      
      // 이벤트 매니저 초기화
      this.eventManager.registerEvents(view);
      
      // 선택 관리자에 에디터 뷰 설정
      this.selectionManager.setEditorView(view);
      
      Logger.log('InlineModeCore: 인라인 모드 활성화 완료');
      
    } catch (error) {
      Logger.error('InlineModeCore: 인라인 모드 활성화 실패', error);
      throw error;
    }
  }
  
  /**
   * 인라인 모드 비활성화
   * 기존 InlineModeService.disableInlineMode()와 호환
   */
  async disableInlineMode(): Promise<void> {
    try {
      Logger.log('InlineModeCore: 인라인 모드 비활성화 시작');
      
      // 이벤트 매니저 정리
      this.eventManager.unregisterEvents();
      
      // 데코레이션 정리
      this.decorationManager.clearAllDecorations();
      
      // 선택 관리자 정리
      this.selectionManager.setEditorView(null);
      
      // 상태 관리자를 통해 모든 상태 초기화
      this.stateManager.clearAllErrors();
      this.stateManager.setActive(false);
      
      // 기존 호환성 유지
      this.isInlineMode = false;
      
      Logger.log('InlineModeCore: 인라인 모드 비활성화 완료');
      
    } catch (error) {
      Logger.error('InlineModeCore: 인라인 모드 비활성화 실패', error);
      throw error;
    }
  }
  
  /**
   * 텍스트 분석 실행
   * 기존 InlineModeService.analyzeText()와 호환
   */
  async analyzeText(text: string): Promise<void> {
    try {
      Logger.log('InlineModeCore: 텍스트 분석 시작', { textLength: text.length });
      
      // TODO: Phase 1에서는 기존 로직 위임
      // 실제 구현은 기존 InlineModeService에서 처리
      
      Logger.log('InlineModeCore: 텍스트 분석 완료');
      
    } catch (error) {
      Logger.error('InlineModeCore: 텍스트 분석 실패', error);
      throw error;
    }
  }
  
  /**
   * AI 분석 적용
   * 기존 InlineModeService.applyAIAnalysis()와 호환
   */
  async applyAIAnalysis(results: AIAnalysisResult[]): Promise<void> {
    try {
      Logger.log('InlineModeCore: AI 분석 적용 시작', { resultsCount: results.length });
      
      this.state.aiAnalysisInProgress = true;
      
      // TODO: Phase 5에서 구현
      // await this.aiIntegration?.applyResults(results);
      
      this.state.aiAnalysisInProgress = false;
      this.state.lastAnalysisTime = Date.now();
      
      Logger.log('InlineModeCore: AI 분석 적용 완료');
      
    } catch (error) {
      Logger.error('InlineModeCore: AI 분석 적용 실패', error);
      this.state.aiAnalysisInProgress = false;
      throw error;
    }
  }
  
  /**
   * 사용자 편집 처리
   * 기존 InlineModeService.handleUserEdit()와 호환
   */
  async handleUserEdit(errorId: string, newValue: string): Promise<void> {
    try {
      Logger.log('InlineModeCore: 사용자 편집 처리', { errorId, newValue });
      
      const error = this.state.activeErrors.get(errorId) || this.activeErrors.get(errorId);
      if (!error) {
        Logger.warn('InlineModeCore: 오류를 찾을 수 없음', { errorId });
        return;
      }
      
      // TODO: Phase 4에서 구현
      // await this.stateManager?.updateError(errorId, { userEditedValue: newValue });
      
      Logger.log('InlineModeCore: 사용자 편집 처리 완료');
      
    } catch (error) {
      Logger.error('InlineModeCore: 사용자 편집 처리 실패', error);
      throw error;
    }
  }
  
  /**
   * 현재 에디터 뷰 가져오기
   * 기존 로직과 동일
   */
  private getCurrentEditorView(): EditorView | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      return null;
    }
    
    return (activeView.editor as any)?.cm;
  }
  
  /**
   * 상태 조회 메서드들 (기존 호환성)
   */
  public isActive(): boolean {
    return this.stateManager.isActive();
  }
  
  public getActiveErrors(): Map<string, InlineError> {
    return this.stateManager.getAllErrors();
  }
  
  public getErrorCount(): number {
    return this.stateManager.getErrorCount();
  }
  
  public getFocusedErrorId(): string | null {
    return this.stateManager.getFocusedErrorId();
  }
  
  /**
   * IEventSubscriber 인터페이스 구현
   */
  async onErrorClick(data: ClickEventData): Promise<void> {
    try {
      Logger.log('InlineModeCore: 클릭 이벤트 처리', { 
        errorId: data.errorId,
        isMobile: data.isMobile
      });
      
      // TODO: Phase 4에서 상태 관리자와 연동하여 실제 클릭 처리 구현
      // 현재는 기존 로직에 위임
      
    } catch (error) {
      Logger.error('InlineModeCore: 클릭 이벤트 처리 실패', error);
    }
  }
  
  async onErrorHover(data: HoverEventData): Promise<void> {
    try {
      Logger.log('InlineModeCore: 호버 이벤트 처리', { 
        errorId: data.errorId,
        isEntering: data.isEntering
      });
      
      if (data.isEntering) {
        // 툴팁 표시 로직
        // TODO: Phase 4에서 상태 관리자와 연동
      } else {
        // 툴팁 숨김 로직
        // TODO: Phase 4에서 상태 관리자와 연동
      }
      
    } catch (error) {
      Logger.error('InlineModeCore: 호버 이벤트 처리 실패', error);
    }
  }
  
  async onErrorKeyboard(data: KeyboardEventData): Promise<void> {
    try {
      Logger.log('InlineModeCore: 키보드 이벤트 처리', { 
        action: data.action,
        errorId: data.errorId,
        direction: data.direction
      });
      
      switch (data.action) {
        case 'navigate':
          await this.handleKeyboardNavigation(data);
          break;
        case 'select':
          await this.handleKeyboardSelection(data);
          break;
        case 'edit':
          await this.handleKeyboardEdit(data);
          break;
        case 'escape':
          await this.handleKeyboardEscape(data);
          break;
        default:
          Logger.warn('InlineModeCore: 알 수 없는 키보드 액션', { action: data.action });
      }
      
    } catch (error) {
      Logger.error('InlineModeCore: 키보드 이벤트 처리 실패', error);
    }
  }
  
  async onErrorTouch(data: TouchEventData): Promise<void> {
    try {
      Logger.log('InlineModeCore: 터치 이벤트 처리', { 
        errorId: data.errorId,
        gestureType: data.gestureType
      });
      
      switch (data.gestureType) {
        case 'tap':
          // 단일 탭 - 클릭과 동일한 처리
          await this.onErrorClick({
            ...data,
            mouseEvent: new MouseEvent('click'),
            isMobile: true
          } as ClickEventData);
          break;
        case 'hold':
          // 홀드 - 편집 모드 진입
          await this.handleTouchHold(data);
          break;
        case 'double-tap':
          // 더블탭 - 특별 동작
          await this.handleTouchDoubleTap(data);
          break;
      }
      
    } catch (error) {
      Logger.error('InlineModeCore: 터치 이벤트 처리 실패', error);
    }
  }
  
  /**
   * 키보드 네비게이션 처리
   */
  private async handleKeyboardNavigation(data: KeyboardEventData): Promise<void> {
    if (!data.direction) return;
    
    let nextErrorId: string | null = null;
    
    // 선택 관리자를 통한 네비게이션
    switch (data.direction) {
      case 'next':
        nextErrorId = this.selectionManager.focusNextError();
        break;
      case 'prev':
        nextErrorId = this.selectionManager.focusPrevError();
        break;
      case 'first':
        nextErrorId = this.selectionManager.focusFirstError();
        break;
      case 'last':
        nextErrorId = this.selectionManager.focusLastError();
        break;
    }
    
    if (nextErrorId) {
      Logger.log('InlineModeCore: 키보드 네비게이션 완료', { 
        direction: data.direction,
        newFocusId: nextErrorId 
      });
    } else {
      Logger.log('InlineModeCore: 키보드 네비게이션 불가', { 
        direction: data.direction,
        reason: '이동할 오류가 없음'
      });
    }
  }
  
  /**
   * 키보드 선택 처리
   */
  private async handleKeyboardSelection(data: KeyboardEventData): Promise<void> {
    if (!data.errorId) return;
    
    // TODO: Phase 4에서 상태 관리자와 연동하여 수정 제안 선택 구현
    Logger.log('InlineModeCore: 키보드 선택 처리 (TODO)', { errorId: data.errorId });
  }
  
  /**
   * 키보드 편집 처리
   */
  private async handleKeyboardEdit(data: KeyboardEventData): Promise<void> {
    if (!data.errorId) return;
    
    // TODO: Phase 4에서 상태 관리자와 연동하여 편집 모드 진입 구현
    Logger.log('InlineModeCore: 키보드 편집 처리 (TODO)', { errorId: data.errorId });
  }
  
  /**
   * 키보드 취소 처리
   */
  private async handleKeyboardEscape(data: KeyboardEventData): Promise<void> {
    // 상태 관리자를 통해 포커스 해제
    this.stateManager.setFocusedError(null);
    
    Logger.log('InlineModeCore: 키보드 취소 처리 완료');
  }
  
  /**
   * 터치 홀드 처리
   */
  private async handleTouchHold(data: TouchEventData): Promise<void> {
    // TODO: Phase 4에서 모바일 편집 모드 구현
    Logger.log('InlineModeCore: 터치 홀드 처리 (TODO)', { errorId: data.errorId });
  }
  
  /**
   * 터치 더블탭 처리
   */
  private async handleTouchDoubleTap(data: TouchEventData): Promise<void> {
    // TODO: Phase 4에서 특별 동작 구현
    Logger.log('InlineModeCore: 터치 더블탭 처리 (TODO)', { errorId: data.errorId });
  }
  
  /**
   * 데코레이션 업데이트
   */
  private updateDecorations(): void {
    try {
      const allErrors = this.stateManager.getAllErrors();
      
      // 이벤트 매니저와 선택 관리자에 오류 목록 업데이트
      this.eventManager.updateErrorList(allErrors);
      this.selectionManager.updateErrorNavigationOrder(allErrors);
      
      // 데코레이션 매니저 업데이트
      this.decorationManager.updateDecorations(allErrors);
      
      Logger.log('InlineModeCore: 데코레이션 업데이트 완료', { 
        errorCount: allErrors.size 
      });
      
    } catch (error) {
      Logger.error('InlineModeCore: 데코레이션 업데이트 실패', error);
    }
  }
  
  /**
   * 오류 추가 (외부 API)
   */
  public addError(error: InlineError): void {
    this.stateManager.addError(error);
    
    Logger.log('InlineModeCore: 오류 추가', { 
      errorId: error.uniqueId,
      totalErrors: this.getErrorCount()
    });
  }
  
  /**
   * 오류 제거 (외부 API)
   */
  public removeError(errorId: string): boolean {
    const removed = this.stateManager.removeError(errorId);
    
    Logger.log('InlineModeCore: 오류 제거', { 
      errorId,
      removed,
      totalErrors: this.getErrorCount()
    });
    
    return removed;
  }
  
  /**
   * 오류 업데이트 (외부 API)
   */
  public updateError(errorId: string, updates: Partial<InlineError>): boolean {
    const updated = this.stateManager.updateError(errorId, updates);
    
    Logger.log('InlineModeCore: 오류 업데이트', { 
      errorId,
      updated,
      updatedFields: Object.keys(updates)
    });
    
    return updated;
  }
  
  /**
   * 모든 오류 설정 (외부 API)
   */
  public setErrors(errors: InlineError[]): void {
    // 기존 오류 모두 제거
    this.stateManager.clearAllErrors();
    
    // 새 오류들 추가
    for (const error of errors) {
      this.stateManager.addError(error);
    }
    
    Logger.log('InlineModeCore: 오류 목록 설정', { 
      errorCount: errors.length 
    });
  }
  
  /**
   * 상태 관리자 접근 (디버깅용)
   */
  public getStateManager(): InlineStateManager {
    return this.stateManager;
  }
  
  /**
   * 선택 관리자 접근 (디버깅용)
   */
  public getSelectionManager(): SelectionStateManager {
    return this.selectionManager;
  }
  
  /**
   * 디버그 정보
   */
  public getDebugInfo(): any {
    return {
      isActive: this.isActive(),
      errorCount: this.getErrorCount(),
      focusedErrorId: this.getFocusedErrorId(),
      state: this.stateManager.getStateStats(),
      selection: this.selectionManager.getDebugInfo(),
      decoration: this.decorationManager.getDebugInfo(),
      events: this.eventManager.getDebugInfo()
    };
  }
}