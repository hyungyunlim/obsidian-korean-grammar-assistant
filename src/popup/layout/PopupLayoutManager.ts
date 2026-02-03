/**
 * 팝업 레이아웃 관리자
 * 전체 팝업 구조를 관리하고 각 영역별 렌더러를 조율
 */

import { Platform } from 'obsidian';
import { 
  RenderContext, 
  LayoutState, 
  LayoutArea, 
  IPopupComponent,
  PopupState 
} from '../types/PopupTypes';
import { HeaderRenderer } from './HeaderRenderer';
import { PreviewRenderer } from './PreviewRenderer';
import { SummaryRenderer } from './SummaryRenderer';
import { Logger } from '../../utils/logger';
import { createEl } from '../../utils/domUtils';

/**
 * 레이아웃 변경 이벤트 타입
 */
export type LayoutChangeEvent = {
  area: LayoutArea;
  type: 'resize' | 'visibility' | 'content';
  data: any;
};

export type LayoutChangeListener = (event: LayoutChangeEvent) => void;

/**
 * 팝업 레이아웃 관리자 클래스
 */
export class PopupLayoutManager implements IPopupComponent {
  private context?: RenderContext;
  private layoutState: LayoutState;
  
  // 영역별 렌더러들
  private headerRenderer: HeaderRenderer;
  private previewRenderer: PreviewRenderer;
  private summaryRenderer: SummaryRenderer;
  
  // DOM 요소들
  private containerElement?: HTMLElement;
  private headerElement?: HTMLElement;
  private previewElement?: HTMLElement;
  private summaryElement?: HTMLElement;
  private footerElement?: HTMLElement;
  
  // 이벤트 관리
  private layoutListeners: Set<LayoutChangeListener> = new Set();
  private resizeObserver?: ResizeObserver;
  
  // 상태 관리
  private isInitialized: boolean = false;
  private lastResizeTime: number = 0;
  private resizeThrottleMs: number = 100;
  
  constructor() {
    // 기본 레이아웃 상태 초기화
    this.layoutState = {
      areaVisibility: {
        header: true,
        preview: true,
        summary: true,
        footer: false // 기본적으로 푸터는 숨김
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
    };
    
    // 영역별 렌더러 초기화
    this.headerRenderer = new HeaderRenderer();
    this.previewRenderer = new PreviewRenderer();
    this.summaryRenderer = new SummaryRenderer();
    
    Logger.log('PopupLayoutManager: 초기화 완료', {
      breakpoint: this.layoutState.currentBreakpoint
    });
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
      
      // 하위 렌더러들 초기화
      await this.headerRenderer.initialize(context);
      await this.previewRenderer.initialize(context);
      await this.summaryRenderer.initialize(context);
      
      // 반응형 레이아웃 설정
      if (this.layoutState.responsiveEnabled) {
        this.setupResponsiveLayout();
      }
      
      // 리사이즈 옵저버 설정
      this.setupResizeObserver();
      
      this.isInitialized = true;
      
      Logger.log('PopupLayoutManager: 초기화 완료');
      
    } catch (error) {
      Logger.error('PopupLayoutManager: 초기화 중 오류', error);
      throw error;
    }
  }
  
  /**
   * 전체 팝업 구조 렌더링
   */
  render(): HTMLElement {
    if (!this.context) {
      throw new Error('PopupLayoutManager: 초기화되지 않은 상태에서 render 호출');
    }
    
    try {
      // 메인 컨테이너 생성
      this.containerElement = this.createMainContainer();
      
      // 각 영역 렌더링 및 추가
      this.renderHeader();
      this.renderPreview();
      this.renderSummary();
      this.renderFooter();
      
      // 반응형 클래스 적용
      this.applyResponsiveClasses();
      
      // 초기 레이아웃 계산
      this.calculateInitialLayout();
      
      Logger.log('PopupLayoutManager: 렌더링 완료');
      
      return this.containerElement;
      
    } catch (error) {
      Logger.error('PopupLayoutManager: 렌더링 중 오류', error);
      throw error;
    }
  }
  
