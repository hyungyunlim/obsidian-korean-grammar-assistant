/**
 * ComponentManager.ts
 * 
 * Phase 7: UI 컴포넌트 및 렌더링 시스템
 * UI 컴포넌트 관리자 - UI 컴포넌트 생명주기, 템플릿 관리, 레이아웃 조정
 */

import { App } from 'obsidian';
import { PageCorrection, CorrectionState, RenderContext } from '../../types/interfaces';
import { Logger } from '../../utils/logger';
import { ErrorRenderer, ErrorRenderOptions } from './ErrorRenderer';
import { InteractionHandler, InteractionConfig } from './InteractionHandler';
import { createEl } from '../../utils/domUtils';

export interface ComponentConfig {
  containerSelector: string;
  enableVirtualScrolling: boolean;
  maxVisibleItems: number;
  itemHeight: number;
  bufferSize: number;
  lazyLoadThreshold: number;
}

export interface LayoutMetrics {
  containerWidth: number;
  containerHeight: number;
  itemHeight: number;
  visibleItems: number;
  totalItems: number;
  scrollTop: number;
}

export interface ComponentTemplate {
  name: string;
  html: string;
  css?: string;
  bindings?: Record<string, any>;
}

export class ComponentManager {
  private app: App;
  private errorRenderer: ErrorRenderer;
  private interactionHandler: InteractionHandler;
  private config: ComponentConfig;

  // 컴포넌트 컨테이너
  private containerElement: HTMLElement | null = null;
  private previewContainer: HTMLElement | null = null;
  private summaryContainer: HTMLElement | null = null;

  // 가상 스크롤링
  private virtualScrollEnabled: boolean = false;
  private visibleRange: { start: number; end: number } = { start: 0, end: 0 };
  private itemPool: HTMLElement[] = [];
  private scrollObserver: IntersectionObserver | null = null;

  // 템플릿 시스템
  private templates: Map<string, ComponentTemplate> = new Map();
  private componentCache: Map<string, HTMLElement> = new Map();

  // 레이아웃 관리
  private layoutMetrics: LayoutMetrics;
  private resizeObserver: ResizeObserver | null = null;
  private layoutUpdateCallback: (() => void) | null = null;

  constructor(
    app: App,
    errorRenderer: ErrorRenderer,
    interactionHandler: InteractionHandler,
    config: Partial<ComponentConfig> = {}
  ) {
    this.app = app;
    this.errorRenderer = errorRenderer;
    this.interactionHandler = interactionHandler;
    this.config = {
      containerSelector: '.spell-popup-content',
      enableVirtualScrolling: false,
      maxVisibleItems: 50,
      itemHeight: 32,
      bufferSize: 5,
      lazyLoadThreshold: 10,
      ...config
    };

    this.layoutMetrics = {
      containerWidth: 0,
      containerHeight: 0,
      itemHeight: this.config.itemHeight,
      visibleItems: 0,
      totalItems: 0,
      scrollTop: 0
    };

    this.initializeTemplates();
    this.setupResizeObserver();

    Logger.debug('ComponentManager: 초기화 완료', { config: this.config });
  }

  /**
   * 컴포넌트 시스템 초기화
   */
  async initialize(containerElement: HTMLElement): Promise<void> {
    this.containerElement = containerElement;
    
    // 하위 컨테이너 찾기 또는 생성
    this.previewContainer = containerElement.querySelector('.preview-container') as HTMLElement;
    this.summaryContainer = containerElement.querySelector('.summary-container') as HTMLElement;

    if (!this.previewContainer) {
      this.previewContainer = createEl('div', { cls: 'preview-container' });
      containerElement.appendChild(this.previewContainer);
    }

    if (!this.summaryContainer) {
      this.summaryContainer = createEl('div', { cls: 'summary-container' });
      containerElement.appendChild(this.summaryContainer);
    }

    // 레이아웃 메트릭 초기화
    this.updateLayoutMetrics();

    // 가상 스크롤링 설정
    if (this.config.enableVirtualScrolling) {
      this.setupVirtualScrolling();
    }

    // 교차 관찰자 설정
    this.setupIntersectionObserver();

    Logger.debug('ComponentManager: 초기화 완료', {
      container: !!this.containerElement,
      preview: !!this.previewContainer,
      summary: !!this.summaryContainer,
      virtualScroll: this.virtualScrollEnabled
    });
  }

