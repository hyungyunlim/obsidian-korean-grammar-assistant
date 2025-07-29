/**
 * 페이지네이션 전체 관리자
 * 동적 페이지 분할, 네비게이션, 상태 관리를 총괄하는 클래스
 */

import { createEl } from '../../utils/domUtils';
import { PageSplitter } from './PageSplitter';
import { PageNavigator } from './PageNavigator';
import { PopupState, PaginationState, PageInfo, PageSplitOptions, IPopupComponent, RenderContext } from '../types/PopupTypes';
import { Correction, PageCorrection } from '../../types/interfaces';
import { Logger } from '../../utils/logger';

export class PaginationManager implements IPopupComponent {
  private pageSplitter: PageSplitter;
  private pageNavigator: PageNavigator;
  private state: PaginationState;
  private pages: PageInfo[] = [];
  private corrections: Correction[] = [];
  private selectedText: string = '';
  private containerElement?: HTMLElement;
  private eventListeners: Array<() => void> = [];

  constructor() {
    this.pageSplitter = new PageSplitter();
    this.pageNavigator = new PageNavigator();
    this.state = this.createInitialState();
  }

  async initialize(context: RenderContext): Promise<void> {
    Logger.log('[PaginationManager] 초기화 시작');
    
    this.state = {
      ...this.state,
      currentPage: context.pagination.currentPage || 0,
      charsPerPage: context.pagination.charsPerPage || 800,
      dynamicSizing: context.pagination.dynamicSizing !== false,
    };

    await this.pageSplitter.initialize(context);
    await this.pageNavigator.initialize(context);
    
    Logger.log('[PaginationManager] 초기화 완료', { state: this.state });
  }

  render(): HTMLElement {
    const container = createEl('div', { cls: 'pagination-container' });
    this.containerElement = container;
    
    // 페이지 내비게이션 컨트롤
    const navContainer = createEl('div', { cls: 'pagination-nav' });
    
    // 이전 페이지 버튼
    const prevButton = createEl('button', { 
      cls: 'pagination-button prev',
      attr: { 'data-action': 'prev-page' }
    });
    prevButton.textContent = '◀';
    prevButton.disabled = this.state.currentPage === 0;
    
    // 페이지 정보
    const pageInfo = createEl('span', { cls: 'pagination-info' });
    pageInfo.textContent = this.getPageInfoText();
    
    // 다음 페이지 버튼
    const nextButton = createEl('button', { 
      cls: 'pagination-button next',
      attr: { 'data-action': 'next-page' }
    });
    nextButton.textContent = '▶';
    nextButton.disabled = this.state.currentPage >= this.state.totalPages - 1;
    
    navContainer.appendChild(prevButton);
    navContainer.appendChild(pageInfo);
    navContainer.appendChild(nextButton);
    container.appendChild(navContainer);
    
    // 이벤트 리스너 등록
    const clickHandler = this.handleNavigationClick.bind(this);
    container.addEventListener('click', clickHandler);
    this.eventListeners.push(() => container.removeEventListener('click', clickHandler));
    
    return container;
  }

  update(state: Partial<PopupState>): void {
    if (state.currentPreviewPage !== undefined) {
      this.state.currentPage = state.currentPreviewPage;
    }
    if (state.totalPreviewPages !== undefined) {
      this.state.totalPages = state.totalPreviewPages;
    }
    
    // UI 업데이트
    this.updateNavigationControls();
  }

  dispose(): void {
    Logger.log('[PaginationManager] 정리 시작');
    
    // 이벤트 리스너 정리
    this.eventListeners.forEach(cleanup => cleanup());
    this.eventListeners = [];
    
    // 하위 컴포넌트 정리
    this.pageSplitter.dispose();
    this.pageNavigator.dispose();
    
    // 컨테이너 정리
    this.containerElement = undefined;
    
    Logger.log('[PaginationManager] 정리 완료');
  }

  isVisible(): boolean {
    return this.state.totalPages > 1;
  }

