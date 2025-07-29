/**
 * CorrectionPopup 호환성 어댑터
 * 기존 CorrectionPopup API와 완전 호환되면서 새로운 모듈화된 구조로 점진적 마이그레이션 지원
 */

import { Editor, EditorPosition, App, Platform, Scope, Notice } from 'obsidian';
import { CorrectionPopupCore } from './core/CorrectionPopupCore';
import { 
  PopupCoreConfig, 
  PopupInitializationData, 
  PopupConfiguration 
} from './types/PopupTypes';
import { Correction, PopupConfig, AIAnalysisResult, PageCorrection } from '../types/interfaces';
import { CorrectionStateManager } from '../state/correctionState';
import { AIAnalysisService } from '../services/aiAnalysisService';
import { BaseComponent } from '../ui/baseComponent';
import { Logger } from '../utils/logger';

/**
 * 마이그레이션 단계 타입
 */
export type MigrationPhase = 'legacy' | 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'complete';

/**
 * 어댑터 설정 인터페이스
 */
export interface AdapterConfig {
  /** 현재 마이그레이션 단계 */
  migrationPhase: MigrationPhase;
  /** 레거시 모드 강제 활성화 */
  forceLegacyMode?: boolean;
  /** 새로운 기능 활성화 여부 */
  enableNewFeatures?: boolean;
  /** 디버그 모드 활성화 */
  debugMode?: boolean;
}

/**
 * CorrectionPopup 어댑터 클래스
 * 기존 CorrectionPopup을 확장하면서 새로운 모듈화된 구조로 점진적 전환
 */
export class CorrectionPopupAdapter extends BaseComponent {
  // =============================================================================
  // 기존 호환성을 위한 속성들 (CorrectionPopup과 동일)
  // =============================================================================
  
  /**
   * 렌더링 (BaseComponent에서 요구)
   */
  render(): HTMLElement {
    // 레거시 모드에서는 빈 div 반환 (기존 DOM 직접 조작 방식 사용)
    // Phase 2 이상에서는 새로운 렌더링 시스템 사용 예정
    return this.element;
  }
  
  private config: PopupConfig;
  private app: App;
  private stateManager: CorrectionStateManager;
  private aiService?: AIAnalysisService;
  private onSettingsUpdate?: (newMaxTokens: number) => void;
  
  // Pagination state (기존 호환성)
  private isLongText: boolean = false;
  private currentPreviewPage: number = 0;
  private totalPreviewPages: number = 1;
  private pageBreaks: number[] = [];
  private charsPerPage: number = 800;
  
  // AI 분석 결과 (기존 호환성)
  private aiAnalysisResults: AIAnalysisResult[] = [];
  private isAiAnalyzing: boolean = false;

  // 키보드 네비게이션 (기존 호환성)
  private keyboardScope: Scope;
  private currentFocusIndex: number = 0;
  private currentCorrections: PageCorrection[] = [];
  
  // 전체 오류 위치 캐시 (기존 호환성)
  private allErrorPositions: Array<{
    correction: Correction;
    originalIndex: number;
    absolutePosition: number;
    uniqueId: string;
  }> = [];

  // =============================================================================
  // 새로운 모듈화된 구조 관련 속성들
  // =============================================================================
  
  private core?: CorrectionPopupCore;
  private adapterConfig: AdapterConfig;
  private migrationPhase: MigrationPhase;
  
  // 초기화 데이터
  private selectedText: string = '';
  private editor?: Editor;
  private selectionStart?: EditorPosition;
  private selectionEnd?: EditorPosition;
  
  constructor(
    app: App, 
    config: PopupConfig, 
    aiService?: AIAnalysisService, 
    onSettingsUpdate?: (newMaxTokens: number) => void,
    adapterConfig: AdapterConfig = { migrationPhase: 'phase1' }
  ) {
    super('div', 'correction-popup-container');
    
    this.app = app;
    this.config = config;
    this.aiService = aiService;
    this.onSettingsUpdate = onSettingsUpdate;
    this.adapterConfig = adapterConfig;
    this.migrationPhase = adapterConfig.migrationPhase;
    
    // 기존 상태 관리자 초기화 (호환성 유지)
    this.stateManager = new CorrectionStateManager(
      this.config.corrections, 
      this.config.ignoredWords
    );
    
    // 키보드 스코프 초기화 (기존 호환성)
    this.keyboardScope = new Scope();
    
    // 마이그레이션 단계에 따른 초기화
    this.initializeByMigrationPhase();
    
    Logger.log('CorrectionPopupAdapter: 초기화 완료', {
      migrationPhase: this.migrationPhase,
      hasAIService: !!this.aiService,
      correctionCount: this.config.corrections.length
    });
  }
  