  /**
   * 오류 컴포넌트 렌더링
   */
  async renderErrorComponents(corrections: PageCorrection[]): Promise<void> {
    if (!this.previewContainer || !this.summaryContainer) {
      Logger.error('ComponentManager: 컨테이너가 초기화되지 않음');
      return;
    }

    this.layoutMetrics.totalItems = corrections.length;

    // 가상 스크롤링 사용 여부 결정
    const useVirtualScrolling = this.shouldUseVirtualScrolling(corrections.length);

    if (useVirtualScrolling) {
      await this.renderVirtualizedComponents(corrections);
    } else {
      await this.renderAllComponents(corrections);
    }

    // 레이아웃 업데이트
    this.updateLayoutMetrics();

    Logger.debug('ComponentManager: 컴포넌트 렌더링 완료', {
      count: corrections.length,
      virtual: useVirtualScrolling,
      visible: this.visibleRange
    });
  }

  /**
   * 모든 컴포넌트 직접 렌더링
   */
  private async renderAllComponents(corrections: PageCorrection[]): Promise<void> {
    // 기존 컴포넌트 정리
    this.clearContainers();

    for (let i = 0; i < corrections.length; i++) {
      const correction = corrections[i];
      const renderContext: RenderContext = {
        state: 'error', // 기본 상태
        isActive: false,
        isFocused: false,
        isVisible: true,
        index: i
      };

      // 미리보기 컴포넌트 생성
      const previewComponent = await this.createPreviewComponent(correction, renderContext);
      this.previewContainer!.appendChild(previewComponent);

      // 요약 컴포넌트 생성
      const summaryComponent = await this.createSummaryComponent(correction, renderContext);
      this.summaryContainer!.appendChild(summaryComponent);

      // InteractionHandler에 등록
      this.interactionHandler.registerPreviewElement(correction.originalIndex, previewComponent);
      this.interactionHandler.registerSummaryElement(correction.originalIndex, summaryComponent);
    }
  }

  /**
   * 가상화된 컴포넌트 렌더링
   */
  private async renderVirtualizedComponents(corrections: PageCorrection[]): Promise<void> {
    this.virtualScrollEnabled = true;
    
    // 보이는 범위 계산
    this.calculateVisibleRange();

    // 보이는 컴포넌트만 렌더링
    for (let i = this.visibleRange.start; i <= this.visibleRange.end; i++) {
      if (i >= corrections.length) break;

      const correction = corrections[i];
      const renderContext: RenderContext = {
        state: 'error',
        isActive: false,
        isFocused: false,
        isVisible: true,
        index: i
      };

      await this.renderSingleComponent(correction, renderContext);
    }

    // 스크롤 패딩 설정
    this.updateScrollPadding(corrections.length);
  }

  /**
   * 단일 컴포넌트 렌더링
   */
  private async renderSingleComponent(
    correction: PageCorrection, 
    renderContext: RenderContext
  ): Promise<void> {
    // 미리보기 컴포넌트
    const previewComponent = await this.createPreviewComponent(correction, renderContext);
    this.previewContainer!.appendChild(previewComponent);

    // 요약 컴포넌트
    const summaryComponent = await this.createSummaryComponent(correction, renderContext);
    this.summaryContainer!.appendChild(summaryComponent);

    // 등록
    this.interactionHandler.registerPreviewElement(correction.originalIndex, previewComponent);
    this.interactionHandler.registerSummaryElement(correction.originalIndex, summaryComponent);
  }

