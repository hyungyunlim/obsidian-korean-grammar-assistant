/**
 * CorrectionPopup 핵심 오케스트레이터
 * 모든 하위 모듈들을 관리하고 조율하는 중앙 제어 클래스
 */

import { Editor, EditorPosition, App, Platform, Scope, Notice } from 'obsidian';
import { 
  PopupCoreConfig, 
  PopupInitializationData, 
  LegacyPopupInterface,
  PopupState,
  RenderContext
} from '../types/PopupTypes';
import { PopupStateManager } from '../state/PopupStateManager';
import { PaginationManager } from '../pagination/PaginationManager';
import { KeyboardManager } from '../keyboard/KeyboardManager';
import { AIIntegrationManager } from '../ai/AIIntegrationManager';
import { PerformanceOptimizer } from '../ai/PerformanceOptimizer';
import { PopupEventManager } from '../events/PopupEventManager';
import { ClickHandler } from '../events/ClickHandler';
import { HoverHandler } from '../events/HoverHandler';
import { MobileEventHandler } from '../events/MobileEventHandler';
import { ErrorRenderer } from '../ui/ErrorRenderer';
import { InteractionHandler } from '../ui/InteractionHandler';
import { ComponentManager } from '../ui/ComponentManager';
import { Correction, PopupConfig, AIAnalysisResult, PageCorrection, AISettings, AIProvider } from '../../types/interfaces';
import { CorrectionStateManager } from '../../state/correctionState';
import { AIAnalysisService } from '../../services/aiAnalysisService';
import { Logger } from '../../utils/logger';

/**
 * CorrectionPopup 핵심 오케스트레이터 클래스
 * 기존 CorrectionPopup 클래스와 완전 호환되면서 모듈화된 아키텍처 제공
 */
export class CorrectionPopupCore implements LegacyPopupInterface {
  // =============================================================================
  // 기존 호환성을 위한 public 속성들
  // =============================================================================
  
  public config: PopupConfig;
  public isAiAnalyzing: boolean = false;
  public aiAnalysisResults: AIAnalysisResult[] = [];
  public keyboardScope: Scope;
  public currentFocusIndex: number = 0;
  public currentCorrections: PageCorrection[] = [];
  
  // =============================================================================
  // 내부 관리 속성들
  // =============================================================================
  
  private app: App;
  private aiService?: AIAnalysisService;
  private onSettingsUpdate?: (newMaxTokens: number) => void;
  
  // 상태 관리자
  private stateManager: PopupStateManager;
  private correctionStateManager: CorrectionStateManager;
  
  // 초기화 데이터
  private initData?: PopupInitializationData;
  
  // DOM 관련
  private containerElement?: HTMLElement;
  private renderContext?: RenderContext;
  
  // 모듈 관리자들
  // private layoutManager?: PopupLayoutManager; // Phase 2에서 구현됨
  private paginationManager?: PaginationManager; // Phase 3에서 구현됨
  private keyboardManager?: KeyboardManager; // Phase 4에서 구현됨
  private aiIntegrationManager?: AIIntegrationManager; // Phase 5에서 구현됨
  private performanceOptimizer?: PerformanceOptimizer; // Phase 5에서 구현됨
  
  // Phase 6: Event System
  private eventManager?: PopupEventManager; // Phase 6에서 구현됨
  private clickHandler?: ClickHandler; // Phase 6에서 구현됨
  private hoverHandler?: HoverHandler; // Phase 6에서 구현됨
  private mobileEventHandler?: MobileEventHandler; // Phase 6에서 구현됨
  
  // Phase 7: UI System
  private errorRenderer?: ErrorRenderer; // Phase 7에서 구현됨
  private interactionHandler?: InteractionHandler; // Phase 7에서 구현됨
  private componentManager?: ComponentManager; // Phase 7에서 구현됨
  
  // 내부 상태
  private isInitialized: boolean = false;
  private isVisible: boolean = false;
  
  constructor(coreConfig: PopupCoreConfig) {
    this.app = coreConfig.app;
    this.config = coreConfig.config;
    this.aiService = coreConfig.aiService;
    this.onSettingsUpdate = coreConfig.onSettingsUpdate;
    
    // 상태 관리자들 초기화
    this.stateManager = new PopupStateManager();
    this.correctionStateManager = new CorrectionStateManager(
      this.config.corrections, 
      this.config.ignoredWords
    );
    
    // 키보드 스코프 초기화 (기존 호환성 유지)
    this.keyboardScope = new Scope();
    
    // 상태 동기화 설정
    this.setupStateSync();
    
    Logger.log('CorrectionPopupCore: 초기화 완료', {
      hasAIService: !!this.aiService,
      correctionCount: this.config.corrections.length
    });
  }
  
  // =============================================================================
  // 초기화 및 설정
  // =============================================================================
  
