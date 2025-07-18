import { Editor, EditorPosition, App, Platform, Scope, Notice } from 'obsidian';
import { Correction, PopupConfig, AIAnalysisResult, AIAnalysisRequest } from '../types/interfaces';
import { BaseComponent } from './baseComponent';
import { CorrectionStateManager } from '../state/correctionState';
import { escapeHtml } from '../utils/htmlUtils';
import { calculateDynamicCharsPerPage, splitTextIntoPages, escapeRegExp } from '../utils/textUtils';
import { AIAnalysisService } from '../services/aiAnalysisService';
import { Logger } from '../utils/logger';
import { clearElement, appendChildren } from '../utils/domUtils';

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
  private currentCorrections: Correction[] = [];

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

    // Enter: 현재 선택된 수정사항 적용
    this.keyboardScope.register([], 'Enter', (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.applyCurrentSelection();
      return false;
    });

    // Escape: 팝업 닫기
    this.keyboardScope.register([], 'Escape', (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.close();
      return false;
    });

    // ArrowRight: 다음 수정 제안으로 순환
    this.keyboardScope.register([], 'ArrowRight', (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.cycleCurrentCorrectionNext();
      return false;
    });

    // ArrowLeft: 이전 수정 제안으로 순환
    this.keyboardScope.register([], 'ArrowLeft', (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.cycleCurrentCorrectionPrev();
      return false;
    });

    // Space: AI 분석 트리거 (더 확실한 키)
    this.keyboardScope.register([], 'Space', (evt: KeyboardEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      this.triggerAIAnalysis();
      return false;
    });

    // Cmd+E: 오류 상세부분 펼침/접힘
    this.keyboardScope.register(['Mod'], 'KeyE', (evt: KeyboardEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.toggleErrorSummary();
      return false;
    });

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
      if (this.isLongText && this.currentPreviewPage < this.totalPreviewPages - 1) {
        evt.preventDefault();
        this.goToNextPage();
        return false;
      }
      return true;
    });

    // Cmd/Ctrl+Shift+ArrowRight: 모든 오류를 다음 제안으로 일괄 변경
    this.keyboardScope.register(['Mod', 'Shift'], 'ArrowRight', (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.batchCycleCorrections('next');
      return false;
    });

    // Cmd/Ctrl+Shift+ArrowLeft: 모든 오류를 이전 제안으로 일괄 변경
    this.keyboardScope.register(['Mod', 'Shift'], 'ArrowLeft', (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.batchCycleCorrections('prev');
      return false;
    });

    Logger.log('키보드 네비게이션 설정 완료');
  }

  /**
   * 다음 오류 항목으로 포커스를 이동합니다.
   */
  private focusNextError(): void {
    this.currentCorrections = this.getCurrentCorrections();
    if (this.currentCorrections.length === 0) return;

    // 초기에 포커스가 없으면 첫 번째로 설정
    if (this.currentFocusIndex === -1) {
      this.currentFocusIndex = 0;
    } else {
      this.currentFocusIndex = (this.currentFocusIndex + 1) % this.currentCorrections.length;
    }
    this.updateFocusHighlight();
    
    // 상세보기가 이미 펼쳐져 있을 때만 스크롤
    const errorSummary = document.getElementById('errorSummary');
    const isExpanded = errorSummary && !errorSummary.classList.contains('collapsed');
    
    if (isExpanded) {
      this.scrollToFocusedError(false); // 펼쳐진 상태에서는 상태 유지하며 스크롤
    }
    
    Logger.debug(`포커스 이동: ${this.currentFocusIndex}/${this.currentCorrections.length}, 상세보기 펼쳐짐: ${isExpanded}`);
  }

  /**
   * 이전 오류 항목으로 포커스를 이동합니다.
   */
  private focusPrevError(): void {
    this.currentCorrections = this.getCurrentCorrections();
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
    const errorSummary = document.getElementById('errorSummary');
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

    const currentCorrection = this.currentCorrections[this.currentFocusIndex];
    if (!currentCorrection) return;

    const actualIndex = this.config.corrections.findIndex(c => 
      c.original === currentCorrection.original && c.help === currentCorrection.help
    );

    if (actualIndex !== -1) {
      const currentState = this.stateManager.getValue(actualIndex);
      // 현재 선택된 수정사항을 적용 처리
      Logger.log(`키보드로 수정사항 적용: ${currentState}`);
    }
  }

  /**
   * 현재 포커스된 오류의 다음 수정 제안으로 순환합니다.
   */
  private cycleCurrentCorrectionNext(): void {
    if (this.currentCorrections.length === 0) return;

    const currentCorrection = this.currentCorrections[this.currentFocusIndex];
    if (!currentCorrection) return;

    const actualIndex = this.config.corrections.findIndex(c => 
      c.original === currentCorrection.original && c.help === currentCorrection.help
    );

    if (actualIndex !== -1) {
      this.cycleCorrectionState(actualIndex, 'next');
    }
  }

  /**
   * 현재 포커스된 오류의 이전 수정 제안으로 순환합니다.
   */
  private cycleCurrentCorrectionPrev(): void {
    if (this.currentCorrections.length === 0) return;

    const currentCorrection = this.currentCorrections[this.currentFocusIndex];
    if (!currentCorrection) return;

    const actualIndex = this.config.corrections.findIndex(c => 
      c.original === currentCorrection.original && c.help === currentCorrection.help
    );

    if (actualIndex !== -1) {
      this.cycleCorrectionState(actualIndex, 'prev');
    }
  }

  /**
   * 수정 제안 상태를 순환시킵니다.
   */
  private cycleCorrectionState(correctionIndex: number, direction: 'next' | 'prev'): void {
    const correction = this.config.corrections[correctionIndex];
    if (!correction) return;

    // StateManager의 toggleState 메서드 사용
    const result = this.stateManager.toggleState(correctionIndex);
    
    Logger.debug(`수정 제안 순환: ${direction}, index: ${correctionIndex}, 새로운 값: ${result.value}`);
    
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
    this.currentCorrections = this.getCurrentCorrections();
    if (this.currentCorrections.length > 0) {
      this.currentFocusIndex = 0;
      // 약간의 지연을 두고 포커스 설정 (DOM이 완전히 렌더링된 후)
      setTimeout(() => {
        this.updateFocusHighlight();
      }, 100);
      
      // 디버깅을 위한 상세 로깅
      const firstCorrection = this.currentCorrections[0];
      const actualIndex = this.config.corrections.findIndex(c => 
        c.original === firstCorrection.original && c.help === firstCorrection.help
      );
      
      Logger.log(`초기 포커스 설정: ${this.currentFocusIndex}/${this.currentCorrections.length}`);
      Logger.log(`첫 번째 오류: "${firstCorrection.original}" (전체 배열 인덱스: ${actualIndex})`);
      Logger.log('현재 페이지 오류 목록:', this.currentCorrections.map(c => c.original));
    } else {
      this.currentFocusIndex = -1;
      Logger.log('오류가 없어 포커스 설정하지 않음');
    }
  }

  /**
   * 현재 포커스된 항목을 시각적으로 표시합니다.
   */
  private updateFocusHighlight(): void {
    // 기존 포커스 하이라이트 제거
    const prevFocused = this.element.querySelectorAll('.keyboard-focused');
    prevFocused.forEach(el => el.removeClass('keyboard-focused'));

    // 현재 포커스 항목 하이라이트
    if (this.currentCorrections.length > 0 && 
        this.currentFocusIndex >= 0 && 
        this.currentFocusIndex < this.currentCorrections.length) {
      
      const correction = this.currentCorrections[this.currentFocusIndex];
      const actualIndex = this.config.corrections.findIndex(c => 
        c.original === correction.original && c.help === correction.help
      );

      if (actualIndex !== -1) {
        const errorItem = this.element.querySelector(`[data-correction-index="${actualIndex}"]`);
        if (errorItem) {
          errorItem.addClass('keyboard-focused');
          // 스크롤하여 보이게 하기
          errorItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          Logger.debug(`포커스 하이라이트 적용: 인덱스 ${actualIndex}`);
        } else {
          Logger.warn(`포커스 대상 요소를 찾을 수 없음: 인덱스 ${actualIndex}`);
        }
      }
    } else {
      Logger.debug('포커스할 오류가 없거나 인덱스가 범위를 벗어남');
    }
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
    this.element.innerHTML = this.createPopupHTML();
    
    // 이벤트 바인딩
    this.bindEvents();
    
    // 키보드 네비게이션 활성화
    this.app.keymap.pushScope(this.keyboardScope);
    
    // 팝업에 포커스 설정하여 키보드 이벤트가 올바르게 전달되도록 함
    setTimeout(() => {
      this.element.focus();
      Logger.log('팝업 포커스 설정 완료');
    }, 50);
    
    // 초기 포커스 설정
    this.resetFocusToFirstError();
    
    // 키보드 네비게이션 힌트 표시
    this.showKeyboardHint();
    
    // Body 스크롤 잠금
    document.body.classList.add('spell-popup-open');
    
    return this.element;
  }

  /**
   * 팝업 HTML을 생성합니다.
   */
  private createPopupHTML(): string {
    return `
      <div class="popup-overlay"></div>
      <div class="popup-content">
        <div class="header">
          <h2>한국어 맞춤법 검사</h2>
          <div class="preview-header-top">
            ${this.aiService?.isAvailable() ? `
              <button class="ai-analyze-btn" id="aiAnalyzeBtn" ${this.isAiAnalyzing ? 'disabled' : ''}>
                ${this.isAiAnalyzing ? '🤖 분석 중...' : '🤖 AI 분석'}
              </button>
            ` : ''}
            <button class="close-btn-header">×</button>
          </div>
        </div>
        
        <div class="content">
          <div class="preview-section">
            <div class="preview-header">
              <div class="preview-label">
                미리보기
                <span class="preview-hint">클릭하여 수정사항 적용</span>
              </div>
              
              <div class="color-legend">
                <div class="color-legend-item">
                  <div class="color-legend-dot error"></div>
                  <span>오류</span>
                </div>
                <div class="color-legend-item">
                  <div class="color-legend-dot corrected"></div>
                  <span>수정</span>
                </div>
                <div class="color-legend-item">
                  <div class="color-legend-dot exception-processed"></div>
                  <span>예외처리</span>
                </div>
                <div class="color-legend-item">
                  <div class="color-legend-dot original-kept"></div>
                  <span>원본유지</span>
                </div>
              </div>
              
              ${this.createPaginationHTML()}
            </div>
            
            <div class="preview-text" id="resultPreview">
              ${this.generatePreviewHTML()}
            </div>
          </div>
          
          <div class="error-summary collapsed" id="errorSummary">
            <div class="error-summary-toggle">
              <div class="left-section">
                <span class="error-summary-label">오류 상세</span>
                <span class="error-count-badge" id="errorCountBadge">${this.getErrorStateCount()}</span>
              </div>
              <span class="toggle-icon">▼</span>
            </div>
            <div class="error-summary-content" id="errorSummaryContent">
              ${this.generateErrorSummaryHTML()}
            </div>
          </div>
        </div>
        
        <div class="button-area">
          <button class="cancel-btn">취소</button>
          <button class="apply-btn" id="applyCorrectionsButton">적용</button>
        </div>
      </div>
    `;
  }

  /**
   * 페이지네이션 HTML을 생성합니다.
   */
  private createPaginationHTML(): string {
    if (!this.isLongText || this.totalPreviewPages <= 1) {
      return '<div id="paginationContainer" class="pagination-container-hidden"></div>';
    }

    return `
      <div class="pagination-controls" id="paginationContainer">
        <button class="pagination-btn" id="prevPreviewPage" ${this.currentPreviewPage === 0 ? 'disabled' : ''}>이전</button>
        <span class="page-info" id="previewPageInfo">${this.currentPreviewPage + 1} / ${this.totalPreviewPages}</span>
        <button class="pagination-btn" id="nextPreviewPage" ${this.currentPreviewPage === this.totalPreviewPages - 1 ? 'disabled' : ''}>다음</button>
        <span class="page-chars-info" id="pageCharsInfo">${this.charsPerPage}자</span>
      </div>
    `;
  }

  /**
   * 현재 페이지의 교정 목록을 가져옵니다.
   */
  private getCurrentCorrections(): Correction[] {
    if (!this.isLongText) return this.config.corrections;
    
    const previewStartIndex = this.currentPreviewPage === 0 ? 0 : this.pageBreaks[this.currentPreviewPage - 1];
    const previewEndIndex = this.pageBreaks[this.currentPreviewPage];
    const currentPreviewText = this.config.selectedText.slice(previewStartIndex, previewEndIndex);
    
    // 현재 페이지에 포함된 오류들을 필터링하고 원본 순서대로 정렬
    const filteredCorrections = this.config.corrections.filter(correction => {
      return currentPreviewText.includes(correction.original);
    });
    
    // 원본 텍스트에서의 순서대로 정렬
    const sortedCorrections = filteredCorrections.sort((a, b) => {
      const aPos = currentPreviewText.indexOf(a.original);
      const bPos = currentPreviewText.indexOf(b.original);
      return aPos - bPos;
    });
    
    Logger.debug(`getCurrentCorrections: 페이지 ${this.currentPreviewPage + 1}, 오류 ${sortedCorrections.length}개`);
    Logger.debug('오류 위치 순서:', sortedCorrections.map(c => ({ 
      original: c.original, 
      position: currentPreviewText.indexOf(c.original) 
    })));
    
    return sortedCorrections;
  }

  /**
   * 현재 페이지에서 오류 상태(빨간색)인 항목의 개수를 가져옵니다.
   */
  private getErrorStateCount(): number {
    const currentCorrections = this.getCurrentCorrections();
    let errorCount = 0;
    
    currentCorrections.forEach(correction => {
      const actualIndex = this.config.corrections.findIndex(c => 
        c.original === correction.original && c.help === correction.help
      );
      
      if (actualIndex !== -1) {
        const currentValue = this.stateManager.getValue(actualIndex);
        const isException = this.stateManager.isExceptionState(actualIndex);
        const isOriginalKept = this.stateManager.isOriginalKeptState(actualIndex);
        
        // 오류 상태: 원본 값이고, 예외처리나 원본유지 상태가 아닌 경우
        if (currentValue === correction.original && !isException && !isOriginalKept) {
          errorCount++;
        }
      }
    });
    
    return errorCount;
  }

  /**
   * 미리보기 HTML을 생성합니다.
   */
  private generatePreviewHTML(): string {
    const previewText = this.isLongText ? this.getCurrentPreviewText() : this.config.selectedText.trim();
    const currentCorrections = this.getCurrentCorrections();

    // Create a map to track processed positions and avoid duplicates
    const processedPositions: Map<string, boolean> = new Map();
    const segments: { text: string; html: string; start: number; end: number }[] = [];

    // Group corrections by original text to handle duplicates
    const correctionsByOriginal = new Map<string, Correction[]>();
    currentCorrections.forEach(correction => {
      const original = correction.original;
      if (!correctionsByOriginal.has(original)) {
        correctionsByOriginal.set(original, []);
      }
      correctionsByOriginal.get(original)!.push(correction);
    });

    // Process each unique original text only once
    correctionsByOriginal.forEach((corrections, originalText) => {
      // Use the first correction for this original text (could be improved to use best match)
      const correction = corrections[0];
      const actualIndex = this.config.corrections.findIndex(c => 
        c.original === correction.original && c.help === correction.help
      );

      if (actualIndex === -1) return;

      const displayClass = this.stateManager.getDisplayClass(actualIndex);
      const currentValue = this.stateManager.getValue(actualIndex);
      const escapedValue = escapeHtml(currentValue);
      
      const replacementHtml = `<span class="${displayClass} clickable-error" data-correction-index="${actualIndex}">${escapedValue}</span>`;
      
      // Find all occurrences of the original word within the previewText
      const regex = new RegExp(escapeRegExp(correction.original), 'g');
      let match;
      while ((match = regex.exec(previewText)) !== null) {
        const positionKey = `${match.index}-${match.index + match[0].length}`;
        
        // Skip if this position has already been processed
        if (processedPositions.has(positionKey)) {
          continue;
        }
        processedPositions.set(positionKey, true);
        
        // Add the replacement segment for the current match
        segments.push({ 
          text: match[0], 
          html: replacementHtml, 
          start: match.index, 
          end: match.index + match[0].length 
        });
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
        finalHtml += escapeHtml(previewText.substring(currentPos, segment.start));
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
      finalHtml += escapeHtml(previewText.substring(currentPos));
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
    
    return this.config.selectedText.slice(previewStartIndex, previewEndIndex).trim();
  }

  /**
   * 오류 요약 HTML을 생성합니다.
   */
  private generateErrorSummaryHTML(): string {
    const currentCorrections = this.getCurrentCorrections();
    
    if (currentCorrections.length === 0) {
      return `
        <div class="error-placeholder">
          <div class="placeholder-icon">✓</div>
          <div class="placeholder-text">이 페이지에는 발견된 오류가 없습니다</div>
          <div class="placeholder-subtext">다른 페이지에서 오류를 확인하세요</div>
        </div>
      `;
    }

    return currentCorrections.map((correction, index) => {
      const actualIndex = this.config.corrections.findIndex(c => 
        c.original === correction.original && c.help === correction.help
      );
      const isOriginalKept = this.stateManager.isOriginalKeptState(actualIndex);
      const suggestions = correction.corrected.slice(0, 2);
      
      const aiResult = this.aiAnalysisResults.find(result => result.correctionIndex === actualIndex);
      const reasoningHTML = aiResult
        ? `<div class="ai-analysis-result">
             <div class="ai-confidence">🤖 신뢰도: <span class="confidence-score">${aiResult.confidence}%</span></div>
             <div class="ai-reasoning">${escapeHtml(aiResult.reasoning)}</div>
           </div>`
        : isOriginalKept
        ? `<div class="ai-analysis-result">
             <div class="ai-reasoning">사용자가 직접 선택했거나, 예외 단어로 등록된 항목입니다.</div>
           </div>`
        : '';
      
      const suggestionsHTML = suggestions.map(suggestion => 
        `<span class="suggestion-compact ${this.stateManager.isSelected(actualIndex, suggestion) ? 'selected' : ''}" 
              data-value="${escapeHtml(suggestion)}" 
              data-correction="${actualIndex}"
              ${isOriginalKept ? 'disabled' : ''}>
          ${escapeHtml(suggestion)}
        </span>`
      ).join('');

      return `
        <div class="error-item-compact ${isOriginalKept ? 'spell-original-kept' : ''}" data-correction-index="${actualIndex}">
          <div class="error-row">
            <div class="error-original-compact">${escapeHtml(correction.original)}</div>
            <div class="error-suggestions-compact">
              ${suggestionsHTML}
              <span class="suggestion-compact ${this.stateManager.isSelected(actualIndex, correction.original) ? 'selected' : ''} keep-original" 
                    data-value="${escapeHtml(correction.original)}" 
                    data-correction="${actualIndex}"
                    ${isOriginalKept ? 'disabled' : ''}>
                예외처리
              </span>
            </div>
          </div>
          <div class="error-help-compact">${escapeHtml(correction.help)}</div>
          ${reasoningHTML}
        </div>
      `;
    }).join('');
  }

  /**
   * 이벤트를 바인딩합니다.
   */
  private bindEvents(): void {
    // DOM 레벨에서 키보드 이벤트 처리 (백업)
    this.addEventListener(this.element, 'keydown', (evt: KeyboardEvent) => {
      // Space: AI 분석
      if (evt.code === 'Space' && !evt.shiftKey && !evt.ctrlKey && !evt.metaKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.triggerAIAnalysis();
        return;
      }
      
      // Cmd+E: 오류 상세부분 토글
      if (evt.code === 'KeyE' && ((evt.metaKey && !evt.ctrlKey) || (!evt.metaKey && evt.ctrlKey)) && !evt.shiftKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.toggleErrorSummary();
        return;
      }
    });


    // 닫기 버튼들
    this.bindCloseEvents();
    
    // 팝업 오버레이 클릭 시 닫기
    const overlay = this.element.querySelector('.popup-overlay');
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
    const closeButtons = this.element.querySelectorAll('.close-btn-header, .cancel-btn');
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
        }
      });
    }

    if (nextButton) {
      this.addEventListener(nextButton, 'click', () => {
        if (this.currentPreviewPage < this.totalPreviewPages - 1) {
          this.currentPreviewPage++;
          this.updateDisplay();
        }
      });
    }
  }

  /**
   * 오류 토글 이벤트를 바인딩합니다.
   */
  private bindErrorToggleEvents(): void {
    const toggleElement = this.element.querySelector('.error-summary-toggle');
    if (toggleElement) {
      this.addEventListener(toggleElement as HTMLElement, 'click', () => {
        const errorSummary = this.element.querySelector('#errorSummary');
        if (errorSummary) {
          errorSummary.classList.toggle('collapsed');
          
          // 페이지네이션 재계산
          setTimeout(() => {
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
    this.addEventListener(this.element, 'click', (e: Event) => {
      const target = e.target as HTMLElement;
      
      // 미리보기 영역 클릭 처리
      if (target.classList.contains('clickable-error')) {
        this.handlePreviewClick(target);
      }
      
      // 제안 버튼 클릭 처리
      if (target.classList.contains('suggestion-compact')) {
        this.handleSuggestionClick(target);
      }
    });
  }

  /**
   * 적용 버튼 이벤트를 바인딩합니다.
   */
  private bindApplyEvents(): void {
    const applyButton = this.element.querySelector('#applyCorrectionsButton');
    if (applyButton) {
      this.addEventListener(applyButton as HTMLElement, 'click', () => {
        this.applyCorrections();
      });
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
    Logger.log(`Recalculated pagination: Chars per page: ${this.charsPerPage}, Total pages: ${this.totalPreviewPages}, Current page: ${this.currentPreviewPage}`);
  }

  /**
   * 디스플레이를 업데이트합니다.
   */
  private updateDisplay(): void {
    // 미리보기 업데이트
    const previewElement = this.element.querySelector('#resultPreview');
    if (previewElement) {
      previewElement.innerHTML = this.generatePreviewHTML();
    }

    // 오류 요약 업데이트
    const errorSummaryContent = this.element.querySelector('#errorSummaryContent') as HTMLElement;
    if (errorSummaryContent) {
      clearElement(errorSummaryContent);
      const errorSummaryDOM = this.generateErrorSummaryDOM();
      errorSummaryContent.appendChild(errorSummaryDOM);
    }

    // 페이지네이션 컨트롤 업데이트
    this.updatePaginationControls();

    // 오류 개수 배지 업데이트 (오류 상태만 카운팅)
    const errorCountBadge = this.element.querySelector('#errorCountBadge');
    if (errorCountBadge) {
      errorCountBadge.textContent = this.getErrorStateCount().toString();
    }
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
        paginationContainer.className = 'pagination-controls';
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
        paginationContainer.className = 'pagination-container-hidden';
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
  private applyCorrections(): void {
    const result = this.stateManager.applyCorrections(this.config.selectedText);
    
    // 에디터에 변경사항 적용
    this.config.editor.replaceRange(result.finalText, this.config.start, this.config.end);
    
    // 예외 처리된 단어들이 있으면 콜백 호출
    if (result.exceptionWords.length > 0 && this.config.onExceptionWordsAdded) {
      this.config.onExceptionWordsAdded(result.exceptionWords);
    }
    
    this.close();
  }

  /**
   * 팝업을 표시합니다.
   */
  show(): void {
    document.body.appendChild(this.element);
    
    // 모바일 감지를 위한 클래스 추가
    if (Platform.isMobile) {
      this.element.classList.add('mobile-popup');
      Logger.log('Mobile mode detected, added mobile-popup class');
    }
    
    // DOM에 추가된 후에 페이지네이션 계산 및 디스플레이 업데이트
    // requestAnimationFrame을 사용하여 브라우저가 레이아웃을 완료한 후 실행
    requestAnimationFrame(() => {
      this.recalculatePagination();
      this.updateDisplay();
    });
  }


  /**
   * AI 분석을 수행합니다.
   */
  private async performAIAnalysis(): Promise<void> {
    Logger.log('performAIAnalysis 호출됨:', {
      hasAiService: !!this.aiService,
      isAiAnalyzing: this.isAiAnalyzing,
      aiServiceAvailable: this.aiService?.isAvailable(),
      aiServiceSettings: this.aiService?.getSettings()
    });

    if (!this.aiService || this.isAiAnalyzing) {
      Logger.log('AI 분석 중단: aiService 없음 또는 이미 분석 중');
      return;
    }

    if (!this.aiService.isAvailable()) {
      Logger.error('AI 서비스 사용 불가: 기능 비활성화 또는 API 키 없음');
      // 기존 오류 처리 방식과 동일하게 처리
      new Notice('❌ AI 기능이 비활성화되어 있거나 API 키가 설정되지 않았습니다. 플러그인 설정을 확인해주세요.', 5000);
      return;
    }

    try {
      this.isAiAnalyzing = true;
      
      // UI 업데이트 (버튼 비활성화)
      const aiBtn = this.element.querySelector('#aiAnalyzeBtn') as HTMLButtonElement;
      if (aiBtn) {
        aiBtn.disabled = true;
        aiBtn.textContent = '🤖 분석 중...';
      }

      Logger.log('AI 분석 시작 중...');

      // AI 분석 요청 준비
      const currentStates = this.stateManager.getAllStates();
      const analysisRequest: AIAnalysisRequest = {
        originalText: this.config.selectedText,
        corrections: this.config.corrections,
        contextWindow: 100, // 앞뒤 100자씩 컨텍스트 포함 (향상된 컨텍스트)
        currentStates: currentStates, // 현재 상태 전달
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

      this.aiAnalysisResults = await this.aiService.analyzeCorrections(analysisRequest);
      
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
      
      // 버튼 재활성화
      const aiBtn = this.element.querySelector('#aiAnalyzeBtn') as HTMLButtonElement;
      if (aiBtn) {
        aiBtn.disabled = false;
        aiBtn.textContent = '🤖 AI 분석';
      }
    }
  }

  /**
   * 오류 요약 섹션의 DOM 구조를 생성합니다.
   */
  private generateErrorSummaryDOM(): HTMLElement {
    const container = document.createElement('div');
    const currentCorrections = this.getCurrentCorrections();
    
    if (currentCorrections.length === 0) {
      // 오류가 없는 경우의 플레이스홀더
      const placeholder = document.createElement('div');
      placeholder.className = 'error-placeholder';
      
      const icon = document.createElement('div');
      icon.className = 'placeholder-icon';
      icon.textContent = '✓';
      placeholder.appendChild(icon);
      
      const text = document.createElement('div');
      text.className = 'placeholder-text';
      text.textContent = '이 페이지에는 발견된 오류가 없습니다';
      placeholder.appendChild(text);
      
      const subtext = document.createElement('div');
      subtext.className = 'placeholder-subtext';
      subtext.textContent = '다른 페이지에서 오류를 확인하세요';
      placeholder.appendChild(subtext);
      
      container.appendChild(placeholder);
      return container;
    }

    // 오류가 있는 경우 각 오류 항목 생성
    currentCorrections.forEach((correction, index) => {
      const actualIndex = this.config.corrections.findIndex(c => 
        c.original === correction.original && c.help === correction.help
      );
      const isOriginalKept = this.stateManager.isOriginalKeptState(actualIndex);
      const suggestions = correction.corrected.slice(0, 2);
      
      // 에러 아이템 컨테이너
      const errorItem = document.createElement('div');
      errorItem.className = `error-item-compact ${isOriginalKept ? 'spell-original-kept' : ''}`;
      errorItem.setAttribute('data-correction-index', actualIndex.toString());
      
      // 에러 행 (원본 + 제안들)
      const errorRow = document.createElement('div');
      errorRow.className = 'error-row';
      
      // 원본 텍스트
      const errorOriginal = document.createElement('div');
      errorOriginal.className = 'error-original-compact';
      errorOriginal.textContent = correction.original;
      errorRow.appendChild(errorOriginal);
      
      // 제안들 컨테이너
      const suggestionsContainer = document.createElement('div');
      suggestionsContainer.className = 'error-suggestions-compact';
      
      // 제안 스팬들 생성
      suggestions.forEach(suggestion => {
        const suggestionSpan = document.createElement('span');
        suggestionSpan.className = `suggestion-compact ${this.stateManager.isSelected(actualIndex, suggestion) ? 'selected' : ''}`;
        suggestionSpan.setAttribute('data-value', suggestion);
        suggestionSpan.setAttribute('data-correction', actualIndex.toString());
        if (isOriginalKept) {
          suggestionSpan.setAttribute('disabled', '');
        }
        suggestionSpan.textContent = suggestion;
        suggestionsContainer.appendChild(suggestionSpan);
      });
      
      // 예외처리 스팬
      const keepOriginalSpan = document.createElement('span');
      keepOriginalSpan.className = `suggestion-compact ${this.stateManager.isSelected(actualIndex, correction.original) ? 'selected' : ''} keep-original`;
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
      const errorHelp = document.createElement('div');
      errorHelp.className = 'error-help-compact';
      errorHelp.textContent = correction.help;
      errorItem.appendChild(errorHelp);
      
      // AI 분석 결과 (조건부)
      const aiResult = this.aiAnalysisResults.find(result => result.correctionIndex === actualIndex);
      if (aiResult || isOriginalKept) {
        const aiAnalysis = document.createElement('div');
        aiAnalysis.className = 'ai-analysis-result';
        
        if (aiResult) {
          const aiConfidence = document.createElement('div');
          aiConfidence.className = 'ai-confidence';
          aiConfidence.textContent = '🤖 신뢰도: ';
          
          const confidenceScore = document.createElement('span');
          confidenceScore.className = 'confidence-score';
          confidenceScore.textContent = `${aiResult.confidence}%`;
          aiConfidence.appendChild(confidenceScore);
          aiAnalysis.appendChild(aiConfidence);
          
          const aiReasoning = document.createElement('div');
          aiReasoning.className = 'ai-reasoning';
          aiReasoning.textContent = aiResult.reasoning;
          aiAnalysis.appendChild(aiReasoning);
        } else if (isOriginalKept) {
          const aiReasoning = document.createElement('div');
          aiReasoning.className = 'ai-reasoning';
          aiReasoning.textContent = '사용자가 직접 선택했거나, 예외 단어로 등록된 항목입니다.';
          aiAnalysis.appendChild(aiReasoning);
        }
        
        errorItem.appendChild(aiAnalysis);
      }
      
      container.appendChild(errorItem);
    });
    
    return container;
  }

  /**
   * 페이지네이션 컨트롤의 DOM 구조를 생성합니다.
   */
  private createPaginationControls(): DocumentFragment {
    const fragment = document.createDocumentFragment();

    const prevButton = document.createElement('button');
    prevButton.className = 'pagination-btn';
    prevButton.id = 'prevPreviewPage';
    prevButton.textContent = '이전';
    if (this.currentPreviewPage === 0) {
      prevButton.disabled = true;
    }
    fragment.appendChild(prevButton);

    const pageInfo = document.createElement('span');
    pageInfo.className = 'page-info';
    pageInfo.id = 'previewPageInfo';
    pageInfo.textContent = `${this.currentPreviewPage + 1} / ${this.totalPreviewPages}`;
    fragment.appendChild(pageInfo);

    const nextButton = document.createElement('button');
    nextButton.className = 'pagination-btn';
    nextButton.id = 'nextPreviewPage';
    nextButton.textContent = '다음';
    if (this.currentPreviewPage === this.totalPreviewPages - 1) {
      nextButton.disabled = true;
    }
    fragment.appendChild(nextButton);

    const charsInfo = document.createElement('span');
    charsInfo.className = 'page-chars-info';
    charsInfo.id = 'pageCharsInfo';
    charsInfo.textContent = `${this.charsPerPage}자`;
    fragment.appendChild(charsInfo);

    return fragment;
  }

  /**
   * 토큰 경고 모달의 DOM 구조를 생성합니다.
   */
  private createTokenWarningModal(tokenUsage: any, isOverMaxTokens: boolean, maxTokens: number): HTMLElement {
    const content = document.createElement('div');
    content.className = 'token-warning-content';

    // 헤더 섹션
    const header = content.appendChild(document.createElement('div'));
    header.className = 'token-warning-header';
    
    const headerIcon = header.appendChild(document.createElement('div'));
    headerIcon.className = 'token-warning-header-icon';
    headerIcon.textContent = '⚡';
    
    const headerInfo = header.appendChild(document.createElement('div'));
    
    const title = headerInfo.appendChild(document.createElement('h3'));
    title.className = 'token-warning-title';
    title.textContent = isOverMaxTokens ? '토큰 사용량 확인' : '토큰 사용량 안내';
    
    const description = headerInfo.appendChild(document.createElement('p'));
    description.className = 'token-warning-description';
    description.textContent = isOverMaxTokens ? '설정된 한계를 초과했습니다' : '예상 사용량이 높습니다';

    // 토큰 사용량 카드
    const details = content.appendChild(document.createElement('div'));
    details.className = 'token-warning-details';
    
    const stats = details.appendChild(document.createElement('div'));
    stats.className = 'token-warning-stats';
    
    // 총 토큰 통계
    const totalTokenItem = stats.appendChild(document.createElement('div'));
    totalTokenItem.className = 'token-stat-item';
    
    const totalTokenNumber = totalTokenItem.appendChild(document.createElement('div'));
    totalTokenNumber.className = 'token-stat-number';
    totalTokenNumber.textContent = tokenUsage.totalEstimated.toLocaleString();
    
    const totalTokenLabel = totalTokenItem.appendChild(document.createElement('div'));
    totalTokenLabel.className = 'token-stat-label';
    totalTokenLabel.textContent = '총 토큰';
    
    // 예상 비용 통계
    const costItem = stats.appendChild(document.createElement('div'));
    costItem.className = 'token-stat-item';
    
    const costNumber = costItem.appendChild(document.createElement('div'));
    costNumber.className = 'token-stat-number orange';
    costNumber.textContent = tokenUsage.estimatedCost;
    
    const costLabel = costItem.appendChild(document.createElement('div'));
    costLabel.className = 'token-stat-label';
    costLabel.textContent = '예상 비용';
    
    // 사용량 세부사항
    const recommendation = details.appendChild(document.createElement('div'));
    recommendation.className = 'token-warning-recommendation';
    
    const recHeader = recommendation.appendChild(document.createElement('div'));
    recHeader.className = 'token-warning-recommendation-header';
    
    const recContent = recHeader.appendChild(document.createElement('div'));
    recContent.className = 'token-warning-recommendation-content';
    
    const recTitle = recContent.appendChild(document.createElement('div'));
    recTitle.className = 'token-warning-recommendation-title';
    recTitle.textContent = '사용량 세부사항';
    
    const recText = recContent.appendChild(document.createElement('div'));
    recText.className = 'token-warning-recommendation-text';
    recText.textContent = `입력: ${tokenUsage.inputTokens.toLocaleString()} • 출력: ${tokenUsage.estimatedOutputTokens.toLocaleString()}`;

    // 토큰 초과 알림 (조건부)
    if (isOverMaxTokens) {
      const overLimit = content.appendChild(document.createElement('div'));
      overLimit.className = 'token-warning-over-limit';
      
      const overLimitContent = overLimit.appendChild(document.createElement('div'));
      overLimitContent.className = 'token-warning-over-limit-content';
      
      const overLimitIcon = overLimitContent.appendChild(document.createElement('div'));
      overLimitIcon.className = 'token-warning-over-limit-icon';
      overLimitIcon.textContent = '!';
      
      const overLimitText = overLimitContent.appendChild(document.createElement('div'));
      overLimitText.className = 'token-warning-over-limit-text';
      
      const overLimitTitle = overLimitText.appendChild(document.createElement('div'));
      overLimitTitle.className = 'token-warning-over-limit-title';
      overLimitTitle.textContent = '설정된 최대 토큰을 초과했습니다';
      
      const overLimitDesc = overLimitText.appendChild(document.createElement('div'));
      overLimitDesc.className = 'token-warning-over-limit-description';
      overLimitDesc.textContent = `현재 설정: ${maxTokens.toLocaleString()} 토큰 → 초과량: ${(tokenUsage.totalEstimated - maxTokens).toLocaleString()} 토큰`;
    }

    // 액션 버튼들
    const actions = content.appendChild(document.createElement('div'));
    actions.className = 'token-warning-actions';
    
    const cancelBtn = actions.appendChild(document.createElement('button'));
    cancelBtn.id = 'token-warning-cancel';
    cancelBtn.className = 'token-warning-btn token-warning-btn-cancel';
    cancelBtn.textContent = '취소';
    
    if (isOverMaxTokens) {
      const updateSettingsBtn = actions.appendChild(document.createElement('button'));
      updateSettingsBtn.id = 'token-warning-update-settings';
      updateSettingsBtn.className = 'token-warning-btn token-warning-btn-settings';
      updateSettingsBtn.textContent = '설정 업데이트';
    }
    
    const proceedBtn = actions.appendChild(document.createElement('button'));
    proceedBtn.id = 'token-warning-proceed';
    proceedBtn.className = 'token-warning-btn token-warning-btn-proceed';
    proceedBtn.textContent = isOverMaxTokens ? '이번만 진행' : '계속 진행';

    // 키보드 단축키 안내
    const keyboardHint = content.appendChild(document.createElement('div'));
    keyboardHint.className = 'token-warning-keyboard-hint';
    keyboardHint.textContent = '💡 키보드 단축키: Enter(진행), Esc(취소)';

    return content;
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

    // 토큰 사용량 추정
    const tokenUsage = this.aiService.estimateTokenUsage(request);
    const isOverMaxTokens = tokenUsage.totalEstimated > maxTokens;
    
    if (tokenUsage.totalEstimated < threshold && !isOverMaxTokens) {
      return true; // 임계값 미만이고 최대 토큰 이내면 바로 진행
    }

    // 확인 모달 표시
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'token-warning-modal';

      // DOM API를 사용하여 모달 내용 생성
      const modalContent = this.createTokenWarningModal(tokenUsage, isOverMaxTokens, maxTokens);
      modal.appendChild(modalContent);

      document.body.appendChild(modal);

      // 모달에 포커스 설정 (강화된 접근법)
      modal.setAttribute('tabindex', '-1');
      modal.style.outline = 'none';
      
      // 강제로 포커스 설정 (지연 처리)
      setTimeout(() => {
        modal.focus();
        Logger.log('토큰 경고 모달: 포커스 설정 완료');
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
        Logger.log(`토큰 경고 모달: 키 이벤트 감지 - ${e.key} (코드: ${e.code})`);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        if (e.key === 'Enter') {
          Logger.log('토큰 경고 모달: Enter키 감지 - 진행');
          handleResponse('proceed');
        } else if (e.key === 'Escape') {
          Logger.log('토큰 경고 모달: Escape키 감지 - 취소');
          handleResponse('cancel');
        }
        // 다른 모든 키 이벤트는 무시하고 전파 차단
      };

      // 여러 레벨에서 키보드 이벤트 캡처
      modal.addEventListener('keydown', handleKeyboard, { capture: true });
      modal.addEventListener('keyup', handleKeyboard, { capture: true });
      
      // 글로벌 키보드 이벤트도 차단 (백그라운드 이벤트 방지)
      const globalKeyHandler = (e: KeyboardEvent) => {
        if (document.body.contains(modal)) {
          Logger.log(`토큰 경고 모달: 글로벌 키 이벤트 차단 - ${e.key}`);
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          // 글로벌 레벨에서도 키 처리
          if (e.key === 'Enter') {
            Logger.log('토큰 경고 모달: 글로벌 Enter키 감지 - 진행');
            handleResponse('proceed');
          } else if (e.key === 'Escape') {
            Logger.log('토큰 경고 모달: 글로벌 Escape키 감지 - 취소');
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
        
        Logger.log('토큰 경고 모달: 모든 이벤트 리스너 제거 완료');
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
      Logger.log(`최대 토큰을 ${newMaxTokens}으로 업데이트했습니다.`);
      
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
    const allCorrections = this.getCurrentCorrections();
    if (allCorrections.length === 0) return;

    let changedCount = 0;
    
    allCorrections.forEach((correction) => {
      const actualIndex = this.config.corrections.findIndex(c => 
        c.original === correction.original && c.help === correction.help
      );
      
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
      Logger.log('모바일 환경에서는 키보드 힌트를 표시하지 않음');
      return;
    }

    const hint = document.createElement('div');
    hint.className = 'keyboard-navigation-hint';
    hint.id = 'keyboard-hint';
    
    // 헤더 (제목 + 닫기 버튼)
    const header = document.createElement('div');
    header.className = 'hint-header';
    
    const title = document.createElement('div');
    title.className = 'hint-title';
    title.textContent = '⌨️ 키보드 단축키';
    header.appendChild(title);
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'hint-close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = '단축키 가이드 닫기';
    closeBtn.addEventListener('click', () => {
      hint.style.opacity = '0';
      setTimeout(() => hint.remove(), 200);
    });
    header.appendChild(closeBtn);
    
    hint.appendChild(header);
    
    const shortcuts = [
      { key: 'Tab', desc: '다음 오류' },
      { key: '←/→', desc: '수정 제안 순환' },
      { key: 'Enter', desc: '적용' },
      { key: 'Space', desc: 'AI 분석' },
      { key: '⌘E', desc: '오류 상세 토글' },
      { key: '⌘⇧←/→', desc: '일괄 변경' },
      { key: '↑/↓', desc: '페이지 이동' },
      { key: 'Esc', desc: '닫기' }
    ];
    
    shortcuts.forEach(shortcut => {
      const item = document.createElement('div');
      item.className = 'hint-item';
      
      const key = document.createElement('span');
      key.className = 'hint-key';
      key.textContent = shortcut.key;
      
      const desc = document.createElement('span');
      desc.className = 'hint-desc';
      desc.textContent = shortcut.desc;
      
      item.appendChild(key);
      item.appendChild(desc);
      hint.appendChild(item);
    });
    
    document.body.appendChild(hint);
    
    Logger.log('키보드 네비게이션 힌트 표시됨 (데스크톱 전용)');
  }

  /**
   * 오류 상세부분 펼침/접힘을 토글합니다.
   */
  private toggleErrorSummary(): void {
    Logger.log('오류 상세부분 토글 트리거됨 (키보드 단축키: ⌘E)');
    const errorSummary = document.getElementById('errorSummary');
    if (!errorSummary) {
      Logger.warn('errorSummary 요소를 찾을 수 없습니다.');
      return;
    }

    const isCurrentlyCollapsed = errorSummary.classList.contains('collapsed');
    
    if (isCurrentlyCollapsed) {
      errorSummary.classList.remove('collapsed');
      Logger.log('오류 상세부분 펼침');
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
    const currentCorrections = this.getCurrentCorrections();
    if (currentCorrections.length === 0 || this.currentFocusIndex < 0) return;

    const correction = currentCorrections[this.currentFocusIndex];
    if (!correction) return;

    const actualIndex = this.config.corrections.findIndex(c => 
      c.original === correction.original && c.help === correction.help
    );

    if (actualIndex === -1) return;

    // 오류 상세부분에서 해당 항목 찾기
    const errorSummary = document.getElementById('errorSummary');
    if (!errorSummary) return;

    const errorItems = errorSummary.querySelectorAll('.error-item-compact');
    let targetItem: HTMLElement | null = null;

    // 실제 인덱스와 매칭되는 항목 찾기
    errorItems.forEach((item, index) => {
      const itemCorrection = currentCorrections[index];
      if (itemCorrection && itemCorrection.original === correction.original && itemCorrection.help === correction.help) {
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
        setTimeout(() => {
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

      Logger.log(`오류 상세부분 자동스크롤: ${correction.original} (forceOpen: ${forceOpen}, collapsed: ${isCollapsed})`);
    }
  }

  /**
   * 포커스된 오류 카드를 하이라이트합니다.
   */
  private highlightFocusedError(targetItem: HTMLElement): void {
    // 기존 하이라이트 제거
    const existingHighlight = document.querySelector('.error-item-highlighted');
    if (existingHighlight) {
      existingHighlight.classList.remove('error-item-highlighted');
    }

    // 새로운 하이라이트 추가
    targetItem.classList.add('error-item-highlighted');
    
    // 2초 후 하이라이트 제거
    setTimeout(() => {
      targetItem.classList.remove('error-item-highlighted');
    }, 2000);
    
    Logger.log('오류 카드 하이라이트 애니메이션 적용');
  }

  /**
   * 팝업을 닫습니다.
   */
  close(): void {
    // 키보드 네비게이션 비활성화
    this.app.keymap.popScope(this.keyboardScope);
    
    // 키보드 힌트 제거
    const hint = document.getElementById('keyboard-hint');
    if (hint) {
      hint.remove();
    }
    
    document.body.classList.remove('spell-popup-open');
    this.destroy();
  }
}