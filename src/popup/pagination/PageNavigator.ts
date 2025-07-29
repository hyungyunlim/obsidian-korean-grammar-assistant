/**
 * 페이지 이동 및 상태 업데이트 담당 클래스
 * 페이지 네비게이션 로직과 상태 동기화를 관리
 */

import { createEl } from '../../utils/domUtils';
import { PopupState, PaginationState, PageInfo, IPopupComponent, RenderContext, PopupEventType } from '../types/PopupTypes';
import { Logger } from '../../utils/logger';

export interface PageNavigationEvent {
  type: 'page-changed' | 'page-loading' | 'page-error';
  currentPage: number;
  totalPages: number;
  previousPage?: number;
  pageInfo?: PageInfo;
  error?: string;
}

export class PageNavigator implements IPopupComponent {
  private currentPage: number = 0;
  private totalPages: number = 1;
  private pages: PageInfo[] = [];
  private navigationHistory: number[] = [];
  private isNavigating: boolean = false;
  private containerElement?: HTMLElement;
  private eventListeners: Array<() => void> = [];

  // 이벤트 콜백
  private onPageChangeCallback?: (event: PageNavigationEvent) => void;
  private onNavigationErrorCallback?: (error: string) => void;

  constructor() {
  }

  async initialize(context: RenderContext): Promise<void> {
    Logger.log('[PageNavigator] 초기화 시작');
    
    this.currentPage = context.pagination.currentPage || 0;
    this.totalPages = context.pagination.totalPages || 1;
    
    // 네비게이션 히스토리 초기화
    this.navigationHistory = [this.currentPage];
    
    Logger.log('[PageNavigator] 초기화 완료', {
      currentPage: this.currentPage,
      totalPages: this.totalPages
    });
  }

  render(): HTMLElement {
    const container = createEl('div', { cls: 'page-navigator' });
    this.containerElement = container;
    
    // 페이지 네비게이션 컨트롤 생성
    const navControls = this.createNavigationControls();
    container.appendChild(navControls);
    
    // 페이지 인디케이터 생성
    const pageIndicator = this.createPageIndicator();
    container.appendChild(pageIndicator);
    
    return container;
  }

  update(state: Partial<PopupState>): void {
    let shouldUpdate = false;
    
    if (state.currentPreviewPage !== undefined && state.currentPreviewPage !== this.currentPage) {
      this.currentPage = state.currentPreviewPage;
      shouldUpdate = true;
    }
    
    if (state.totalPreviewPages !== undefined && state.totalPreviewPages !== this.totalPages) {
      this.totalPages = state.totalPreviewPages;
      shouldUpdate = true;
    }
    
    if (shouldUpdate) {
      this.updateNavigationUI();
    }
  }

  dispose(): void {
    Logger.log('[PageNavigator] 정리 시작');
    
    // 이벤트 리스너 정리
    this.eventListeners.forEach(cleanup => cleanup());
    this.eventListeners = [];
    
    // 콜백 정리
    this.onPageChangeCallback = undefined;
    this.onNavigationErrorCallback = undefined;
    this.navigationHistory = [];
    
    // 컨테이너 정리
    this.containerElement = undefined;
    
    Logger.log('[PageNavigator] 정리 완료');
  }

  isVisible(): boolean {
    return this.totalPages > 1;
  }

  // =============================================================================
  // 페이지 네비게이션 핵심 메서드
  // =============================================================================

  /**
   * 페이지 정보 설정
   */
  setPages(pages: PageInfo[]): void {
    this.pages = pages;
    this.totalPages = pages.length;
    
    // 현재 페이지가 범위를 벗어나면 조정
    if (this.currentPage >= this.totalPages) {
      this.currentPage = Math.max(0, this.totalPages - 1);
    }
    
    Logger.log('[PageNavigator] 페이지 정보 설정', {
      totalPages: this.totalPages,
      currentPage: this.currentPage
    });
    
    this.updateNavigationUI();
  }