  /**
   * 팝업 초기화
   */
  async initialize(initData: PopupInitializationData): Promise<void> {
    try {
      this.initData = initData;
      
      // 교정 상태 관리자 업데이트
      this.correctionStateManager = new CorrectionStateManager(
        initData.corrections,
        initData.ignoredWords
      );
      
      // 상태 초기화
      this.stateManager.resetState();
      
      // 페이지네이션 관리자 초기화
      await this.initializePaginationManager(initData.selectedText, initData.corrections);
      
      // 키보드 관리자 초기화
      await this.initializeKeyboardManager();
      
      // Phase 5: AI 통합 및 성능 최적화 관리자 초기화
      await this.initializeAIIntegrationManager();
      await this.initializePerformanceOptimizer();
      
      // Phase 6: Event System 초기화
      await this.initializeEventSystem();
      
      // Phase 7: UI System 초기화
      await this.initializeUISystem();
      
      // 키보드 네비게이션 설정 (임시 구현)
      this.setupKeyboardNavigation();
      
      // 현재 교정 목록 계산
      this.updateCurrentCorrections();
      
      this.isInitialized = true;
      
      Logger.log('CorrectionPopupCore: 초기화 완료', {
        textLength: initData.selectedText.length,
        correctionCount: initData.corrections.length,
        isLongText: this.stateManager.getState().isLongText
      });
      
    } catch (error) {
      Logger.error('CorrectionPopupCore: 초기화 중 오류', error);
      throw error;
    }
  }
  
  /**
   * 상태 동기화 설정
   */
  private setupStateSync(): void {
    // 상태 변경 리스너 등록
    this.stateManager.addStateListener((state, changedFields) => {
      // 기존 호환성 속성들 동기화
      this.isAiAnalyzing = state.isAiAnalyzing;
      this.currentFocusIndex = state.currentFocusIndex;
      this.isVisible = state.isVisible;
      
      // AI 상태 동기화
      const aiState = this.stateManager.getAIState();
      this.aiAnalysisResults = aiState.results;
      
      Logger.debug('CorrectionPopupCore: 상태 동기화', { changedFields });
    });
  }
  
  /**
   * 페이지네이션 관리자 초기화 (Phase 3 구현)
   */
  private async initializePaginationManager(selectedText: string, corrections: Correction[]): Promise<void> {
    // 페이지네이션 관리자 생성
    this.paginationManager = new PaginationManager();
    
    // 렌더 컨텍스트 생성
    const renderContext: RenderContext = {
      container: document.createElement('div'), // 임시 컨테이너
      state: this.stateManager.getState(),
      pagination: {
        pageBreaks: [],
        charsPerPage: 800,
        currentPage: 0,
        totalPages: 1,
        dynamicSizing: true,
        lastSizeUpdate: Date.now()
      },
      layout: {
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
        currentBreakpoint: Platform.isMobile ? 'mobile' : 'desktop',
        customClasses: []
      },
      optimized: true
    };
    
    // 페이지네이션 관리자 초기화
    await this.paginationManager.initialize(renderContext);
    
    // 텍스트와 교정 목록으로 페이지네이션 설정
    this.paginationManager.initializePagination(selectedText, corrections);
    
    // 상태 업데이트
    const paginationState = this.paginationManager.getPaginationState();
    this.stateManager.updateState({
      isLongText: paginationState.totalPages > 1,
      totalPreviewPages: paginationState.totalPages,
      currentPreviewPage: paginationState.currentPage
    });
    
    Logger.log('CorrectionPopupCore: 페이지네이션 관리자 초기화 완료', {
      isLongText: paginationState.totalPages > 1,
      totalPages: paginationState.totalPages
    });
  }
  
  /**
   * 키보드 관리자 초기화
   */
  private async initializeKeyboardManager(): Promise<void> {
    if (!this.initData) {
      throw new Error('초기화 데이터가 없습니다.');
    }

    // 키보드 관리자 생성
    this.keyboardManager = new KeyboardManager(this.app);
    
    const currentState = this.stateManager.getState();
    const paginationState = this.paginationManager?.getPaginationState();
    
    // 렌더 컨텍스트 생성
    const renderContext: RenderContext = {
      container: document.createElement('div'), // 임시 컨테이너
      state: currentState,
      pagination: paginationState || {
        pageBreaks: [],
        charsPerPage: 800,
        currentPage: 0,
        totalPages: 1,
        dynamicSizing: true,
        lastSizeUpdate: Date.now(),
        isLongText: false
      },
      layout: {
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
        currentBreakpoint: Platform.isMobile ? 'mobile' : 'desktop',
        customClasses: []
      },
      focus: {
        currentIndex: 0,
        totalItems: this.initData.corrections.length,
        isEditMode: false
      },
      keyboard: {
        showHints: !Platform.isMobile
      },
      optimized: true
    };
    
    // 키보드 관리자 초기화
    await this.keyboardManager.initialize(renderContext);
    
    // 키보드 이벤트 콜백 설정
    this.setupKeyboardCallbacks();
    
    Logger.log('CorrectionPopupCore: 키보드 관리자 초기화 완료', {
      totalFocusableItems: renderContext.focus?.totalItems || 0,
      showHints: renderContext.keyboard?.showHints || false
    });
  }

