import { Editor, EditorPosition, App, Platform, Scope, Notice, MarkdownView, Setting } from 'obsidian';
import { Correction, PopupConfig, AIAnalysisResult, AIAnalysisRequest, PageCorrection } from '../types/interfaces';
import { BaseComponent } from './baseComponent';
import { CorrectionStateManager } from '../state/correctionState';
import { escapeHtml } from '../utils/htmlUtils';
import { calculateDynamicCharsPerPage, splitTextIntoPages, escapeRegExp } from '../utils/textUtils';
import { AIAnalysisService } from '../services/aiAnalysisService';
import { Logger } from '../utils/logger';
import { clearElement } from '../utils/domUtils';

const HIDDEN_CLASS = 'kga-hidden';
const FORCE_HIDDEN_CLASS = 'kga-force-hidden';
const ERROR_SUMMARY_EXPANDED_CLASS = 'kga-error-summary-expanded';
const NO_OUTLINE_CLASS = 'kga-no-outline';
const FADE_OUT_CLASS = 'kga-fade-out';

/**
 * 맞춤법 교정 팝업 관리 클래스
 */
export class CorrectionPopup extends BaseComponent {
  private config: PopupConfig;
  private app: App;
  private stateManager: CorrectionStateManager;
  private aiService?: AIAnalysisService;
  private onSettingsUpdate?: (newMaxTokens: number) => void;
  
  // Pagination state
  private isLongText: boolean = false;
  private currentPreviewPage: number = 0;
  private totalPreviewPages: number = 1;
  private pageBreaks: number[] = [];
  private charsPerPage: number = 800;
  
  // AI 분석 결과
  private aiAnalysisResults: AIAnalysisResult[] = [];
  private isAiAnalyzing: boolean = false;

  // 키보드 네비게이션
  private keyboardScope: Scope;
  private currentFocusIndex: number = 0;
  private currentCorrections: PageCorrection[] = [];
  
  // 전체 오류 위치 캐시
  private allErrorPositions: Array<{
    correction: Correction;
    originalIndex: number;
    absolutePosition: number;
    uniqueId: string;
  }> = [];

  constructor(app: App, config: PopupConfig, aiService?: AIAnalysisService, onSettingsUpdate?: (newMaxTokens: number) => void) {
    super('div', 'correction-popup-container');
    this.app = app;
    this.config = config;
    this.stateManager = new CorrectionStateManager(config.corrections, this.config.ignoredWords);
    this.aiService = aiService;
    this.onSettingsUpdate = onSettingsUpdate;
    
    // 키보드 네비게이션 스코프 초기화
    this.keyboardScope = new Scope();
    this.setupKeyboardNavigation();
    
    this.initializePagination();
    this.calculateAllErrorPositions();
  }

  /**
   * 키보드 네비게이션을 설정합니다.
   */
  private setupKeyboardNavigation(): void {
    // Tab: 다음 오류 항목으로 이동
    this.keyboardScope.register([], 'Tab', (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.focusNextError();
      return false;
    });

    // Shift+Tab: 이전 오류 항목으로 이동
    this.keyboardScope.register(['Shift'], 'Tab', (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.focusPrevError();
      return false;
    });

    // Enter: 현재 선택된 수정사항 적용 (편집 중이 아닐 때만)
    this.keyboardScope.register([], 'Enter', (evt: KeyboardEvent) => {
      const target = evt.target as HTMLElement;
      if (target && (target.dataset?.editMode === 'true' || target.classList.contains('kga-error-original-input'))) {
        // 편집 중인 input 요소에서는 기본 동작 허용
        Logger.debug('Enter key in edit mode - allowing default behavior');
        return true;
      }
      evt.preventDefault();
      this.applyCurrentSelection();
      return false;
    });

    // Escape: 팝업 닫기 (편집 중이 아닐 때만)
    this.keyboardScope.register([], 'Escape', (evt: KeyboardEvent) => {
      const target = evt.target as HTMLElement;
      if (target && (target.dataset?.editMode === 'true' || target.classList.contains('kga-error-original-input'))) {
        // 편집 중인 input 요소에서는 기본 동작 허용
        Logger.debug('Escape key in edit mode - allowing default behavior');
        return true;
      }
      evt.preventDefault();
      this.close();
      return false;
    });

    // ArrowRight: 다음 수정 제안으로 순환
    this.keyboardScope.register([], 'ArrowRight', (evt: KeyboardEvent) => {
      if (this.isInEditMode()) {
        Logger.debug('🚫 편집 모드 중 - ArrowRight 비활성화');
        return;
      }
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      
      this.cycleCurrentCorrectionNext();
      
      // 포커스 유지를 위해 하이라이트 강제 업데이트
      activeWindow.setTimeout(() => {
        this.updateFocusHighlight();
      }, 50);
      
      return false;
    });

    // ArrowLeft: 이전 수정 제안으로 순환
    this.keyboardScope.register([], 'ArrowLeft', (evt: KeyboardEvent) => {
      if (this.isInEditMode()) {
        Logger.debug('🚫 편집 모드 중 - ArrowLeft 비활성화');
        return;
      }
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      
      this.cycleCurrentCorrectionPrev();
      
      // 포커스 유지를 위해 하이라이트 강제 업데이트
      activeWindow.setTimeout(() => {
        this.updateFocusHighlight();
      }, 50);
      
      return false;
    });

    // Shift+Cmd+A: AI 분석 트리거
    this.keyboardScope.register(['Shift', 'Mod'], 'KeyA', (evt: KeyboardEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      this.triggerAIAnalysis();
      return false;
    });

    // Note: Cmd+E와 Cmd+Shift+E는 bindEvents()에서 글로벌 스코프로 등록됨

    // ArrowUp: 이전 페이지
    this.keyboardScope.register([], 'ArrowUp', (evt: KeyboardEvent) => {
      if (this.isLongText && this.currentPreviewPage > 0) {
        evt.preventDefault();
        this.goToPrevPage();
        return false;
      }
      return true;
    });

    // ArrowDown: 다음 페이지
    this.keyboardScope.register([], 'ArrowDown', (evt: KeyboardEvent) => {
      if (this.isInEditMode()) {
        return; // 편집 모드에서는 일반 텍스트 네비게이션 허용
      }
      if (this.isLongText && this.currentPreviewPage < this.totalPreviewPages - 1) {
        evt.preventDefault();
        this.goToNextPage();
        return false;
      }
      return true;
    });

    // Cmd/Ctrl+Shift+ArrowRight: 모든 오류를 다음 제안으로 일괄 변경
    this.keyboardScope.register(['Mod', 'Shift'], 'ArrowRight', (evt: KeyboardEvent) => {
      if (this.isInEditMode()) {
        Logger.debug('🚫 편집 모드 중 - 일괄 변경 비활성화');
        return;
      }
      evt.preventDefault();
      this.batchCycleCorrections('next');
      return false;
    });

    // Cmd/Ctrl+Shift+ArrowLeft: 모든 오류를 이전 제안으로 일괄 변경
    this.keyboardScope.register(['Mod', 'Shift'], 'ArrowLeft', (evt: KeyboardEvent) => {
      if (this.isInEditMode()) {
        Logger.debug('🚫 편집 모드 중 - 일괄 변경 비활성화');
        return;
      }
      evt.preventDefault();
      this.batchCycleCorrections('prev');
      return false;
    });

    // Cmd/Ctrl+Enter: 모든 변경사항을 에디터에 적용
    this.keyboardScope.register(['Mod'], 'Enter', (evt: KeyboardEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      this.applyCorrections();
      return false;
    });

    Logger.log('키보드 네비게이션 설정 완료');
  }

  /**
   * 다음 오류 항목으로 포커스를 이동합니다.
   */
  private focusNextError(): void {
    Logger.debug('========= focusNextError 시작 =========');
    Logger.debug(`현재 포커스 인덱스: ${this.currentFocusIndex}`);
    
    const rawCorrections = this.getCurrentCorrections();
    Logger.debug(`RAW 수정사항 개수: ${rawCorrections.length}`);
    Logger.debug('RAW 수정사항 목록:', rawCorrections.map(pc => ({ 
      original: pc.correction.original, 
      originalIndex: pc.originalIndex,
      uniqueId: pc.uniqueId,
      absolutePosition: pc.absolutePosition
    })));
    
    this.currentCorrections = this.removeDuplicateCorrections(rawCorrections);
    Logger.debug(`중복 제거 전후: ${rawCorrections.length} → ${this.currentCorrections.length}`);
    Logger.debug('중복 제거 후 목록:', this.currentCorrections.map(pc => ({ 
      original: pc.correction.original, 
      originalIndex: pc.originalIndex,
      uniqueId: pc.uniqueId,
      absolutePosition: pc.absolutePosition
    })));
    
    if (this.currentCorrections.length === 0) {
      Logger.debug('수정사항이 없어 함수 종료');
      return;
    }

    const oldFocusIndex = this.currentFocusIndex;
    // 초기에 포커스가 없으면 첫 번째로 설정
    if (this.currentFocusIndex === -1) {
      this.currentFocusIndex = 0;
    } else {
      this.currentFocusIndex = (this.currentFocusIndex + 1) % this.currentCorrections.length;
    }
    
    Logger.debug(`포커스 인덱스 변경: ${oldFocusIndex} → ${this.currentFocusIndex}`);
    Logger.debug(`포커스 대상: ${this.currentCorrections[this.currentFocusIndex]?.correction.original} (고유ID: ${this.currentCorrections[this.currentFocusIndex]?.uniqueId})`);
    
    this.updateFocusHighlight();
    
    // 상세보기가 이미 펼쳐져 있을 때만 스크롤
    const errorSummary = activeDocument.getElementById('errorSummary');
    const isExpanded = errorSummary && !errorSummary.classList.contains('collapsed');
    
    if (isExpanded) {
      this.scrollToFocusedError(false); // 펼쳐진 상태에서는 상태 유지하며 스크롤
    }
    
    Logger.debug(`포커스 이동 완료: ${this.currentFocusIndex}/${this.currentCorrections.length}, 상세보기 펼쳐짐: ${isExpanded}`);
    Logger.debug('========= focusNextError 종료 =========');
  }

  /**
   * 이전 오류 항목으로 포커스를 이동합니다.
   */
  private focusPrevError(): void {
    const rawCorrections = this.getCurrentCorrections();
    this.currentCorrections = this.removeDuplicateCorrections(rawCorrections);
    if (this.currentCorrections.length === 0) return;

    // 초기에 포커스가 없으면 마지막으로 설정
    if (this.currentFocusIndex === -1) {
      this.currentFocusIndex = this.currentCorrections.length - 1;
    } else {
      this.currentFocusIndex = this.currentFocusIndex === 0 
        ? this.currentCorrections.length - 1 
        : this.currentFocusIndex - 1;
    }
    this.updateFocusHighlight();
    
    // 상세보기가 이미 펼쳐져 있을 때만 스크롤
    const errorSummary = activeDocument.getElementById('errorSummary');
    const isExpanded = errorSummary && !errorSummary.classList.contains('collapsed');
    
    if (isExpanded) {
      this.scrollToFocusedError(false); // 펼쳐진 상태에서는 상태 유지하며 스크롤
    }
    
    Logger.debug(`포커스 이동: ${this.currentFocusIndex}/${this.currentCorrections.length}, 상세보기 펼쳐짐: ${isExpanded}`);
  }

  /**
   * 현재 포커스된 항목의 수정사항을 적용합니다.
   */
  private applyCurrentSelection(): void {
    if (this.currentCorrections.length === 0) {
      // 오류가 없으면 팝업을 닫습니다
      this.close();
      return;
    }

    const pageCorrection = this.currentCorrections[this.currentFocusIndex || 0];
    if (!pageCorrection) return;

    const actualIndex = pageCorrection.originalIndex;
    if (actualIndex === undefined) {
        Logger.warn('pageCorrection.originalIndex is undefined');
        return;
    }
    const currentState = this.stateManager.getValue(actualIndex);
    if (currentState === undefined) {
        Logger.warn(`stateManager.getValue(${actualIndex}) returned undefined`);
        return;
    }
    // 현재 선택된 수정사항을 적용 처리
    Logger.debug(`키보드로 수정사항 적용: ${currentState}`);
  }

  /**
   * 현재 포커스된 오류의 다음 수정 제안으로 순환합니다.
   */
  private cycleCurrentCorrectionNext(): void {
    if (this.currentCorrections.length === 0) return;

    const pageCorrection = this.currentCorrections[this.currentFocusIndex || 0];
    if (!pageCorrection) return;

    const actualIndex = pageCorrection.originalIndex;
    if (actualIndex === undefined) {
        Logger.warn('pageCorrection.originalIndex is undefined');
        return;
    }
    this.cycleCorrectionState(actualIndex, 'next');
  }

  /**
   * 현재 포커스된 오류의 이전 수정 제안으로 순환합니다.
   */
  private cycleCurrentCorrectionPrev(): void {
    if (this.currentCorrections.length === 0) return;

    const pageCorrection = this.currentCorrections[this.currentFocusIndex || 0];
    if (!pageCorrection) return;

    const actualIndex = pageCorrection.originalIndex;
    if (actualIndex === undefined) {
        Logger.warn('pageCorrection.originalIndex is undefined');
        return;
    }
    this.cycleCorrectionState(actualIndex, 'prev');
  }

  /**
   * 수정 제안 상태를 순환시킵니다.
   */
  private cycleCorrectionState(correctionIndex: number, direction: 'next' | 'prev'): void {
    const correction = this.config.corrections[correctionIndex];
    if (!correction) return;

    // StateManager의 toggleState 또는 toggleStatePrev 메서드 사용
    const result = direction === 'next' 
      ? this.stateManager.toggleState(correctionIndex)
      : this.stateManager.toggleStatePrev(correctionIndex);
    
    Logger.log(`수정 제안 순환: ${direction}, index: ${correctionIndex}, 새로운 값: ${result.value}`);
    
    // UI 업데이트
    this.updateDisplay();
  }

  /**
   * AI 분석을 트리거합니다.
   */
  private triggerAIAnalysis(): void {
    Logger.log('AI 분석 트리거됨 (키보드 단축키)');
    const aiBtn = this.element.querySelector('#aiAnalyzeBtn') as HTMLButtonElement;
    if (aiBtn && !aiBtn.disabled) {
      Logger.log('AI 분석 버튼 클릭 실행');
      aiBtn.click();
    } else {
      Logger.warn('AI 분석 버튼이 비활성화되어 있거나 찾을 수 없습니다.');
      // 직접 AI 분석 실행 시도
      if (this.aiService && !this.isAiAnalyzing) {
        this.performAIAnalysis();
      }
    }
  }

  /**
   * 이전 페이지로 이동합니다.
   */
  private goToPrevPage(): void {
    if (this.currentPreviewPage > 0) {
      this.currentPreviewPage--;
      this.updateDisplay();
      this.resetFocusToFirstError();
    }
  }

  /**
   * 다음 페이지로 이동합니다.
   */
  private goToNextPage(): void {
    if (this.currentPreviewPage < this.totalPreviewPages - 1) {
      this.currentPreviewPage++;
      this.updateDisplay();
      this.resetFocusToFirstError();
    }
  }

  /**
   * 포커스를 첫 번째 오류로 리셋합니다.
   */
  private resetFocusToFirstError(): void {
    Logger.debug('========= resetFocusToFirstError 시작 =========');
    
    const rawCorrections = this.getCurrentCorrections();
    Logger.debug(`RAW 오류 개수: ${rawCorrections.length}`);
    
    this.currentCorrections = this.removeDuplicateCorrections(rawCorrections);
    Logger.debug(`중복 제거 후 오류 개수: ${this.currentCorrections.length}`);
    
    if (this.currentCorrections.length > 0) {
      this.currentFocusIndex = 0;
      Logger.debug(`포커스 인덱스를 0으로 설정`);
      
      // 약간의 지연을 두고 포커스 설정 (DOM이 완전히 렌더링된 후)
      activeWindow.setTimeout(() => {
        Logger.debug('지연 후 포커스 하이라이트 업데이트 실행');
        this.updateFocusHighlight();
      }, 100);
      
      // 디버깅을 위한 상세 로깅
      const firstPageCorrection = this.currentCorrections[0];
      const actualIndex = firstPageCorrection.originalIndex;
      
      Logger.debug(`초기 포커스 설정: ${this.currentFocusIndex}/${this.currentCorrections.length}`);
      Logger.debug(`첫 번째 오류: "${firstPageCorrection.correction.original}" (전체 배열 인덱스: ${actualIndex}, 고유ID: ${firstPageCorrection.uniqueId})`);
      Logger.debug('현재 페이지 오류 목록:', this.currentCorrections.map(pc => ({ 
        original: pc.correction.original, 
        originalIndex: pc.originalIndex,
        uniqueId: pc.uniqueId
      })));
    } else {
      this.currentFocusIndex = -1;
      Logger.debug('오류가 없어 포커스 설정하지 않음');
    }
    
    Logger.debug('========= resetFocusToFirstError 종료 =========');
  }

