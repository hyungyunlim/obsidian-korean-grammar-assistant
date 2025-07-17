import { Editor, EditorPosition, App, Platform } from 'obsidian';
import { Correction, PopupConfig, AIAnalysisResult, AIAnalysisRequest } from '../types/interfaces';
import { BaseComponent } from './baseComponent';
import { CorrectionStateManager } from '../state/correctionState';
import { escapeHtml } from '../utils/htmlUtils';
import { calculateDynamicCharsPerPage, splitTextIntoPages, escapeRegExp } from '../utils/textUtils';
import { AIAnalysisService } from '../services/aiAnalysisService';

/**
 * 맞춤법 교정 팝업 관리 클래스
 */
export class CorrectionPopup extends BaseComponent {
  private config: PopupConfig;
  private app: App;
  private stateManager: CorrectionStateManager;
  private aiService?: AIAnalysisService;
  
  // Pagination state
  private isLongText: boolean = false;
  private currentPreviewPage: number = 0;
  private totalPreviewPages: number = 1;
  private pageBreaks: number[] = [];
  private charsPerPage: number = 800;
  
  // AI 분석 결과
  private aiAnalysisResults: AIAnalysisResult[] = [];
  private isAiAnalyzing: boolean = false;

  constructor(app: App, config: PopupConfig, aiService?: AIAnalysisService) {
    super('div', 'correction-popup-container');
    this.app = app;
    this.config = config;
    this.stateManager = new CorrectionStateManager(config.corrections, this.config.ignoredWords);
    this.aiService = aiService;
    
    this.initializePagination();
  }

  /**
   * 페이지네이션을 초기화합니다.
   */
  private initializePagination(): void {
    const textLength = this.config.selectedText.length;
    this.isLongText = textLength > 1000;
    
    // 초기값 설정. 실제 계산은 recalculatePagination에서 이루어짐.
    this.charsPerPage = 800; 
    this.pageBreaks = [textLength]; // 임시
    this.totalPreviewPages = 1;
    this.currentPreviewPage = 0;
    console.log(`[CorrectionPopup] Initial pagination setup: Long text: ${this.isLongText}`);
  }

  /**
   * 팝업을 렌더링합니다.
   */
  render(): HTMLElement {
    this.element.id = 'correctionPopup';
    this.element.innerHTML = this.createPopupHTML();
    
    // 이벤트 바인딩
    this.bindEvents();
    
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
          <div style="display: flex; align-items: center; gap: 8px;">
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
                  <div class="color-legend-dot ignored"></div>
                  <span>무시됨</span>
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
                <span class="error-count-badge" id="errorCountBadge">${this.getCurrentCorrections().length}</span>
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
      return '<div id="paginationContainer" style="display: none;"></div>';
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
    
    return this.config.corrections.filter(correction => {
      return currentPreviewText.includes(correction.original);
    });
  }

