import { Editor, EditorPosition, App } from 'obsidian';
import { Correction, PopupConfig } from '../types/interfaces';
import { BaseComponent } from './baseComponent';
import { CorrectionStateManager } from '../state/correctionState';
import { escapeHtml } from '../utils/htmlUtils';
import { calculateDynamicCharsPerPage, splitTextIntoPages } from '../utils/textUtils';

/**
 * 맞춤법 교정 팝업 관리 클래스
 */
export class CorrectionPopup extends BaseComponent {
  private config: PopupConfig;
  private app: App;
  private stateManager: CorrectionStateManager;
  
  // Pagination state
  private isLongText: boolean = false;
  private currentPreviewPage: number = 0;
  private totalPreviewPages: number = 1;
  private pageBreaks: number[] = [];
  private charsPerPage: number = 800;

  constructor(app: App, config: PopupConfig) {
    super('div', 'correction-popup-container');
    this.app = app;
    this.config = config;
    this.stateManager = new CorrectionStateManager(config.corrections, this.config.ignoredWords);
    
    this.initializePagination();
  }

  /**
   * 페이지네이션을 초기화합니다.
   */
  private initializePagination(): void {
    const textLength = this.config.selectedText.length;
    this.isLongText = textLength > 1000;
    
    if (this.isLongText) {
      this.charsPerPage = calculateDynamicCharsPerPage(undefined, false);
      this.pageBreaks = splitTextIntoPages(this.config.selectedText, this.charsPerPage);
      this.totalPreviewPages = this.pageBreaks.length;
    } else {
      this.totalPreviewPages = 1;
      this.pageBreaks = [textLength];
    }
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

    // 초기 디스플레이 업데이트 (뱃지 숫자 등)
    this.updateDisplay();
    
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
            <button class="close-btn-header">×</button>
          </div>
        </div>
        
        <div class="content">
          <div class="preview-section">
            <div class="preview-header">
              <div style="display: flex; flex-direction: column; gap: 4px;">
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

    // Create an array of segments to build the final HTML
    const segments: { text: string; html: string; start: number; end: number }[] = [];
    let lastIndex = 0;

    currentCorrections.forEach((correction) => {
      const actualIndex = this.config.corrections.findIndex(c => 
        c.original === correction.original && c.help === correction.help
      );

      if (actualIndex === -1) return;

      const displayClass = this.stateManager.getDisplayClass(actualIndex);
      const currentValue = this.stateManager.getValue(actualIndex);
      const escapedValue = escapeHtml(currentValue);
      
      const replacementHtml = `<span class="${displayClass} clickable-error" data-correction-index="${actualIndex}" style="cursor: pointer;">${escapedValue}</span>`;
      
      // Find all occurrences of the original word within the previewText
      const regex = new RegExp(escapeHtml(correction.original), 'g');
      let match;
      while ((match = regex.exec(previewText)) !== null) {
        // Add the text before the current match
        if (match.index > lastIndex) {
          segments.push({ text: previewText.substring(lastIndex, match.index), html: '', start: lastIndex, end: match.index });
        }
        // Add the replacement HTML for the current match
        segments.push({ text: match[0], html: replacementHtml, start: match.index, end: match.index + match[0].length });
        lastIndex = match.index + match[0].length;
      }
    });

    // Add any remaining text after the last match
    if (lastIndex < previewText.length) {
      segments.push({ text: previewText.substring(lastIndex), html: '', start: lastIndex, end: previewText.length });
    }

    // Sort segments by their start index to handle potential overlaps or out-of-order matches
    segments.sort((a, b) => a.start - b.start);

    // Build the final HTML string, handling overlaps by prioritizing earlier, longer matches
    let finalHtml = '';
    let currentPos = 0;
    segments.forEach(segment => {
      if (segment.start >= currentPos) {
        if (segment.html) {
          finalHtml += segment.html;
          currentPos = segment.end;
        } else {
          finalHtml += escapeHtml(segment.text);
          currentPos = segment.end;
        }
      } else if (segment.end > currentPos) {
        // Handle partial overlap: only append the non-overlapping part if it's a replacement
        if (segment.html && segment.start < currentPos) {
          // This case is tricky and might need more sophisticated tokenization for perfect handling
          // For now, we'll just append the full HTML if it's a replacement and it extends beyond currentPos
          // This might lead to nested spans if not careful, but given the current regex, it should be okay.
          // A more robust solution would involve a proper AST or token stream.
          finalHtml += segment.html.substring(segment.html.indexOf(escapeHtml(segment.text.substring(currentPos - segment.start))));
          currentPos = segment.end;
        }
      }
    });

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
    const prevButton = this.element.querySelector('#prevPreviewPage') as HTMLButtonElement;
    const nextButton = this.element.querySelector('#nextPreviewPage') as HTMLButtonElement;
    const pageInfo = this.element.querySelector('#previewPageInfo');
    const pageCharsInfo = this.element.querySelector('#pageCharsInfo');

    if (prevButton) prevButton.disabled = this.currentPreviewPage === 0;
    if (nextButton) nextButton.disabled = this.currentPreviewPage === this.totalPreviewPages - 1;
    if (pageInfo) pageInfo.textContent = `${this.currentPreviewPage + 1} / ${this.totalPreviewPages}`;
    if (pageCharsInfo) pageCharsInfo.textContent = `${this.charsPerPage}자`;
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
  }

  /**
   * 팝업을 닫습니다.
   */
  close(): void {
    document.body.classList.remove('spell-popup-open');
    this.destroy();
  }
}