  /**
   * 현재 포커스된 항목을 시각적으로 표시합니다.
   */
  private updateFocusHighlight(): void {
    Logger.debug('========= updateFocusHighlight 시작 =========');
    Logger.debug(`currentCorrections 길이: ${this.currentCorrections.length}`);
    Logger.debug(`currentFocusIndex: ${this.currentFocusIndex}`);
    
    // 기존 포커스 하이라이트 제거
    const prevFocused = this.element.querySelectorAll('.kga-keyboard-focused');
    Logger.debug(`기존 포커스 요소 ${prevFocused.length}개 제거`);
    prevFocused.forEach(el => el.removeClass('kga-keyboard-focused'));

    // 현재 포커스 항목 하이라이트
    if (this.currentCorrections.length > 0 && 
        this.currentFocusIndex >= 0 && 
        this.currentFocusIndex < this.currentCorrections.length) {
      
      const pageCorrection = this.currentCorrections[this.currentFocusIndex];
      const actualIndex = pageCorrection.originalIndex;
      const uniqueId = pageCorrection.uniqueId;

      Logger.debug(`포커스 대상 정보:`, {
        original: pageCorrection.correction.original,
        actualIndex: actualIndex,
        uniqueId: uniqueId,
        absolutePosition: pageCorrection.absolutePosition
      });

      // 먼저 고유 ID로 찾기 시도
      let errorItem = this.element.querySelector(`[data-unique-id="${uniqueId}"]`);
      Logger.debug(`고유 ID로 검색: [data-unique-id="${uniqueId}"] → ${errorItem ? '발견' : '미발견'}`);
      
      // 고유 ID로 찾지 못하면 기존 방식으로 폴백
      if (!errorItem) {
        errorItem = this.element.querySelector(`[data-correction-index="${actualIndex}"]`);
        Logger.debug(`인덱스로 검색: [data-correction-index="${actualIndex}"] → ${errorItem ? '발견' : '미발견'}`);
      }
      
      if (errorItem) {
        errorItem.addClass('kga-keyboard-focused');
        // 스크롤하여 보이게 하기
        errorItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        Logger.debug(`포커스 하이라이트 적용 성공: 고유 ID ${uniqueId}, 원본 인덱스 ${actualIndex}, 절대 위치 ${pageCorrection.absolutePosition}`);
        
        // DOM 요소 정보 추가 로깅
        Logger.debug(`포커스된 요소 정보:`, {
          tagName: errorItem.tagName,
          className: errorItem.className,
          textContent: errorItem.textContent?.substring(0, 50) + '...',
          dataset: (errorItem as HTMLElement).dataset
        });
      } else {
        Logger.warn(`포커스 대상 요소를 찾을 수 없음: 고유 ID ${uniqueId}, 인덱스 ${actualIndex}`);
        
        // DOM 트리에서 관련 요소들 찾기 시도
        const allUniqueIdElements = this.element.querySelectorAll('[data-unique-id]');
        const allCorrectionIndexElements = this.element.querySelectorAll('[data-correction-index]');
        
        Logger.debug(`DOM 내 data-unique-id 속성 요소 ${allUniqueIdElements.length}개:`, 
          Array.from(allUniqueIdElements).map(el => (el as HTMLElement).dataset.uniqueId));
        Logger.debug(`DOM 내 data-correction-index 속성 요소 ${allCorrectionIndexElements.length}개:`, 
          Array.from(allCorrectionIndexElements).map(el => (el as HTMLElement).dataset.correctionIndex));
      }
    } else {
      Logger.debug('포커스할 오류가 없거나 인덱스가 범위를 벗어남');
      Logger.debug(`세부 정보: length=${this.currentCorrections.length}, index=${this.currentFocusIndex}, 인덱스 범위 내? ${this.currentFocusIndex >= 0 && this.currentFocusIndex < this.currentCorrections.length}`);
    }
    
    Logger.debug('========= updateFocusHighlight 종료 =========');
  }

  /**
   * 페이지네이션을 초기화합니다.
   */
  private initializePagination(): void {
    const trimmedText = this.config.selectedText.trim();
    const textLength = trimmedText.length;
    this.isLongText = textLength > 1000;
    
    // 초기값 설정. 실제 계산은 recalculatePagination에서 이루어짐.
    this.charsPerPage = 800; 
    this.pageBreaks = [textLength]; // 임시
    this.totalPreviewPages = 1;
    this.currentPreviewPage = 0;
    Logger.log(`Initial pagination setup: Long text: ${this.isLongText}, Trimmed length: ${textLength}`);
  }

  /**
   * 팝업을 렌더링합니다.
   */
  render(): HTMLElement {
    this.element.id = 'correctionPopup';
    this.element.setAttribute('tabindex', '-1');
    this.createPopupStructure();
    
    // 이벤트 바인딩
    this.bindEvents();
    
    // 키보드 네비게이션 활성화
    this.app.keymap.pushScope(this.keyboardScope);
    
    // 포커스 설정 (DOM 추가는 show() 메서드에서 처리됨)
    activeWindow.setTimeout(() => {
      // 팝업에 포커스 설정하여 키보드 이벤트가 올바르게 전달되도록 함
      this.element.focus();
    }, 50);
    
    // 초기 포커스 설정
    this.resetFocusToFirstError();
    
    // 키보드 네비게이션 힌트 표시
    this.showKeyboardHint();
    
    // Body 스크롤 잠금
    activeDocument.body.classList.add('spell-popup-open');
    
    return this.element;
  }

  /**
   * 팝업 DOM 구조를 생성합니다.
   */
  private createPopupStructure(): void {
    // Clear existing content
    this.element.empty();
    
    // Popup overlay
    const overlay = this.element.createDiv('kga-popup-overlay');
    
    // Popup content
    const content = this.element.createDiv('kga-popup-content');
    
    // Header
    const header = content.createDiv('kga-header');
    new Setting(header).setName('한국어 맞춤법 검사').setHeading();
    
    const headerTop = header.createDiv('kga-preview-header-top');
    
    // AI 분석 버튼 (항상 표시, 상태에 따라 활성화/비활성화)
    const aiBtn = headerTop.createEl('button', {
      cls: 'kga-ai-analyze-btn',
      attr: { id: 'aiAnalyzeBtn' }
    });
    
    // AI 서비스 상태에 따른 버튼 설정
    this.updateAiButtonState(aiBtn);
    headerTop.createEl('button', { cls: 'kga-close-btn-header', text: '×' });
    
    // Main content
    const mainContent = content.createDiv('kga-content');
    
    // Preview section
    const previewSection = mainContent.createDiv('kga-preview-section');
    const previewHeader = previewSection.createDiv('kga-preview-header');
    
    const previewLabel = previewHeader.createDiv('kga-preview-label');
    previewLabel.createSpan({ text: '미리보기' });
    previewLabel.createSpan({ cls: 'kga-preview-hint', text: '클릭하여 수정사항 적용' });
    
    // Color legend
    const colorLegend = previewHeader.createDiv('kga-color-legend');
    const legendItems = [
      { cls: 'error', text: '오류' },
      { cls: 'corrected', text: '수정' },
      { cls: 'exception-processed', text: '예외처리' },
      { cls: 'original-kept', text: '원본유지' },
      { cls: 'user-edited', text: '편집됨' }
    ];
    
    legendItems.forEach(item => {
      const legendItem = colorLegend.createDiv('kga-color-legend-item');
      legendItem.createDiv(`kga-color-legend-dot ${item.cls}`);
      legendItem.createSpan({ text: item.text });
    });
    
    // Pagination
    const paginationDiv = previewHeader.createDiv();
    this.createPaginationElement(paginationDiv);
    
    // Preview content
    const previewContent = previewSection.createDiv('kga-preview-text');
    previewContent.id = 'resultPreview';
    previewContent.createSpan({ text: this.config.selectedText.trim() });
    
    // Error summary
    const errorSummary = mainContent.createDiv('kga-error-summary collapsed');
    errorSummary.id = 'errorSummary';
    
    const errorToggle = errorSummary.createDiv('kga-error-summary-toggle');
    const leftSection = errorToggle.createDiv('kga-left-section');
    leftSection.createSpan({ cls: 'kga-error-summary-label', text: '오류 상세' });
    const badge = leftSection.createSpan({ 
      cls: 'kga-error-count-badge', 
      text: this.getErrorStateCount().toString(),
      attr: { id: 'errorCountBadge' }
    });
    
    errorToggle.createSpan({ cls: 'kga-toggle-icon', text: '▼' });
    
    const errorContent = errorSummary.createDiv('kga-error-summary-content');
    errorContent.id = 'errorSummaryContent';
    // Error summary content
    this.createErrorSummaryElement(errorContent);
    
    // Button area
    const buttonArea = content.createDiv('kga-button-area');
    buttonArea.createEl('button', { cls: 'kga-cancel-btn', text: '취소' });
    buttonArea.createEl('button', {
      cls: 'kga-apply-btn',
      text: '적용',
      attr: { id: 'applyCorrectionsButton' }
    });
  }

  /**
   * 페이지네이션 요소를 생성합니다.
   */
  private createPaginationElement(container: HTMLElement): void {
    // Clear existing content
    container.empty();
    
    if (!this.isLongText || this.totalPreviewPages <= 1) {
      const hiddenContainer = container.createDiv('kga-pagination-container-hidden');
      hiddenContainer.id = 'paginationContainer';
      return;
    }

    const paginationControls = container.createDiv('kga-pagination-controls');
    paginationControls.id = 'paginationContainer';
    
    // Previous button
    const prevBtn = paginationControls.createEl('button', { 
      cls: 'kga-pagination-btn',
      text: '이전'
    });
    prevBtn.id = 'prevPreviewPage';
    if (this.currentPreviewPage === 0) {
      prevBtn.disabled = true;
    }
    
    // Page info
    const pageInfo = paginationControls.createSpan('kga-page-info');
    pageInfo.id = 'previewPageInfo';
    pageInfo.textContent = `${this.currentPreviewPage + 1} / ${this.totalPreviewPages}`;
    
    // Next button
    const nextBtn = paginationControls.createEl('button', { 
      cls: 'kga-pagination-btn',
      text: '다음'
    });
    nextBtn.id = 'nextPreviewPage';
    if (this.currentPreviewPage === this.totalPreviewPages - 1) {
      nextBtn.disabled = true;
    }
    
    // Page chars info
    const pageCharsInfo = paginationControls.createSpan('kga-page-chars-info');
    pageCharsInfo.id = 'pageCharsInfo';
    pageCharsInfo.textContent = `${this.charsPerPage}자`;
  }

  /**
   * 페이지네이션 HTML을 생성합니다. (하위 호환성을 위해 유지)
   * @deprecated createPaginationElement 사용 권장
   */
  private createPaginationHTML(): string {
    if (!this.isLongText || this.totalPreviewPages <= 1) {
      return '<div id="paginationContainer" class="kga-pagination-container-hidden"></div>';
    }

    return `
      <div class="kga-pagination-controls" id="paginationContainer">
        <button class="kga-pagination-btn" id="prevPreviewPage" ${this.currentPreviewPage === 0 ? 'disabled' : ''}>이전</button>
        <span class="kga-page-info" id="previewPageInfo">${this.currentPreviewPage + 1} / ${this.totalPreviewPages}</span>
        <button class="kga-pagination-btn" id="nextPreviewPage" ${this.currentPreviewPage === this.totalPreviewPages - 1 ? 'disabled' : ''}>다음</button>
        <span class="kga-page-chars-info" id="pageCharsInfo">${this.charsPerPage}자</span>
      </div>
    `;
  }

  /**
   * 현재 페이지의 교정 목록을 가져옵니다. (절대 위치 기반 정확한 순서)
   */
  private getCurrentCorrections(): PageCorrection[] {
    Logger.debug('========= getCurrentCorrections 시작 =========');
    Logger.debug(`isLongText: ${this.isLongText}`);
    Logger.debug(`currentPreviewPage: ${this.currentPreviewPage}`);
    Logger.debug(`allErrorPositions 개수: ${this.allErrorPositions.length}`);
    
    if (!this.isLongText) {
      // 짧은 텍스트인 경우 전체 오류 위치 배열을 그대로 사용
      const result = this.allErrorPositions.map((errorPos, index) => ({
        correction: errorPos.correction,
        originalIndex: errorPos.originalIndex || index,
        positionInPage: errorPos.absolutePosition || 0,
        absolutePosition: errorPos.absolutePosition || 0,
        uniqueId: errorPos.uniqueId || `fallback_${index}`,
        // Phase 3에서 추가된 필수 필드들
        pageIndex: 0,
        absoluteIndex: errorPos.originalIndex || index,
        relativeIndex: index,
        isVisible: true
      }));
      
      Logger.debug(`짧은 텍스트 모드: 전체 ${result.length}개 오류 반환`);
      Logger.debug('반환 오류 목록:', result.map(pc => ({ 
        original: pc.correction.original, 
        originalIndex: pc.originalIndex,
        uniqueId: pc.uniqueId,
        absolutePosition: pc.absolutePosition
      })));
      Logger.debug('========= getCurrentCorrections 종료 (짧은 텍스트) =========');
      
      return result;
    }
    
    const previewStartIndex = this.currentPreviewPage === 0 ? 0 : this.pageBreaks[this.currentPreviewPage - 1];
    const previewEndIndex = this.pageBreaks[this.currentPreviewPage];
    
    Logger.debug(`페이지 범위: ${previewStartIndex} ~ ${previewEndIndex}`);
    
    // 현재 페이지 범위에 포함된 오류들만 필터링
    const pageCorrections: PageCorrection[] = [];
    
    this.allErrorPositions.forEach((errorPos, index) => {
      Logger.debug(`[${index}] 오류 위치 검사: "${errorPos.correction.original}" at ${errorPos.absolutePosition} (고유ID: ${errorPos.uniqueId})`);
      
      if ((errorPos.absolutePosition || 0) >= previewStartIndex && 
          (errorPos.absolutePosition || 0) < previewEndIndex) {
        
        const pageCorrection = {
          correction: errorPos.correction,
          originalIndex: errorPos.originalIndex || index,
          positionInPage: (errorPos.absolutePosition || 0) - previewStartIndex,
          absolutePosition: errorPos.absolutePosition || 0,
          uniqueId: errorPos.uniqueId || `fallback_${index}`,
          // Phase 3에서 추가된 필수 필드들
          pageIndex: this.currentPreviewPage || 0,
          absoluteIndex: errorPos.originalIndex || index,
          relativeIndex: pageCorrections.length,
          isVisible: true
        };
        
        pageCorrections.push(pageCorrection);
        Logger.debug(`[${index}] 페이지 범위 내 오류 추가: positionInPage=${pageCorrection.positionInPage}`);
      } else {
        Logger.debug(`[${index}] 페이지 범위 밖 오류 제외`);
      }
    });
    
    // 절대 위치 순서로 정렬 (이미 정렬된 상태이지만 안전성을 위해)
    pageCorrections.sort((a, b) => (a.absolutePosition || 0) - (b.absolutePosition || 0));
    
    Logger.debug(`getCurrentCorrections: 페이지 ${this.currentPreviewPage + 1}, 오류 ${pageCorrections.length}개`);
    Logger.debug('최종 오류 위치 순서:', pageCorrections.map(pc => ({ 
      original: pc.correction.original, 
      originalIndex: pc.originalIndex,
      positionInPage: pc.positionInPage,
      absolutePosition: pc.absolutePosition,
      uniqueId: pc.uniqueId
    })));
    Logger.debug('========= getCurrentCorrections 종료 (긴 텍스트) =========');
    
    return pageCorrections;
  }

  /**
   * 중복된 교정 항목을 제거합니다.
   * 같은 original 텍스트를 가진 corrections를 그룹화하여 대표 항목만 선택합니다.
   */
  private removeDuplicateCorrections(corrections: PageCorrection[]): PageCorrection[] {
    Logger.debug('========= removeDuplicateCorrections 시작 =========');
    Logger.debug(`입력 corrections 개수: ${corrections.length}`);
    Logger.debug('입력 corrections:', corrections.map(pc => ({ 
      original: pc.correction.original, 
      originalIndex: pc.originalIndex,
      uniqueId: pc.uniqueId,
      absolutePosition: pc.absolutePosition
    })));
    
    const uniqueMap = new Map<string, PageCorrection>();
    const duplicateGroups = new Map<string, PageCorrection[]>();
    
    // 위치 기반 그룹화 (같은 위치에서 겹치는 단어들 처리)
    corrections.forEach((correction, index) => {
      const originalText = correction.correction.original;
      const position = correction.absolutePosition;
      Logger.debug(`[${index}] 그룹화 중: "${originalText}" (위치: ${position}, 고유ID: ${correction.uniqueId})`);
      
      // 같은 위치에서 겹치는 단어들을 찾기
      let groupKey = originalText;
      let foundOverlap = false;
      
      // 기존 그룹들과 겹치는지 확인
      for (const [existingKey, existingGroup] of duplicateGroups) {
        if (existingGroup.length > 0) {
          const existingCorrection = existingGroup[0];
          const existingPos = existingCorrection.absolutePosition;
          const existingText = existingCorrection.correction.original;
          
          // 같은 위치에서 시작하고 한 단어가 다른 단어를 포함하는 경우
          if (position === existingPos && 
              (originalText.includes(existingText) || existingText.includes(originalText))) {
            groupKey = existingKey;
            foundOverlap = true;
            Logger.debug(`[${index}] 위치 기반 중복 발견: "${originalText}" ↔ "${existingText}" (위치: ${position})`);
            break;
          }
        }
      }
      
      if (!duplicateGroups.has(groupKey)) {
        duplicateGroups.set(groupKey, []);
        Logger.debug(`[${index}] 새로운 그룹 생성: "${groupKey}"`);
      }
      duplicateGroups.get(groupKey)!.push(correction);
      Logger.debug(`[${index}] 그룹 추가 완료. 현재 "${groupKey}" 그룹 크기: ${duplicateGroups.get(groupKey)!.length}`);
    });
    
    Logger.debug(`그룹화 완료. 총 ${duplicateGroups.size}개 그룹 생성`);
    
    // 각 그룹에서 대표 항목 선택
    duplicateGroups.forEach((group, originalText) => {
      Logger.debug(`처리 중인 그룹: "${originalText}", 그룹 크기: ${group.length}`);
      Logger.debug(`그룹 내 항목들:`, group.map(pc => ({ 
        originalIndex: pc.originalIndex,
        uniqueId: pc.uniqueId,
        absolutePosition: pc.absolutePosition
      })));
      
      if (group.length === 1) {
        // 중복이 없는 경우 그대로 사용
        uniqueMap.set(originalText, group[0]);
        Logger.debug(`[단일 항목] "${originalText}" → 대표 항목: ${group[0].uniqueId}`);
      } else {
        // 중복이 있는 경우 선택 기준 적용
        const representative = this.selectRepresentativeCorrection(group);
        uniqueMap.set(originalText, representative);
        
        Logger.debug(`[중복 항목] "${originalText}", ${group.length}개 항목 → 대표 항목 선택 (uniqueId: ${representative.uniqueId}, originalIndex: ${representative.originalIndex})`);
        Logger.debug(`제외된 항목들:`, group.filter(pc => pc.uniqueId !== representative?.uniqueId).map(pc => ({ 
          uniqueId: pc.uniqueId || 'undefined',
          originalIndex: pc.originalIndex || -1,
          absolutePosition: pc.absolutePosition || -1
        })));
      }
    });
    
    Logger.debug(`대표 항목 선택 완료. uniqueMap 크기: ${uniqueMap.size}`);
    
    // 절대 위치 순서로 정렬하여 반환
    const result = Array.from(uniqueMap.values())
      .sort((a, b) => (a.absolutePosition || 0) - (b.absolutePosition || 0));
    
    Logger.debug(`중복 제거 결과: ${corrections.length}개 → ${result.length}개`);
    Logger.debug('최종 중복 제거 후 항목들:', result.map(pc => ({ 
      original: pc.correction.original, 
      originalIndex: pc.originalIndex,
      uniqueId: pc.uniqueId,
      absolutePosition: pc.absolutePosition
    })));
    Logger.debug('========= removeDuplicateCorrections 종료 =========');
    
    return result;
  }
  