  /**
   * 미리보기 HTML을 생성합니다.
   */
  private generatePreviewHTML(): string {
    const previewText = this.isLongText ? this.getCurrentPreviewText() : this.config.selectedText;
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
      
      const replacementHtml = `<span class="${displayClass} clickable-error" data-correction-index="${actualIndex}" style="cursor: pointer;">${escapedValue}</span>`;
      
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
    if (!this.isLongText) return this.config.selectedText;
    
    const previewStartIndex = this.currentPreviewPage === 0 ? 0 : this.pageBreaks[this.currentPreviewPage - 1];
    const previewEndIndex = this.pageBreaks[this.currentPreviewPage];
    
    return this.config.selectedText.slice(previewStartIndex, previewEndIndex);
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

    return currentCorrections.filter(correction => !this.stateManager.isIgnoredState(this.config.corrections.findIndex(c => c.original === correction.original && c.help === correction.help))).map((correction, index) => {
      const actualIndex = this.config.corrections.findIndex(c => 
        c.original === correction.original && c.help === correction.help
      );
      const isIgnored = this.stateManager.isIgnoredState(actualIndex);
      const suggestions = correction.corrected.slice(0, 2);
      
      // AI 분석 결과 찾기
      const aiResult = this.aiAnalysisResults.find(result => result.correctionIndex === actualIndex);
      
      const suggestionsHTML = suggestions.map(suggestion => 
        `<span class="suggestion-compact ${this.stateManager.isSelected(actualIndex, suggestion) ? 'selected' : ''}" 
              data-value="${escapeHtml(suggestion)}" 
              data-correction="${actualIndex}"
              ${isIgnored ? 'disabled' : ''}>
          ${escapeHtml(suggestion)}
        </span>`
      ).join('');

      return `
        <div class="error-item-compact ${isIgnored ? 'spell-ignored' : ''}" data-correction-index="${actualIndex}">
          <div class="error-row">
            <div class="error-original-compact">${escapeHtml(correction.original)}</div>
            <div class="error-suggestions-compact">
              ${suggestionsHTML}
              <span class="suggestion-compact ${this.stateManager.isSelected(actualIndex, correction.original) ? 'selected' : ''} keep-original" 
                    data-value="${escapeHtml(correction.original)}" 
                    data-correction="${actualIndex}"
                    ${isIgnored ? 'disabled' : ''}>
                예외처리
              </span>
            </div>
          </div>
          <div class="error-help-compact">${escapeHtml(correction.help)}</div>
          ${aiResult ? `
            <div class="ai-analysis-result">
              <div class="ai-confidence">
                🤖 신뢰도: <span class="confidence-score">${aiResult.confidence}%</span>
              </div>
              <div class="ai-reasoning">${escapeHtml(aiResult.reasoning)}</div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  /**
   * 이벤트를 바인딩합니다.
   */
  private bindEvents(): void {
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
    
    this.stateManager.setState(correctionIndex, value, value === this.config.corrections[correctionIndex]?.original);
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
    this.pageBreaks = splitTextIntoPages(this.config.selectedText, this.charsPerPage);
    this.totalPreviewPages = this.pageBreaks.length;
    
    // 현재 페이지가 범위를 벗어나면 조정
    if (this.currentPreviewPage >= this.totalPreviewPages) {
      this.currentPreviewPage = Math.max(0, this.totalPreviewPages - 1);
    }
    console.log(`[CorrectionPopup] Recalculated pagination: Chars per page: ${this.charsPerPage}, Total pages: ${this.totalPreviewPages}, Current page: ${this.currentPreviewPage}`);
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
    const errorSummaryContent = this.element.querySelector('#errorSummaryContent');
    if (errorSummaryContent) {
      errorSummaryContent.innerHTML = this.generateErrorSummaryHTML();
    }

    // 페이지네이션 컨트롤 업데이트
    this.updatePaginationControls();

    // 오류 개수 배지 업데이트
    const errorCountBadge = this.element.querySelector('#errorCountBadge');
    if (errorCountBadge) {
      const visibleCorrections = this.getCurrentCorrections().filter(correction => {
        const actualIndex = this.config.corrections.findIndex(c => c.original === correction.original && c.help === correction.help);
        return !this.stateManager.isIgnoredState(actualIndex);
      });
      errorCountBadge.textContent = visibleCorrections.length.toString();
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
        paginationContainer.style.display = 'flex';
        // 페이지네이션이 표시되어야 하는데 버튼이 없으면 HTML을 다시 생성
        if (!prevButton || !nextButton) {
          paginationContainer.innerHTML = `
            <button class="pagination-btn" id="prevPreviewPage" ${this.currentPreviewPage === 0 ? 'disabled' : ''}>이전</button>
            <span class="page-info" id="previewPageInfo">${this.currentPreviewPage + 1} / ${this.totalPreviewPages}</span>
            <button class="pagination-btn" id="nextPreviewPage" ${this.currentPreviewPage === this.totalPreviewPages - 1 ? 'disabled' : ''}>다음</button>
            <span class="page-chars-info" id="pageCharsInfo">${this.charsPerPage}자</span>
          `;
          
          // 새로 생성된 버튼에 이벤트 바인딩
          this.bindPaginationEvents();
        }
      } else {
        paginationContainer.style.display = 'none';
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
      console.log('[CorrectionPopup] Mobile mode detected, added mobile-popup class');
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
    if (!this.aiService || this.isAiAnalyzing) {
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

      console.log('[AI] AI 분석 시작 중...');

      // AI 분석 요청 준비
      const analysisRequest = {
        originalText: this.config.selectedText,
        corrections: this.config.corrections,
        contextWindow: 100 // 앞뒤 100자씩 컨텍스트 포함 (향상된 컨텍스트)
      };

      // 토큰 사용량 추정 및 경고 확인
      if (await this.checkTokenUsageWarning(analysisRequest) === false) {
        // 사용자가 취소한 경우
        return;
      }

      this.aiAnalysisResults = await this.aiService.analyzeCorrections(analysisRequest);
      
      console.log('[AI] AI 분석 완료:', this.aiAnalysisResults);

      // AI 분석 결과를 상태 관리자에 적용
      this.applyAIAnalysisResults();

      // UI 업데이트
      this.updateDisplay();

      // 성공 알림
      const notice = document.createElement('div');
      notice.textContent = `🤖 AI가 ${this.aiAnalysisResults.length}개의 수정 제안을 분석했습니다.`;
      notice.style.cssText = `
        position: fixed;
        top: 50px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--color-green);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `;
      document.body.appendChild(notice);
      setTimeout(() => notice.remove(), 3000);

    } catch (error) {
      console.error('[AI] AI 분석 실패:', error);
      
      // 오류 알림
      const errorNotice = document.createElement('div');
      errorNotice.textContent = `❌ AI 분석 실패: ${error.message}`;
      errorNotice.style.cssText = `
        position: fixed;
        top: 50px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--color-red);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `;
      document.body.appendChild(errorNotice);
      setTimeout(() => errorNotice.remove(), 5000);
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
   * 토큰 사용량 경고를 확인하고 사용자 확인을 받습니다.
   */
  private async checkTokenUsageWarning(request: AIAnalysisRequest): Promise<boolean> {
    // AI 서비스에서 설정 확인
    const aiSettings = this.aiService?.getProviderInfo();
    if (!this.aiService || !aiSettings?.available) {
      return true; // AI 서비스 없으면 그냥 진행
    }

    // TODO: 실제 AI 설정에서 경고 설정 가져오기 (임시로 기본값 사용)
    const showWarning = true; // 임시
    const threshold = 3000; // 임시
    
    if (!showWarning) {
      return true; // 경고 비활성화된 경우
    }

    // 토큰 사용량 추정
    const tokenUsage = this.aiService.estimateTokenUsage(request);
    
    if (tokenUsage.totalEstimated < threshold) {
      return true; // 임계값 미만이면 바로 진행
    }

    // 확인 모달 표시
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10002;
        font-family: var(--font-interface);
      `;

      modal.innerHTML = `
        <div style="
          background: var(--background-primary);
          border-radius: 12px;
          padding: 24px;
          max-width: 400px;
          width: 90%;
          box-shadow: 0 12px 60px rgba(0, 0, 0, 0.3);
          border: 1px solid var(--background-modifier-border);
        ">
          <h3 style="margin: 0 0 16px 0; color: var(--text-normal); font-size: 18px;">
            🚨 높은 토큰 사용량 예상
          </h3>
          <div style="margin-bottom: 20px; color: var(--text-normal); line-height: 1.5;">
            <p style="margin: 8px 0;">예상 토큰 사용량: <strong>${tokenUsage.totalEstimated.toLocaleString()}</strong> 토큰</p>
            <p style="margin: 8px 0;">• 입력: ${tokenUsage.inputTokens.toLocaleString()} 토큰</p>
            <p style="margin: 8px 0;">• 출력 예상: ${tokenUsage.estimatedOutputTokens.toLocaleString()} 토큰</p>
            <p style="margin: 8px 0;">• 예상 비용: ${tokenUsage.estimatedCost}</p>
            <p style="margin: 12px 0 0 0; font-size: 14px; color: var(--text-muted);">
              계속 진행하시겠습니까?
            </p>
          </div>
          <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button id="token-warning-cancel" style="
              padding: 8px 16px;
              border: 1px solid var(--background-modifier-border);
              border-radius: 6px;
              background: var(--background-secondary);
              color: var(--text-normal);
              cursor: pointer;
            ">취소</button>
            <button id="token-warning-proceed" style="
              padding: 8px 16px;
              border: none;
              border-radius: 6px;
              background: var(--interactive-accent);
              color: var(--text-on-accent);
              cursor: pointer;
            ">계속 진행</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // 이벤트 처리
      const handleResponse = (proceed: boolean) => {
        modal.remove();
        resolve(proceed);
      };

      modal.querySelector('#token-warning-cancel')?.addEventListener('click', () => handleResponse(false));
      modal.querySelector('#token-warning-proceed')?.addEventListener('click', () => handleResponse(true));
      
      // 오버레이 클릭 시 취소
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          handleResponse(false);
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
        result.isExceptionProcessed
      );
    }
  }

  /**
   * 팝업을 닫습니다.
   */
  close(): void {
    document.body.classList.remove('spell-popup-open');
    this.destroy();
  }
}