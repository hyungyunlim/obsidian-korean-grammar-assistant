/**
 * 미리보기 렌더러
 * 팝업 미리보기 영역(텍스트 표시, 오류 하이라이트)을 관리
 */

import { Platform } from 'obsidian';
import { RenderContext, IPopupComponent, PopupState, PaginationState } from '../types/PopupTypes';
import { Correction, PageCorrection } from '../../types/interfaces';
import { Logger } from '../../utils/logger';
import { createEl } from '../../utils/domUtils';
import { escapeHtml } from '../../utils/htmlUtils';
import { calculateDynamicCharsPerPage, splitTextIntoPages, escapeRegExp } from '../../utils/textUtils';

/**
 * 오류 클릭 이벤트 타입
 */
export type ErrorClickEvent = {
  correctionIndex: number;
  correction: Correction;
  element: HTMLElement;
  position: { x: number; y: number };
};

export type ErrorClickListener = (event: ErrorClickEvent) => void;

/**
 * 페이지 변경 이벤트 타입
 */
export type PageChangeEvent = {
  currentPage: number;
  totalPages: number;
  pageText: string;
};

export type PageChangeListener = (event: PageChangeEvent) => void;

/**
 * 미리보기 렌더러 클래스
 */
export class PreviewRenderer implements IPopupComponent {
  private context?: RenderContext;
  private containerElement?: HTMLElement;
  
  // 하위 요소들
  private contentElement?: HTMLElement;
  private paginationElement?: HTMLElement;
  private pageInfoElement?: HTMLElement;
  private prevButtonElement?: HTMLElement;
  private nextButtonElement?: HTMLElement;
  
  // 상태 관리
  private isInitialized: boolean = false;
  private currentPageText: string = '';
  private currentCorrections: PageCorrection[] = [];
  
  // 이벤트 관리
  private errorClickListeners: Set<ErrorClickListener> = new Set();
  private pageChangeListeners: Set<PageChangeListener> = new Set();
  
  // 페이지네이션 상태
  private currentPage: number = 0;
  private totalPages: number = 1;
  private pageBreaks: number[] = [];
  private charsPerPage: number = 800;
  
  // 원본 텍스트
  private originalText: string = '';
  
  constructor() {
    Logger.log('PreviewRenderer: 초기화 완료');
  }
  
  // =============================================================================
  // IPopupComponent 구현
  // =============================================================================
  
  /**
   * 컴포넌트 초기화
   */
  async initialize(context: RenderContext): Promise<void> {
    try {
      this.context = context;
      
      // 페이지네이션 상태 초기화
      const paginationState = context.pagination;
      this.currentPage = paginationState.currentPage;
      this.totalPages = paginationState.totalPages;
      this.pageBreaks = [...paginationState.pageBreaks];
      this.charsPerPage = paginationState.charsPerPage;
      
      this.isInitialized = true;
      
      Logger.log('PreviewRenderer: 초기화 완료');
      
    } catch (error) {
      Logger.error('PreviewRenderer: 초기화 중 오류', error);
      throw error;
    }
  }
  
  /**
   * 미리보기 영역 렌더링
   */
  render(): HTMLElement {
    if (!this.context) {
      throw new Error('PreviewRenderer: 초기화되지 않은 상태에서 render 호출');
    }
    
    try {
      // 미리보기 컨테이너 생성
      this.containerElement = this.createPreviewContainer();
      
      // 콘텐츠 영역 렌더링
      this.renderContent();
      
      // 페이지네이션 렌더링 (긴 텍스트인 경우)
      if (this.context.state.isLongText) {
        this.renderPagination();
      }
      
      Logger.debug('PreviewRenderer: 렌더링 완료');
      
      return this.containerElement;
      
    } catch (error) {
      Logger.error('PreviewRenderer: 렌더링 중 오류', error);
      throw error;
    }
  }
  