  /**
   * Phase 5: AI 통합 관리자 초기화
   */
  private async initializeAIIntegrationManager(): Promise<void> {
    try {
      Logger.log('CorrectionPopupCore: AI 통합 관리자 초기화 시작');

      // AI 설정 가져오기 (config에서 추출)
      const aiSettings: AISettings = {
        enabled: this.config.enableAI || false,
        provider: (this.config.aiProvider as AIProvider) || 'openai',
        openaiApiKey: this.config.openaiApiKey || '',
        anthropicApiKey: this.config.anthropicApiKey || '',
        googleApiKey: this.config.googleApiKey || '',
        ollamaEndpoint: this.config.ollamaEndpoint || 'http://localhost:11434',
        model: '', // 기본값 (AIIntegrationManager에서 provider에 따라 설정)
        maxTokens: this.config.maxTokens || 8000,
        temperature: 0.7, // 기본값
        contextWindow: this.config.contextWindow || 50,
        showTokenWarning: this.config.showTokenWarning ?? true,
        tokenWarningThreshold: this.config.tokenWarningThreshold || 1000
      };

      // AI 통합 관리자 생성
      this.aiIntegrationManager = new AIIntegrationManager(aiSettings, this.app);

      // 렌더 컨텍스트 생성 (기존 컨텍스트 재사용)
      const renderContext = this.createCurrentRenderContext();

      // AI 관리자 초기화
      await this.aiIntegrationManager.initialize(renderContext);

      Logger.log('CorrectionPopupCore: AI 통합 관리자 초기화 완료', {
        aiEnabled: aiSettings.enabled,
        provider: aiSettings.provider,
        isAvailable: this.aiIntegrationManager.isAIAvailable()
      });

    } catch (error) {
      Logger.error('CorrectionPopupCore: AI 통합 관리자 초기화 실패:', error);
      // AI 관리자 초기화 실패는 전체 초기화를 중단하지 않음
      this.aiIntegrationManager = undefined;
    }
  }

  /**
   * Phase 5: 성능 최적화 관리자 초기화
   */
  private async initializePerformanceOptimizer(): Promise<void> {
    try {
      Logger.log('CorrectionPopupCore: 성능 최적화 관리자 초기화 시작');

      // 성능 최적화 관리자 생성
      this.performanceOptimizer = new PerformanceOptimizer(this.app);

      // 렌더 컨텍스트 생성 (기존 컨텍스트 재사용)
      const renderContext = this.createCurrentRenderContext();

      // 성능 최적화 관리자 초기화
      await this.performanceOptimizer.initialize(renderContext);

      Logger.log('CorrectionPopupCore: 성능 최적화 관리자 초기화 완료');

    } catch (error) {
      Logger.error('CorrectionPopupCore: 성능 최적화 관리자 초기화 실패:', error);
      // 성능 최적화 관리자 초기화 실패는 전체 초기화를 중단하지 않음
      this.performanceOptimizer = undefined;
    }
  }

  /**
   * Phase 6: Event System 초기화
   */
  private async initializeEventSystem(): Promise<void> {
    try {
      Logger.log('CorrectionPopupCore: Event System 초기화 시작');

      // 이벤트 핸들러들 생성
      this.clickHandler = new ClickHandler();
      this.hoverHandler = new HoverHandler();
      this.mobileEventHandler = new MobileEventHandler();

      // 메인 이벤트 관리자 생성
      this.eventManager = new PopupEventManager(this.app);

      // 렌더 컨텍스트 생성
      const renderContext = this.createCurrentRenderContext();

      // 이벤트 관리자 초기화
      await this.eventManager.initialize(renderContext);

      // 이벤트 핸들러 콜백 등록
      this.setupEventHandlerCallbacks();

      Logger.log('CorrectionPopupCore: Event System 초기화 완료', {
        hasClickHandler: !!this.clickHandler,
        hasHoverHandler: !!this.hoverHandler,
        hasMobileHandler: !!this.mobileEventHandler,
        hasEventManager: !!this.eventManager
      });

    } catch (error) {
      Logger.error('CorrectionPopupCore: Event System 초기화 실패:', error);
      // Event System 초기화 실패는 전체 초기화를 중단하지 않음
      this.cleanupEventSystem();
    }
  }

  /**
   * Phase 7: UI System 초기화
   */
  private async initializeUISystem(): Promise<void> {
    try {
      Logger.log('CorrectionPopupCore: UI System 초기화 시작');

      // ErrorRenderer 초기화
      this.errorRenderer = new ErrorRenderer(this.app, {
        showTooltips: true,
        enableHover: !Platform.isMobile,
        mobileOptimized: Platform.isMobile,
        animationEnabled: true,
        colorScheme: 'auto'
      });

      // InteractionHandler 초기화 (ErrorRenderer 필요)
      this.interactionHandler = new InteractionHandler(
        this.app,
        this.errorRenderer,
        {
          enableAnimations: true,
          showTooltips: !Platform.isMobile,
          mobileOptimized: Platform.isMobile,
          debounceMs: 150,
          scrollBehavior: 'smooth'
        }
      );

      // ComponentManager 초기화 (ErrorRenderer와 InteractionHandler 필요)
      this.componentManager = new ComponentManager(
        this.app,
        this.errorRenderer,
        this.interactionHandler,
        {
          containerSelector: '.spell-popup-content',
          enableVirtualScrolling: false, // 기본적으로 비활성화
          maxVisibleItems: 50,
          itemHeight: 32,
          bufferSize: 5,
          lazyLoadThreshold: 10
        }
      );

      // 상태 변경 리스너 등록
      this.setupUISystemCallbacks();

      Logger.log('CorrectionPopupCore: UI System 초기화 완료', {
        hasErrorRenderer: !!this.errorRenderer,
        hasInteractionHandler: !!this.interactionHandler,
        hasComponentManager: !!this.componentManager
      });

    } catch (error) {
      Logger.error('CorrectionPopupCore: UI System 초기화 실패:', error);
      // UI System 초기화 실패는 전체 초기화를 중단하지 않음
      this.cleanupUISystem();
    }
  }