  /**
   * 미리보기 컴포넌트 생성
   */
  private async createPreviewComponent(
    correction: PageCorrection, 
    renderContext: RenderContext
  ): Promise<HTMLElement> {
    // ErrorRenderer를 사용하여 하이라이트 요소 생성
    const highlightElement = this.errorRenderer.createErrorHighlight(correction, renderContext);
    
    // 컨테이너 래퍼 생성
    const wrapper = createEl('span', {
      cls: 'preview-error-wrapper',
      attr: {
        'data-correction-index': correction.originalIndex.toString(),
        'data-page-index': correction.pageIndex?.toString() || '0'
      }
    });

    wrapper.appendChild(highlightElement);

    // 툴팁 지원 (데스크톱)
    const errorOptions = this.getErrorRenderOptions();
    if (errorOptions.showTooltips && !errorOptions.mobileOptimized) {
      const tooltip = this.errorRenderer.createTooltip(correction, renderContext.state);
      if (tooltip) {
        wrapper.appendChild(tooltip);
      }
    }

    return wrapper;
  }

  /**
   * 요약 컴포넌트 생성
   */
  private async createSummaryComponent(
    correction: PageCorrection, 
    renderContext: RenderContext
  ): Promise<HTMLElement> {
    const template = this.templates.get('error-card');
    if (!template) {
      return this.createBasicSummaryComponent(correction, renderContext);
    }

    return this.createTemplatedSummaryComponent(correction, renderContext, template);
  }

  /**
   * 기본 요약 컴포넌트 생성
   */
  private createBasicSummaryComponent(
    correction: PageCorrection, 
    renderContext: RenderContext
  ): HTMLElement {
    const card = createEl('div', {
      cls: 'error-card',
      attr: {
        'data-correction-index': correction.originalIndex.toString(),
        'role': 'button',
        'tabindex': '0',
        'aria-label': `오류: ${correction.correction.original}`
      }
    });

    // 상태 표시기
    const stateIndicator = createEl('div', {
      cls: 'error-state-indicator',
      text: this.getStateDisplayText(renderContext.state)
    });
    card.appendChild(stateIndicator);

    // 원본 텍스트
    const originalText = createEl('div', {
      cls: 'error-original-text',
      text: correction.correction.original
    });
    card.appendChild(originalText);

    // 수정 제안
    if (correction.correction.suggestions && correction.correction.suggestions.length > 0) {
      const suggestions = createEl('div', { cls: 'error-suggestions' });
      correction.correction.suggestions.forEach((suggestion, index) => {
        const suggestionSpan = createEl('span', {
          cls: 'suggestion-item',
          text: suggestion.value,
          attr: { 'data-suggestion-index': index.toString() }
        });
        suggestions.appendChild(suggestionSpan);
        
        if (correction.correction.suggestions && index < correction.correction.suggestions.length - 1) {
          suggestions.appendChild(createEl('span', { cls: 'suggestion-separator', text: ', ' }));
        }
      });
      card.appendChild(suggestions);
    }

    return card;
  }