  /**
   * 컴포넌트 업데이트
   */
  update(state: Partial<PopupState>): void {
    if (!this.isInitialized || !this.context) {
      Logger.warn('PreviewRenderer: 초기화되지 않은 상태에서 update 호출');
      return;
    }
    
    try {
      // 컨텍스트 상태 업데이트
      this.context.state = { ...this.context.state, ...state };
      
      // 페이지 변경 처리
      if (state.currentPreviewPage !== undefined) {
        this.currentPage = state.currentPreviewPage;
        this.updateContent();
        this.updatePagination();
      }
      
      // 총 페이지 수 변경 처리
      if (state.totalPreviewPages !== undefined) {
        this.totalPages = state.totalPreviewPages;
        this.updatePagination();
      }
      
      // 긴 텍스트 상태 변경 처리
      if (state.isLongText !== undefined) {
        if (state.isLongText && !this.paginationElement) {
          this.renderPagination();
        } else if (!state.isLongText && this.paginationElement) {
          this.paginationElement.remove();
          this.paginationElement = undefined;
        }
      }
      
      Logger.debug('PreviewRenderer: 업데이트 완료', { updatedFields: Object.keys(state) });
      
    } catch (error) {
      Logger.error('PreviewRenderer: 업데이트 중 오류', error);
    }
  }
  
  /**
   * 컴포넌트 정리
   */
  dispose(): void {
    try {
      // 이벤트 리스너 정리
      this.errorClickListeners.clear();
      this.pageChangeListeners.clear();
      
      // DOM 요소 정리
      if (this.containerElement) {
        this.containerElement.remove();
        this.containerElement = undefined;
      }
      
      this.contentElement = undefined;
      this.paginationElement = undefined;
      this.pageInfoElement = undefined;
      this.prevButtonElement = undefined;
      this.nextButtonElement = undefined;
      
      // 상태 초기화
      this.currentPageText = '';
      this.currentCorrections = [];
      this.originalText = '';
      
      this.isInitialized = false;
      this.context = undefined;
      
      Logger.log('PreviewRenderer: 정리 완료');
      
    } catch (error) {
      Logger.error('PreviewRenderer: 정리 중 오류', error);
    }
  }
  
  /**
   * 가시성 확인
   */
  isVisible(): boolean {
    return this.isInitialized && !!this.containerElement && this.containerElement.isConnected;
  }
  
  // =============================================================================
  // 미리보기 구조 생성
  // =============================================================================
  
  /**
   * 미리보기 컨테이너 생성
   */
  private createPreviewContainer(): HTMLElement {
    const container = createEl('div', {
      cls: 'korean-grammar-popup-preview-container'
    });
    
    // 컨테이너 스타일 설정
    Object.assign(container.style, {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden'
    });
    
    return container;
  }
  
  /**
   * 콘텐츠 영역 렌더링
   */
  private renderContent(): void {
    if (!this.containerElement) return;
    
    // 콘텐츠 영역 생성
    this.contentElement = createEl('div', {
      cls: 'korean-grammar-popup-preview-content',
      parent: this.containerElement
    });
    
    // 콘텐츠 스타일 설정
    Object.assign(this.contentElement.style, {
      flex: '1',
      padding: '16px',
      overflow: 'auto',
      fontSize: '14px',
      lineHeight: '1.6',
      backgroundColor: 'var(--background-primary)',
      fontFamily: 'var(--font-text)'
    });
    
    // 초기 콘텐츠 업데이트
    this.updateContent();
  }
  
  /**
   * 페이지네이션 렌더링
   */
  private renderPagination(): void {
    if (!this.containerElement) return;
    
    // 페이지네이션 컨테이너 생성
    this.paginationElement = createEl('div', {
      cls: 'korean-grammar-popup-preview-pagination',
      parent: this.containerElement
    });
    
    // 페이지네이션 스타일 설정
    Object.assign(this.paginationElement.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      borderTop: '1px solid var(--background-modifier-border)',
      backgroundColor: 'var(--background-secondary)'
    });
    
    // 이전 페이지 버튼
    this.prevButtonElement = this.createPaginationButton('prev', '이전');
    this.paginationElement.appendChild(this.prevButtonElement);
    
    // 페이지 정보
    this.pageInfoElement = createEl('span', {
      cls: 'korean-grammar-popup-preview-page-info',
      parent: this.paginationElement
    });
    
    Object.assign(this.pageInfoElement.style, {
      fontSize: '12px',
      color: 'var(--text-muted)',
      fontWeight: '500'
    });
    
    // 다음 페이지 버튼
    this.nextButtonElement = this.createPaginationButton('next', '다음');
    this.paginationElement.appendChild(this.nextButtonElement);
    