  /**
   * 중복된 교정 항목들 중에서 대표 항목을 선택합니다.
   * 선택 기준:
   * 1. 가장 앞에 위치한 항목 (absolutePosition이 가장 작은 항목)
   * 2. 동일한 위치인 경우 가장 많은 수정 제안을 가진 항목
   * 3. 수정 제안이 같은 경우 더 좋은 도움말을 가진 항목 (문법 > 맞춤법 > 띄어쓰기)
   * 4. 그 외에는 첫 번째 항목
   */
  private selectRepresentativeCorrection(corrections: PageCorrection[]): PageCorrection {
    if (corrections.length === 0) {
      throw new Error('빈 교정 배열에서는 대표 항목을 선택할 수 없습니다');
    }
    
    if (corrections.length === 1) {
      return corrections[0];
    }
    
    // 우선순위 1: 가장 앞에 위치한 항목
    const minPosition = Math.min(...corrections.map(c => c.absolutePosition || 0));
    const frontmostCorrections = corrections.filter(c => (c.absolutePosition || 0) === minPosition);
    
    if (frontmostCorrections.length === 1) {
      Logger.debug(`대표 항목 선택: 가장 앞 위치 기준 (위치: ${minPosition})`);
      return frontmostCorrections[0];
    }
    
    // 우선순위 2: 가장 많은 수정 제안을 가진 항목
    const maxSuggestions = Math.max(...frontmostCorrections.map(c => c.correction.corrected.length));
    const bestSuggestionCorrections = frontmostCorrections.filter(c => c.correction.corrected.length === maxSuggestions);
    
    if (bestSuggestionCorrections.length === 1) {
      Logger.debug(`대표 항목 선택: 수정 제안 수 기준 (제안 수: ${maxSuggestions})`);
      return bestSuggestionCorrections[0];
    }
    
    // 우선순위 3: 더 좋은 도움말을 가진 항목 (문법 > 맞춤법 > 띄어쓰기)
    const helpPriority = (help: string): number => {
      const helpLower = help.toLowerCase();
      if (helpLower.includes('문법')) return 3;
      if (helpLower.includes('맞춤법')) return 2;
      if (helpLower.includes('띄어쓰기')) return 1;
      return 0;
    };
    
    const maxHelpPriority = Math.max(...bestSuggestionCorrections.map(c => helpPriority(c.correction.help)));
    const bestHelpCorrections = bestSuggestionCorrections.filter(c => helpPriority(c.correction.help) === maxHelpPriority);
    
    if (bestHelpCorrections.length === 1) {
      Logger.debug(`대표 항목 선택: 도움말 우선순위 기준 (우선순위: ${maxHelpPriority})`);
      return bestHelpCorrections[0];
    }
    
    // 우선순위 4: 첫 번째 항목 (기본값)
    Logger.debug(`대표 항목 선택: 첫 번째 항목 기본 선택`);
    return bestHelpCorrections[0];
  }

  /**
   * 전체 텍스트에서 모든 오류의 위치를 계산합니다.
   */
  private calculateAllErrorPositions(): void {
    this.allErrorPositions = [];
    
    this.config.corrections.forEach((correction, originalIndex) => {
      let searchPos = 0;
      let occurrenceCount = 0;
      
      while (true) {
        const foundPos = this.config.selectedText.indexOf(correction.original, searchPos);
        if (foundPos === -1) break;
        
        // 실제로 이 위치에 오류가 있는지 확인 (단어 경계 등 고려)
        const endPos = foundPos + correction.original.length;
        if (this.config.selectedText.slice(foundPos, endPos) === correction.original) {
          this.allErrorPositions.push({
            correction,
            originalIndex,
            absolutePosition: foundPos,
            uniqueId: `${originalIndex}_${occurrenceCount}`
          });
          occurrenceCount++;
        }
        
        searchPos = foundPos + 1;
      }
    });
    
    // 절대 위치 순서로 정렬
    this.allErrorPositions.sort((a, b) => a.absolutePosition - b.absolutePosition);
    
    Logger.debug('전체 오류 위치 계산 완료:', {
      totalErrors: this.allErrorPositions.length,
      positions: this.allErrorPositions.map(ep => ({
        original: ep.correction.original,
        originalIndex: ep.originalIndex,
        absolutePosition: ep.absolutePosition,
        uniqueId: ep.uniqueId
      }))
    });
  }

  /**
   * 현재 페이지에서 오류 상태(빨간색)인 항목의 개수를 가져옵니다.
   */
  private getErrorStateCount(): number {
    const currentCorrections = this.getCurrentCorrections();
    const uniqueCorrections = this.removeDuplicateCorrections(currentCorrections);
    let errorCount = 0;
    
    uniqueCorrections.forEach(pageCorrection => {
      const actualIndex = pageCorrection.originalIndex;
      if (actualIndex === undefined) {
        Logger.warn('pageCorrection.originalIndex is undefined in getErrorStateCount');
        return;
      }
      const correction = pageCorrection.correction;
      
      const currentValue = this.stateManager.getValue(actualIndex);
      const isException = this.stateManager.isExceptionState(actualIndex);
      const isOriginalKept = this.stateManager.isOriginalKeptState(actualIndex);
      
      // 오류 상태: 원본 값이고, 예외처리나 원본유지 상태가 아닌 경우
      if (currentValue === correction.original && !isException && !isOriginalKept) {
        errorCount++;
      }
    });
    
    return errorCount;
  }

  /**
   * 미리보기 콘텐츠를 업데이트합니다 (DOM API 사용).
   */
  private updatePreviewContent(previewElement: HTMLElement): void {
    this.createPreviewElement(previewElement);
  }

  /**
   * 미리보기 HTML을 생성합니다.
   */
  private generatePreviewHTML(): string {
    const previewText = this.isLongText ? this.getCurrentPreviewText() : this.config.selectedText.trim();
    const rawCorrections = this.getCurrentCorrections();
    const currentCorrections = this.removeDuplicateCorrections(rawCorrections);
    
    // 원본 텍스트와 정리된 텍스트 간의 오프셋 계산
    const originalText = this.config.selectedText;
    const trimmedStartOffset = originalText.length - originalText.trimStart().length;
    
    // 디버깅을 위한 로그
    Logger.debug('generatePreviewHTML 디버깅:', {
      isLongText: this.isLongText,
      originalLength: originalText.length,
      trimmedLength: previewText.length,
      trimmedStartOffset: trimmedStartOffset,
      startsWithSpace: previewText.startsWith(' '),
      endsWithSpace: previewText.endsWith(' '),
      firstChars: previewText.substring(0, 20),
      lastChars: previewText.substring(previewText.length - 20),
      correctionsCount: currentCorrections.length
    });

    // Create a map to track processed positions and avoid duplicates
    const processedPositions: Map<string, boolean> = new Map();
    const segments: { text: string; html: string; start: number; end: number }[] = [];

    // Process each correction individually to preserve unique IDs
    currentCorrections.forEach(pageCorrection => {
      const correction = pageCorrection.correction;
      const actualIndex = pageCorrection.originalIndex;
      if (actualIndex === undefined) {
        Logger.warn('pageCorrection.originalIndex is undefined in renderPreview');
        return;
      }
      const uniqueId = pageCorrection.uniqueId || 'unknown';
      const positionInPage = pageCorrection.positionInPage || 0;

      const displayClass = this.stateManager.getDisplayClass(actualIndex);
      const currentValue = this.stateManager.getValue(actualIndex);
      if (currentValue === undefined) {
        Logger.warn(`stateManager.getValue(${actualIndex}) returned undefined in renderPreview`);
        return;
      }
      const escapedValue = escapeHtml(currentValue);
      
      // 사용자 편집 상태일 때 디버깅
      const isUserEdited = this.stateManager.isUserEditedState(actualIndex);
      if (isUserEdited) {
        Logger.debug(`🎨 미리보기 사용자편집: index=${actualIndex}, original="${correction.original}", currentValue="${currentValue}", displayClass="${displayClass}"`);
      }
      
      const replacementHtml = `<span class="${displayClass} kga-clickable-error" data-correction-index="${actualIndex}" data-unique-id="${uniqueId}">${escapedValue}</span>`;
      
      // 정확한 위치에서 오류 텍스트 찾기
      const expectedText = correction.original || '';
      const expectedEnd = positionInPage + (expectedText?.length || 0);
      
      // 위치 범위 검증
      if (positionInPage >= 0 && expectedEnd <= previewText.length) {
        const actualText = previewText.slice(positionInPage, expectedEnd);
        
        // 텍스트가 정확히 일치하는지 확인
        if (actualText === expectedText) {
          const positionKey = `${positionInPage}-${expectedEnd}`;
          if (!processedPositions.has(positionKey)) {
            processedPositions.set(positionKey, true);
            
            segments.push({
              text: actualText,
              html: replacementHtml,
              start: positionInPage,
              end: expectedEnd
            });
            
            Logger.debug(`미리보기 오류 처리: ${actualText} at ${positionInPage}-${expectedEnd}, 고유 ID: ${uniqueId}`);
          }
        } else {
          Logger.warn(`텍스트 불일치: 예상 "${expectedText}", 실제 "${actualText}" at ${positionInPage}-${expectedEnd}`);
        }
      } else {
        Logger.warn(`위치 범위 초과: ${positionInPage}-${expectedEnd}, 텍스트 길이: ${previewText.length}`);
      }
    });

    // No need to add remaining text as we'll handle it in the final loop

    // Sort segments by their start index to handle potential overlaps or out-of-order matches
    segments.sort((a, b) => a.start - b.start);

    // Build the final HTML string by filling gaps between segments
    let finalHtml = '';
    let currentPos = 0;
    
    segments.forEach(segment => {
      // Add any text between the current position and the start of this segment
      if (segment.start > currentPos) {
        const betweenText = previewText.substring(currentPos, segment.start);
        // 시작 부분의 공백 제거
        const cleanedBetweenText = currentPos === 0 ? betweenText.trimStart() : betweenText;
        finalHtml += escapeHtml(cleanedBetweenText);
      }
      
      // Add the segment (replacement HTML) if it's not overlapping
      if (segment.start >= currentPos) {
        finalHtml += segment.html;
        currentPos = segment.end;
      }
      // Skip overlapping segments
    });

    // Add any remaining text after the last segment
    if (currentPos < previewText.length) {
      const remainingText = previewText.substring(currentPos);
      // 시작 부분의 공백 제거 (전체 텍스트의 시작인 경우)
      const cleanedRemainingText = currentPos === 0 ? remainingText.trimStart() : remainingText;
      finalHtml += escapeHtml(cleanedRemainingText);
    }

    return finalHtml;
  }

  /**
   * 현재 페이지의 미리보기 텍스트를 가져옵니다.
   */
  private getCurrentPreviewText(): string {
    if (!this.isLongText) return this.config.selectedText.trim();
    
    const previewStartIndex = this.currentPreviewPage === 0 ? 0 : this.pageBreaks[this.currentPreviewPage - 1];
    const previewEndIndex = this.pageBreaks[this.currentPreviewPage];
    
    const pageText = this.config.selectedText.slice(previewStartIndex, previewEndIndex);
    
    // 페이지 텍스트 정리 - 앞뒤 공백 제거
    const cleanedPageText = pageText.trim();
    
    // 디버깅 로그 추가
    Logger.debug('getCurrentPreviewText 디버깅:', {
      currentPage: this.currentPreviewPage,
      startIndex: previewStartIndex,
      endIndex: previewEndIndex,
      originalLength: pageText.length,
      cleanedLength: cleanedPageText.length,
      startsWithSpace: pageText.startsWith(' '),
      endsWithSpace: pageText.endsWith(' '),
      firstChars: pageText.substring(0, 20),
      cleanedFirstChars: cleanedPageText.substring(0, 20)
    });
    
    return cleanedPageText;
  }

  /**
   * 오류 요약 HTML을 생성합니다.
   */
  private generateErrorSummaryHTML(): string {
    Logger.debug(`🏗️ generateErrorSummaryHTML 시작`);
    const rawCorrections = this.getCurrentCorrections();
    const currentCorrections = this.removeDuplicateCorrections(rawCorrections);
    Logger.debug(`🏗️ rawCorrections: ${rawCorrections.length}, currentCorrections: ${currentCorrections.length}`);
    
    if (currentCorrections.length === 0) {
      Logger.debug(`🏗️ 오류 없음 - 플레이스홀더 반환`);
      return `
        <div class="kga-error-placeholder">
          <div class="kga-placeholder-icon">✓</div>
          <div class="kga-placeholder-text">이 페이지에는 발견된 오류가 없습니다</div>
          <div class="kga-placeholder-subtext">다른 페이지에서 오류를 확인하세요</div>
        </div>
      `;
    }

    // 중복 제거: originalIndex를 기준으로 그룹화하여 첫 번째 항목만 표시
    const uniqueCorrections = this.removeDuplicateCorrections(currentCorrections);
    Logger.debug(`🏗️ uniqueCorrections: ${uniqueCorrections.length}`);
    
    return uniqueCorrections.map((pageCorrection, index) => {
      const actualIndex = pageCorrection.originalIndex;
      const correction = pageCorrection.correction;
      const isOriginalKept = this.stateManager.isOriginalKeptState(actualIndex);
      const isUserEdited = this.stateManager.isUserEditedState(actualIndex);
      const suggestions = correction.corrected.slice(0, 3);
      
      Logger.debug(`🏗️ HTML 생성: "${correction.original}" → actualIndex=${actualIndex}, pageIndex=${index}`);
      
      const aiResult = this.aiAnalysisResults.find(result => result.correctionIndex === actualIndex);
      const reasoningHTML = aiResult
        ? `<div class="kga-ai-analysis-result">
             <div class="kga-ai-confidence">🤖 신뢰도: <span class="kga-confidence-score">${aiResult.confidence}%</span></div>
             <div class="kga-ai-reasoning">${escapeHtml(aiResult.reasoning)}</div>
           </div>`
        : isOriginalKept
        ? `<div class="kga-ai-analysis-result">
             <div class="kga-ai-reasoning">사용자가 직접 선택했거나, 예외 단어로 등록된 항목입니다.</div>
           </div>`
        : '';
      
      const suggestionsHTML = suggestions.map(suggestion => 
        `<span class="kga-suggestion-compact ${this.stateManager.isSelected(actualIndex, suggestion) ? 'selected' : ''}" 
              data-value="${escapeHtml(suggestion)}" 
              data-correction="${actualIndex}"
              ${isOriginalKept ? 'disabled' : ''}>
          ${escapeHtml(suggestion)}
        </span>`
      ).join('');

      const stateClass = isUserEdited ? 'user-edited' : 
                       isOriginalKept ? 'original-kept' : 
                       this.stateManager.isExceptionState(actualIndex) ? 'exception-processed' :
                       this.stateManager.getValue(actualIndex) !== correction.original ? 'corrected' : '';
      
      const htmlString = `
        <div class="kga-error-item-compact ${isOriginalKept ? 'spell-original-kept' : ''}" data-correction-index="${actualIndex}">
          <div class="kga-error-row">
            <div class="kga-error-original-compact ${stateClass}" data-correction-index="${actualIndex}">${escapeHtml(this.stateManager.getValue(actualIndex))}</div>
            <div class="kga-error-suggestions-compact">
              ${suggestionsHTML}
              <span class="kga-suggestion-compact ${this.stateManager.isSelected(actualIndex, correction.original) ? 'selected' : ''} kga-keep-original" 
                    data-value="${escapeHtml(correction.original)}" 
                    data-correction="${actualIndex}"
                    ${isOriginalKept ? 'disabled' : ''}>
                예외처리
              </span>
            </div>
          </div>
          <div class="kga-error-help-compact">${escapeHtml(correction.help)}</div>
          ${reasoningHTML}
        </div>
      `;
      
      Logger.debug(`🏗️ HTML 첫 부분 - actualIndex=${actualIndex}: ${htmlString.substring(0, 200)}...`);
      
      return htmlString;
    }).join('');
  }