  /**
   * 템플릿 기반 요약 컴포넌트 생성
   */
  private createTemplatedSummaryComponent(
    correction: PageCorrection,
    renderContext: RenderContext,
    template: ComponentTemplate
  ): HTMLElement {
    // 템플릿 변수 바인딩
    const bindings = {
      originalText: correction.correction.original,
      suggestions: correction.correction.suggestions,
      state: renderContext.state,
      stateText: this.getStateDisplayText(renderContext.state),
      correctionIndex: correction.originalIndex,
      isActive: renderContext.isActive,
      ...template.bindings
    };

    // HTML 템플릿 처리
    let html = template.html;
    Object.entries(bindings).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      html = html.replace(new RegExp(placeholder, 'g'), String(value));
    });

    // DOM 요소 생성
    const wrapper = createEl('div');
    wrapper.innerHTML = html;
    
    return wrapper.firstElementChild as HTMLElement;
  }

  /**
   * 컴포넌트 업데이트
   */
  async updateComponent(
    correctionIndex: number, 
    newState: CorrectionState, 
    isActive: boolean = false
  ): Promise<void> {
    // InteractionHandler에 위임
    await this.interactionHandler.handleStateChange({
      correctionIndex,
      newState,
      isActive,
      isFocused: false,
      shouldAnimate: true,
      trigger: 'user'
    });

    Logger.debug('ComponentManager: 컴포넌트 업데이트', {
      index: correctionIndex,
      newState,
      isActive
    });
  }

  /**
   * 가상 스크롤링 설정
   */
  private setupVirtualScrolling(): void {
    if (!this.containerElement) return;

    this.containerElement.addEventListener('scroll', this.handleScroll.bind(this));
    this.virtualScrollEnabled = true;

    Logger.debug('ComponentManager: 가상 스크롤링 설정 완료');
  }

  /**
   * 스크롤 이벤트 처리
   */
  private handleScroll(): void {
    if (!this.virtualScrollEnabled || !this.containerElement) return;

    const scrollTop = this.containerElement.scrollTop;
    const oldRange = { ...this.visibleRange };

    // 새 보이는 범위 계산
    this.layoutMetrics.scrollTop = scrollTop;
    this.calculateVisibleRange();

    // 범위가 변경되었으면 컴포넌트 업데이트
    if (oldRange.start !== this.visibleRange.start || oldRange.end !== this.visibleRange.end) {
      this.updateVisibleComponents();
    }
  }

  /**
   * 보이는 범위 계산
   */
  private calculateVisibleRange(): void {
    const { scrollTop } = this.layoutMetrics;
    const { itemHeight, bufferSize } = this.config;
    const containerHeight = this.layoutMetrics.containerHeight;

    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferSize);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const end = Math.min(this.layoutMetrics.totalItems - 1, start + visibleCount + bufferSize * 2);

    this.visibleRange = { start, end };
  }

  /**
   * 보이는 컴포넌트 업데이트
   */
  private updateVisibleComponents(): void {
    // 구현 필요: 보이는 범위의 컴포넌트만 DOM에 유지
    Logger.debug('ComponentManager: 보이는 컴포넌트 업데이트', this.visibleRange);
  }

  /**
   * 스크롤 패딩 업데이트
   */
  private updateScrollPadding(totalItems: number): void {
    if (!this.virtualScrollEnabled || !this.containerElement) return;

    const totalHeight = totalItems * this.config.itemHeight;
    const visibleHeight = this.visibleRange.end * this.config.itemHeight;

    // 상단 패딩
    const topPadding = this.visibleRange.start * this.config.itemHeight;
    // 하단 패딩
    const bottomPadding = totalHeight - visibleHeight;

    this.containerElement.style.paddingTop = `${topPadding}px`;
    this.containerElement.style.paddingBottom = `${bottomPadding}px`;
  }

  /**
   * 교차 관찰자 설정
   */
  private setupIntersectionObserver(): void {
    this.scrollObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const element = entry.target as HTMLElement;
          const correctionIndex = parseInt(element.dataset.correctionIndex || '-1');
          
          if (correctionIndex >= 0) {
            // 보이는 상태 업데이트
            const isVisible = entry.isIntersecting;
            // 필요시 지연 로딩 처리
          }
        });
      },
      {
        root: this.containerElement,
        rootMargin: '50px',
        threshold: 0.1
      }
    );
  }

  /**
   * 기본 템플릿 초기화
   */
  private initializeTemplates(): void {
    // 오류 카드 템플릿
    this.templates.set('error-card', {
      name: 'error-card',
      html: `
        <div class="error-card state-{{state}}" data-correction-index="{{correctionIndex}}" role="button" tabindex="0">
          <div class="error-state-indicator">{{stateText}}</div>
          <div class="error-original-text">{{originalText}}</div>
          <div class="error-suggestions"></div>
        </div>
      `,
      bindings: {}
    });

    // 미리보기 래퍼 템플릿
    this.templates.set('preview-wrapper', {
      name: 'preview-wrapper',
      html: `
        <span class="preview-error-wrapper" data-correction-index="{{correctionIndex}}">
          <!-- ErrorRenderer가 하이라이트 요소 삽입 -->
        </span>
      `,
      bindings: {}
    });
  }

  /**
   * 레이아웃 메트릭 업데이트
   */
  private updateLayoutMetrics(): void {
    if (!this.containerElement) return;

    const rect = this.containerElement.getBoundingClientRect();
    this.layoutMetrics.containerWidth = rect.width;
    this.layoutMetrics.containerHeight = rect.height;
    this.layoutMetrics.visibleItems = Math.ceil(rect.height / this.config.itemHeight);

    Logger.debug('ComponentManager: 레이아웃 메트릭 업데이트', this.layoutMetrics);
  }

  /**
   * 리사이즈 관찰자 설정
   */
  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      entries.forEach(() => {
        this.updateLayoutMetrics();
        if (this.layoutUpdateCallback) {
          this.layoutUpdateCallback();
        }
      });
    });
  }

  /**
   * 가상 스크롤링 사용 여부 결정
   */
  private shouldUseVirtualScrolling(itemCount: number): boolean {
    return this.config.enableVirtualScrolling && itemCount > this.config.maxVisibleItems;
  }

  /**
   * ErrorRenderer 옵션 가져오기
   */
  private getErrorRenderOptions(): ErrorRenderOptions {
    return {
      showTooltips: true,
      enableHover: true,
      mobileOptimized: false,
      animationEnabled: true,
      colorScheme: 'auto'
    };
  }

  /**
   * 상태별 표시 텍스트
   */
  private getStateDisplayText(state: CorrectionState): string {
    switch (state) {
      case 'error': return '오류';
      case 'corrected': return '수정됨';
      case 'exception-processed': return '예외처리';
      case 'original-kept': return '원본유지';
      case 'user-edited': return '사용자편집';
      default: return '알 수 없음';
    }
  }

  /**
   * 컨테이너 정리
   */
  private clearContainers(): void {
    if (this.previewContainer) {
      this.previewContainer.innerHTML = '';
    }
    if (this.summaryContainer) {
      this.summaryContainer.innerHTML = '';
    }
  }

  /**
   * 레이아웃 업데이트 콜백 설정
   */
  setLayoutUpdateCallback(callback: () => void): void {
    this.layoutUpdateCallback = callback;
  }

  /**
   * 현재 레이아웃 메트릭 조회
   */
  getLayoutMetrics(): LayoutMetrics {
    return { ...this.layoutMetrics };
  }

  /**
   * 가상 스크롤링 상태 조회
   */
  isVirtualScrollEnabled(): boolean {
    return this.virtualScrollEnabled;
  }

  /**
   * 보이는 범위 조회
   */
  getVisibleRange(): { start: number; end: number } {
    return { ...this.visibleRange };
  }

  /**
   * 설정 업데이트
   */
  updateConfig(newConfig: Partial<ComponentConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // 가상 스크롤링 설정 변경 시 재초기화
    if (newConfig.enableVirtualScrolling !== undefined) {
      this.virtualScrollEnabled = newConfig.enableVirtualScrolling;
    }

    Logger.debug('ComponentManager: 설정 업데이트', this.config);
  }

  /**
   * 모든 리소스 정리
   */
  dispose(): void {
    // 관찰자 정리
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
      this.scrollObserver = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // 캐시 정리
    this.templates.clear();
    this.componentCache.clear();
    this.itemPool.length = 0;

    // 참조 정리
    this.containerElement = null;
    this.previewContainer = null;
    this.summaryContainer = null;
    this.layoutUpdateCallback = null;

    Logger.debug('ComponentManager: 리소스 정리 완료');
  }
}