    // 초기 페이지네이션 업데이트
    this.updatePagination();
  }
  
  /**
   * 페이지네이션 버튼 생성
   */
  private createPaginationButton(type: 'prev' | 'next', text: string): HTMLElement {
    const button = createEl('button', {
      cls: [`korean-grammar-popup-preview-pagination-button`, `korean-grammar-popup-preview-pagination-button-${type}`],
      text
    });
    
    // 버튼 스타일
    Object.assign(button.style, {
      padding: '6px 12px',
      border: '1px solid var(--background-modifier-border)',
      borderRadius: '4px',
      backgroundColor: 'var(--background-primary)',
      color: 'var(--text-normal)',
      fontSize: '12px',
      cursor: 'pointer',
      transition: 'all 0.2s ease'
    });
    
    // 클릭 이벤트
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (button.hasAttribute('disabled')) return;
      
      if (type === 'prev') {
        this.goToPrevPage();
      } else {
        this.goToNextPage();
      }
    });
    
    // Hover 효과는 CSS :hover로 처리 (preview.css에서 정의)

    return button;
  }
  
  // =============================================================================
  // 콘텐츠 업데이트
  // =============================================================================
  
  /**
   * 콘텐츠 업데이트
   */
  private updateContent(): void {
    if (!this.contentElement || !this.context) return;
    
    try {
      // 현재 페이지 텍스트 계산
      this.calculateCurrentPageText();
      
      // 현재 페이지의 교정 목록 계산
      this.calculateCurrentCorrections();
      
      // HTML 생성 및 렌더링
      this.renderContentElement();
      
      // 오류 클릭 이벤트 등록
      this.registerErrorClickEvents();
      
      Logger.debug('PreviewRenderer: 콘텐츠 업데이트 완료');
      
    } catch (error) {
      Logger.error('PreviewRenderer: 콘텐츠 업데이트 중 오류', error);
    }
  }
  
  /**
   * 현재 페이지 텍스트 계산
   */
  private calculateCurrentPageText(): void {
    if (!this.context) return;
    
    // 원본 텍스트 (실제 사용 시에는 context에서 가져와야 함)
    // 임시로 빈 문자열 사용
    if (!this.originalText) {
      this.originalText = this.context.state.isLongText ? 
        '이것은 긴 텍스트의 예시입니다. 실제로는 context에서 전체 텍스트를 가져와야 합니다.' : 
        '짧은 텍스트 예시입니다.';
    }
    
    if (!this.context.state.isLongText) {
      // 단일 페이지
      this.currentPageText = this.originalText;
    } else {
      // 다중 페이지
      const startPos = this.currentPage === 0 ? 0 : this.pageBreaks[this.currentPage - 1];
      const endPos = this.currentPage === this.totalPages - 1 ? 
        this.originalText.length : 
        this.pageBreaks[this.currentPage];
      
      this.currentPageText = this.originalText.slice(startPos, endPos);
    }
  }
  
  /**
   * 현재 페이지의 교정 목록 계산
   */
  private calculateCurrentCorrections(): void {
    if (!this.context) return;
    
    // 실제 구현에서는 context에서 corrections를 가져와야 함
    // 임시로 빈 배열 사용
    this.currentCorrections = [];
    
    Logger.debug('PreviewRenderer: 현재 교정 목록 계산 완료', {
      correctionCount: this.currentCorrections.length
    });
  }
  
  /**
   * 콘텐츠 HTML 생성
   */
  private generateContentHTML(): string {
    if (!this.currentPageText) {
      return '<p style="color: var(--text-muted); text-align: center; padding: 40px;">텍스트가 없습니다.</p>';
    }
    
    let html = escapeHtml(this.currentPageText);
    
    // 오류 하이라이트 적용
    for (let i = this.currentCorrections.length - 1; i >= 0; i--) {
      const correction = this.currentCorrections[i];
      const errorId = `error-${i}`;
      
      // 오류 텍스트를 하이라이트 요소로 교체
      const errorText = escapeHtml(correction.correction.original);
      const highlightHtml = this.createErrorHighlightHTML(errorId, errorText, correction.correction);
      
      // 정규식을 사용한 안전한 교체
      const regex = new RegExp(escapeRegExp(errorText), 'g');
      let replacedCount = 0;
      
      html = html.replace(regex, (match) => {
        if (replacedCount === 0) {
          replacedCount++;
          return highlightHtml;
        }
        return match;
      });
    }
    
    // 빈 줄을 <br>로 변환
    html = html.replace(/\n/g, '<br>');
    
    return `<div class="korean-grammar-popup-preview-text">${html}</div>`;
  }
  
  /**
   * 오류 하이라이트 HTML 생성
   */
  private createErrorHighlightHTML(errorId: string, errorText: string, correction: Correction): string {
    const classes = [
      'korean-grammar-error-highlight',
      'korean-grammar-error-clickable'
    ];
    
    // 교정 상태에 따른 클래스 추가
    // 실제 구현에서는 correction의 상태를 확인해야 함
    classes.push('korean-grammar-error-pending');
    
    const dataAttributes = [
      `data-error-id="${errorId}"`,
      `data-original="${escapeHtml(correction.original)}"`,
      `data-corrected="${escapeHtml(JSON.stringify(correction.corrected))}"`,
      `data-help="${escapeHtml(correction.help || '')}"`
    ];
    
    return `<span class="${classes.join(' ')}" ${dataAttributes.join(' ')}>${errorText}</span>`;
  }
  
  // =============================================================================
  // 이벤트 처리
  // =============================================================================
  
  /**
   * 오류 클릭 이벤트 등록
   */
  private registerErrorClickEvents(): void {
    if (!this.contentElement) return;
    
    // 이벤트 위임 사용
    this.contentElement.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      
      if (target.classList.contains('korean-grammar-error-clickable')) {
        e.preventDefault();
        e.stopPropagation();
        
        this.handleErrorClick(target, e);
      }
    });
    
    Logger.debug('PreviewRenderer: 오류 클릭 이벤트 등록 완료');
  }
  
  /**
   * 오류 클릭 처리
   */
  private handleErrorClick(element: HTMLElement, event: MouseEvent): void {
    const errorId = element.getAttribute('data-error-id');
    if (!errorId) return;
    
    const correctionIndex = parseInt(errorId.replace('error-', ''), 10);
    const correction = this.currentCorrections[correctionIndex];
    
    if (!correction) {
      Logger.warn('PreviewRenderer: 해당하는 교정을 찾을 수 없음', { errorId, correctionIndex });
      return;
    }
    
    // 오류 클릭 이벤트 발생
    const clickEvent: ErrorClickEvent = {
      correctionIndex,
      correction: correction.correction,
      element,
      position: { x: event.clientX, y: event.clientY }
    };
    
    this.notifyErrorClickListeners(clickEvent);
    
    Logger.debug('PreviewRenderer: 오류 클릭 처리', { errorId, correctionIndex });
  }
  
  // =============================================================================
  // 페이지네이션 처리
  // =============================================================================
  
  /**
   * 페이지네이션 업데이트
   */
  private updatePagination(): void {
    if (!this.paginationElement) return;
    
    // 페이지 정보 업데이트
    if (this.pageInfoElement) {
      this.pageInfoElement.textContent = `${this.currentPage + 1} / ${this.totalPages}`;
    }
    
    // 버튼 상태 업데이트 (CSS 클래스 사용)
    if (this.prevButtonElement) {
      if (this.currentPage <= 0) {
        this.prevButtonElement.setAttribute('disabled', 'true');
        this.prevButtonElement.addClass('kga-button-disabled');
      } else {
        this.prevButtonElement.removeAttribute('disabled');
        this.prevButtonElement.removeClass('kga-button-disabled');
      }
    }

    if (this.nextButtonElement) {
      if (this.currentPage >= this.totalPages - 1) {
        this.nextButtonElement.setAttribute('disabled', 'true');
        this.nextButtonElement.addClass('kga-button-disabled');
      } else {
        this.nextButtonElement.removeAttribute('disabled');
        this.nextButtonElement.removeClass('kga-button-disabled');
      }
    }
    
    Logger.debug('PreviewRenderer: 페이지네이션 업데이트 완료');
  }
  
  /**
   * 이전 페이지로 이동
   */
  private goToPrevPage(): void {
    if (this.currentPage <= 0) return;
    
    this.currentPage--;
    this.updateContent();
    this.updatePagination();
    
    // 페이지 변경 이벤트 발생
    this.notifyPageChangeListeners({
      currentPage: this.currentPage,
      totalPages: this.totalPages,
      pageText: this.currentPageText
    });
    
    Logger.debug('PreviewRenderer: 이전 페이지로 이동', { currentPage: this.currentPage });
  }
  
  /**
   * 다음 페이지로 이동
   */
  private goToNextPage(): void {
    if (this.currentPage >= this.totalPages - 1) return;
    
    this.currentPage++;
    this.updateContent();
    this.updatePagination();
    
    // 페이지 변경 이벤트 발생
    this.notifyPageChangeListeners({
      currentPage: this.currentPage,
      totalPages: this.totalPages,
      pageText: this.currentPageText
    });
    
    Logger.debug('PreviewRenderer: 다음 페이지로 이동', { currentPage: this.currentPage });
  }
  
  // =============================================================================
  // 리사이즈 처리
  // =============================================================================
  
  /**
   * 리사이즈 처리
   */
  handleResize(): void {
    if (!this.containerElement || !this.context) return;
    
    // 동적 페이지 크기 재계산 (긴 텍스트인 경우)
    if (this.context.state.isLongText) {
      const newCharsPerPage = calculateDynamicCharsPerPage();
      
      if (Math.abs(newCharsPerPage - this.charsPerPage) > 100) {
        // 페이지 크기가 크게 변경된 경우 재계산
        this.charsPerPage = newCharsPerPage;
        this.recalculatePages();
      }
    }
    
    Logger.debug('PreviewRenderer: 리사이즈 처리 완료');
  }
  
  /**
   * 페이지 재계산
   */
  private recalculatePages(): void {
    if (!this.originalText) return;
    
    this.pageBreaks = splitTextIntoPages(this.originalText, this.charsPerPage);
    this.totalPages = this.pageBreaks.length;
    
    // splitTextIntoPages는 이미 페이지 경계점들을 반환하므로 추가 처리 불필요
    
    // 현재 페이지가 범위를 벗어나면 조정
    if (this.currentPage >= this.totalPages) {
      this.currentPage = Math.max(0, this.totalPages - 1);
    }
    
    // 콘텐츠 및 페이지네이션 업데이트
    this.updateContent();
    this.updatePagination();
    
    Logger.debug('PreviewRenderer: 페이지 재계산 완료', {
      totalPages: this.totalPages,
      currentPage: this.currentPage,
      charsPerPage: this.charsPerPage
    });
  }
  
  // =============================================================================
  // 이벤트 관리
  // =============================================================================
  
  /**
   * 오류 클릭 리스너 추가
   */
  addErrorClickListener(listener: ErrorClickListener): void {
    this.errorClickListeners.add(listener);
    Logger.debug('PreviewRenderer: 오류 클릭 리스너 추가', {
      listenerCount: this.errorClickListeners.size
    });
  }
  
  /**
   * 오류 클릭 리스너 제거
   */
  removeErrorClickListener(listener: ErrorClickListener): void {
    const removed = this.errorClickListeners.delete(listener);
    Logger.debug('PreviewRenderer: 오류 클릭 리스너 제거', {
      removed,
      listenerCount: this.errorClickListeners.size
    });
  }
  
  /**
   * 페이지 변경 리스너 추가
   */
  addPageChangeListener(listener: PageChangeListener): void {
    this.pageChangeListeners.add(listener);
    Logger.debug('PreviewRenderer: 페이지 변경 리스너 추가', {
      listenerCount: this.pageChangeListeners.size
    });
  }
  
  /**
   * 페이지 변경 리스너 제거
   */
  removePageChangeListener(listener: PageChangeListener): void {
    const removed = this.pageChangeListeners.delete(listener);
    Logger.debug('PreviewRenderer: 페이지 변경 리스너 제거', {
      removed,
      listenerCount: this.pageChangeListeners.size
    });
  }
  
  /**
   * 오류 클릭 리스너들에게 알림
   */
  private notifyErrorClickListeners(event: ErrorClickEvent): void {
    for (const listener of this.errorClickListeners) {
      try {
        listener(event);
      } catch (error) {
        Logger.error('PreviewRenderer: 오류 클릭 리스너 실행 중 오류', { error, event });
      }
    }
  }
  
  /**
   * 페이지 변경 리스너들에게 알림
   */
  private notifyPageChangeListeners(event: PageChangeEvent): void {
    for (const listener of this.pageChangeListeners) {
      try {
        listener(event);
      } catch (error) {
        Logger.error('PreviewRenderer: 페이지 변경 리스너 실행 중 오류', { error, event });
      }
    }
  }
  
  // =============================================================================
  // 공개 API
  // =============================================================================
  
  /**
   * 특정 페이지로 이동
   */
  goToPage(pageIndex: number): void {
    if (pageIndex < 0 || pageIndex >= this.totalPages) {
      Logger.warn('PreviewRenderer: 잘못된 페이지 인덱스', { pageIndex, totalPages: this.totalPages });
      return;
    }
    
    if (this.currentPage !== pageIndex) {
      this.currentPage = pageIndex;
      this.updateContent();
      this.updatePagination();
      
      // 페이지 변경 이벤트 발생
      this.notifyPageChangeListeners({
        currentPage: this.currentPage,
        totalPages: this.totalPages,
        pageText: this.currentPageText
      });
    }
  }
  
  /**
   * 원본 텍스트 설정
   */
  setOriginalText(text: string): void {
    this.originalText = text;
    
    // 페이지 재계산 (긴 텍스트인 경우)
    if (this.context?.state.isLongText) {
      this.recalculatePages();
    } else {
      this.updateContent();
    }
    
    Logger.debug('PreviewRenderer: 원본 텍스트 설정 완료', { textLength: text.length });
  }
  
  /**
   * 교정 목록 설정
   */
  setCorrections(corrections: PageCorrection[]): void {
    this.currentCorrections = [...corrections];
    this.updateContent();
    
    Logger.debug('PreviewRenderer: 교정 목록 설정 완료', { correctionCount: corrections.length });
  }
  
  /**
   * 현재 페이지 정보 조회
   */
  getCurrentPageInfo(): { currentPage: number; totalPages: number; pageText: string } {
    return {
      currentPage: this.currentPage,
      totalPages: this.totalPages,
      pageText: this.currentPageText
    };
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      isInitialized: this.isInitialized,
      hasContainer: !!this.containerElement,
      pagination: {
        currentPage: this.currentPage,
        totalPages: this.totalPages,
        charsPerPage: this.charsPerPage,
        pageBreaksCount: this.pageBreaks.length
      },
      content: {
        originalTextLength: this.originalText.length,
        currentPageTextLength: this.currentPageText.length,
        correctionCount: this.currentCorrections.length
      },
      elements: {
        content: !!this.contentElement,
        pagination: !!this.paginationElement,
        pageInfo: !!this.pageInfoElement,
        prevButton: !!this.prevButtonElement,
        nextButton: !!this.nextButtonElement
      },
      listeners: {
        errorClick: this.errorClickListeners.size,
        pageChange: this.pageChangeListeners.size
      }
    };
  }

  /**
   * 콘텐츠 요소를 안전하게 렌더링합니다.
   */
  private renderContentElement(): void {
    if (!this.contentElement) return;
    
    // 기존 내용 제거
    this.contentElement.empty();
    
    // 텍스트 세그먼트 생성 및 렌더링
    const segments = this.createTextSegments();
    
    segments.forEach(segment => {
      const span = this.contentElement?.createSpan();
      if (!span) return;
      span.textContent = segment.text;
      
      if (segment.correctionIndex !== undefined) {
        span.className = `clickable-error ${segment.className || ''}`;
        span.dataset.correctionIndex = segment.correctionIndex.toString();
        span.dataset.uniqueId = segment.uniqueId || '';
        span.setAttribute('tabindex', '0');
      }
    });
  }

  /**
   * 텍스트를 세그먼트로 분할합니다.
   */
  private createTextSegments(): Array<{
    text: string;
    correctionIndex?: number;
    className?: string;
    uniqueId?: string;
  }> {
    const segments: Array<{
      text: string;
      correctionIndex?: number;
      className?: string;
      uniqueId?: string;
    }> = [];
    
    let lastEnd = 0;
    
    // 현재 페이지의 교정사항들을 위치 순으로 처리
    this.currentCorrections.forEach((correction, index) => {
      const positionInPage = correction.positionInPage || 0;
      const originalText = correction.correction.original;
      
      // 교정 전 텍스트 추가
      if (positionInPage > lastEnd) {
        segments.push({
          text: this.currentPageText.slice(lastEnd, positionInPage)
        });
      }
      
      // 교정 세그먼트 추가
      segments.push({
        text: originalText, // 여기서는 원본 텍스트를 보여주고, 상태에 따라 클래스 적용
        correctionIndex: correction.originalIndex,
        className: this.getDisplayClass(correction.originalIndex || 0),
        uniqueId: correction.uniqueId
      });
      
      lastEnd = positionInPage + originalText.length;
    });
    
    // 남은 텍스트 추가
    if (lastEnd < this.currentPageText.length) {
      segments.push({
        text: this.currentPageText.slice(lastEnd)
      });
    }
    
    return segments;
  }

  /**
   * 교정 인덱스에 대한 표시 클래스를 반환합니다.
   * (실제 구현에서는 상태 관리자에서 가져와야 함)
   */
  private getDisplayClass(correctionIndex: number): string {
    // 실제 구현에서는 CorrectionStateManager에서 가져와야 함
    // 여기서는 기본값 반환
    return 'error-state';
  }
}