  /**
   * 이벤트를 바인딩합니다.
   */
  private bindEvents(): void {
    // Obsidian 글로벌 스코프에 키보드 단축키 등록 (포커스 독립적)
    
    // Cmd+E: 편집 모드 진입
    const cmdEHandler = this.app.scope.register(['Mod'], 'KeyE', (evt: KeyboardEvent) => {
      if (this.isInEditMode()) {
        return true; // 편집 중일 때는 기본 동작 허용
      }
      
      evt.preventDefault();
      evt.stopPropagation();
      this.enterEditModeForFocusedError();
      return false;
    });
    
    // Cmd+Shift+E: 오류 상세부분 토글
    const cmdShiftEHandler = this.app.scope.register(['Mod', 'Shift'], 'KeyE', (evt: KeyboardEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.toggleErrorSummary();
      return false;
    });
    
    // Component 정리 시스템에 등록 (자동 정리)
    this.cleanupFunctions.push(() => this.app.scope.unregister(cmdEHandler));
    this.cleanupFunctions.push(() => this.app.scope.unregister(cmdShiftEHandler));

    // Document 레벨 백업 시스템 (포커스 독립적 보장)
    const documentKeyListener = (evt: KeyboardEvent) => {
      // Cmd+E: 편집 모드 진입 (글로벌 스코프가 실패했을 때 백업)
      if (evt.code === 'KeyE' && ((evt.metaKey && !evt.ctrlKey) || (!evt.metaKey && evt.ctrlKey)) && !evt.shiftKey) {
        if (this.isInEditMode()) {
          return;
        }
        
        evt.preventDefault();
        evt.stopPropagation();
        this.enterEditModeForFocusedError();
        return;
      }
      
      // Cmd+Shift+E: 오류 상세부분 토글 (글로벌 스코프가 실패했을 때 백업)
      if (evt.code === 'KeyE' && ((evt.metaKey && !evt.ctrlKey) || (!evt.metaKey && evt.ctrlKey)) && evt.shiftKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.toggleErrorSummary();
        return;
      }
    };
    document.addEventListener('keydown', documentKeyListener);
    this.cleanupFunctions.push(() => document.removeEventListener('keydown', documentKeyListener));

    // DOM 레벨에서 키보드 이벤트 처리 (백업)
    this.addEventListener(this.element, 'keydown', (evt: KeyboardEvent) => {
      // Shift+Cmd+A: AI 분석
      if (evt.code === 'KeyA' && evt.shiftKey && evt.metaKey && !evt.ctrlKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.triggerAIAnalysis();
        return;
      }
      
      // Cmd+E: 편집 모드 진입 (편집 중이 아닐 때만)
      if (evt.code === 'KeyE' && ((evt.metaKey && !evt.ctrlKey) || (!evt.metaKey && evt.ctrlKey)) && !evt.shiftKey) {
        if (this.isInEditMode()) {
          return; // 편집 중일 때는 기본 동작 허용
        }
        
        evt.preventDefault();
        evt.stopPropagation();
        this.enterEditModeForFocusedError();
        return;
      }
      
      // Cmd+Shift+E: 오류 상세부분 토글
      if (evt.code === 'KeyE' && ((evt.metaKey && !evt.ctrlKey) || (!evt.metaKey && evt.ctrlKey)) && evt.shiftKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.toggleErrorSummary();
        return;
      }
    });


    // 닫기 버튼들
    this.bindCloseEvents();
    
    // 팝업 오버레이 클릭 시 닫기
    const overlay = this.element.querySelector('.kga-popup-overlay');
    if (overlay) {
      this.addEventListener(overlay as HTMLElement, 'click', () => {
        this.close();
      });
    }

    // 페이지네이션
    this.bindPaginationEvents();
    
    // 오류 토글
    this.bindErrorToggleEvents();
    
    // 교정 클릭
    this.bindCorrectionEvents();
    
    // 적용 버튼
    this.bindApplyEvents();
    
    // AI 분석 버튼
    this.bindAIAnalysisEvents();
  }