  /**
   * UI System 콜백 설정
   */
  private setupUISystemCallbacks(): void {
    if (!this.interactionHandler) return;

    // 상태 변경 리스너 등록
    this.interactionHandler.onStateChange((event) => {
      Logger.debug('CorrectionPopupCore: UI 상태 변경 이벤트', event);
      
      // 필요시 다른 시스템들에 상태 변경 알림
      if (this.stateManager) {
        // 상태 관리자 업데이트 (필요시)
      }
    });

    Logger.debug('CorrectionPopupCore: UI System 콜백 설정 완료');
  }

  /**
   * Phase 6: 이벤트 핸들러 콜백 설정
   */
  private setupEventHandlerCallbacks(): void {
    if (!this.clickHandler || !this.hoverHandler || !this.mobileEventHandler) {
      Logger.warn('CorrectionPopupCore: 이벤트 핸들러가 초기화되지 않음');
      return;
    }

    // 클릭 핸들러 콜백
    this.clickHandler.onAction('error-toggle', async (result, context) => {
      await this.handleErrorToggleAction(result.data);
    });

    this.clickHandler.onAction('suggestion-select', async (result, context) => {
      await this.handleSuggestionSelectAction(result.data);
    });

    this.clickHandler.onAction('edit-mode', async (result, context) => {
      await this.handleEditModeAction(result.data);
    });

    this.clickHandler.onAction('navigation', async (result, context) => {
      await this.handleNavigationAction(result.data);
    });

    this.clickHandler.onAction('toggle-ui', async (result, context) => {
      await this.handleUIToggleAction(result.data);
    });

    // 호버 핸들러 콜백 (데스크톱만)
    if (!Platform.isMobile) {
      this.hoverHandler.onAction('error-preview', async (result, context) => {
        // Phase 7에서 툴팁 UI와 연결 예정
        Logger.debug('CorrectionPopupCore: 오류 미리보기 호버', result);
      });

      this.hoverHandler.onAction('ai-info', async (result, context) => {
        // Phase 7에서 AI 정보 툴팁과 연결 예정
        Logger.debug('CorrectionPopupCore: AI 정보 호버', result);
      });
    }

    // 모바일 핸들러 콜백 (모바일만)
    if (Platform.isMobile) {
      this.mobileEventHandler.onAction('touch-hold', async (result, context) => {
        await this.handleTouchHoldAction(result.data);
      });

      this.mobileEventHandler.onAction('swipe-left', async (result, context) => {
        await this.handleSwipeAction('left', result.data);
      });

      this.mobileEventHandler.onAction('swipe-right', async (result, context) => {
        await this.handleSwipeAction('right', result.data);
      });
    }

    Logger.debug('CorrectionPopupCore: 이벤트 핸들러 콜백 설정 완료');
  }

  /**
   * Phase 7: UI System 정리
   */
  private cleanupUISystem(): void {
    if (this.componentManager) {
      this.componentManager.dispose();
      this.componentManager = undefined;
    }

    if (this.interactionHandler) {
      this.interactionHandler.dispose();
      this.interactionHandler = undefined;
    }

    if (this.errorRenderer) {
      this.errorRenderer.dispose();
      this.errorRenderer = undefined;
    }

    Logger.debug('CorrectionPopupCore: UI System 정리 완료');
  }

  /**
   * Phase 6: Event System 정리
   */
  private cleanupEventSystem(): void {
    if (this.eventManager) {
      this.eventManager.destroy();
      this.eventManager = undefined;
    }

    if (this.clickHandler) {
      this.clickHandler.dispose();
      this.clickHandler = undefined;
    }

    if (this.hoverHandler) {
      this.hoverHandler.dispose();
      this.hoverHandler = undefined;
    }

    if (this.mobileEventHandler) {
      this.mobileEventHandler.dispose();
      this.mobileEventHandler = undefined;
    }

    Logger.debug('CorrectionPopupCore: Event System 정리 완료');
  }

  /**
   * 현재 상태 기반으로 렌더 컨텍스트를 생성합니다.
   */
  private createCurrentRenderContext(): RenderContext {
    const currentState = this.stateManager.getState();
    const paginationState = this.paginationManager?.getPaginationState();

    return {
      container: this.containerElement || document.createElement('div'),
      state: currentState,
      pagination: paginationState || {
        pageBreaks: [],
        charsPerPage: 800,
        currentPage: 0,
        totalPages: 1,
        dynamicSizing: true,
        lastSizeUpdate: Date.now(),
        isLongText: false
      },
      layout: {
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
        currentBreakpoint: Platform.isMobile ? 'mobile' : 'desktop',
        customClasses: []
      },
      focus: {
        currentIndex: 0,
        totalItems: this.initData?.corrections.length || 0,
        isEditMode: false
      },
      keyboard: {
        showHints: !Platform.isMobile
      },
      optimized: true
    };
  }
  