  /**
   * 특정 페이지로 이동
   */
  async goToPage(pageIndex: number, addToHistory: boolean = true): Promise<boolean> {
    if (this.isNavigating) {
      Logger.warn('[PageNavigator] 네비게이션이 이미 진행 중');
      return false;
    }

    if (pageIndex < 0 || pageIndex >= this.totalPages) {
      const error = `잘못된 페이지 인덱스: ${pageIndex} (범위: 0-${this.totalPages - 1})`;
      Logger.error('[PageNavigator] 페이지 이동 실패', { error });
      this.triggerNavigationError(error);
      return false;
    }

    if (pageIndex === this.currentPage) {
      Logger.debug('[PageNavigator] 이미 현재 페이지에 있음', { pageIndex });
      return true;
    }

    this.isNavigating = true;
    const previousPage = this.currentPage;

    try {
      // 페이지 변경 이벤트 발생 (로딩 상태)
      this.triggerPageChange({
        type: 'page-loading',
        currentPage: pageIndex,
        totalPages: this.totalPages,
        previousPage: previousPage
      });

      // 페이지 변경
      this.currentPage = pageIndex;

      // 히스토리에 추가
      if (addToHistory) {
        this.addToNavigationHistory(pageIndex);
      }

      // 페이지 정보 조회
      const pageInfo = this.pages[pageIndex] || null;

      // 페이지 변경 완료 이벤트 발생
      this.triggerPageChange({
        type: 'page-changed',
        currentPage: this.currentPage,
        totalPages: this.totalPages,
        previousPage: previousPage,
        pageInfo: pageInfo
      });

      // UI 업데이트
      this.updateNavigationUI();

      Logger.log('[PageNavigator] 페이지 이동 완료', {
        from: previousPage,
        to: this.currentPage,
        totalPages: this.totalPages
      });

      return true;

    } catch (error) {
      const errorMessage = `페이지 이동 중 오류 발생: ${error}`;
      Logger.error('[PageNavigator] 페이지 이동 오류', { error: errorMessage });
      
      // 이전 페이지로 복원
      this.currentPage = previousPage;
      
      this.triggerNavigationError(errorMessage);
      return false;

    } finally {
      this.isNavigating = false;
    }
  }

  /**
   * 다음 페이지로 이동
   */
  async goToNextPage(): Promise<boolean> {
    return await this.goToPage(this.currentPage + 1);
  }

  /**
   * 이전 페이지로 이동
   */
  async goToPreviousPage(): Promise<boolean> {
    return await this.goToPage(this.currentPage - 1);
  }

  /**
   * 첫 번째 페이지로 이동
   */
  async goToFirstPage(): Promise<boolean> {
    return await this.goToPage(0);
  }

  /**
   * 마지막 페이지로 이동
   */
  async goToLastPage(): Promise<boolean> {
    return await this.goToPage(this.totalPages - 1);
  }

  /**
   * 네비게이션 히스토리에서 이전 페이지로 이동
   */
  async goBackInHistory(): Promise<boolean> {
    if (this.navigationHistory.length < 2) {
      Logger.debug('[PageNavigator] 히스토리에 이전 페이지 없음');
      return false;
    }

    // 현재 페이지 제거
    this.navigationHistory.pop();
    
    // 이전 페이지 조회
    const previousPage = this.navigationHistory[this.navigationHistory.length - 1];
    
    return await this.goToPage(previousPage, false); // 히스토리에 추가하지 않음
  }

  // =============================================================================
  // 상태 조회 메서드
  // =============================================================================

  getCurrentPage(): number {
    return this.currentPage;
  }

  getTotalPages(): number {
    return this.totalPages;
  }

  getCurrentPageInfo(): PageInfo | null {
    if (this.currentPage >= 0 && this.currentPage < this.pages.length) {
      return { ...this.pages[this.currentPage] };
    }
    return null;
  }

  getNavigationState(): {
    currentPage: number;
    totalPages: number;
    canGoNext: boolean;
    canGoPrev: boolean;
    canGoBack: boolean;
    isNavigating: boolean;
  } {
    return {
      currentPage: this.currentPage,
      totalPages: this.totalPages,
      canGoNext: this.currentPage < this.totalPages - 1,
      canGoPrev: this.currentPage > 0,
      canGoBack: this.navigationHistory.length > 1,
      isNavigating: this.isNavigating
    };
  }

  getNavigationHistory(): number[] {
    return [...this.navigationHistory];
  }

  // =============================================================================
  // 이벤트 콜백 설정
  // =============================================================================

  setPageChangeCallback(callback: (event: PageNavigationEvent) => void): void {
    this.onPageChangeCallback = callback;
  }

  setNavigationErrorCallback(callback: (error: string) => void): void {
    this.onNavigationErrorCallback = callback;
  }

  // =============================================================================
  // Private 메서드
  // =============================================================================