  // =============================================================================
  // 마이그레이션 단계별 초기화
  // =============================================================================
  
  /**
   * 마이그레이션 단계에 따른 초기화
   */
  private initializeByMigrationPhase(): void {
    switch (this.migrationPhase) {
      case 'legacy':
        this.initializeLegacyMode();
        break;
        
      case 'phase1':
        this.initializePhase1();
        break;
        
      case 'phase2':
        this.initializePhase2();
        break;
        
      case 'phase3':
        this.initializePhase3();
        break;
        
      case 'phase4':
        this.initializePhase4();
        break;
        
      case 'complete':
        this.initializeCompleteMode();
        break;
        
      default:
        Logger.warn('CorrectionPopupAdapter: 알 수 없는 마이그레이션 단계', { phase: this.migrationPhase });
        this.initializeLegacyMode();
    }
  }
  
  /**
   * 레거시 모드 초기화 (기존 CorrectionPopup과 동일)
   */
  private initializeLegacyMode(): void {
    // 기존 CorrectionPopup의 초기화 로직 유지
    this.setupKeyboardNavigation();
    this.initializePagination();
    this.calculateAllErrorPositions();
    
    Logger.debug('CorrectionPopupAdapter: 레거시 모드 초기화 완료');
  }
  
  /**
   * Phase 1 초기화 (Core + StateManager)
   */
  private initializePhase1(): void {
    // 새로운 Core 초기화
    const coreConfig: PopupCoreConfig = {
      app: this.app,
      config: this.convertToPopupConfiguration(this.config),
      aiService: this.aiService,
      onSettingsUpdate: this.onSettingsUpdate
    };
    
    this.core = new CorrectionPopupCore(coreConfig);
    
    // 기존 속성들을 Core와 동기화
    this.syncWithCore();
    
    Logger.debug('CorrectionPopupAdapter: Phase 1 초기화 완료');
  }
  
  /**
   * Phase 2 초기화 (+ Layout System)
   */
  private initializePhase2(): void {
    this.initializePhase1();
    // Phase 2 기능들은 아직 구현되지 않음
    Logger.debug('CorrectionPopupAdapter: Phase 2 초기화 완료');
  }
  
  /**
   * Phase 3 초기화 (+ Pagination System)  
   */
  private initializePhase3(): void {
    this.initializePhase2();
    // Phase 3 기능들은 아직 구현되지 않음
    Logger.debug('CorrectionPopupAdapter: Phase 3 초기화 완료');
  }
  
  /**
   * Phase 4 초기화 (+ Keyboard Navigation)
   */
  private initializePhase4(): void {
    this.initializePhase3();
    // Phase 4 기능들은 아직 구현되지 않음
    Logger.debug('CorrectionPopupAdapter: Phase 4 초기화 완료');
  }
  
  /**
   * 완전 모드 초기화 (모든 새로운 기능 활성화)
   */
  private initializeCompleteMode(): void {
    this.initializePhase4();
    // 완전 모드 기능들은 아직 구현되지 않음
    Logger.debug('CorrectionPopupAdapter: 완전 모드 초기화 완료');
  }
  
  // =============================================================================
  // Core와의 동기화
  // =============================================================================
  
  /**
   * Core와 기존 속성들 동기화
   */
  private syncWithCore(): void {
    if (!this.core) return;
    
    // Core의 속성들을 기존 속성들과 동기화
    this.keyboardScope = this.core.keyboardScope;
    this.currentFocusIndex = this.core.currentFocusIndex;
    this.currentCorrections = this.core.currentCorrections;
    this.isAiAnalyzing = this.core.isAiAnalyzing;
    this.aiAnalysisResults = this.core.aiAnalysisResults;
    
    Logger.debug('CorrectionPopupAdapter: Core와 동기화 완료');
  }
  
  /**
   * PopupConfig를 PopupConfiguration으로 변환
   */
  private convertToPopupConfiguration(config: PopupConfig): PopupConfiguration {
    return {
      ...config,
      keyboardNavigationEnabled: true,
      paginationThreshold: 800,
      autoAnalyzeEnabled: false,
      mobileOptimized: Platform.isMobile
    };
  }
  