  /**
   * 키보드 이벤트 콜백 설정
   */
  private setupKeyboardCallbacks(): void {
    if (!this.keyboardManager) return;

    // 키보드 액션 콜백
    this.keyboardManager.setKeyboardActionCallback(async (action, event) => {
      try {
        return await this.handleKeyboardAction(action, event);
      } catch (error) {
        Logger.error('CorrectionPopupCore: 키보드 액션 처리 오류', { action, error });
        return false;
      }
    });

    // 포커스 변경 콜백
    this.keyboardManager.setFocusChangeCallback((newFocusIndex) => {
      this.stateManager.updateState({
        currentFocusIndex: newFocusIndex
      });
    });
  }
  
  /**
   * 키보드 액션 처리
   */
  private async handleKeyboardAction(action: string, event: KeyboardEvent): Promise<boolean> {
    Logger.debug('CorrectionPopupCore: 키보드 액션 처리', { action });
    
    switch (action) {
      case 'next-error':
        return this.focusNextError();
      case 'prev-error':
        return this.focusPrevError();
      case 'next-suggestion':
        return this.nextSuggestion();
      case 'prev-suggestion':
        return this.prevSuggestion();
      case 'apply-current':
        return this.applyCurrentCorrection();
      case 'apply-all':
        await this.applyChanges();
        return true;
      case 'close-popup':
        this.hide();
        return true;
      case 'edit-current':
        return await this.editCurrentError();
      case 'ai-analyze':
        await this.performAIAnalysis();
        return true;
      case 'toggle-error-summary':
        return this.toggleErrorSummary();
      case 'bulk-next-suggestion':
        return this.bulkNextSuggestion();
      case 'bulk-prev-suggestion':
        return this.bulkPrevSuggestion();
      case 'next-page':
        return this.nextPage();
      case 'prev-page':
        return this.prevPage();
      default:
        Logger.warn('CorrectionPopupCore: 알 수 없는 키보드 액션', { action });
        return false;
    }
  }
  
  /**
   * 키보드 네비게이션 설정 (KeyboardManager 위임)
   * Phase 4에서 KeyboardManager로 완전히 분리됨
   */
  private setupKeyboardNavigation(): void {
    // KeyboardManager가 모든 키보드 기능을 담당하므로
    // 여기서는 KeyboardManager가 없는 경우에만 기본 설정
    if (!this.keyboardManager) {
      Logger.warn('CorrectionPopupCore: KeyboardManager가 없어 기본 키보드 설정 건너뜀');
      return;
    }
    
    Logger.debug('CorrectionPopupCore: 키보드 네비게이션을 KeyboardManager에 위임');
  }
  
  // =============================================================================
  // 기존 호환성을 위한 Public API
  // =============================================================================
  
  /**
   * 팝업 표시
   */
  async show(): Promise<void> {
    if (!this.isInitialized) {
      Logger.warn('CorrectionPopupCore: 초기화되지 않은 상태에서 show 호출');
      return;
    }
    
    try {
      // 상태 업데이트
      this.stateManager.updateState({ isVisible: true });
      
      // 키보드 네비게이션 활성화
      if (this.keyboardManager) {
        this.keyboardManager.enableKeyboardNavigation();
      }
      
      // UI System 초기화 (컨테이너가 있을 때)
      if (this.componentManager && this.containerElement) {
        await this.componentManager.initialize(this.containerElement);
        
        // 현재 교정들로 컴포넌트 렌더링
        if (this.currentCorrections.length > 0) {
          await this.componentManager.renderErrorComponents(this.currentCorrections);
        }
      }
      
      Logger.log('CorrectionPopupCore: 팝업 표시');
      
    } catch (error) {
      Logger.error('CorrectionPopupCore: 팝업 표시 중 오류', error);
      throw error;
    }
  }
  
  /**
   * 팝업 숨김
   */
  hide(): void {
    try {
      // 상태 업데이트
      this.stateManager.updateState({ isVisible: false });
      
      // 키보드 네비게이션 비활성화
      if (this.keyboardManager) {
        this.keyboardManager.disableKeyboardNavigation();
      }
      
      // 컨테이너 제거 (Phase 2에서 구현 예정)
      if (this.containerElement) {
        this.containerElement.remove();
        this.containerElement = undefined;
      }
      
      Logger.log('CorrectionPopupCore: 팝업 숨김');
      
    } catch (error) {
      Logger.error('CorrectionPopupCore: 팝업 숨김 중 오류', error);
    }
  }
  
  /**
   * 변경사항 적용
   */
  async applyChanges(): Promise<string> {
    if (!this.initData) {
      Logger.warn('CorrectionPopupCore: 초기화 데이터가 없음');
      return '';
    }
    
    try {
      // 교정 상태 관리자에서 최종 텍스트 생성
      const finalText = this.correctionStateManager.getFinalText(this.initData.selectedText);
      
      Logger.log('CorrectionPopupCore: 변경사항 적용 완료', {
        originalLength: this.initData.selectedText.length,
        finalLength: finalText.length
      });
      
      return finalText;
      
    } catch (error) {
      Logger.error('CorrectionPopupCore: 변경사항 적용 중 오류', error);
      throw error;
    }
  }
  
  
  // =============================================================================
  // 내부 헬퍼 메서드들
  // =============================================================================
  