  // =============================================================================
  // 페이지네이션 핵심 메서드
  // =============================================================================

  /**
   * 텍스트와 교정 목록으로 페이지네이션 초기화
   */
  initializePagination(text: string, corrections: Correction[]): void {
    Logger.log('[PaginationManager] 페이지네이션 초기화', { 
      textLength: text.length, 
      correctionCount: corrections.length 
    });

    this.selectedText = text;
    this.corrections = corrections;

    // 동적 페이지 크기 계산
    if (this.state.dynamicSizing) {
      this.state.charsPerPage = this.calculateDynamicCharsPerPage();
    }

    // 페이지 분할 실행
    this.pages = this.pageSplitter.splitTextIntoPages(text, {
      defaultPageSize: this.state.charsPerPage,
      minPageSize: 500,
      maxPageSize: 2000,
      preferSentenceBoundary: true,
      considerErrorExpansion: this.isErrorSummaryExpanded()
    });

    // 페이지 분할점 업데이트
    this.state.pageBreaks = this.pages.map(page => page.endPos);
    this.state.totalPages = this.pages.length;
    this.state.currentPage = 0;

    Logger.log('[PaginationManager] 페이지 분할 완료', {
      totalPages: this.state.totalPages,
      charsPerPage: this.state.charsPerPage,
      pageBreaks: this.state.pageBreaks
    });
  }

  /**
   * 현재 페이지의 교정 목록 반환
   */
  getCurrentPageCorrections(): PageCorrection[] {
    if (!this.pages.length || this.state.currentPage >= this.pages.length) {
      return [];
    }

    const currentPage = this.pages[this.state.currentPage];
    const pageCorrections: PageCorrection[] = [];

    // 현재 페이지 텍스트 범위 내의 교정만 필터링
    this.corrections.forEach((correction, index) => {
      const correctionStart = this.selectedText.indexOf(correction.original);
      if (correctionStart >= 0) {
        // 교정이 현재 페이지 범위 내에 있는지 확인
        if (correctionStart >= currentPage.startPos && correctionStart < currentPage.endPos) {
          pageCorrections.push({
            correction,
            // 기존 필드들 (하위 호환성)
            originalIndex: index,
            positionInPage: correctionStart - currentPage.startPos,
            absolutePosition: correctionStart,
            uniqueId: `${index}_${this.state.currentPage}`,
            // Phase 3 필드들
            pageIndex: this.state.currentPage,
            absoluteIndex: index,
            relativeIndex: pageCorrections.length,
            isVisible: true
          });
        }
      }
    });

    return pageCorrections.slice(0, 10); // 페이지당 최대 10개 교정으로 제한
  }

  /**
   * 특정 페이지로 이동
   */
  goToPage(pageIndex: number): boolean {
    if (pageIndex < 0 || pageIndex >= this.state.totalPages) {
      Logger.warn('[PaginationManager] 잘못된 페이지 인덱스', { pageIndex, totalPages: this.state.totalPages });
      return false;
    }

    const previousPage = this.state.currentPage;
    this.state.currentPage = pageIndex;

    Logger.log('[PaginationManager] 페이지 이동', { 
      from: previousPage, 
      to: pageIndex,
      totalPages: this.state.totalPages
    });

    // 네비게이션 컨트롤 업데이트
    this.updateNavigationControls();

    return true;
  }

  /**
   * 다음 페이지로 이동
   */
  nextPage(): boolean {
    return this.goToPage(this.state.currentPage + 1);
  }

  /**
   * 이전 페이지로 이동
   */
  previousPage(): boolean {
    return this.goToPage(this.state.currentPage - 1);
  }