  // =============================================================================
  // 기존 Public API (완전 호환성 유지)
  // =============================================================================
  
  /**
   * 팝업 표시 (기존 API 유지)
   */
  async show(
    selectedText: string,
    editor: Editor,
    selectionStart: EditorPosition,
    selectionEnd: EditorPosition
  ): Promise<void> {
    try {
      // 초기화 데이터 저장
      this.selectedText = selectedText;
      this.editor = editor;
      this.selectionStart = selectionStart;
      this.selectionEnd = selectionEnd;
      
      if (this.core && this.migrationPhase !== 'legacy') {
        // 새로운 Core 사용
        const initData: PopupInitializationData = {
          selectedText,
          editor,
          selectionStart,
          selectionEnd,
          corrections: this.config.corrections,
          ignoredWords: this.config.ignoredWords
        };
        
        await this.core.initialize(initData);
        await this.core.show();
        
        // Core 상태와 동기화
        this.syncWithCore();
        
      } else {
        // 레거시 모드 사용
        await this.showLegacy(selectedText, editor, selectionStart, selectionEnd);
      }
      
      Logger.log('CorrectionPopupAdapter: 팝업 표시 완료', {
        migrationPhase: this.migrationPhase,
        textLength: selectedText.length
      });
      
    } catch (error) {
      Logger.error('CorrectionPopupAdapter: 팝업 표시 중 오류', error);
      throw error;
    }
  }
  
  /**
   * 팝업 숨김 (기존 API 유지)
   */
  hide(): void {
    try {
      if (this.core && this.migrationPhase !== 'legacy') {
        this.core.hide();
      } else {
        this.hideLegacy();
      }
      
      Logger.log('CorrectionPopupAdapter: 팝업 숨김 완료');
      
    } catch (error) {
      Logger.error('CorrectionPopupAdapter: 팝업 숨김 중 오류', error);
    }
  }
  
  /**
   * 변경사항 적용 (기존 API 유지)
   */
  async applyChanges(): Promise<string> {
    try {
      if (this.core && this.migrationPhase !== 'legacy') {
        return await this.core.applyChanges();
      } else {
        return await this.applyChangesLegacy();
      }
      
    } catch (error) {
      Logger.error('CorrectionPopupAdapter: 변경사항 적용 중 오류', error);
      throw error;
    }
  }
  
  /**
   * AI 분석 실행 (기존 API 유지)
   */
  async performAIAnalysis(): Promise<void> {
    try {
      if (this.core && this.migrationPhase !== 'legacy') {
        await this.core.performAIAnalysis();
        this.syncWithCore();
      } else {
        await this.performAIAnalysisLegacy();
      }
      
      Logger.log('CorrectionPopupAdapter: AI 분석 완료');
      
    } catch (error) {
      Logger.error('CorrectionPopupAdapter: AI 분석 중 오류', error);
      throw error;
    }
  }
  
  // =============================================================================
  // 레거시 모드 구현 (기존 CorrectionPopup 로직)
  // =============================================================================
  
  /**
   * 레거시 모드 팝업 표시
   */
  private async showLegacy(
    selectedText: string,
    editor: Editor,
    selectionStart: EditorPosition,
    selectionEnd: EditorPosition
  ): Promise<void> {
    // 기존 CorrectionPopup의 show 로직을 여기에 구현
    // 이는 Phase 2에서 레이아웃 시스템과 함께 완전히 구현될 예정
    Logger.debug('CorrectionPopupAdapter: 레거시 모드 팝업 표시');
  }
  
  /**
   * 레거시 모드 팝업 숨김
   */
  private hideLegacy(): void {
    // 기존 CorrectionPopup의 hide 로직
    // this.app.scope.unregister(this.keyboardScope); // 임시 비활성화
    Logger.debug('CorrectionPopupAdapter: 레거시 모드 팝업 숨김');
  }
  
  /**
   * 레거시 모드 변경사항 적용
   */
  private async applyChangesLegacy(): Promise<string> {
    // 기존 CorrectionPopup의 applyChanges 로직
    return this.stateManager.getFinalText(this.selectedText);
  }
  