  /**
   * 컴포넌트 업데이트
   */
  update(state: Partial<PopupState>): void {
    if (!this.isInitialized || !this.context) {
      Logger.warn('PopupLayoutManager: 초기화되지 않은 상태에서 update 호출');
      return;
    }
    
    try {
      // 컨텍스트 상태 업데이트
      this.context.state = { ...this.context.state, ...state };
      
      // 하위 렌더러들 업데이트
      this.headerRenderer.update(state);
      this.previewRenderer.update(state);
      this.summaryRenderer.update(state);
      
      // 레이아웃 재계산 (필요한 경우)
      if (this.shouldRecalculateLayout(state)) {
        this.recalculateLayout();
      }
      
      Logger.debug('PopupLayoutManager: 업데이트 완료', { updatedFields: Object.keys(state) });
      
    } catch (error) {
      Logger.error('PopupLayoutManager: 업데이트 중 오류', error);
    }
  }
  
  /**
   * 컴포넌트 정리
   */
  dispose(): void {
    try {
      // 리사이즈 옵저버 정리
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = undefined;
      }
      
      // 하위 렌더러들 정리
      this.headerRenderer.dispose();
      this.previewRenderer.dispose();
      this.summaryRenderer.dispose();
      
      // 이벤트 리스너 정리
      this.layoutListeners.clear();
      
      // DOM 요소 정리
      if (this.containerElement) {
        this.containerElement.remove();
        this.containerElement = undefined;
      }
      
      this.headerElement = undefined;
      this.previewElement = undefined;
      this.summaryElement = undefined;
      this.footerElement = undefined;
      
      this.isInitialized = false;
      this.context = undefined;
      
      Logger.log('PopupLayoutManager: 정리 완료');
      
    } catch (error) {
      Logger.error('PopupLayoutManager: 정리 중 오류', error);
    }
  }
  
  /**
   * 가시성 확인
   */
  isVisible(): boolean {
    return this.isInitialized && !!this.containerElement && this.containerElement.isConnected;
  }
  
  // =============================================================================
  // 레이아웃 구조 생성
  // =============================================================================
  
  /**
   * 메인 컨테이너 생성
   */
  private createMainContainer(): HTMLElement {
    const container = createEl('div', {
      cls: [
        'korean-grammar-popup',
        'korean-grammar-popup-modern',
        `korean-grammar-popup-${this.layoutState.currentBreakpoint}`
      ]
    });

    // 동적 계산이 필요한 스타일만 JavaScript로 설정
    // (maxWidth, maxHeight는 브레이크포인트에 따라 달라짐)
    container.style.setProperty('--kga-max-width', this.getMaxWidth());
    container.style.setProperty('--kga-max-height', this.getMaxHeight());

    // 커스텀 클래스 추가
    if (this.layoutState.customClasses.length > 0) {
      container.classList.add(...this.layoutState.customClasses);
    }

    return container;
  }
  
  /**
   * 헤더 영역 렌더링
   */
  private renderHeader(): void {
    if (!this.containerElement || !this.layoutState.areaVisibility.header) {
      return;
    }
    
    try {
      this.headerElement = this.headerRenderer.render();
      this.headerElement.classList.add('korean-grammar-popup-header');
      
      this.containerElement.appendChild(this.headerElement);
      
      Logger.debug('PopupLayoutManager: 헤더 렌더링 완료');
      
    } catch (error) {
      Logger.error('PopupLayoutManager: 헤더 렌더링 중 오류', error);
    }
  }
  
  /**
   * 미리보기 영역 렌더링
   */
  private renderPreview(): void {
    if (!this.containerElement || !this.layoutState.areaVisibility.preview) {
      return;
    }

    try {
      this.previewElement = this.previewRenderer.render();
      this.previewElement.classList.add('korean-grammar-popup-preview');

      // CSS에서 처리: flex-grow, minHeight, overflow는 CSS 클래스로 정의됨

      this.containerElement.appendChild(this.previewElement);

      Logger.debug('PopupLayoutManager: 미리보기 렌더링 완료');

    } catch (error) {
      Logger.error('PopupLayoutManager: 미리보기 렌더링 중 오류', error);
    }
  }
  
  /**
   * 오류 요약 영역 렌더링
   */
  private renderSummary(): void {
    if (!this.containerElement || !this.layoutState.areaVisibility.summary) {
      return;
    }
    
    try {
      this.summaryElement = this.summaryRenderer.render();
      this.summaryElement.classList.add('korean-grammar-popup-summary');
      
      this.containerElement.appendChild(this.summaryElement);
      
      Logger.debug('PopupLayoutManager: 오류 요약 렌더링 완료');
      
    } catch (error) {
      Logger.error('PopupLayoutManager: 오류 요약 렌더링 중 오류', error);
    }
  }
  
  /**
   * 푸터 영역 렌더링
   */
  private renderFooter(): void {
    if (!this.containerElement || !this.layoutState.areaVisibility.footer) {
      return;
    }

    try {
      this.footerElement = createEl('div', {
        cls: 'korean-grammar-popup-footer'
      });

      // 푸터 버튼들 (적용, 취소 등)
      const buttonContainer = createEl('div', {
        cls: 'korean-grammar-popup-footer-buttons',
        parent: this.footerElement
      });

      // CSS에서 처리: flexbox layout, gap, padding는 CSS 클래스로 정의됨

      this.containerElement.appendChild(this.footerElement);

      Logger.debug('PopupLayoutManager: 푸터 렌더링 완료');

    } catch (error) {
      Logger.error('PopupLayoutManager: 푸터 렌더링 중 오류', error);
    }
  }
  
  // =============================================================================
  // 반응형 레이아웃
  // =============================================================================
  
  /**
   * 반응형 레이아웃 설정
   */
  setupResponsiveLayout(): void {
    if (!this.layoutState.responsiveEnabled) {
      return;
    }
    
    // 브레이크포인트 계산
    const updateBreakpoint = () => {
      const windowWidth = window.innerWidth;
      let newBreakpoint: 'mobile' | 'tablet' | 'desktop';
      
      if (Platform.isMobile || windowWidth < 768) {
        newBreakpoint = 'mobile';
      } else if (windowWidth < 1024) {
        newBreakpoint = 'tablet';
      } else {
        newBreakpoint = 'desktop';
      }
      
      if (newBreakpoint !== this.layoutState.currentBreakpoint) {
        this.layoutState.currentBreakpoint = newBreakpoint;
        this.applyResponsiveClasses();
        
        Logger.debug('PopupLayoutManager: 브레이크포인트 변경', { 
          breakpoint: newBreakpoint,
          windowWidth 
        });
      }
    };
    
    // 초기 브레이크포인트 설정
    updateBreakpoint();
    
    // 윈도우 리사이즈 이벤트 리스너
    window.addEventListener('resize', updateBreakpoint);
    
    Logger.debug('PopupLayoutManager: 반응형 레이아웃 설정 완료');
  }
  
  /**
   * 반응형 클래스 적용
   */
  private applyResponsiveClasses(): void {
    if (!this.containerElement) return;
    
    // 기존 브레이크포인트 클래스 제거
    this.containerElement.classList.remove(
      'korean-grammar-popup-mobile',
      'korean-grammar-popup-tablet',
      'korean-grammar-popup-desktop'
    );
    
    // 새 브레이크포인트 클래스 추가
    this.containerElement.classList.add(
      `korean-grammar-popup-${this.layoutState.currentBreakpoint}`
    );
    
    // 브레이크포인트별 스타일 조정
    switch (this.layoutState.currentBreakpoint) {
      case 'mobile':
        this.applyMobileStyles();
        break;
      case 'tablet':
        this.applyTabletStyles();
        break;
      case 'desktop':
        this.applyDesktopStyles();
        break;
    }
  }
  
  /**
   * 모바일 스타일 적용
   */
  private applyMobileStyles(): void {
    if (!this.containerElement) return;

    // CSS 클래스로 레이아웃 크기 적용 (--kga-max-width, --kga-max-height)
    // 값은 styles.css의 .korean-grammar-popup-mobile에서 정의됨

    // 오류 요약 영역을 기본적으로 접힘
    if (this.context) {
      this.context.state.isErrorSummaryExpanded = false;
    }
  }
  
  /**
   * 태블릿 스타일 적용
   */
  private applyTabletStyles(): void {
    if (!this.containerElement) return;

    // CSS 클래스로 레이아웃 크기 적용 (--kga-max-width, --kga-max-height)
    // 값은 styles.css의 .korean-grammar-popup-tablet에서 정의됨
  }
  
  /**
   * 데스크톱 스타일 적용
   */
  private applyDesktopStyles(): void {
    if (!this.containerElement) return;

    // CSS 클래스로 레이아웃 크기 적용 (--kga-max-width, --kga-max-height)
    // 값은 styles.css의 .korean-grammar-popup-desktop에서 정의됨
  }
  
  // =============================================================================
  // 리사이즈 처리
  // =============================================================================
  
  /**
   * 리사이즈 옵저버 설정
   */
  private setupResizeObserver(): void {
    if (!window.ResizeObserver) {
      Logger.warn('PopupLayoutManager: ResizeObserver가 지원되지 않음');
      return;
    }
    
    this.resizeObserver = new ResizeObserver((entries) => {
      const now = Date.now();
      if (now - this.lastResizeTime < this.resizeThrottleMs) {
        return; // 스로틀링
      }
      
      this.lastResizeTime = now;
      this.handleResize(entries);
    });
  }
  
  /**
   * 리사이즈 처리
   */
  handleResize(entries?: ResizeObserverEntry[]): void {
    if (!this.containerElement || !this.context) {
      return;
    }
    
    try {
      // 각 영역 크기 업데이트
      this.updateAreaSizes();
      
      // 하위 렌더러들에게 리사이즈 알림
      if (this.headerRenderer.handleResize) {
        this.headerRenderer.handleResize();
      }
      if (this.previewRenderer.handleResize) {
        this.previewRenderer.handleResize();
      }
      if (this.summaryRenderer.handleResize) {
        this.summaryRenderer.handleResize();
      }
      
      // 레이아웃 변경 이벤트 발생
      this.notifyLayoutChange({
        area: 'preview', // 주로 미리보기 영역이 영향받음
        type: 'resize',
        data: { timestamp: Date.now() }
      });
      
      Logger.debug('PopupLayoutManager: 리사이즈 처리 완료');
      
    } catch (error) {
      Logger.error('PopupLayoutManager: 리사이즈 처리 중 오류', error);
    }
  }
  
  /**
   * 각 영역 크기 업데이트
   */
  private updateAreaSizes(): void {
    const areas = [
      { element: this.headerElement, area: 'header' as LayoutArea },
      { element: this.previewElement, area: 'preview' as LayoutArea },
      { element: this.summaryElement, area: 'summary' as LayoutArea },
      { element: this.footerElement, area: 'footer' as LayoutArea }
    ];
    
    for (const { element, area } of areas) {
      if (element) {
        const rect = element.getBoundingClientRect();
        this.layoutState.areaSizes[area] = {
          width: rect.width,
          height: rect.height
        };
      }
    }
  }
  
  // =============================================================================
  // 레이아웃 계산
  // =============================================================================
  
  /**
   * 초기 레이아웃 계산
   */
  private calculateInitialLayout(): void {
    if (!this.containerElement) return;
    
    // 컨테이너 중앙 정렬 (데스크톱의 경우)
    if (this.layoutState.currentBreakpoint === 'desktop') {
      this.centerContainer();
    }
    
    // 각 영역 크기 측정
    this.updateAreaSizes();
    
    // 리사이즈 옵저버 시작
    if (this.resizeObserver && this.containerElement) {
      this.resizeObserver.observe(this.containerElement);
    }
    
    Logger.debug('PopupLayoutManager: 초기 레이아웃 계산 완료');
  }
  
  /**
   * 컨테이너 중앙 정렬
   */
  private centerContainer(): void {
    if (!this.containerElement) return;

    const rect = this.containerElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const left = Math.max(0, (viewportWidth - rect.width) / 2);
    const top = Math.max(0, (viewportHeight - rect.height) / 2);

    // 동적 계산이 필요한 위치 스타일만 JavaScript로 설정
    this.containerElement.style.setProperty('--kga-pos-left', `${left}px`);
    this.containerElement.style.setProperty('--kga-pos-top', `${top}px`);
  }
  
  /**
   * 레이아웃 재계산이 필요한지 확인
   */
  private shouldRecalculateLayout(state: Partial<PopupState>): boolean {
    return !!(
      state.isErrorSummaryExpanded !== undefined ||
      state.currentPreviewPage !== undefined ||
      state.isLongText !== undefined
    );
  }
  
  /**
   * 레이아웃 재계산
   */
  private recalculateLayout(): void {
    if (!this.isInitialized) return;
    
    // 영역 가시성 업데이트
    this.updateAreaVisibility();
    
    // 크기 재계산
    this.updateAreaSizes();
    
    // 컨테이너 위치 재조정 (필요한 경우)
    if (this.layoutState.currentBreakpoint === 'desktop') {
      this.centerContainer();
    }
    
    Logger.debug('PopupLayoutManager: 레이아웃 재계산 완료');
  }
  
  /**
   * 영역 가시성 업데이트
   */
  private updateAreaVisibility(): void {
    if (!this.context) return;

    const state = this.context.state;

    // 오류 요약 영역 가시성
    if (this.summaryElement) {
      const isVisible = state.isErrorSummaryExpanded;
      // CSS 클래스로 가시성 제어
      if (isVisible) {
        this.summaryElement.classList.remove('kga-hidden');
        this.summaryElement.classList.add('kga-block');
      } else {
        this.summaryElement.classList.remove('kga-block');
        this.summaryElement.classList.add('kga-hidden');
      }
      this.layoutState.areaVisibility.summary = isVisible;
    }
  }
  
  // =============================================================================
  // 유틸리티 메서드
  // =============================================================================
  
  /**
   * 최대 너비 계산
   */
  private getMaxWidth(): string {
    switch (this.layoutState.currentBreakpoint) {
      case 'mobile':
        return '100vw';
      case 'tablet':
        return '90vw';
      case 'desktop':
      default:
        return '1200px';
    }
  }
  
  /**
   * 최대 높이 계산
   */
  private getMaxHeight(): string {
    switch (this.layoutState.currentBreakpoint) {
      case 'mobile':
        return '100vh';
      case 'tablet':
        return '90vh';
      case 'desktop':
      default:
        return '800px';
    }
  }
  
  /**
   * 영역 가시성 토글
   */
  toggleAreaVisibility(area: LayoutArea): void {
    this.layoutState.areaVisibility[area] = !this.layoutState.areaVisibility[area];

    const element = this.getAreaElement(area);
    if (element) {
      // CSS 클래스로 가시성 제어
      if (this.layoutState.areaVisibility[area]) {
        element.classList.remove('kga-hidden');
        element.classList.add('kga-block');
      } else {
        element.classList.remove('kga-block');
        element.classList.add('kga-hidden');
      }
    }

    this.notifyLayoutChange({
      area,
      type: 'visibility',
      data: { visible: this.layoutState.areaVisibility[area] }
    });

    Logger.debug('PopupLayoutManager: 영역 가시성 토글', {
      area,
      visible: this.layoutState.areaVisibility[area]
    });
  }
  
  /**
   * 영역 요소 조회
   */
  private getAreaElement(area: LayoutArea): HTMLElement | undefined {
    switch (area) {
      case 'header':
        return this.headerElement;
      case 'preview':
        return this.previewElement;
      case 'summary':
        return this.summaryElement;
      case 'footer':
        return this.footerElement;
      default:
        return undefined;
    }
  }
  
  // =============================================================================
  // 이벤트 관리
  // =============================================================================
  
  /**
   * 레이아웃 변경 리스너 추가
   */
  addLayoutChangeListener(listener: LayoutChangeListener): void {
    this.layoutListeners.add(listener);
    Logger.debug('PopupLayoutManager: 레이아웃 변경 리스너 추가', {
      listenerCount: this.layoutListeners.size
    });
  }
  
  /**
   * 레이아웃 변경 리스너 제거
   */
  removeLayoutChangeListener(listener: LayoutChangeListener): void {
    const removed = this.layoutListeners.delete(listener);
    Logger.debug('PopupLayoutManager: 레이아웃 변경 리스너 제거', {
      removed,
      listenerCount: this.layoutListeners.size
    });
  }
  
  /**
   * 레이아웃 변경 알림
   */
  private notifyLayoutChange(event: LayoutChangeEvent): void {
    for (const listener of this.layoutListeners) {
      try {
        listener(event);
      } catch (error) {
        Logger.error('PopupLayoutManager: 레이아웃 변경 리스너 실행 중 오류', { error, event });
      }
    }
  }
  
  // =============================================================================
  // 상태 조회
  // =============================================================================
  
  /**
   * 현재 레이아웃 상태 조회
   */
  getLayoutState(): LayoutState {
    return { ...this.layoutState };
  }
  
  /**
   * 특정 영역 크기 조회
   */
  getAreaSize(area: LayoutArea): { width: number; height: number } {
    return { ...this.layoutState.areaSizes[area] };
  }
  
  /**
   * 현재 브레이크포인트 조회
   */
  getCurrentBreakpoint(): 'mobile' | 'tablet' | 'desktop' {
    return this.layoutState.currentBreakpoint;
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      isInitialized: this.isInitialized,
      layoutState: this.layoutState,
      hasContainer: !!this.containerElement,
      elements: {
        header: !!this.headerElement,
        preview: !!this.previewElement,
        summary: !!this.summaryElement,
        footer: !!this.footerElement
      },
      listenerCount: this.layoutListeners.size,
      hasResizeObserver: !!this.resizeObserver,
      lastResizeTime: this.lastResizeTime
    };
  }
}