  /**
   * 페이지 크기 업데이트 (동적 계산)
   */
  updatePageSize(): void {
    if (!this.state.dynamicSizing) {
      return;
    }

    const newCharsPerPage = this.calculateDynamicCharsPerPage();
    const sizeChange = Math.abs(newCharsPerPage - this.state.charsPerPage);

    // 100자 이상 차이날 때만 재계산
    if (sizeChange >= 100) {
      Logger.log('[PaginationManager] 페이지 크기 업데이트', {
        oldSize: this.state.charsPerPage,
        newSize: newCharsPerPage,
        change: sizeChange
      });

      this.state.charsPerPage = newCharsPerPage;
      this.state.lastSizeUpdate = Date.now();

      // 페이지 재분할 필요 시 수행
      if (this.selectedText) {
        this.initializePagination(this.selectedText, this.corrections);
      }
    }
  }

  // =============================================================================
  // 상태 조회 메서드
  // =============================================================================

  getPaginationState(): PaginationState {
    return { ...this.state };
  }

  getCurrentPageInfo(): PageInfo | null {
    if (this.state.currentPage >= 0 && this.state.currentPage < this.pages.length) {
      return { ...this.pages[this.state.currentPage] };
    }
    return null;
  }

  getAllPages(): PageInfo[] {
    return [...this.pages];
  }

  isLongText(): boolean {
    return this.state.totalPages > 1;
  }

  // =============================================================================
  // Private 헬퍼 메서드
  // =============================================================================

  private createInitialState(): PaginationState {
    return {
      pageBreaks: [],
      charsPerPage: 800,
      currentPage: 0,
      totalPages: 1,
      dynamicSizing: true,
      lastSizeUpdate: Date.now()
    };
  }

  private calculateDynamicCharsPerPage(): number {
    // DOM 요소 기반 동적 페이지 크기 계산
    const previewElement = document.getElementById('resultPreview');
    const errorSummary = document.getElementById('errorSummary');

    if (previewElement) {
      const previewRect = previewElement.getBoundingClientRect();
      const isErrorExpanded = errorSummary && !errorSummary.classList.contains('collapsed');
      
      const availableHeight = previewRect.height;
      const avgCharsPerLine = 75;
      const lineHeight = 15 * 1.7; // CSS line-height 고려
      const linesPerPage = Math.floor(availableHeight / lineHeight);
      
      let calculatedChars: number;
      if (isErrorExpanded) {
        // 오류 영역이 펼쳐진 경우 더 작은 페이지
        calculatedChars = Math.max(500, Math.min(1000, linesPerPage * avgCharsPerLine));
      } else {
        // 오류 영역이 접힌 경우 더 큰 페이지
        calculatedChars = Math.max(800, Math.min(1800, linesPerPage * avgCharsPerLine));
      }
      
      return calculatedChars;
    }
    
    return 800; // 기본값
  }

  private isErrorSummaryExpanded(): boolean {
    const errorSummary = document.getElementById('errorSummary');
    return errorSummary ? !errorSummary.classList.contains('collapsed') : true;
  }

  private getPageInfoText(): string {
    if (this.state.totalPages <= 1) {
      return '페이지 1/1';
    }
    return `페이지 ${this.state.currentPage + 1}/${this.state.totalPages}`;
  }

  private updateNavigationControls(): void {
    const container = this.containerElement;
    if (!container) return;

    // 버튼 상태 업데이트
    const prevButton = container.querySelector('.pagination-button.prev') as HTMLButtonElement;
    const nextButton = container.querySelector('.pagination-button.next') as HTMLButtonElement;
    const pageInfo = container.querySelector('.pagination-info') as HTMLElement;

    if (prevButton) {
      prevButton.disabled = this.state.currentPage === 0;
    }
    if (nextButton) {
      nextButton.disabled = this.state.currentPage >= this.state.totalPages - 1;
    }
    if (pageInfo) {
      pageInfo.textContent = this.getPageInfoText();
    }
  }

  private handleNavigationClick(event: Event): void {
    const target = event.target as HTMLElement;
    const action = target.getAttribute('data-action');

    switch (action) {
      case 'prev-page':
        this.previousPage();
        break;
      case 'next-page':
        this.nextPage();
        break;
    }
  }
}