  /**
   * 레거시 모드 AI 분석
   */
  private async performAIAnalysisLegacy(): Promise<void> {
    if (!this.aiService) return;
    
    this.isAiAnalyzing = true;
    
    try {
      const analysisRequest = {
        corrections: this.config.corrections,
        selectedText: this.selectedText,
        originalText: this.selectedText, // selectedText를 originalText로도 사용
        userEditedValues: this.stateManager.getUserEditedValues()
      };
      
      this.aiAnalysisResults = await this.aiService.analyzeCorrections(analysisRequest);
      
    } finally {
      this.isAiAnalyzing = false;
    }
  }
  
  /**
   * 기존 키보드 네비게이션 설정
   */
  private setupKeyboardNavigation(): void {
    // 기존 CorrectionPopup의 setupKeyboardNavigation 로직
    this.keyboardScope.register([], 'Tab', (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.focusNextError();
      return false;
    });
    
    // 추가 키보드 바인딩들...
  }
  
  /**
   * 기존 페이지네이션 초기화
   */
  private initializePagination(): void {
    // 기존 CorrectionPopup의 initializePagination 로직
    const textLength = this.selectedText.length;
    this.isLongText = textLength > this.charsPerPage;
    
    if (this.isLongText) {
      this.totalPreviewPages = Math.ceil(textLength / this.charsPerPage);
      // 페이지 분할 로직...
    }
  }
  
  /**
   * 기존 오류 위치 계산
   */
  private calculateAllErrorPositions(): void {
    // 기존 CorrectionPopup의 calculateAllErrorPositions 로직
    this.allErrorPositions = this.config.corrections.map((correction, index) => ({
      correction,
      originalIndex: index,
      absolutePosition: index, // 임시로 index 사용
      uniqueId: `correction-${index}`
    }));
  }
  
  /**
   * 다음 오류로 포커스 이동
   */
  private focusNextError(): void {
    if (this.core && this.migrationPhase !== 'legacy') {
      // Core의 포커스 이동 사용 (향후 구현)
      return;
    }
    
    // 레거시 포커스 이동 로직
    this.currentFocusIndex = (this.currentFocusIndex + 1) % this.currentCorrections.length;
  }
  
  // =============================================================================
  // 마이그레이션 유틸리티
  // =============================================================================
  
  /**
   * 마이그레이션 단계 변경
   */
  setMigrationPhase(phase: MigrationPhase): void {
    if (this.migrationPhase === phase) return;
    
    Logger.log('CorrectionPopupAdapter: 마이그레이션 단계 변경', {
      from: this.migrationPhase,
      to: phase
    });
    
    this.migrationPhase = phase;
    this.adapterConfig.migrationPhase = phase;
    
    // 새로운 단계로 재초기화
    this.initializeByMigrationPhase();
  }
  
  /**
   * 현재 사용 중인 구현 확인
   */
  getCurrentImplementation(): 'legacy' | 'core' {
    return (this.core && this.migrationPhase !== 'legacy') ? 'core' : 'legacy';
  }
  
  /**
   * Core 인스턴스 접근 (디버깅용)
   */
  getCore(): CorrectionPopupCore | undefined {
    return this.core;
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      migrationPhase: this.migrationPhase,
      currentImplementation: this.getCurrentImplementation(),
      hasCore: !!this.core,
      adapterConfig: this.adapterConfig,
      legacyState: {
        isLongText: this.isLongText,
        currentPreviewPage: this.currentPreviewPage,
        totalPreviewPages: this.totalPreviewPages,
        currentFocusIndex: this.currentFocusIndex,
        correctionCount: this.currentCorrections.length,
        isAiAnalyzing: this.isAiAnalyzing,
        aiResultCount: this.aiAnalysisResults.length
      },
      coreState: this.core?.getDebugInfo() || null
    };
  }
  
  /**
   * 리소스 정리
   */
  dispose(): void {
    try {
      // Core 정리
      if (this.core) {
        this.core.dispose();
        this.core = undefined;
      }
      
      // 키보드 스코프 정리
      if (this.keyboardScope) {
        // this.app.scope.unregister(this.keyboardScope); // 임시 비활성화
      }
      
      // 기존 상태 정리
      this.selectedText = '';
      this.editor = undefined;
      this.selectionStart = undefined;
      this.selectionEnd = undefined;
      this.currentCorrections = [];
      this.allErrorPositions = [];
      this.aiAnalysisResults = [];
      
      Logger.log('CorrectionPopupAdapter: 리소스 정리 완료');
      
    } catch (error) {
      Logger.error('CorrectionPopupAdapter: 리소스 정리 중 오류', error);
    }
  }
}