  private createNavigationControls(): HTMLElement {
    const controls = createEl('div', { cls: 'navigation-controls' });
    
    // 첫 페이지 버튼
    const firstButton = createEl('button', {
      cls: 'nav-button first',
      attr: { 'data-action': 'first', title: '첫 페이지' }
    });
    firstButton.textContent = '⟪';
    
    // 이전 페이지 버튼
    const prevButton = createEl('button', {
      cls: 'nav-button prev',
      attr: { 'data-action': 'prev', title: '이전 페이지' }
    });
    prevButton.textContent = '◀';
    
    // 다음 페이지 버튼
    const nextButton = createEl('button', {
      cls: 'nav-button next',
      attr: { 'data-action': 'next', title: '다음 페이지' }
    });
    nextButton.textContent = '▶';
    
    // 마지막 페이지 버튼
    const lastButton = createEl('button', {
      cls: 'nav-button last',
      attr: { 'data-action': 'last', title: '마지막 페이지' }
    });
    lastButton.textContent = '⟫';
    
    controls.appendChild(firstButton);
    controls.appendChild(prevButton);
    controls.appendChild(nextButton);
    controls.appendChild(lastButton);
    
    // 클릭 이벤트 등록
    const clickHandler = this.handleNavigationClick.bind(this);
    controls.addEventListener('click', clickHandler);
    this.eventListeners.push(() => controls.removeEventListener('click', clickHandler));
    
    return controls;
  }

  private createPageIndicator(): HTMLElement {
    const indicator = createEl('div', { cls: 'page-indicator' });
    
    const pageText = createEl('span', { cls: 'page-text' });
    pageText.textContent = this.getPageText();
    
    indicator.appendChild(pageText);
    return indicator;
  }

  private updateNavigationUI(): void {
    const container = this.containerElement;
    if (!container) return;

    // 버튼 상태 업데이트
    const firstButton = container.querySelector('.nav-button.first') as HTMLButtonElement;
    const prevButton = container.querySelector('.nav-button.prev') as HTMLButtonElement;
    const nextButton = container.querySelector('.nav-button.next') as HTMLButtonElement;
    const lastButton = container.querySelector('.nav-button.last') as HTMLButtonElement;
    
    if (firstButton) firstButton.disabled = this.currentPage === 0 || this.isNavigating;
    if (prevButton) prevButton.disabled = this.currentPage === 0 || this.isNavigating;
    if (nextButton) nextButton.disabled = this.currentPage >= this.totalPages - 1 || this.isNavigating;
    if (lastButton) lastButton.disabled = this.currentPage >= this.totalPages - 1 || this.isNavigating;

    // 페이지 텍스트 업데이트
    const pageText = container.querySelector('.page-text') as HTMLElement;
    if (pageText) {
      pageText.textContent = this.getPageText();
    }
  }

  private getPageText(): string {
    if (this.totalPages <= 1) {
      return '';
    }
    return `${this.currentPage + 1} / ${this.totalPages}`;
  }

  private addToNavigationHistory(pageIndex: number): void {
    // 연속된 같은 페이지는 히스토리에 추가하지 않음
    if (this.navigationHistory.length === 0 || 
        this.navigationHistory[this.navigationHistory.length - 1] !== pageIndex) {
      this.navigationHistory.push(pageIndex);
      
      // 히스토리 크기 제한 (최대 20개)
      if (this.navigationHistory.length > 20) {
        this.navigationHistory.shift();
      }
    }
  }

  private async handleNavigationClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement;
    const action = target.getAttribute('data-action');
    
    if (!action || this.isNavigating) return;

    switch (action) {
      case 'first':
        await this.goToFirstPage();
        break;
      case 'prev':
        await this.goToPreviousPage();
        break;
      case 'next':
        await this.goToNextPage();
        break;
      case 'last':
        await this.goToLastPage();
        break;
    }
  }

  private triggerPageChange(event: PageNavigationEvent): void {
    if (this.onPageChangeCallback) {
      try {
        this.onPageChangeCallback(event);
      } catch (error) {
        Logger.error('[PageNavigator] 페이지 변경 콜백 오류', { error });
      }
    }
  }

  private triggerNavigationError(error: string): void {
    if (this.onNavigationErrorCallback) {
      try {
        this.onNavigationErrorCallback(error);
      } catch (callbackError) {
        Logger.error('[PageNavigator] 네비게이션 오류 콜백 오류', { callbackError });
      }
    }
  }
}