  /**
   * 현재 교정 목록 업데이트 (Phase 3 페이지네이션 시스템 적용)
   */
  private updateCurrentCorrections(): void {
    if (!this.initData) return;
    
    // 페이지네이션 관리자를 통해 현재 페이지 교정 조회
    if (this.paginationManager) {
      this.currentCorrections = this.paginationManager.getCurrentPageCorrections();
      Logger.debug('CorrectionPopupCore: 페이지네이션 관리자를 통한 교정 목록 업데이트', {
        correctionCount: this.currentCorrections.length,
        currentPage: this.stateManager.getState().currentPreviewPage
      });
    } else {
      // 폴백: 페이지네이션 관리자가 없는 경우 모든 교정 표시
      this.currentCorrections = this.initData.corrections.map((correction, index) => ({
        correction,
        pageIndex: 0,
        absoluteIndex: index,
        relativeIndex: index,
        isVisible: true,
        // 하위 호환성을 위한 기존 필드들
        originalIndex: index,
        positionInPage: index,
        absolutePosition: index,
        uniqueId: `${index}_0`
      }));
      
      Logger.debug('CorrectionPopupCore: 폴백 교정 목록 생성', {
        correctionCount: this.currentCorrections.length
      });
    }
    
    // 포커스 상태 업데이트
    this.stateManager.updateFocusState({
      totalCount: this.currentCorrections.length,
      currentIndex: Math.min(this.stateManager.getFocusState().currentIndex, this.currentCorrections.length - 1)
    });
    
    Logger.debug('CorrectionPopupCore: 현재 교정 목록 업데이트', {
      currentPage: this.stateManager.getState().currentPreviewPage,
      correctionCount: this.currentCorrections.length
    });
  }
  
  /**
   * 다음 오류로 포커스 이동
   */
  private focusNextError(): boolean {
    const moved = this.stateManager.moveFocus('next');
    if (moved) {
      this.updateCurrentCorrections();
      Logger.debug('CorrectionPopupCore: 다음 오류로 포커스 이동');
    }
    return moved;
  }
  
  /**
   * 이전 오류로 포커스 이동
   */
  private focusPrevError(): boolean {
    const moved = this.stateManager.moveFocus('prev');
    if (moved) {
      this.updateCurrentCorrections();
      Logger.debug('CorrectionPopupCore: 이전 오류로 포커스 이동');
    }
    return moved;
  }
  
  /**
   * 현재 선택 적용
   */
  private applyCurrentSelection(): void {
    const focusState = this.stateManager.getFocusState();
    const currentCorrection = this.currentCorrections[focusState.currentIndex];
    
    if (currentCorrection) {
      // 교정 상태 관리자에 적용 (임시 구현)
      // Phase 2에서 UI 업데이트와 함께 완전히 구현 예정
      Logger.debug('CorrectionPopupCore: 현재 선택 적용', {
        correctionIndex: focusState.currentIndex,
        original: currentCorrection.correction.original
      });
    }
  }
  
  // =============================================================================
  // 상태 조회 메서드들
  // =============================================================================
  
  /**
   * 현재 상태 조회
   */
  getState(): PopupState {
    return this.stateManager.getState();
  }
  
  /**
   * 초기화 여부 확인
   */
  isReady(): boolean {
    return this.isInitialized;
  }
  