  /**
   * 닫기 이벤트를 바인딩합니다.
   */
  private bindCloseEvents(): void {
    const closeButtons = this.element.querySelectorAll('.kga-close-btn-header, .kga-cancel-btn');
    closeButtons.forEach(button => {
      this.addEventListener(button as HTMLElement, 'click', () => {
        this.close();
      });
    });

    // ESC 키 이벤트
    const escKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };
    document.addEventListener('keydown', escKeyHandler);
    this.cleanupFunctions.push(() => document.removeEventListener('keydown', escKeyHandler));
  }

  /**
   * 페이지네이션 이벤트를 바인딩합니다.
   */
  private bindPaginationEvents(): void {
    const prevButton = this.element.querySelector('#prevPreviewPage') as HTMLButtonElement;
    const nextButton = this.element.querySelector('#nextPreviewPage') as HTMLButtonElement;

    if (prevButton) {
      this.addEventListener(prevButton, 'click', () => {
        if (this.currentPreviewPage > 0) {
          this.currentPreviewPage--;
          this.updateDisplay();
          this.resetFocusToFirstError();
        }
      });
    }

    if (nextButton) {
      this.addEventListener(nextButton, 'click', () => {
        if (this.currentPreviewPage < this.totalPreviewPages - 1) {
          this.currentPreviewPage++;
          this.updateDisplay();
          this.resetFocusToFirstError();
        }
      });
    }
  }

  /**
   * 오류 토글 이벤트를 바인딩합니다.
   */
  private bindErrorToggleEvents(): void {
    const toggleElement = this.element.querySelector('.kga-error-summary-toggle');
    if (toggleElement) {
      this.addEventListener(toggleElement as HTMLElement, 'click', () => {
        const errorSummary = this.element.querySelector('#errorSummary');
        if (errorSummary) {
          errorSummary.classList.toggle('collapsed');
          
          // 페이지네이션 재계산
          activeWindow.setTimeout(() => {
            this.recalculatePagination();
            this.updateDisplay();
          }, 350);
        }
      });
    }
  }

  /**
   * 교정 클릭 이벤트를 바인딩합니다.
   */
  private bindCorrectionEvents(): void {
    // 좌클릭 이벤트
    this.addEventListener(this.element, 'click', (e: Event) => {
      const target = e.target as HTMLElement;
      Logger.debug(`🖱️ 클릭 이벤트 발생: target="${target.tagName}.${target.className}", textContent="${target.textContent}"`);
      
      // 미리보기 영역 클릭 처리
      if (target.classList.contains('kga-clickable-error')) {
        Logger.debug(`🖱️ 미리보기 클릭 처리: ${target.textContent}`);
        this.handlePreviewClick(target);
      }
      
      // 오류 상세 카드 원본 텍스트 클릭 처리 (편집 모드)
      if (target.classList.contains('kga-error-original-compact')) {
        Logger.debug(`🖱️ 오류 카드 텍스트 클릭 감지: ${target.textContent}`);
        this.handleCardTextClick(target);
      }
      
      // 제안 버튼 클릭 처리
      if (target.classList.contains('kga-suggestion-compact')) {
        this.handleSuggestionClick(target);
      }
    });

    // 우클릭 컨텍스트 메뉴 이벤트
    this.addEventListener(this.element, 'contextmenu', (e: Event) => {
      const target = e.target as HTMLElement;
      
      // 미리보기 영역의 오류 단어에서 우클릭 시 편집 모드로 전환
      if (target.classList.contains('kga-clickable-error')) {
        e.preventDefault(); // 기본 컨텍스트 메뉴 차단
        Logger.debug(`🖱️ 미리보기 우클릭 편집 모드: ${target.textContent}`);
        this.handlePreviewRightClick(target);
      }
    });

    // 모바일용 터치홀드 이벤트 (터치홀드로 편집 모드 진입)
    this.bindTouchHoldEvents();
  }

  /**
   * 모바일용 터치홀드 이벤트를 바인딩합니다.
   */
  private bindTouchHoldEvents(): void {
    // 모바일에서만 터치홀드 이벤트 활성화
    if (!Platform.isMobile) {
      Logger.debug('데스크톱 환경에서는 터치홀드 이벤트를 등록하지 않음');
      return;
    }

    let touchTimer: number | null = null;
    let touchTarget: HTMLElement | null = null;
    const TOUCH_HOLD_DURATION = 500; // 500ms 터치홀드

    // 터치 시작
    this.addEventListener(this.element, 'touchstart', (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      
      // 미리보기 영역의 오류 텍스트 또는 오류 카드의 원본 텍스트에서 터치홀드 처리
      if (target.classList.contains('kga-clickable-error') || target.classList.contains('kga-error-original-compact')) {
        touchTarget = target;
        
        touchTimer = activeWindow.setTimeout(() => {
          if (touchTarget) {
            Logger.log(`📱 터치홀드 편집 모드 진입: ${touchTarget.textContent}`);
            
            // 햅틱 피드백 (지원되는 경우)
            if ('vibrate' in navigator) {
              navigator.vibrate(50);
            }
            
            // 편집 모드 로직 먼저 호출 (미리보기가 보이는 상태에서)
            let editingStarted = false;
            if (touchTarget.classList.contains('kga-clickable-error')) {
              editingStarted = this.handlePreviewRightClick(touchTarget);
            } else if (touchTarget.classList.contains('kga-error-original-compact')) {
              editingStarted = this.handleCardTextClick(touchTarget);
            }
            
            // 편집 모드가 성공적으로 시작된 후에만 모바일 UI 적용
            if (editingStarted) {
              this.enterMobileEditingMode();
            }
            
            // 터치홀드 처리 완료 후 정리
            touchTarget = null;
            touchTimer = null;
          }
        }, TOUCH_HOLD_DURATION);
        
        Logger.debug(`📱 터치홀드 타이머 시작: ${target.textContent}`);
      }
    });

    // 터치 끝 (타이머 취소)
    this.addEventListener(this.element, 'touchend', () => {
      if (touchTimer) {
        activeWindow.clearTimeout(touchTimer);
        touchTimer = null;
        Logger.debug('📱 터치홀드 타이머 취소 (touchend)');
      }
      touchTarget = null;
    });

    // 터치 취소 (드래그 등으로 인한 취소)
    this.addEventListener(this.element, 'touchcancel', () => {
      if (touchTimer) {
        activeWindow.clearTimeout(touchTimer);
        touchTimer = null;
        Logger.debug('📱 터치홀드 타이머 취소 (touchcancel)');
      }
      touchTarget = null;
    });

    // 터치 이동 (일정 거리 이상 이동 시 취소)
    this.addEventListener(this.element, 'touchmove', (e: TouchEvent) => {
      if (touchTimer && touchTarget) {
        // 터치 이동이 감지되면 홀드 취소 (스크롤 등과 구분)
        const touch = e.touches[0];
        const rect = touchTarget.getBoundingClientRect();
        const moveThreshold = 10; // 10px 이상 이동 시 취소
        
        const distanceX = Math.abs(touch.clientX - (rect.left + rect.width / 2));
        const distanceY = Math.abs(touch.clientY - (rect.top + rect.height / 2));
        
        if (distanceX > moveThreshold || distanceY > moveThreshold) {
          activeWindow.clearTimeout(touchTimer);
          touchTimer = null;
          touchTarget = null;
          Logger.debug('📱 터치홀드 타이머 취소 (이동 감지)');
        }
      }
    });

    Logger.log('📱 모바일 터치홀드 이벤트 등록 완료');
  }

  /**
   * 적용 버튼 이벤트를 바인딩합니다.
   */
  private bindApplyEvents(): void {
    const applyButton = this.element.querySelector('#applyCorrectionsButton');
    if (applyButton) {
      this.addEventListener(applyButton as HTMLElement, 'click', async () => {
        await this.applyCorrections();
      });
    }
  }

  /**
   * AI 분석 버튼 상태를 업데이트합니다.
   */
  private async updateAiButtonState(aiBtn: HTMLButtonElement): Promise<void> {
    try {
      if (this.isAiAnalyzing) {
        // 분석 중인 경우
        aiBtn.textContent = '🤖 분석 중...';
        aiBtn.disabled = true;
        aiBtn.classList.remove('kga-ai-disabled');
        aiBtn.title = 'AI 분석이 진행 중입니다...';
      } else if (this.aiService && (await this.aiService.isAvailable())) {
        // AI 서비스 사용 가능한 경우
        aiBtn.textContent = '🤖 AI 분석';
        aiBtn.disabled = false;
        aiBtn.classList.remove('kga-ai-disabled');
        aiBtn.title = 'AI가 최적의 수정사항을 자동으로 선택합니다 (Shift+Cmd+A)';
      } else {
        // AI 서비스 사용 불가능한 경우
        aiBtn.textContent = '🤖 AI 미설정';
        aiBtn.disabled = true;
        aiBtn.classList.add('kga-ai-disabled');
        if (!this.aiService) {
          aiBtn.title = 'AI 서비스를 초기화할 수 없습니다. 플러그인을 다시 로드해보세요.';
        } else {
          // AI 서비스는 있지만 설정이 부족한 경우
          const providerInfo = this.aiService.getProviderInfo();
          if (!providerInfo.available) {
            aiBtn.title = `AI 기능이 비활성화되었습니다. 설정에서 ${providerInfo.provider} API 키를 입력하고 AI 기능을 활성화하세요.`;
          } else {
            aiBtn.title = 'AI 서비스를 사용할 수 없습니다. 설정을 확인해주세요.';
          }
        }
      }
    } catch (error) {
      Logger.error('AI 버튼 상태 업데이트 실패:', error);
      aiBtn.textContent = '🤖 AI 오류';
      aiBtn.disabled = true;
      aiBtn.classList.add('kga-ai-disabled');
      aiBtn.title = 'AI 서비스 상태 확인 중 오류가 발생했습니다.';
    }
  }

  /**
   * AI 분석 버튼 이벤트를 바인딩합니다.
   */
  private bindAIAnalysisEvents(): void {
    const aiAnalyzeBtn = this.element.querySelector('#aiAnalyzeBtn');
    if (aiAnalyzeBtn && this.aiService) {
      this.addEventListener(aiAnalyzeBtn as HTMLElement, 'click', async () => {
        await this.performAIAnalysis();
      });
    }
  }

  /**
   * 미리보기 클릭을 처리합니다.
   */
  private handlePreviewClick(target: HTMLElement): void {
    const correctionIndex = parseInt(target.dataset.correctionIndex || '-1');
    if (correctionIndex >= 0 && correctionIndex < this.config.corrections.length) {
      this.stateManager.toggleState(correctionIndex);
      this.updateDisplay();
    }
  }

  /**
   * 제안 버튼 클릭을 처리합니다.
   */
  private handleSuggestionClick(target: HTMLElement): void {
    const correctionIndex = parseInt(target.dataset.correction || '0');
    const value = target.dataset.value || '';
    
    this.stateManager.setState(correctionIndex, value, value === this.config.corrections[correctionIndex]?.original, false);
    this.updateDisplay();
  }

  /**
   * 현재 편집 모드인지 확인합니다.
   */
  private isInEditMode(): boolean {
    const editingInput = activeDocument.querySelector('input[data-edit-mode="true"]');
    return editingInput !== null && activeDocument.activeElement === editingInput;
  }

  /**
   * 미리보기 영역에서 우클릭 시 편집 모드로 전환합니다.
   * 일괄 동작: 펼치기 + 오토스크롤 + 편집 모드 진입
   */
  private handlePreviewRightClick(target: HTMLElement): boolean {
    const correctionIndex = parseInt(target.dataset.correctionIndex || '0');
    Logger.debug(`🔧 handlePreviewRightClick 호출: index=${correctionIndex}, text="${target.textContent}"`);
    
    if (isNaN(correctionIndex) || correctionIndex < 0 || correctionIndex >= this.config.corrections.length) {
      Logger.debug('Invalid correction index for preview right click:', correctionIndex);
      return false;
    }

    // 오류 상세 영역 상태 확인 및 펼치기
    const errorSummary = this.element.querySelector('#errorSummary');
    const wasCollapsed = errorSummary && errorSummary.classList.contains('collapsed');
    
    if (wasCollapsed) {
      errorSummary!.classList.remove('collapsed');
      Logger.debug('🔧 오류 상세 영역 펼침');
      this.updateDisplay(); // 페이지네이션 재계산
    }

    // DOM 업데이트 후 편집 모드 진입 (비동기 처리)
    activeWindow.setTimeout(() => {
      const errorCard = this.element.querySelector(`[data-correction-index="${correctionIndex}"] .kga-error-original-compact`);
      if (errorCard) {
        Logger.debug(`🔧 편집 모드 진입 - 오류 상세 카드 찾음: index=${correctionIndex}`);
        
        // 해당 카드로 스크롤
        errorCard.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
        Logger.debug('🔧 오토스크롤 수행');
        
        // 스크롤 완료 후 편집 모드 진입
        activeWindow.setTimeout(() => {
          this.enterCardEditMode(errorCard as HTMLElement, correctionIndex);
        }, 300); // 스크롤 애니메이션 완료 대기
        
      } else {
        Logger.debug(`🔧 오류 상세 카드를 찾을 수 없음: index=${correctionIndex}`);
      }
    }, wasCollapsed ? 100 : 0); // 펼쳐졌다면 DOM 업데이트 대기
    
    return true; // 편집 모드 진입 프로세스 시작됨
  }

  /**
   * 오류 상세 카드의 원본 텍스트 클릭 시 편집 모드로 전환합니다.
   */
  private handleCardTextClick(target: HTMLElement): boolean {
    const correctionIndex = parseInt(target.dataset.correctionIndex || '0');
    Logger.debug(`🔧 handleCardTextClick 호출: index=${correctionIndex}, text="${target.textContent}"`);
    Logger.debug(`🔧 target.dataset: ${JSON.stringify(target.dataset)}`);
    Logger.debug(`🔧 target 클래스: ${target.className}`);
    
    if (isNaN(correctionIndex) || correctionIndex < 0 || correctionIndex >= this.config.corrections.length) {
      Logger.debug('Invalid correction index for card text click:', correctionIndex);
      return false;
    }

    Logger.debug(`🔧 enterCardEditMode 호출 예정: index=${correctionIndex}`);
    this.enterCardEditMode(target, correctionIndex);
    return true; // 편집 모드 진입 시작됨
  }

  /**
   * 카드 편집 모드로 진입합니다.
   */
  private enterCardEditMode(originalElement: HTMLElement, correctionIndex: number): void {
    const currentText = originalElement.textContent || '';
    Logger.debug(`🔧 enterCardEditMode 시작: index=${correctionIndex}, currentText="${currentText}"`);
    
    // input 요소 생성
    const input = createEl('input');
    input.type = 'text';
    input.value = currentText;
    input.className = 'kga-error-original-input';
    input.dataset.correctionIndex = correctionIndex.toString();
    input.dataset.editMode = 'true'; // 편집 모드 표시
    
    // 편집 완료 플래그 (중복 호출 방지)
    let isFinished = false;
    
    // 모바일에서는 컨테이너와 버튼 추가
    if (Platform.isMobile) {
      this.createMobileEditContainer(originalElement, input, correctionIndex, () => isFinished, (flag) => isFinished = flag);
    } else {
      // 데스크톱: 기존 방식
      this.createDesktopEditMode(originalElement, input, correctionIndex, () => isFinished, (flag) => isFinished = flag);
    }
  }

  /**
   * 데스크톱용 편집 모드를 생성합니다.
   */
  private createDesktopEditMode(originalElement: HTMLElement, input: HTMLInputElement, correctionIndex: number, getIsFinished: () => boolean, setIsFinished: (flag: boolean) => void): void {
    const errorCard = originalElement.closest('.kga-error-card');
    const hiddenElements: Array<{ element: HTMLElement; className: string }> = [];

    const hideElement = (element: HTMLElement | null, className: string = HIDDEN_CLASS, logMessage?: string) => {
      if (!element) return;
      element.classList.add(className);
      hiddenElements.push({ element, className });
      if (logMessage) {
        Logger.debug(logMessage);
      }
    };

    if (errorCard) {
      hideElement(
        errorCard.querySelector('.kga-error-suggestions-compact') as HTMLElement,
        HIDDEN_CLASS,
        `🖥️ 수정 제안 버튼 숨김: index=${correctionIndex}`
      );
      hideElement(
        errorCard.querySelector('.kga-error-exception-btn') as HTMLElement,
        HIDDEN_CLASS,
        `🖥️ 예외 처리 버튼 숨김: index=${correctionIndex}`
      );
    }
    
    // 편집 완료 함수 (중복 호출 방지)
    const finishEdit = () => {
      if (getIsFinished()) return;
      setIsFinished(true);
      // 숨겨둔 요소들 다시 표시
      hiddenElements.forEach(({ element, className }) => {
        element.classList.remove(className);
        Logger.debug(`🖥️ 숨겨진 요소 복원: ${element.className}`);
      });
      this.finishCardEdit(input, correctionIndex);
    };
    
    // 편집 취소 함수 (중복 호출 방지)
    const cancelEdit = () => {
      if (getIsFinished()) return;
      setIsFinished(true);
      // 숨겨둔 요소들 다시 표시
      hiddenElements.forEach(({ element, className }) => {
        element.classList.remove(className);
        Logger.debug(`🖥️ 숨겨진 요소 복원 (취소): ${element.className}`);
      });
      this.cancelCardEdit(input, correctionIndex);
    };
    
    // 원본 요소를 input으로 교체
    originalElement.parentElement?.replaceChild(input, originalElement);
    
    // input에 포커스를 주고 텍스트 선택
    input.focus();
    input.select();
    
    // 엔터키 이벤트 처리
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelEdit();
      }
    });
    
    // 포커스를 잃으면 편집 완료
    input.addEventListener('blur', () => {
      finishEdit();
    });
  }

  /**
   * 모바일 편집 모드로 진입합니다.
   */
  private enterMobileEditingMode(): void {
    if (!Platform.isMobile) return;
    
    const errorSummary = activeDocument.getElementById('errorSummary');
    
    // 오류 상세 영역 전체 확장 (미리보기는 유지)
    if (errorSummary) {
      errorSummary.classList.add(ERROR_SUMMARY_EXPANDED_CLASS);
      errorSummary.classList.remove('collapsed');
      Logger.debug(`📱 오류 상세 영역 전체 확장 (편집 모드)`);
    }
  }

  /**
   * 모바일 편집 모드에서 복원합니다.
   */
  private exitMobileEditingMode(): void {
    if (!Platform.isMobile) return;
    
    const errorSummary = activeDocument.getElementById('errorSummary');
    
    // 오류 상세 영역 원래 크기로 복원
    if (errorSummary) {
      errorSummary.classList.remove(ERROR_SUMMARY_EXPANDED_CLASS);
      Logger.debug(`📱 오류 상세 영역 원래 크기로 복원`);
    }
  }

  /**
   * 모바일용 편집 컨테이너를 생성합니다.
   */
  private createMobileEditContainer(originalElement: HTMLElement, input: HTMLInputElement, correctionIndex: number, getIsFinished: () => boolean, setIsFinished: (flag: boolean) => void): void {
    const hiddenElements: Array<{ element: HTMLElement; className: string }> = [];

    const stashElement = (element: HTMLElement | null, className: string = FORCE_HIDDEN_CLASS, logMessage?: string) => {
      if (!element) return;
      element.classList.add(className);
      hiddenElements.push({ element, className });
      if (logMessage) {
        Logger.debug(logMessage);
      }
    };
    
    // 해당 오류 카드 찾기 및 수정 제안 버튼들 숨기기
    const errorCard = originalElement.closest('.kga-error-card');
    
    if (errorCard) {
      // kga-editing-mode 클래스 추가 (CSS 폴백용)
      errorCard.classList.add('kga-editing-mode');
      Logger.debug(`📱 kga-editing-mode 클래스 추가: index=${correctionIndex}`);
      
      // 수정 제안 버튼들 모두 찾아서 숨기기
      const suggestions = errorCard.querySelectorAll('.kga-suggestion-compact');
      const keepOriginals = errorCard.querySelectorAll('.kga-keep-original');
      const suggestionsContainer = errorCard.querySelector('.kga-error-suggestions-compact') as HTMLElement;
      const exceptionBtn = errorCard.querySelector('.kga-error-exception-btn') as HTMLElement;
      
      // 개별 수정 제안 버튼들 강제 숨기기
      suggestions.forEach((btn) => {
        stashElement(btn as HTMLElement);
      });
      
      // 원본 유지 버튼들 강제 숨기기
      keepOriginals.forEach((btn) => {
        stashElement(btn as HTMLElement);
      });
      
      // 수정 제안 컨테이너 강제 숨기기
      stashElement(
        suggestionsContainer,
        FORCE_HIDDEN_CLASS,
        `📱 수정 제안 컨테이너 강제 숨김: index=${correctionIndex}`
      );
      
      // 예외 처리 버튼 강제 숨기기
      stashElement(
        exceptionBtn,
        FORCE_HIDDEN_CLASS,
        `📱 예외 처리 버튼 강제 숨김: index=${correctionIndex}`
      );
    }
    
    // 컨테이너 생성 (Obsidian createEl 사용)
    const container = createDiv();
    container.className = 'kga-mobile-edit-container';
    
    // 완료 버튼
    const saveBtn = createEl('button');
    saveBtn.className = 'kga-mobile-edit-btn save';
    saveBtn.textContent = '✓';
    saveBtn.title = '저장';
    
    // 취소 버튼
    const cancelBtn = createEl('button');
    cancelBtn.className = 'kga-mobile-edit-btn cancel';
    cancelBtn.textContent = '✕';
    cancelBtn.title = '취소';
    
    // 편집 완료 함수
    const finishEdit = () => {
      if (getIsFinished()) return;
      setIsFinished(true);
      
      // 모바일 편집 모드 종료 - 미리보기 복원 및 오류 상세 영역 원래 크기로 복원
      this.exitMobileEditingMode();
      
      // kga-editing-mode 클래스 제거
      if (errorCard) {
        errorCard.classList.remove('kga-editing-mode');
        Logger.debug(`📱 kga-editing-mode 클래스 제거: index=${correctionIndex}`);
      }
      
      // 숨겨둔 요소들 다시 표시
      hiddenElements.forEach(({ element, className }) => {
        element.classList.remove(className);
        Logger.debug(`📱 숨겨진 요소 복원: ${element.className}`);
      });
      
      Logger.debug(`📱 모바일 편집 모드 종료 - 레이아웃 복원`);
      this.finishCardEdit(input, correctionIndex);
    };
    
    // 편집 취소 함수
    const cancelEdit = () => {
      if (getIsFinished()) return;
      setIsFinished(true);
      
      // 모바일 편집 모드 종료 - 미리보기 복원 및 오류 상세 영역 원래 크기로 복원
      this.exitMobileEditingMode();
      
      // kga-editing-mode 클래스 제거
      if (errorCard) {
        errorCard.classList.remove('kga-editing-mode');
        Logger.debug(`📱 kga-editing-mode 클래스 제거 (취소): index=${correctionIndex}`);
      }
      
      // 숨겨진 요소들 다시 표시
      hiddenElements.forEach(({ element, className }) => {
        element.classList.remove(className);
        Logger.debug(`📱 숨겨진 요소 복원 (취소): ${element.className}`);
      });
      
      Logger.debug(`📱 모바일 편집 모드 취소 - 레이아웃 복원`);
      this.cancelCardEdit(input, correctionIndex);
    };
    
    // 버튼 이벤트
    saveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      finishEdit();
    });
    
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    });
    
    // 모바일에서는 blur 이벤트 비활성화 (버튼 클릭으로만 제어)
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelEdit();
      }
    });
    
    // 컨테이너 구성
    container.appendChild(input);
    container.appendChild(saveBtn);
    container.appendChild(cancelBtn);
    
    // 원본 요소를 컨테이너로 교체
    originalElement.parentElement?.replaceChild(container, originalElement);
    
    // input에 포커스를 주고 텍스트 선택
    activeWindow.setTimeout(() => {
      input.focus();
      input.select();
    }, 100);
    
    Logger.log(`📱 모바일 편집 컨테이너 생성 완료: index=${correctionIndex}`);
  }

  /**
   * 카드 편집을 완료합니다.
   */
  private finishCardEdit(input: HTMLInputElement, correctionIndex: number): void {
    const newValue = input.value.trim();
    const currentValue = this.stateManager.getValue(correctionIndex);
    Logger.debug(`🔧 finishCardEdit 호출: index=${correctionIndex}, newValue="${newValue}", currentValue="${currentValue}"`);
    
    if (newValue === '') {
      // 빈 값이면 편집 취소
      Logger.debug(`🔧 빈 값으로 편집 취소: index=${correctionIndex}`);
      this.cancelCardEdit(input, correctionIndex);
      return;
    }
    
    // 값이 변경되지 않았으면 편집 취소 (현재 상태 유지)
    if (newValue === currentValue) {
      Logger.debug(`🔧 값이 변경되지 않아서 편집 취소: index=${correctionIndex}, value="${newValue}"`);
      this.cancelCardEdit(input, correctionIndex);
      return;
    }
    
    // 사용자 편집 상태로 설정
    Logger.debug(`🔧 setUserEdited 호출 예정: index=${correctionIndex}, value="${newValue}"`);
    this.stateManager.setUserEdited(correctionIndex, newValue);
    
    // 디스플레이 업데이트
    Logger.debug(`🔧 updateDisplay 호출 예정`);
    this.updateDisplay();
    
    // 편집 완료 후 미리보기의 해당 단어로 포커스 이동
    this.focusPreviewWordAfterEdit(correctionIndex);
  }

  /**
   * 카드 편집을 취소합니다.
   */
  private cancelCardEdit(input: HTMLInputElement, correctionIndex: number): void {
    // 단순히 디스플레이 업데이트 (원래 상태로 복원)
    this.updateDisplay();
  }

  /**
   * 편집 완료 후 미리보기의 해당 단어로 포커스를 이동합니다.
   */
  private focusPreviewWordAfterEdit(correctionIndex: number): void {
    Logger.debug(`🎯 편집 완료 후 미리보기 포커스 이동: index=${correctionIndex}`);
    
    // DOM 업데이트 완료를 위해 짧은 지연
    activeWindow.setTimeout(() => {
      // 현재 페이지의 교정사항들을 가져옴
      const rawCorrections = this.getCurrentCorrections();
      const uniqueCorrections = this.removeDuplicateCorrections(rawCorrections);
      
      // 해당 correctionIndex를 가진 항목을 찾음
      const targetCorrectionIndex = uniqueCorrections.findIndex(
        pc => pc.originalIndex === correctionIndex
      );
      
      if (targetCorrectionIndex >= 0) {
        // 현재 포커스 인덱스를 해당 항목으로 설정
        this.currentFocusIndex = targetCorrectionIndex;
        Logger.debug(`🎯 포커스 인덱스 설정: ${targetCorrectionIndex} (correctionIndex: ${correctionIndex})`);
        
        // 포커스 하이라이트 업데이트
        this.updateFocusHighlight();
        
        // 미리보기에서 해당 단어를 화면 중앙으로 스크롤
        const previewElement = this.element.querySelector('.kga-preview-text');
        if (previewElement) {
          const targetSpan = previewElement.querySelector(`[data-correction-index="${correctionIndex}"]`);
          if (targetSpan) {
            targetSpan.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
              inline: 'nearest'
            });
            Logger.debug(`🎯 미리보기 스크롤 완료: 단어 "${targetSpan.textContent}"`);
            
            // 포커스된 요소에 일시적 하이라이트 효과
            targetSpan.classList.add('kga-edit-completion-highlight');
            activeWindow.setTimeout(() => {
              targetSpan.classList.remove('kga-edit-completion-highlight');
            }, 2000);
          } else {
            Logger.debug(`🎯 미리보기에서 해당 단어를 찾을 수 없음: index=${correctionIndex}`);
          }
        }
      } else {
        Logger.debug(`🎯 현재 페이지에서 해당 교정사항을 찾을 수 없음: index=${correctionIndex}`);
      }
    }, 100); // DOM 업데이트 대기
  }

  /**
   * 페이지네이션을 재계산합니다.
   */
  private recalculatePagination(): void {
    const errorSummary = this.element.querySelector('#errorSummary');
    const isErrorExpanded = errorSummary ? !errorSummary.classList.contains('collapsed') : false;
    const previewElement = this.element.querySelector('#resultPreview') as HTMLElement;
    
    this.charsPerPage = calculateDynamicCharsPerPage(previewElement, isErrorExpanded);
    const trimmedText = this.config.selectedText.trim();
    this.pageBreaks = splitTextIntoPages(trimmedText, this.charsPerPage);
    this.totalPreviewPages = this.pageBreaks.length;
    
    // 현재 페이지가 범위를 벗어나면 조정
    if (this.currentPreviewPage >= this.totalPreviewPages) {
      this.currentPreviewPage = Math.max(0, this.totalPreviewPages - 1);
    }
    Logger.debug(`Recalculated pagination: Chars per page: ${this.charsPerPage}, Total pages: ${this.totalPreviewPages}, Current page: ${this.currentPreviewPage}`);
  }

  /**
   * 디스플레이를 업데이트합니다.
   */
  private updateDisplay(): void {
    // 미리보기 업데이트
    const previewElement = this.element.querySelector('#resultPreview');
    if (previewElement) {
      this.updatePreviewContent(previewElement as HTMLElement);
    }

    // 오류 요약 업데이트
    const errorSummaryContent = this.element.querySelector('#errorSummaryContent') as HTMLElement;
    if (errorSummaryContent) {
      clearElement(errorSummaryContent);
      const errorSummaryDOM = this.generateErrorSummaryDOM();
      errorSummaryContent.appendChild(errorSummaryDOM);
    }

    // ⭐ NEW: 오류 상세 항목의 색상 상태 업데이트
    this.updateErrorDetailStyles();

    // 페이지네이션 컨트롤 업데이트
    this.updatePaginationControls();

    // 오류 개수 배지 업데이트 (오류 상태만 카운팅)
    const errorCountBadge = this.element.querySelector('#errorCountBadge');
    if (errorCountBadge) {
      errorCountBadge.textContent = this.getErrorStateCount().toString();
    }
  }

  /**
   * 오류 상세 항목의 스타일을 상태에 따라 업데이트합니다.
   */
  private updateErrorDetailStyles(): void {
    const errorItems = this.element.querySelectorAll('.kga-error-item-compact');
    
    errorItems.forEach((item, index) => {
      const correctionIndex = parseInt(item.getAttribute('data-correction-index') || '0');
      const originalText = item.querySelector('.kga-error-original-compact');
      
      if (originalText) {
        // 기존 상태 클래스 제거
        originalText.classList.remove('corrected', 'exception-processed', 'original-kept');
        
        // 현재 상태 확인
        const currentValue = this.stateManager.getValue(correctionIndex);
        const isException = this.stateManager.isExceptionState(correctionIndex);
        const isOriginalKept = this.stateManager.isOriginalKeptState(correctionIndex);
        const correction = this.config.corrections[correctionIndex];
        
        if (correction) {
          if (isException) {
            // 예외처리 상태 - 파란색
            originalText.classList.add('exception-processed');
          } else if (isOriginalKept) {
            // 원본 유지 상태 - 주황색
            originalText.classList.add('original-kept');
          } else if (currentValue !== correction.original) {
            // 수정된 상태 - 초록색
            originalText.classList.add('corrected');
          }
          // 그 외는 기본 빨간색 유지 (클래스 추가 안함)
        }
      }
    });
  }

  /**
   * 페이지네이션 컨트롤을 업데이트합니다.
   */
  private updatePaginationControls(): void {
    const paginationContainer = this.element.querySelector('#paginationContainer') as HTMLElement;
    const prevButton = this.element.querySelector('#prevPreviewPage') as HTMLButtonElement;
    const nextButton = this.element.querySelector('#nextPreviewPage') as HTMLButtonElement;
    const pageInfo = this.element.querySelector('#previewPageInfo');
    const pageCharsInfo = this.element.querySelector('#pageCharsInfo');

    // 페이지네이션 컨테이너 가시성 업데이트
    if (paginationContainer) {
      if (this.isLongText && this.totalPreviewPages > 1) {
        paginationContainer.className = 'kga-pagination-controls';
        // 페이지네이션이 표시되어야 하는데 버튼이 없으면 HTML을 다시 생성
        if (!prevButton || !nextButton) {
          // DOM API를 사용하여 페이지네이션 컨트롤 생성
          clearElement(paginationContainer);
          const paginationFragment = this.createPaginationControls();
          paginationContainer.appendChild(paginationFragment);
          
          // 새로 생성된 버튼에 이벤트 바인딩
          this.bindPaginationEvents();
        }
      } else {
        paginationContainer.className = 'kga-pagination-container-hidden';
      }
    }

    // 기존 버튼 업데이트 (새로 생성되었을 수도 있으므로 다시 쿼리)
    const updatedPrevButton = this.element.querySelector('#prevPreviewPage') as HTMLButtonElement;
    const updatedNextButton = this.element.querySelector('#nextPreviewPage') as HTMLButtonElement;
    const updatedPageInfo = this.element.querySelector('#previewPageInfo');
    const updatedPageCharsInfo = this.element.querySelector('#pageCharsInfo');

    if (updatedPrevButton) updatedPrevButton.disabled = this.currentPreviewPage === 0;
    if (updatedNextButton) updatedNextButton.disabled = this.currentPreviewPage === this.totalPreviewPages - 1;
    if (updatedPageInfo) updatedPageInfo.textContent = `${this.currentPreviewPage + 1} / ${this.totalPreviewPages}`;
    if (updatedPageCharsInfo) updatedPageCharsInfo.textContent = `${this.charsPerPage}자`;
  }

  /**
   * 교정사항을 적용합니다.
   */
  private async applyCorrections(): Promise<void> {
    Logger.log('🚀 applyCorrections 시작');
    
    // 현재 에디터 모드 확인
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const currentMode = markdownView?.getMode ? markdownView.getMode() : 'unknown';
    Logger.log(`📝 현재 에디터 모드: ${currentMode}`);
    
    const result = this.stateManager.applyCorrections(this.config.selectedText);
    
    Logger.log('🔄 에디터 적용 시작:', {
      originalTextLength: this.config.selectedText.length,
      finalTextLength: result.finalText.length,
      start: this.config.start,
      end: this.config.end,
      changed: this.config.selectedText !== result.finalText,
      exceptionWordsCount: result.exceptionWords.length,
      mode: currentMode
    });
    
    try {
      if (currentMode === 'preview') {
        // 읽기모드에서는 Vault.process() 사용 (공식 권장 방법)
        Logger.log('📖 읽기모드 감지 - Vault.process() 사용');
        
        const file = markdownView?.file;
        if (!file) {
          throw new Error('파일 정보를 가져올 수 없습니다.');
        }
        
        await this.app.vault.process(file, (content) => {
          // 전체 파일에서 선택된 영역 찾기 및 교체
          const lines = content.split('\n');
          let currentLine = 0;
          let currentCol = 0;
          
          // 시작 위치까지 찾기
          for (let i = 0; i < this.config.start.line; i++) {
            currentLine++;
          }
          
          // 텍스트 교체 로직
          const beforeStart = content.substring(0, this.getOffsetFromPosition(content, this.config.start));
          const afterEnd = content.substring(this.getOffsetFromPosition(content, this.config.end));
          
          return beforeStart + result.finalText + afterEnd;
        });
        
        Logger.log('✅ Vault.process() 성공적으로 완료됨');
        
      } else {
        // 원문모드에서는 기존 Editor API 사용
        this.config.editor.replaceRange(result.finalText, this.config.start, this.config.end);
        Logger.log('✅ editor.replaceRange 성공적으로 호출됨');
        
        // 적용 후 실제 텍스트 확인 (검증)
        const appliedText = this.config.editor.getRange(this.config.start, this.config.end);
        const actuallyApplied = appliedText === result.finalText;
        Logger.log(`🔍 적용 검증: 성공=${actuallyApplied}`, {
          expected: result.finalText.substring(0, 50) + (result.finalText.length > 50 ? '...' : ''),
          actual: appliedText.substring(0, 50) + (appliedText.length > 50 ? '...' : ''),
          lengthMatch: appliedText.length === result.finalText.length
        });
      }
      
    } catch (error) {
      Logger.error('❌ 텍스트 적용 실패:', error);
      new Notice('텍스트 적용 중 오류가 발생했습니다.');
      return;
    }
    
    // 예외 처리된 단어들이 있으면 콜백 호출
    if (result.exceptionWords.length > 0 && this.config.onExceptionWordsAdded) {
      this.config.onExceptionWordsAdded(result.exceptionWords);
    }
    
    this.close();
  }
  
  /**
   * 에디터 위치를 문자열 오프셋으로 변환합니다.
   */
  private getOffsetFromPosition(content: string, pos: EditorPosition): number {
    const lines = content.split('\n');
    let offset = 0;
    
    for (let i = 0; i < pos.line; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }
    
    offset += pos.ch;
    return offset;
  }

  /**
   * 팝업을 표시합니다.
   */
  show(): void {
    activeDocument.body.appendChild(this.element);
    
    // 모바일 감지를 위한 클래스 추가
    if (Platform.isMobile) {
      this.element.classList.add('mobile-popup');
      Logger.log('Mobile mode detected, added mobile-popup class');
    }
    
    // DOM에 추가된 후에 페이지네이션 계산 및 디스플레이 업데이트
    // requestAnimationFrame을 사용하여 브라우저가 레이아웃을 완료한 후 실행
    requestAnimationFrame(() => {
      Logger.log('DOM 추가 후 페이지네이션 재계산 시작');
      this.recalculatePagination();
      this.updateDisplay();
      Logger.log('DOM 추가 후 페이지네이션 재계산 완료');
    });
  }


  /**
   * AI 분석을 수행합니다.
   * ⭐ NEW: 형태소 정보와 함께 분석
   */
  private async performAIAnalysis(): Promise<void> {
    Logger.log('performAIAnalysis 호출됨:', {
      hasAiService: !!this.aiService,
      isAiAnalyzing: this.isAiAnalyzing,
      aiServiceAvailable: this.aiService?.isAvailable(),
      aiServiceSettings: this.aiService?.getSettings()
    });

    if (!this.aiService || this.isAiAnalyzing) {
      Logger.warn('AI 분석 중단: aiService 없음 또는 이미 분석 중');
      return;
    }

    if (!this.aiService.isAvailable()) {
      Logger.error('AI 서비스 사용 불가: 기능 비활성화 또는 API 키 없음');
      // 기존 오류 처리 방식과 동일하게 처리
      new Notice('❌ AI 기능이 비활성화되어 있거나 API 키가 설정되지 않았습니다. 플러그인 설정을 확인해주세요.', 5000);
      return;
    }

    try {
      Logger.debug('🔍 performAIAnalysis 메인 try 블록 진입');
      this.isAiAnalyzing = true;
      
      // UI 업데이트 (버튼 비활성화)
      const aiBtn = this.element.querySelector('#aiAnalyzeBtn') as HTMLButtonElement;
      if (aiBtn) {
        aiBtn.disabled = true;
        aiBtn.textContent = '🤖 분석 중...';
      }

      Logger.log('AI 분석 시작 중...');

      // ⭐ NEW: 형태소 분석 정보 사용 (orchestrator에서 전달받은 정보)
      Logger.debug('🔍 형태소 분석 정보 확인 중...');
      let morphemeInfo = this.config.morphemeInfo || null;
      
      if (morphemeInfo) {
        Logger.debug('✅ orchestrator에서 형태소 분석 정보 전달받음:', {
          hasMorphemeInfo: !!morphemeInfo,
          sentencesCount: morphemeInfo?.sentences?.length || 0,
          tokensCount: morphemeInfo?.sentences?.reduce((sum: number, s: any) => sum + (s.tokens?.length || 0), 0) || 0,
          firstFewTokens: morphemeInfo?.sentences?.[0]?.tokens?.slice(0, 3)?.map((t: any) => t.text?.content) || []
        });
      } else {
        Logger.warn('❌ 형태소 분석 정보 없음 - 패턴 매칭만 사용');
      }

      // AI 분석 요청 준비
      const currentStates = this.stateManager.getAllStates();
      const analysisRequest: AIAnalysisRequest = {
        originalText: this.config.selectedText,
        corrections: this.config.corrections,
        contextWindow: morphemeInfo ? 30 : 100, // ⭐ NEW: 형태소 정보 있으면 더 적은 컨텍스트 (토큰 절약)
        currentStates: currentStates, // 현재 상태 전달
        editor: this.config.editor, // ⭐ NEW: Editor 인스턴스 전달 (구조화된 컨텍스트 추출용)
        file: this.config.file, // ⭐ NEW: File 인스턴스 전달 (메타데이터 정보용)
        enhancedContext: true, // ⭐ NEW: 향상된 컨텍스트 추출 활성화
        onProgress: (current: number, total: number, status: string) => {
          // 배치 진행 상황을 버튼 텍스트로 표시
          const aiBtn = this.element.querySelector('#aiAnalyzeBtn') as HTMLButtonElement;
          if (aiBtn) {
            aiBtn.textContent = `🤖 ${status}`;
          }
        }
      };

      // 토큰 사용량 추정 및 경고 확인
      if (await this.checkTokenUsageWarning(analysisRequest) === false) {
        // 사용자가 취소한 경우
        return;
      }

      // ⭐ NEW: 형태소 정보와 함께 AI 분석 호출
      this.aiAnalysisResults = await this.aiService.analyzeCorrections(analysisRequest, morphemeInfo ?? undefined);
      
      Logger.log('AI 분석 완료:', this.aiAnalysisResults);

      // AI 분석 결과를 상태 관리자에 적용
      this.applyAIAnalysisResults();

      // UI 업데이트
      this.updateDisplay();

      // 성공 알림 (Obsidian Notice 시스템 사용 - 일관성 확보)
      new Notice(`🤖 AI가 ${this.aiAnalysisResults.length}개의 수정 제안을 분석했습니다.`, 3000);

    } catch (error) {
      Logger.error('AI 분석 실패:', error);
      
      // 오류 알림 (Obsidian Notice 시스템 사용 - 일관성 확보)
      new Notice(`❌ AI 분석 실패: ${error.message}`, 5000);
    } finally {
      this.isAiAnalyzing = false;
      
      // 버튼 상태 업데이트
      const aiBtn = this.element.querySelector('#aiAnalyzeBtn') as HTMLButtonElement;
      if (aiBtn) {
        await this.updateAiButtonState(aiBtn);
      }
    }
  }

  /**
   * 오류 요약 섹션의 DOM 구조를 생성합니다.
   */
  private generateErrorSummaryDOM(): HTMLElement {
    Logger.debug('========= generateErrorSummaryDOM 시작 =========');
    
    const container = createDiv();
    const rawCorrections = this.getCurrentCorrections();
    Logger.debug(`RAW corrections: ${rawCorrections.length}개`);
    
    const currentCorrections = this.removeDuplicateCorrections(rawCorrections);
    Logger.debug(`중복 제거 후 corrections: ${currentCorrections.length}개`);
    
    if (currentCorrections.length === 0) {
      // 오류가 없는 경우의 플레이스홀더
      const placeholder = createDiv();
      placeholder.className = 'kga-error-placeholder';
      
      const icon = createDiv();
      icon.className = 'kga-placeholder-icon';
      icon.textContent = '✓';
      placeholder.appendChild(icon);
      
      const text = createDiv();
      text.className = 'kga-placeholder-text';
      text.textContent = '이 페이지에는 발견된 오류가 없습니다';
      placeholder.appendChild(text);
      
      const subtext = createDiv();
      subtext.className = 'kga-placeholder-subtext';
      subtext.textContent = '다른 페이지에서 오류를 확인하세요';
      placeholder.appendChild(subtext);
      
      container.appendChild(placeholder);
      Logger.debug('오류 없음 - 플레이스홀더 생성');
      Logger.debug('========= generateErrorSummaryDOM 종료 (오류 없음) =========');
      return container;
    }

    // 중복 제거는 이미 완료되었으므로 바로 사용 (중복 제거 중복 호출 방지)
    Logger.debug('DOM 생성 시작 - 중복 제거 완료된 corrections 사용');
    currentCorrections.forEach((pageCorrection, index) => {
      const actualIndex = pageCorrection.originalIndex;
      const correction = pageCorrection.correction;
      const isOriginalKept = this.stateManager.isOriginalKeptState(actualIndex);
      const suggestions = correction.corrected.slice(0, 3);
      
      Logger.debug(`[${index}] DOM 생성 중: "${correction.original}" (고유ID: ${pageCorrection.uniqueId}, 실제인덱스: ${actualIndex})`);
      
      // 에러 아이템 컨테이너
      const errorItem = createDiv();
      errorItem.className = `kga-error-item-compact ${isOriginalKept ? 'spell-original-kept' : ''}`;
      errorItem.setAttribute('data-correction-index', actualIndex.toString());
      errorItem.setAttribute('data-unique-id', pageCorrection.uniqueId);
      
      Logger.debug(`[${index}] DOM 속성 설정: data-correction-index="${actualIndex}", data-unique-id="${pageCorrection.uniqueId}"`);
      
      // 에러 행 (원본 + 제안들)
      const errorRow = createDiv();
      errorRow.className = 'kga-error-row';
      
      // 원본 텍스트 (사용자 편집값 또는 현재 상태값 표시)
      const errorOriginal = createDiv();
      const isUserEdited = this.stateManager.isUserEditedState(actualIndex);
      const stateClass = isUserEdited ? 'user-edited' : 
                       isOriginalKept ? 'original-kept' : 
                       this.stateManager.isExceptionState(actualIndex) ? 'exception-processed' :
                       this.stateManager.getValue(actualIndex) !== correction.original ? 'corrected' : '';
      
      errorOriginal.className = `kga-error-original-compact ${stateClass}`;
      errorOriginal.setAttribute('data-correction-index', actualIndex.toString());
      errorOriginal.textContent = this.stateManager.getValue(actualIndex); // 현재 상태값 (편집값 포함)
      errorRow.appendChild(errorOriginal);
      
      // 제안들 컨테이너
      const suggestionsContainer = createDiv();
      suggestionsContainer.className = 'kga-error-suggestions-compact';
      
      // 제안 스팬들 생성
      suggestions.forEach(suggestion => {
        const suggestionSpan = createSpan();
        suggestionSpan.className = `kga-suggestion-compact ${this.stateManager.isSelected(actualIndex, suggestion) ? 'selected' : ''}`;
        suggestionSpan.setAttribute('data-value', suggestion);
        suggestionSpan.setAttribute('data-correction', actualIndex.toString());
        if (isOriginalKept) {
          suggestionSpan.setAttribute('disabled', '');
        }
        suggestionSpan.textContent = suggestion;
        suggestionsContainer.appendChild(suggestionSpan);
      });
      
      // 예외처리 스팬
      const keepOriginalSpan = createSpan();
      keepOriginalSpan.className = `kga-suggestion-compact ${this.stateManager.isSelected(actualIndex, correction.original) ? 'selected' : ''} kga-keep-original`;
      keepOriginalSpan.setAttribute('data-value', correction.original);
      keepOriginalSpan.setAttribute('data-correction', actualIndex.toString());
      if (isOriginalKept) {
        keepOriginalSpan.setAttribute('disabled', '');
      }
      keepOriginalSpan.textContent = '예외처리';
      suggestionsContainer.appendChild(keepOriginalSpan);
      
      errorRow.appendChild(suggestionsContainer);
      errorItem.appendChild(errorRow);
      
      // 도움말 텍스트
      const errorHelp = createDiv();
      errorHelp.className = 'kga-error-help-compact';
      errorHelp.textContent = correction.help;
      errorItem.appendChild(errorHelp);
      
      // AI 분석 결과 (조건부)
      const aiResult = this.aiAnalysisResults.find(result => result.correctionIndex === actualIndex);
      if (aiResult || isOriginalKept) {
        const aiAnalysis = createDiv();
        aiAnalysis.className = 'kga-ai-analysis-result';
        
        if (aiResult) {
          const aiConfidence = createDiv();
          aiConfidence.className = 'kga-ai-confidence';
          aiConfidence.textContent = '🤖 신뢰도: ';
          
          const confidenceScore = createSpan();
          confidenceScore.className = 'kga-confidence-score';
          confidenceScore.textContent = `${aiResult.confidence}%`;
          aiConfidence.appendChild(confidenceScore);
          aiAnalysis.appendChild(aiConfidence);
          
          const aiReasoning = createDiv();
          aiReasoning.className = 'kga-ai-reasoning';
          aiReasoning.textContent = aiResult.reasoning;
          aiAnalysis.appendChild(aiReasoning);
        } else if (isOriginalKept) {
          const aiReasoning = createDiv();
          aiReasoning.className = 'kga-ai-reasoning';
          aiReasoning.textContent = '사용자가 직접 선택했거나, 예외 단어로 등록된 항목입니다.';
          aiAnalysis.appendChild(aiReasoning);
        }
        
        errorItem.appendChild(aiAnalysis);
      }
      
      container.appendChild(errorItem);
      Logger.debug(`[${index}] DOM 생성 완료: "${correction.original}"`);
    });
    
    Logger.debug(`DOM 생성 완료: 총 ${currentCorrections.length}개 오류 항목`);
    Logger.debug('========= generateErrorSummaryDOM 종료 =========');
    
    return container;
  }

  /**
   * 페이지네이션 컨트롤의 DOM 구조를 생성합니다.
   */
  private createPaginationControls(): DocumentFragment {
    const fragment = createFragment();

    const prevButton = createEl('button');
    prevButton.className = 'kga-pagination-btn';
    prevButton.id = 'prevPreviewPage';
    prevButton.textContent = '이전';
    if (this.currentPreviewPage === 0) {
      prevButton.disabled = true;
    }
    fragment.appendChild(prevButton);

    const pageInfo = createSpan();
    pageInfo.className = 'kga-page-info';
    pageInfo.id = 'previewPageInfo';
    pageInfo.textContent = `${this.currentPreviewPage + 1} / ${this.totalPreviewPages}`;
    fragment.appendChild(pageInfo);

    const nextButton = createEl('button');
    nextButton.className = 'kga-pagination-btn';
    nextButton.id = 'nextPreviewPage';
    nextButton.textContent = '다음';
    if (this.currentPreviewPage === this.totalPreviewPages - 1) {
      nextButton.disabled = true;
    }
    fragment.appendChild(nextButton);

    const charsInfo = createSpan();
    charsInfo.className = 'kga-page-chars-info';
    charsInfo.id = 'pageCharsInfo';
    charsInfo.textContent = `${this.charsPerPage}자`;
    fragment.appendChild(charsInfo);

    return fragment;
  }

  /**
   * 토큰 경고 모달의 DOM 구조를 생성합니다.
   * ⭐ 형태소 최적화 정보 포함
   */
  private createTokenWarningModal(tokenUsage: any, isOverMaxTokens: boolean, maxTokens: number): HTMLElement {
    const content = createDiv();
    content.className = 'kga-token-warning-content';

    // 헤더 섹션
    const header = content.appendChild(createDiv());
    header.className = 'kga-token-warning-header';
    
    const headerIcon = header.appendChild(createDiv());
    headerIcon.className = 'kga-token-warning-header-icon';
    headerIcon.textContent = '⚡';
    
    const headerInfo = header.appendChild(createDiv());
    
    const title = headerInfo.appendChild(createEl('h3'));
    title.className = 'kga-token-warning-title';
    title.textContent = isOverMaxTokens ? '토큰 사용량 확인' : '토큰 사용량 안내';
    
    const description = headerInfo.appendChild(createEl('p'));
    description.className = 'kga-token-warning-description';
    description.textContent = isOverMaxTokens ? '설정된 한계를 초과했습니다' : '예상 사용량이 높습니다';

    // 토큰 사용량 카드
    const details = content.appendChild(createDiv());
    details.className = 'kga-token-warning-details';
    
    const stats = details.appendChild(createDiv());
    stats.className = 'kga-token-warning-stats';
    
    // 총 토큰 통계
    const totalTokenItem = stats.appendChild(createDiv());
    totalTokenItem.className = 'kga-token-stat-item';
    
    const totalTokenNumber = totalTokenItem.appendChild(createDiv());
    totalTokenNumber.className = 'kga-token-stat-number';
    totalTokenNumber.textContent = tokenUsage.totalEstimated.toLocaleString();
    
    const totalTokenLabel = totalTokenItem.appendChild(createDiv());
    totalTokenLabel.className = 'kga-token-stat-label';
    totalTokenLabel.textContent = '총 토큰';
    
    // 예상 비용 통계
    const costItem = stats.appendChild(createDiv());
    costItem.className = 'kga-token-stat-item';
    
    const costNumber = costItem.appendChild(createDiv());
    costNumber.className = 'kga-token-stat-number kga-orange';
    costNumber.textContent = tokenUsage.estimatedCost;
    
    const costLabel = costItem.appendChild(createDiv());
    costLabel.className = 'kga-token-stat-label';
    costLabel.textContent = '예상 비용';
    
    // 형태소 최적화는 백그라운드에서 동작하므로 UI에 표시하지 않음
    
    // 사용량 세부사항
    const recommendation = details.appendChild(createDiv());
    recommendation.className = 'kga-token-warning-recommendation';
    
    const recHeader = recommendation.appendChild(createDiv());
    recHeader.className = 'kga-token-warning-recommendation-header';
    
    const recContent = recHeader.appendChild(createDiv());
    recContent.className = 'kga-token-warning-recommendation-content';
    
    const recTitle = recContent.appendChild(createDiv());
    recTitle.className = 'kga-token-warning-recommendation-title';
    recTitle.textContent = '사용량 세부사항';
    
    const recText = recContent.appendChild(createDiv());
    recText.className = 'kga-token-warning-recommendation-text';
    
    // 깔끔한 토큰 정보만 표시 (최적화는 백그라운드 처리)
    const detailText = `입력: ${tokenUsage.inputTokens.toLocaleString()} • 출력: ${tokenUsage.estimatedOutputTokens.toLocaleString()}`;
    recText.textContent = detailText;

    // 토큰 초과 알림 (조건부)
    if (isOverMaxTokens) {
      const overLimit = content.appendChild(createDiv());
      overLimit.className = 'kga-token-warning-over-limit';
      
      const overLimitContent = overLimit.appendChild(createDiv());
      overLimitContent.className = 'kga-token-warning-over-limit-content';
      
      const overLimitIcon = overLimitContent.appendChild(createDiv());
      overLimitIcon.className = 'kga-token-warning-over-limit-icon';
      overLimitIcon.textContent = '!';
      
      const overLimitText = overLimitContent.appendChild(createDiv());
      overLimitText.className = 'kga-token-warning-over-limit-text';
      
      const overLimitTitle = overLimitText.appendChild(createDiv());
      overLimitTitle.className = 'kga-token-warning-over-limit-title';
      overLimitTitle.textContent = '설정된 최대 토큰을 초과했습니다';
      
      const overLimitDesc = overLimitText.appendChild(createDiv());
      overLimitDesc.className = 'kga-token-warning-over-limit-description';
      overLimitDesc.textContent = `현재 설정: ${maxTokens.toLocaleString()} 토큰 → 초과량: ${(tokenUsage.totalEstimated - maxTokens).toLocaleString()} 토큰`;
    }

    // 액션 버튼들
    const actions = content.appendChild(createDiv());
    actions.className = 'kga-token-warning-actions';
    
    const cancelBtn = actions.appendChild(createEl('button'));
    cancelBtn.id = 'token-warning-cancel';
    cancelBtn.className = 'kga-token-warning-btn kga-token-warning-btn-cancel';
    cancelBtn.textContent = '취소';
    
    if (isOverMaxTokens) {
      const updateSettingsBtn = actions.appendChild(createEl('button'));
      updateSettingsBtn.id = 'token-warning-update-settings';
      updateSettingsBtn.className = 'kga-token-warning-btn kga-token-warning-btn-settings';
      updateSettingsBtn.textContent = '설정 업데이트';
    }
    
    const proceedBtn = actions.appendChild(createEl('button'));
    proceedBtn.id = 'token-warning-proceed';
    proceedBtn.className = 'kga-token-warning-btn kga-token-warning-btn-proceed';
    proceedBtn.textContent = isOverMaxTokens ? '이번만 진행' : '계속 진행';

    // 키보드 단축키 안내
    const keyboardHint = content.appendChild(createDiv());
    keyboardHint.className = 'kga-token-warning-keyboard-hint';
    keyboardHint.textContent = '💡 키보드 단축키: enter(진행), esc(취소)';

    return content;
  }

  /**
   * 형태소 최적화를 고려한 토큰 사용량을 추정합니다.
   * ⭐ NEW: 실제 사용될 프롬프트 기반 정확한 추정
   */
  private async estimateTokenUsageWithMorphemes(request: AIAnalysisRequest): Promise<{
    inputTokens: number;
    estimatedOutputTokens: number;
    totalEstimated: number;
    estimatedCost: string;
    morphemeOptimized: boolean;
  }> {
    try {
      // 🔧 효율성을 위해 토큰 경고에서는 형태소 분석 호출하지 않음
      // 대신 교정 개수를 기반으로 최적화 효과 추정
      const hasMultipleCorrections = request.corrections.length > 1;
      const morphemeOptimized = hasMultipleCorrections; // 복수 교정 시 최적화 효과 예상
      
      Logger.debug('토큰 경고용 형태소 최적화 추정:', {
        correctionsCount: request.corrections.length,
        estimatedOptimization: morphemeOptimized,
        reason: morphemeOptimized ? '복수 교정으로 컨텍스트 축소 예상' : '단일 교정으로 최적화 불필요'
      });
      
      // 형태소 정보 고려한 컨텍스트 윈도우 적용
      const adjustedRequest = {
        ...request,
        contextWindow: morphemeOptimized ? 30 : request.contextWindow || 100
      };
      
      // 기본 토큰 추정
      const baseEstimation = this.aiService?.estimateTokenUsage(adjustedRequest) || {
        inputTokens: 0,
        estimatedOutputTokens: 0,
        totalEstimated: 0,
        estimatedCost: '$0.00'
      };
      
      // 형태소 정보 토큰 추가 (간소화된 형태)
      const morphemeTokens = morphemeOptimized ? 50 : 0; // 형태소 분석 메타데이터
      
      const finalEstimation = {
        inputTokens: baseEstimation.inputTokens + morphemeTokens,
        estimatedOutputTokens: baseEstimation.estimatedOutputTokens,
        totalEstimated: baseEstimation.totalEstimated + morphemeTokens,
        estimatedCost: baseEstimation.estimatedCost,
        morphemeOptimized
      };
      
      Logger.debug('형태소 최적화 반영 토큰 추정:', {
        before: baseEstimation.totalEstimated,
        after: finalEstimation.totalEstimated,
        contextReduction: morphemeOptimized ? (100 - 30) : 0, // 70토큰 절약
        morphemeTokens,
        netChange: morphemeOptimized ? (morphemeTokens - 70) : 0, // 순 변화량
        optimized: morphemeOptimized
      });
      
      return finalEstimation;
      
    } catch (error) {
      Logger.error('토큰 추정 실패, 기본값 사용:', error);
      Logger.error('에러 스택:', error?.stack);
      
      // 실패 시 기본 추정 사용
      const fallbackEstimation = this.aiService?.estimateTokenUsage(request) || {
        inputTokens: 0,
        estimatedOutputTokens: 0,
        totalEstimated: 0,
        estimatedCost: '$0.00'
      };
      
      Logger.warn('폴백 토큰 추정 사용:', fallbackEstimation);
      
      return {
        ...fallbackEstimation,
        morphemeOptimized: false
      };
    }
  }

  /**
   * 토큰 사용량 경고를 확인하고 사용자 확인을 받습니다.
   */
  private async checkTokenUsageWarning(request: AIAnalysisRequest): Promise<boolean> {
    // AI 서비스에서 설정 확인
    const aiSettings = this.aiService?.getProviderInfo();
    if (!this.aiService || !aiSettings?.available) {
      return true; // AI 서비스 없으면 그냥 진행
    }

    // AI 서비스에서 실제 설정 가져오기
    const aiServiceSettings = this.aiService.getSettings();
    const showWarning = aiServiceSettings.showTokenWarning;
    const threshold = aiServiceSettings.tokenWarningThreshold;
    const maxTokens = aiServiceSettings.maxTokens;
    
    if (!showWarning) {
      return true; // 경고 비활성화된 경우
    }

    // ⭐ 형태소 정보를 고려한 토큰 사용량 추정
    const tokenUsage = await this.estimateTokenUsageWithMorphemes(request);
    const isOverMaxTokens = tokenUsage.totalEstimated > maxTokens;
    
    // 디버깅: 토큰 사용량 확인
    Logger.debug('토큰 경고 모달 토큰 사용량:', {
      total: tokenUsage.totalEstimated,
      input: tokenUsage.inputTokens,
      output: tokenUsage.estimatedOutputTokens,
      cost: tokenUsage.estimatedCost,
      morphemeOptimized: tokenUsage.morphemeOptimized,
      threshold,
      maxTokens
    });
    
    if (tokenUsage.totalEstimated < threshold && !isOverMaxTokens) {
      return true; // 임계값 미만이고 최대 토큰 이내면 바로 진행
    }

    // 확인 모달 표시
    return new Promise((resolve) => {
      const modal = createDiv();
      modal.className = 'kga-token-warning-modal';

      // DOM API를 사용하여 모달 내용 생성
      const modalContent = this.createTokenWarningModal(tokenUsage, isOverMaxTokens, maxTokens);
      modal.appendChild(modalContent);

      activeDocument.body.appendChild(modal);
      
      // 모달에 포커스 설정 (강화된 접근법)
      modal.setAttribute('tabindex', '-1');
      modal.classList.add(NO_OUTLINE_CLASS);
      
      // 강제로 포커스 설정 (지연 처리)
      activeWindow.setTimeout(() => {
        modal.focus();
        Logger.debug('토큰 경고 모달: 포커스 설정 완료');
      }, 10);

      // 이벤트 처리
      let handleResponse = (action: 'cancel' | 'proceed' | 'updateSettings') => {
        modal.remove();
        if (action === 'cancel') {
          resolve(false);
        } else if (action === 'updateSettings') {
          // 100단위로 올림하여 설정 업데이트
          const recommendedTokens = Math.ceil(tokenUsage.totalEstimated / 100) * 100;
          this.updateMaxTokenSetting(recommendedTokens);
          resolve(true);
        } else {
          resolve(true);
        }
      };

      // 키보드 이벤트 처리 (모든 키 이벤트 차단)
      const handleKeyboard = (e: KeyboardEvent) => {
        Logger.debug(`토큰 경고 모달: 키 이벤트 감지 - ${e.key} (코드: ${e.code})`);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        if (e.key === 'Enter') {
          Logger.debug('토큰 경고 모달: Enter키 감지 - 진행');
          handleResponse('proceed');
        } else if (e.key === 'Escape') {
          Logger.debug('토큰 경고 모달: Escape키 감지 - 취소');
          handleResponse('cancel');
        }
        // 다른 모든 키 이벤트는 무시하고 전파 차단
      };

      // 여러 레벨에서 키보드 이벤트 캡처
      modal.addEventListener('keydown', handleKeyboard, { capture: true });
      modal.addEventListener('keyup', handleKeyboard, { capture: true });
      
      // 글로벌 키보드 이벤트도 차단 (백그라운드 이벤트 방지)
      const globalKeyHandler = (e: KeyboardEvent) => {
        if (activeDocument.body.contains(modal)) {
          Logger.debug(`토큰 경고 모달: 글로벌 키 이벤트 차단 - ${e.key}`);
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          // 글로벌 레벨에서도 키 처리
          if (e.key === 'Enter') {
            Logger.debug('토큰 경고 모달: 글로벌 Enter키 감지 - 진행');
            handleResponse('proceed');
          } else if (e.key === 'Escape') {
            Logger.debug('토큰 경고 모달: 글로벌 Escape키 감지 - 취소');
            handleResponse('cancel');
          }
        }
      };
      
      document.addEventListener('keydown', globalKeyHandler, { capture: true });
      document.addEventListener('keyup', globalKeyHandler, { capture: true });
      window.addEventListener('keydown', globalKeyHandler, { capture: true });
      
      // 모달 제거 시 모든 이벤트 핸들러 제거
      const originalHandleResponse = handleResponse;
      handleResponse = (action: 'cancel' | 'proceed' | 'updateSettings') => {
        // 모든 이벤트 리스너 제거
        document.removeEventListener('keydown', globalKeyHandler, { capture: true });
        document.removeEventListener('keyup', globalKeyHandler, { capture: true });
        window.removeEventListener('keydown', globalKeyHandler, { capture: true });
        
        Logger.debug('토큰 경고 모달: 모든 이벤트 리스너 제거 완료');
        originalHandleResponse(action);
      };

      modal.querySelector('#token-warning-cancel')?.addEventListener('click', () => handleResponse('cancel'));
      modal.querySelector('#token-warning-proceed')?.addEventListener('click', () => handleResponse('proceed'));
      modal.querySelector('#token-warning-update-settings')?.addEventListener('click', () => handleResponse('updateSettings'));
      
      // 오버레이 클릭 시 취소
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          handleResponse('cancel');
        }
      });
    });
  }

  /**
   * AI 분석 결과를 상태 관리자에 적용합니다.
   */
  private applyAIAnalysisResults(): void {
    for (const result of this.aiAnalysisResults) {
      this.stateManager.setState(
        result.correctionIndex,
        result.selectedValue,
        result.isExceptionProcessed,
        result.isOriginalKept
      );
    }
  }

  /**
   * 최대 토큰 설정을 업데이트합니다.
   */
  private updateMaxTokenSetting(newMaxTokens: number): void {
    if (this.onSettingsUpdate) {
      this.onSettingsUpdate(newMaxTokens);
      Logger.debug(`최대 토큰을 ${newMaxTokens}으로 업데이트했습니다.`);
      
      // 성공 알림 표시
      new Notice(`⚙️ 최대 토큰이 ${newMaxTokens.toLocaleString()}으로 업데이트되었습니다.`, 3000);
    } else {
      Logger.warn('설정 업데이트 콜백이 없습니다.');
    }
  }

  /**
   * 모든 오류를 일괄로 순환시킵니다.
   */
  private batchCycleCorrections(direction: 'next' | 'prev'): void {
    const rawCorrections = this.getCurrentCorrections();
    const uniqueCorrections = this.removeDuplicateCorrections(rawCorrections);
    if (uniqueCorrections.length === 0) return;

    let changedCount = 0;
    
    uniqueCorrections.forEach((pageCorrection) => {
      const actualIndex = pageCorrection.originalIndex;
      
      if (actualIndex !== -1) {
        this.cycleCorrectionState(actualIndex, direction);
        changedCount++;
      }
    });

    // 알림 표시
    new Notice(`✨ ${changedCount}개 오류가 일괄 ${direction === 'next' ? '다음' : '이전'} 제안으로 변경되었습니다.`, 2000);

    Logger.log(`일괄 변경 완료: ${direction}, ${changedCount}개 항목`);
  }

  /**
   * 키보드 네비게이션 힌트를 표시합니다.
   */
  private showKeyboardHint(): void {
    // 모바일에서는 표시하지 않음
    if (Platform.isMobile) {
      Logger.debug('모바일 환경에서는 키보드 힌트를 표시하지 않음');
      return;
    }

    const hint = createDiv();
    hint.className = 'kga-keyboard-navigation-hint';
    hint.id = 'keyboard-hint';
    
    // 헤더 (제목 + 닫기 버튼)
    const header = createDiv();
    header.className = 'kga-hint-header';
    
    const title = createDiv();
    title.className = 'kga-hint-title';
    title.textContent = '⌨️ 키보드 단축키';
    header.appendChild(title);
    
    const closeBtn = createEl('button');
    closeBtn.className = 'kga-hint-close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = '단축키 가이드 닫기';
    closeBtn.addEventListener('click', () => {
      hint.classList.add(FADE_OUT_CLASS);
      activeWindow.setTimeout(() => hint.remove(), 200);
    });
    header.appendChild(closeBtn);
    
    hint.appendChild(header);
    
    const shortcuts = [
      { key: 'Tab', desc: '다음 오류' },
      { key: '←/→', desc: '수정 제안 순환' },
      { key: 'Enter', desc: '적용' },
      { key: '⌘Enter', desc: '모든 변경사항 저장' },
      { key: '⌘E', desc: '편집 모드' },
      { key: '⇧⌘A', desc: 'AI 분석' },
      { key: '⌘⇧E', desc: '오류 상세 토글' },
      { key: '⌘⇧←/→', desc: '일괄 변경' },
      { key: '↑/↓', desc: '페이지 이동' },
      { key: 'Esc', desc: '닫기' }
    ];
    
    shortcuts.forEach(shortcut => {
      const item = createDiv();
      item.className = 'kga-hint-item';
      
      const key = createSpan();
      key.className = 'kga-hint-key';
      key.textContent = shortcut.key;
      
      const desc = createSpan();
      desc.className = 'kga-hint-desc';
      desc.textContent = shortcut.desc;
      
      item.appendChild(key);
      item.appendChild(desc);
      hint.appendChild(item);
    });
    
    activeDocument.body.appendChild(hint);
    
    Logger.log('키보드 네비게이션 힌트 표시됨 (데스크톱 전용)');
  }

  /**
   * 오류 상세부분 펼침/접힘을 토글합니다.
   */
  private toggleErrorSummary(): void {
    Logger.log('오류 상세부분 토글 트리거됨 (키보드 단축키: ⌘⇧E)');
    const errorSummary = activeDocument.getElementById('errorSummary');
    if (!errorSummary) {
      Logger.warn('errorSummary 요소를 찾을 수 없습니다.');
      return;
    }

    const isCurrentlyCollapsed = errorSummary.classList.contains('collapsed');
    
    if (isCurrentlyCollapsed) {
      errorSummary.classList.remove('collapsed');
      Logger.log('오류 상세부분 폼침');
    } else {
      errorSummary.classList.add('collapsed');
      Logger.log('오류 상세부분 접힘');
    }

    // 동적 페이지네이션 재계산
    this.recalculatePagination();
    this.updateDisplay();
  }

  /**
   * 현재 포커스된 오류로 스크롤합니다.
   * @param forceOpen 강제로 상세부분을 펼칠지 여부 (기본값: false)
   */
  private scrollToFocusedError(forceOpen: boolean = false): void {
    const rawCorrections = this.getCurrentCorrections();
    const uniqueCorrections = this.removeDuplicateCorrections(rawCorrections);
    if (uniqueCorrections.length === 0 || this.currentFocusIndex < 0) return;

    const pageCorrection = uniqueCorrections[this.currentFocusIndex];
    if (!pageCorrection) return;

    const actualIndex = pageCorrection.originalIndex;

    // 오류 상세부분에서 해당 항목 찾기
    const errorSummary = activeDocument.getElementById('errorSummary');
    if (!errorSummary) return;

    const errorItems = errorSummary.querySelectorAll('.kga-error-item-compact');
    let targetItem: HTMLElement | null = null;

    // 실제 인덱스와 매칭되는 항목 찾기
    errorItems.forEach((item, index) => {
      const itemPageCorrection = uniqueCorrections[index];
      if (itemPageCorrection && itemPageCorrection.originalIndex === actualIndex) {
        targetItem = item as HTMLElement;
      }
    });

    if (targetItem) {
      const isCollapsed = errorSummary.classList.contains('collapsed');
      
      // 상세부분이 접혀있고 강제로 펼치도록 설정된 경우에만 펼치기
      if (isCollapsed && forceOpen) {
        errorSummary.classList.remove('collapsed');
        this.recalculatePagination();
        this.updateDisplay();
        
        // 레이아웃 변경 후 스크롤
        activeWindow.setTimeout(() => {
          (targetItem as HTMLElement).scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center',
            inline: 'nearest'
          });
          this.highlightFocusedError(targetItem as HTMLElement);
        }, 100);
      } else if (!isCollapsed) {
        // 상세부분이 펼쳐져 있을 때만 스크롤
        (targetItem as HTMLElement).scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'nearest'
        });
        this.highlightFocusedError(targetItem as HTMLElement);
      }

      Logger.debug(`오류 상세부분 자동스크롤: ${pageCorrection.correction.original} (forceOpen: ${forceOpen}, collapsed: ${isCollapsed})`);
    }
  }

  /**
   * 포커스된 오류 카드를 하이라이트합니다.
   */
  private highlightFocusedError(targetItem: HTMLElement): void {
    // 기존 하이라이트 제거
    const existingHighlight = activeDocument.querySelector('.kga-error-item-highlighted');
    if (existingHighlight) {
      existingHighlight.classList.remove('kga-error-item-highlighted');
    }

    // 새로운 하이라이트 추가
    targetItem.classList.add('kga-error-item-highlighted');
    
    // 2초 후 하이라이트 제거
    activeWindow.setTimeout(() => {
      targetItem.classList.remove('kga-error-item-highlighted');
    }, 2000);
    
    Logger.log('오류 카드 하이라이트 애니메이션 적용');
  }

  /**
   * 현재 포커스된 오류에 대해 편집 모드로 진입합니다.
   */
  private enterEditModeForFocusedError(): void {
    Logger.log(`⌨️ enterEditModeForFocusedError 호출됨: currentFocusIndex=${this.currentFocusIndex}`);
    
    // 현재 교정사항들을 새로 가져와서 최신 상태 보장
    const rawCorrections = this.getCurrentCorrections();
    const uniqueCorrections = this.removeDuplicateCorrections(rawCorrections);
    
    // currentCorrections도 업데이트 (포커스 시스템과 동기화)
    this.currentCorrections = uniqueCorrections;
    
    Logger.debug(`⌨️ 교정사항 개수: raw=${rawCorrections.length}, unique=${uniqueCorrections.length}`);
    Logger.debug(`⌨️ 포커스 인덱스 유효성: currentFocusIndex=${this.currentFocusIndex}, 범위=[0, ${uniqueCorrections.length - 1}]`);
    
    // 포커스 인덱스가 유효하지 않으면 초기화
    if (this.currentFocusIndex < 0 || this.currentFocusIndex >= uniqueCorrections.length) {
      if (uniqueCorrections.length > 0) {
        this.currentFocusIndex = 0;
        Logger.debug(`⌨️ 포커스 인덱스 초기화: ${this.currentFocusIndex}`);
      } else {
        Logger.warn('🚫 편집 가능한 오류가 없음');
        return;
      }
    }

    const pageCorrection = uniqueCorrections[this.currentFocusIndex];
    const actualIndex = pageCorrection.originalIndex;
    
    Logger.debug(`⌨️ Cmd+E키로 편집 모드 진입: index=${actualIndex}, text="${pageCorrection.correction.original}"`);

    // 오류 상세 영역이 접혀있다면 펼치기
    const errorSummary = this.element.querySelector('#errorSummary');
    const wasCollapsed = errorSummary && errorSummary.classList.contains('collapsed');
    
    if (wasCollapsed) {
      errorSummary!.classList.remove('collapsed');
      Logger.debug('⌨️ 오류 상세 영역 자동 펼침');
      this.updateDisplay(); // 페이지네이션 재계산
    }

    // DOM 업데이트 후 편집 모드 진입
    activeWindow.setTimeout(() => {
      const errorCard = this.element.querySelector(`[data-correction-index="${actualIndex}"] .kga-error-original-compact`);
      if (errorCard) {
        Logger.debug(`⌨️ 편집 모드 진입 - 오류 상세 카드 찾음: index=${actualIndex}`);
        
        // 해당 카드로 스크롤
        errorCard.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
        Logger.debug('⌨️ 오토스크롤 수행');
        
        // 스크롤 완료 후 편집 모드 진입
        activeWindow.setTimeout(() => {
          this.enterCardEditMode(errorCard as HTMLElement, actualIndex);
        }, 300); // 스크롤 애니메이션 완료 대기
        
      } else {
        Logger.debug(`⌨️ 오류 상세 카드를 찾을 수 없음: index=${actualIndex}`);
        Logger.debug(`⌨️ 재시도: 모든 .kga-error-original-compact 요소 확인`);
        
        // 디버깅을 위해 모든 카드 확인
        const allCards = this.element.querySelectorAll('.kga-error-original-compact');
        Logger.debug(`⌨️ 발견된 카드 개수: ${allCards.length}`);
        allCards.forEach((card, index) => {
          const cardIndex = card.parentElement?.dataset?.correctionIndex;
          Logger.debug(`⌨️ 카드 ${index}: correctionIndex=${cardIndex}`);
        });
      }
    }, wasCollapsed ? 100 : 0); // 펼쳐졌다면 DOM 업데이트 대기
  }

  /**
   * 팝업을 닫습니다.
   */
  close(): void {
    // 키보드 네비게이션 비활성화
    this.app.keymap.popScope(this.keyboardScope);
    
    // 키보드 힌트 제거
    const hint = activeDocument.getElementById('keyboard-hint');
    if (hint) {
      hint.remove();
    }
    
    activeDocument.body.classList.remove('spell-popup-open');
    this.destroy();
  }

  /**
   * 오류 요약 요소를 생성합니다.
   */
  private createErrorSummaryElement(container: HTMLElement): void {
    // Clear existing content
    container.empty();
    
    const rawCorrections = this.getCurrentCorrections();
    const currentCorrections = this.removeDuplicateCorrections(rawCorrections);
    
    if (currentCorrections.length === 0) {
      const placeholder = container.createDiv('kga-error-placeholder');
      placeholder.textContent = '현재 페이지에 오류가 없습니다.';
      return;
    }

    currentCorrections.forEach((pageCorrection, index) => {
      const actualIndex = pageCorrection.originalIndex;
      if (actualIndex === undefined) return;

      const errorCard = container.createDiv('kga-error-card-compact');
      errorCard.dataset.correctionIndex = actualIndex.toString();
      
      // Error header
      const errorHeader = errorCard.createDiv('error-header');
      const errorNumber = errorHeader.createSpan('error-number');
      errorNumber.textContent = (index + 1).toString();
      
      const errorOriginal = errorHeader.createSpan('kga-error-original-compact');
      errorOriginal.textContent = pageCorrection.correction.original;
      
      const errorArrow = errorHeader.createSpan('error-arrow');
      errorArrow.textContent = '→';
      
      const errorCorrected = errorHeader.createSpan('error-corrected-compact');
      const currentValue = this.stateManager.getValue(actualIndex);
      const displayClass = this.stateManager.getDisplayClass(actualIndex);
      
      errorCorrected.textContent = currentValue || pageCorrection.correction.original;
      errorCorrected.className = `error-corrected-compact ${displayClass}`;
      
      // Help text
      if (pageCorrection.correction.help) {
        const helpDiv = errorCard.createDiv('kga-error-help-compact');
        helpDiv.textContent = pageCorrection.correction.help;
      }
      
      // AI analysis result
      const aiResult = this.aiAnalysisResults?.find(result => result.correctionIndex === actualIndex);
      if (aiResult) {
        const aiDiv = errorCard.createDiv('ai-analysis-compact');
        const confidenceBadge = aiDiv.createSpan('ai-confidence-badge');
        confidenceBadge.textContent = `${aiResult.confidence}%`;
        
        if (aiResult.reasoning) {
          const reasoningSpan = aiDiv.createSpan('ai-reasoning-compact');
          reasoningSpan.textContent = aiResult.reasoning;
        }
      }
    });
  }

  /**
   * 미리보기 요소를 생성합니다.
   */
  private createPreviewElement(container: HTMLElement): void {
    // Clear existing content
    container.empty();
    
    const previewText = this.isLongText ? this.getCurrentPreviewText() : this.config.selectedText.trim();
    const rawCorrections = this.getCurrentCorrections();
    const currentCorrections = this.removeDuplicateCorrections(rawCorrections);
    
    // Create text segments with corrections
    const segments = this.createTextSegments(previewText, currentCorrections);
    
    // Render segments
    segments.forEach(segment => {
      const span = container.createSpan();
      
      if (segment.correctionIndex !== undefined) {
        const actualIndex = segment.correctionIndex;
        const displayClass = this.stateManager.getDisplayClass(actualIndex);
        const currentValue = this.stateManager.getValue(actualIndex);
        
        // uniqueId는 actualIndex로 currentCorrections에서 찾기
        const pageCorrection = currentCorrections.find(pc => pc.originalIndex === actualIndex);
        const uniqueId = pageCorrection?.uniqueId || 'unknown';
        
        span.textContent = currentValue;
        span.className = `kga-clickable-error ${displayClass}`;
        span.dataset.correctionIndex = actualIndex.toString();
        span.dataset.uniqueId = uniqueId;
        span.setAttribute('tabindex', '0');
      } else {
        span.textContent = segment.text;
      }
    });
  }

  /**
   * 텍스트를 세그먼트로 분할합니다.
   */
  private createTextSegments(previewText: string, currentCorrections: PageCorrection[]): Array<{
    text: string;
    correctionIndex?: number;
  }> {
    const segments: Array<{text: string; correctionIndex?: number}> = [];
    let lastEnd = 0;
    
    // Process each correction
    currentCorrections.forEach((pageCorrection, index) => {
      const actualIndex = pageCorrection.originalIndex;
      if (actualIndex === undefined) return;
      
      const positionInPage = pageCorrection.positionInPage || 0;
      const originalText = pageCorrection.correction.original;
      const currentValue = this.stateManager.getValue(actualIndex);
      
      // Add text before this correction
      if (positionInPage > lastEnd) {
        segments.push({
          text: previewText.slice(lastEnd, positionInPage)
        });
      }
      
      // Add the correction segment
      segments.push({
        text: currentValue || originalText,
        correctionIndex: actualIndex
      });
      
      lastEnd = positionInPage + originalText.length;
    });
    
    // Add remaining text
    if (lastEnd < previewText.length) {
      segments.push({
        text: previewText.slice(lastEnd)
      });
    }
    
    return segments;
  }
}