  /**
   * 가시성 확인
   */
  isPopupVisible(): boolean {
    return this.isVisible;
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      isInitialized: this.isInitialized,
      isVisible: this.isVisible,
      hasInitData: !!this.initData,
      hasContainer: !!this.containerElement,
      currentCorrections: this.currentCorrections.length,
      stateManager: this.stateManager.getDebugInfo(),
      correctionStateManager: this.correctionStateManager.getDebugInfo?.() || 'No debug info available'
    };
  }
  
  /**
   * 리소스 정리
   */
  dispose(): void {
    try {
      // 팝업 숨김
      if (this.isVisible) {
        this.hide();
      }
      
      // 상태 리스너 정리
      this.stateManager.removeAllStateListeners();
      
      // 키보드 관리자 정리
      if (this.keyboardManager) {
        this.keyboardManager.dispose();
        this.keyboardManager = undefined;
      }
      
      // Phase 5: AI 통합 관리자 정리
      if (this.aiIntegrationManager) {
        this.aiIntegrationManager.destroy();
        this.aiIntegrationManager = undefined;
      }
      
      // Phase 5: 성능 최적화 관리자 정리
      if (this.performanceOptimizer) {
        this.performanceOptimizer.destroy();
        this.performanceOptimizer = undefined;
      }
      
      // Phase 6: Event System 정리
      this.cleanupEventSystem();
      
      // Phase 7: UI System 정리
      this.cleanupUISystem();
      
      // 키보드 스코프 정리
      if (this.keyboardScope) {
        // this.app.scope.unregister(this.keyboardScope);
      }
      
      // 내부 상태 초기화
      this.isInitialized = false;
      this.initData = undefined;
      this.containerElement = undefined;
      this.renderContext = undefined;
      
      Logger.log('CorrectionPopupCore: 리소스 정리 완료');
      
    } catch (error) {
      Logger.error('CorrectionPopupCore: 리소스 정리 중 오류', error);
    }
  }

  // =============================================================================
  // 키보드 액션 메서드들 (Phase 4에서 추가)
  // =============================================================================

  /**
   * 다음 수정 제안으로 이동
   */
  private nextSuggestion(): boolean {
    // 임시 구현 - Phase 5에서 완전히 구현 예정
    Logger.debug('CorrectionPopupCore: 다음 제안으로 이동 (임시 구현)');
    return false;
  }

  /**
   * 이전 수정 제안으로 이동
   */
  private prevSuggestion(): boolean {
    // 임시 구현 - Phase 5에서 완전히 구현 예정
    Logger.debug('CorrectionPopupCore: 이전 제안으로 이동 (임시 구현)');
    return false;
  }

  /**
   * 현재 교정 적용
   */
  private applyCurrentCorrection(): boolean {
    // 기존 applyCurrentSelection 메서드 활용
    this.applyCurrentSelection();
    return true;
  }

  /**
   * 현재 오류 편집
   */
  private async editCurrentError(): Promise<boolean> {
    // 임시 구현 - Phase 6에서 편집 UI와 함께 구현 예정
    Logger.debug('CorrectionPopupCore: 현재 오류 편집 (임시 구현)');
    return false;
  }

  /**
   * AI 분석 수행
   */
  async performAIAnalysis(): Promise<void> {
    // Phase 5: AIIntegrationManager 사용
    if (!this.aiIntegrationManager || !this.initData) {
      Logger.warn('CorrectionPopupCore: AI 통합 관리자 또는 초기화 데이터 없음');
      return;
    }

    if (!this.aiIntegrationManager.isAIAvailable()) {
      Logger.warn('CorrectionPopupCore: AI 서비스를 사용할 수 없음');
      return;
    }

    try {
      this.stateManager.updateState({ isAiAnalyzing: true });
      
      // Phase 5: AIIntegrationManager를 통한 AI 분석 요청 생성
      const currentStates = this.correctionStateManager.getAllStates();
      const analysisRequest = this.aiIntegrationManager.createAnalysisRequest(
        this.initData.selectedText,
        this.initData.corrections,
        currentStates
      );

      // AI 분석 수행 (토큰 계산 및 경고 포함)
      const results = await this.aiIntegrationManager.performAIAnalysis(analysisRequest);
      
      // 결과 검증
      const { valid, invalid } = this.aiIntegrationManager.validateAnalysisResults(
        results, 
        this.initData.corrections
      );

      if (invalid.length > 0) {
        Logger.warn('CorrectionPopupCore: 일부 AI 분석 결과가 유효하지 않음', { 
          invalidCount: invalid.length 
        });
      }
      
      // 상태 업데이트
      this.stateManager.updateAIState({
        isAnalyzing: false,
        results: valid, // 유효한 결과만 사용
        lastAnalysisTime: Date.now()
      });

      // AI 분석 결과 요약 로그
      const summary = this.aiIntegrationManager.formatAnalysisResults(valid);
      Logger.log('CorrectionPopupCore: AI 분석 완료', { 
        validResults: valid.length,
        invalidResults: invalid.length,
        summary: summary
      });

      // 성능 최적화 적용
      if (this.performanceOptimizer) {
        this.performanceOptimizer.optimizeMemoryUsage();
      }

    } catch (error) {
      Logger.error('CorrectionPopupCore: AI 분석 중 오류', error);
      this.stateManager.updateState({ isAiAnalyzing: false });
      
      // AI 분석 실패 시에도 성능 최적화 수행
      if (this.performanceOptimizer) {
        this.performanceOptimizer.optimizeMemoryUsage();
      }
    }
  }

  /**
   * 오류 요약 토글
   */
  private toggleErrorSummary(): boolean {
    const currentState = this.stateManager.getState();
    this.stateManager.updateState({
      isErrorSummaryExpanded: !currentState.isErrorSummaryExpanded
    });
    Logger.debug('CorrectionPopupCore: 오류 요약 토글', {
      expanded: !currentState.isErrorSummaryExpanded
    });
    return true;
  }

  /**
   * 모든 오류를 다음 제안으로 일괄 변경
   */
  private bulkNextSuggestion(): boolean {
    // 임시 구현 - Phase 5에서 완전히 구현 예정
    Logger.debug('CorrectionPopupCore: 일괄 다음 제안 (임시 구현)');
    return false;
  }

  /**
   * 모든 오류를 이전 제안으로 일괄 변경
   */
  private bulkPrevSuggestion(): boolean {
    // 임시 구현 - Phase 5에서 완전히 구현 예정
    Logger.debug('CorrectionPopupCore: 일괄 이전 제안 (임시 구현)');
    return false;
  }

  /**
   * 다음 페이지로 이동
   */
  private nextPage(): boolean {
    if (!this.paginationManager) {
      return false;
    }
    
    const success = this.paginationManager.nextPage();
    if (success) {
      this.updateCurrentCorrections();
      Logger.debug('CorrectionPopupCore: 다음 페이지로 이동');
    }
    return success;
  }

  /**
   * 이전 페이지로 이동
   */
  private prevPage(): boolean {
    if (!this.paginationManager) {
      return false;
    }
    
    const success = this.paginationManager.previousPage();
    if (success) {
      this.updateCurrentCorrections();
      Logger.debug('CorrectionPopupCore: 이전 페이지로 이동');
    }
    return success;
  }

  // =============================================================================
  // Phase 6: Event Action Handlers
  // =============================================================================

  /**
   * 오류 토글 액션 처리
   */
  private async handleErrorToggleAction(data: any): Promise<void> {
    Logger.debug('CorrectionPopupCore: 오류 토글 액션 처리', data);
    
    if (!data || data.correctionIndex === undefined) {
      Logger.warn('CorrectionPopupCore: 오류 토글 액션에 유효하지 않은 데이터');
      return;
    }

    try {
      // Phase 7에서 상태 관리자와 연결하여 오류 상태 토글 구현 예정
      const correctionIndex = data.correctionIndex;
      
      // 임시 구현: 현재 포커스를 해당 오류로 이동
      this.stateManager.updateState({
        currentFocusIndex: correctionIndex
      });

      Logger.log('CorrectionPopupCore: 오류 토글 완료', { correctionIndex });

    } catch (error) {
      Logger.error('CorrectionPopupCore: 오류 토글 중 오류', error);
    }
  }

  /**
   * 제안 선택 액션 처리
   */
  private async handleSuggestionSelectAction(data: any): Promise<void> {
    Logger.debug('CorrectionPopupCore: 제안 선택 액션 처리', data);
    
    if (!data || data.correctionIndex === undefined || data.suggestionIndex === undefined) {
      Logger.warn('CorrectionPopupCore: 제안 선택 액션에 유효하지 않은 데이터');
      return;
    }

    try {
      // Phase 7에서 상태 관리자와 연결하여 제안 적용 구현 예정
      const { correctionIndex, suggestionIndex } = data;
      
      Logger.log('CorrectionPopupCore: 제안 선택 완료', { correctionIndex, suggestionIndex });

    } catch (error) {
      Logger.error('CorrectionPopupCore: 제안 선택 중 오류', error);
    }
  }

  /**
   * 편집 모드 액션 처리
   */
  private async handleEditModeAction(data: any): Promise<void> {
    Logger.debug('CorrectionPopupCore: 편집 모드 액션 처리', data);
    
    if (!data || data.correctionIndex === undefined) {
      Logger.warn('CorrectionPopupCore: 편집 모드 액션에 유효하지 않은 데이터');
      return;
    }

    try {
      // Phase 7에서 UI 관리자와 연결하여 편집 모드 구현 예정
      const { correctionIndex, trigger } = data;
      
      Logger.log('CorrectionPopupCore: 편집 모드 진입', { correctionIndex, trigger });

    } catch (error) {
      Logger.error('CorrectionPopupCore: 편집 모드 중 오류', error);
    }
  }

  /**
   * 네비게이션 액션 처리
   */
  private async handleNavigationAction(data: any): Promise<void> {
    Logger.debug('CorrectionPopupCore: 네비게이션 액션 처리', data);
    
    if (!data || !data.action) {
      Logger.warn('CorrectionPopupCore: 네비게이션 액션에 유효하지 않은 데이터');
      return;
    }

    try {
      const { action, page } = data;
      
      switch (action) {
        case 'next':
          this.nextPage();
          break;
        case 'prev':
          this.prevPage();
          break;
        case 'goto-page':
          if (page !== undefined) {
            // Phase 7에서 페이지네이션 관리자 연결 예정
            Logger.log('CorrectionPopupCore: 페이지 이동', { page });
          }
          break;
        default:
          Logger.warn('CorrectionPopupCore: 알 수 없는 네비게이션 액션', { action });
      }

    } catch (error) {
      Logger.error('CorrectionPopupCore: 네비게이션 액션 중 오류', error);
    }
  }

  /**
   * UI 토글 액션 처리
   */
  private async handleUIToggleAction(data: any): Promise<void> {
    Logger.debug('CorrectionPopupCore: UI 토글 액션 처리', data);
    
    if (!data || !data.target) {
      Logger.warn('CorrectionPopupCore: UI 토글 액션에 유효하지 않은 데이터');
      return;
    }

    try {
      const { target } = data;
      
      switch (target) {
        case 'error-summary':
          this.toggleErrorSummary();
          break;
        default:
          Logger.warn('CorrectionPopupCore: 알 수 없는 UI 토글 대상', { target });
      }

    } catch (error) {
      Logger.error('CorrectionPopupCore: UI 토글 액션 중 오류', error);
    }
  }

  /**
   * 터치홀드 액션 처리 (모바일)
   */
  private async handleTouchHoldAction(data: any): Promise<void> {
    Logger.debug('CorrectionPopupCore: 터치홀드 액션 처리', data);
    
    if (!data || data.correctionIndex === undefined) {
      Logger.warn('CorrectionPopupCore: 터치홀드 액션에 유효하지 않은 데이터');
      return;
    }

    try {
      // 터치홀드는 편집 모드로 전환
      await this.handleEditModeAction({
        correctionIndex: data.correctionIndex,
        trigger: 'touch-hold'
      });

    } catch (error) {
      Logger.error('CorrectionPopupCore: 터치홀드 액션 중 오류', error);
    }
  }

  /**
   * 스와이프 액션 처리 (모바일)
   */
  private async handleSwipeAction(direction: 'left' | 'right', data: any): Promise<void> {
    Logger.debug('CorrectionPopupCore: 스와이프 액션 처리', { direction, data });

    try {
      switch (direction) {
        case 'left':
          // 왼쪽 스와이프: 다음 페이지
          this.nextPage();
          break;
        case 'right':
          // 오른쪽 스와이프: 이전 페이지
          this.prevPage();
          break;
        default:
          Logger.warn('CorrectionPopupCore: 지원되지 않는 스와이프 방향', { direction });
      }

    } catch (error) {
      Logger.error('CorrectionPopupCore: 스와이프 액션 중 오류', error);
    }
  }
}