import { App } from 'obsidian';
import { IPopupServiceManager, RenderContext } from '../types/PopupTypes';
import { Logger } from '../../utils/logger';

/** Chrome performance.memory non-standard extension typing */
interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
    jsHeapSizeLimit?: number;
  };
}

/**
 * Phase 5: Performance Optimizer
 * 
 * 팝업 성능 최적화를 관리하는 모듈입니다.
 * 메모리 관리, 렌더링 최적화, 이벤트 처리 효율성을 담당합니다.
 */
export class PerformanceOptimizer implements IPopupServiceManager {
  private observedElements: Set<Element> = new Set();
  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private performanceMetrics: PerformanceMetrics = {
    initTime: 0,
    renderTime: 0,
    lastUpdateTime: 0,
    memoryUsage: 0,
    domElementCount: 0
  };
  private renderScheduled: boolean = false;
  private cleanupCallbacks: (() => void)[] = [];

  constructor(private app: App) {
    Logger.log('PerformanceOptimizer 초기화됨');
  }

  /**
   * IPopupServiceManager 인터페이스 구현
   */
  async initialize(context: RenderContext): Promise<void> {
    const startTime = performance.now();
    Logger.log('PerformanceOptimizer 초기화 시작');

    // ResizeObserver 설정 (레이아웃 변경 감지)
    this.setupResizeObserver();

    // MutationObserver 설정 (DOM 변경 감지)
    this.setupMutationObserver();

    // 초기 성능 메트릭 측정
    this.performanceMetrics.initTime = performance.now() - startTime;
    this.updatePerformanceMetrics();

    Logger.log('PerformanceOptimizer 초기화 완료', {
      initTime: this.performanceMetrics.initTime,
      memoryUsage: this.performanceMetrics.memoryUsage
    });
  }

  /**
   * IPopupServiceManager 인터페이스 구현
   */
  destroy(): void {
    Logger.log('PerformanceOptimizer 정리 중');

    // Observer 정리
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.observedElements.clear();

    // 등록된 정리 콜백 실행
    this.cleanupCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error: unknown) {
        Logger.error('정리 콜백 실행 중 오류:', error);
      }
    });
    this.cleanupCallbacks = [];

    // 예약된 렌더링 취소
    if (this.renderScheduled) {
      this.renderScheduled = false;
    }

    Logger.log('PerformanceOptimizer 정리 완료');
  }

  /**
   * ResizeObserver를 설정합니다.
   */
  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') {
      Logger.warn('ResizeObserver가 지원되지 않음');
      return;
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      Logger.debug('레이아웃 변경 감지됨', { entriesCount: entries.length });
      
      // 성능을 위해 렌더링을 스케줄링
      this.scheduleRender(() => {
        this.updatePerformanceMetrics();
        entries.forEach(entry => {
          this.optimizeElementLayout(entry.target as HTMLElement);
        });
      });
    });
  }

  /**
   * MutationObserver를 설정합니다.
   */
  private setupMutationObserver(): void {
    if (typeof MutationObserver === 'undefined') {
      Logger.warn('MutationObserver가 지원되지 않음');
      return;
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      Logger.debug('DOM 변경 감지됨', { mutationsCount: mutations.length });
      
      // 성능을 위해 렌더링을 스케줄링
      this.scheduleRender(() => {
        this.updatePerformanceMetrics();
        this.optimizeDomStructure(mutations);
      });
    });
  }

  /**
   * 요소를 성능 모니터링에 추가합니다.
   */
  public observeElement(element: HTMLElement): void {
    if (!element || this.observedElements.has(element)) {
      return;
    }

    Logger.debug('요소 관찰 시작', { tagName: element.tagName, className: element.className });

    this.observedElements.add(element);
    this.resizeObserver?.observe(element);
    this.mutationObserver?.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    // 정리 콜백 등록
    this.addCleanupCallback(() => {
      this.unobserveElement(element);
    });
  }

  /**
   * 요소 관찰을 중지합니다.
   */
  public unobserveElement(element: HTMLElement): void {
    if (!this.observedElements.has(element)) {
      return;
    }

    Logger.debug('요소 관찰 중지', { tagName: element.tagName });

    this.observedElements.delete(element);
    this.resizeObserver?.unobserve(element);
  }

  /**
   * 렌더링을 스케줄링합니다 (성능 최적화).
   */
  private scheduleRender(callback: () => void): void {
    if (this.renderScheduled) {
      return;
    }

    this.renderScheduled = true;
    
    // requestAnimationFrame을 사용하여 브라우저 렌더링 사이클에 맞춤
    window.requestAnimationFrame(() => {
      const startTime = performance.now();
      
      try {
        callback();
      } catch (error: unknown) {
        Logger.error('스케줄된 렌더링 중 오류:', error);
      } finally {
        this.performanceMetrics.renderTime = performance.now() - startTime;
        this.performanceMetrics.lastUpdateTime = Date.now();
        this.renderScheduled = false;
      }
    });
  }

  /**
   * 요소 레이아웃을 최적화합니다.
   */
  private optimizeElementLayout(element: HTMLElement): void {
    try {
      // 불필요한 리플로우 방지
      if (element.offsetParent === null) {
        Logger.debug('숨겨진 요소 레이아웃 최적화 건너뜀');
        return;
      }

      // 가시성 최적화
      const rect = element.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && 
                       rect.top < window.innerHeight && rect.bottom > 0;

      if (!isVisible) {
        Logger.debug('보이지 않는 요소 처리 최적화');
        // 보이지 않는 요소의 경우 일부 최적화 적용
        this.optimizeHiddenElement(element);
      }

    } catch (error: unknown) {
      Logger.error('요소 레이아웃 최적화 중 오류:', error);
    }
  }

  /**
   * 숨겨진 요소를 최적화합니다.
   */
  private optimizeHiddenElement(element: HTMLElement): void {
    // 숨겨진 요소의 이벤트 리스너 임시 비활성화 등의 최적화
    // CSS 클래스 기반으로 pointer-events 제어
    const hadPointerEventsClass = element.classList.contains('kga-pointer-events-none');

    if (!hadPointerEventsClass) {
      element.classList.add('kga-pointer-events-none');

      // 정리 콜백으로 원복
      this.addCleanupCallback(() => {
        element.classList.remove('kga-pointer-events-none');
      });
    }
  }

  /**
   * DOM 구조를 최적화합니다.
   */
  private optimizeDomStructure(mutations: MutationRecord[]): void {
    let addedNodes = 0;
    let removedNodes = 0;

    mutations.forEach(mutation => {
      addedNodes += mutation.addedNodes.length;
      removedNodes += mutation.removedNodes.length;
    });

    Logger.debug('DOM 변경 최적화', { addedNodes, removedNodes });

    // 대량의 DOM 변경 시 가상화 권장
    if (addedNodes > 50) {
      Logger.warn('대량 DOM 추가 감지 - 가상화 고려 필요', { count: addedNodes });
    }
  }

  /**
   * 메모리 사용량을 최적화합니다.
   */
  public optimizeMemoryUsage(): void {
    try {
      // 사용하지 않는 이벤트 리스너 정리
      this.cleanupUnusedListeners();

      // 캐시된 데이터 정리
      this.cleanupCachedData();

      // 성능 메트릭 업데이트
      this.updatePerformanceMetrics();

      Logger.log('메모리 사용량 최적화 완료', {
        memoryUsage: this.performanceMetrics.memoryUsage,
        domElementCount: this.performanceMetrics.domElementCount
      });

    } catch (error: unknown) {
      Logger.error('메모리 최적화 중 오류:', error);
    }
  }

  /**
   * 사용하지 않는 이벤트 리스너를 정리합니다.
   */
  private cleanupUnusedListeners(): void {
    // 관찰 중인 요소 중 DOM에서 제거된 것들 찾기
    const elementsToRemove: Element[] = [];
    
    this.observedElements.forEach(element => {
      if (!activeDocument.contains(element)) {
        elementsToRemove.push(element);
      }
    });

    // 제거된 요소들의 관찰 중지
    elementsToRemove.forEach(element => {
      this.observedElements.delete(element);
    });

    if (elementsToRemove.length > 0) {
      Logger.debug('사용하지 않는 요소 관찰 중지', { count: elementsToRemove.length });
    }
  }

  /**
   * 캐시된 데이터를 정리합니다.
   */
  private cleanupCachedData(): void {
    // 성능 메트릭 이외의 임시 데이터 정리
    // (현재는 별도의 캐시가 없으므로 메트릭만 리셋)
    const _previousMetrics = { ...this.performanceMetrics };
    void _previousMetrics;
    this.performanceMetrics = {
      ...this.performanceMetrics,
      renderTime: 0 // 렌더링 시간만 리셋
    };

    Logger.debug('캐시 데이터 정리 완료');
  }

  /**
   * 성능 메트릭을 업데이트합니다.
   */
  private updatePerformanceMetrics(): void {
    try {
      // DOM 요소 수 계산
      this.performanceMetrics.domElementCount = activeDocument.querySelectorAll('*').length;

      // 메모리 사용량 추정 (브라우저 지원 시)
      const memInfo = (performance as PerformanceWithMemory).memory;
      if (memInfo) {
        this.performanceMetrics.memoryUsage = memInfo.usedJSHeapSize ?? 0;
      }

      this.performanceMetrics.lastUpdateTime = Date.now();

    } catch (error: unknown) {
      Logger.error('성능 메트릭 업데이트 중 오류:', error);
    }
  }

  /**
   * 정리 콜백을 추가합니다.
   */
  public addCleanupCallback(callback: () => void): void {
    this.cleanupCallbacks.push(callback);
  }

  /**
   * 현재 성능 메트릭을 반환합니다.
   */
  public getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * 성능 보고서를 생성합니다.
   */
  public generatePerformanceReport(): string {
    const metrics = this.performanceMetrics;
    const observedElementsCount = this.observedElements.size;

    const lines = [
      '🔍 성능 최적화 보고서',
      '',
      `초기화 시간: ${metrics.initTime.toFixed(2)}ms`,
      `마지막 렌더링 시간: ${metrics.renderTime.toFixed(2)}ms`,
      `DOM 요소 수: ${metrics.domElementCount.toLocaleString()}개`,
      `관찰 중인 요소: ${observedElementsCount}개`,
      `마지막 업데이트: ${new Date(metrics.lastUpdateTime).toLocaleTimeString()}`
    ];

    if (metrics.memoryUsage > 0) {
      const memoryMB = (metrics.memoryUsage / 1024 / 1024).toFixed(2);
      lines.push(`메모리 사용량: ${memoryMB}MB`);
    }

    return lines.join('\n');
  }

  /**
   * 성능 최적화 상태를 반환합니다.
   */
  public getOptimizationStatus(): {
    isOptimized: boolean;
    observedElements: number;
    metrics: PerformanceMetrics;
    recommendations: string[];
  } {
    const metrics = this.performanceMetrics;
    const recommendations: string[] = [];

    // 성능 분석 및 권장사항 생성
    if (metrics.renderTime > 16) { // 60fps 기준
      recommendations.push('렌더링 시간이 깁니다. 가상 스크롤링을 고려해보세요.');
    }

    if (metrics.domElementCount > 1000) {
      recommendations.push('DOM 요소가 많습니다. 불필요한 요소를 정리해보세요.');
    }

    if (this.observedElements.size > 20) {
      recommendations.push('관찰 중인 요소가 많습니다. 필요한 요소만 관찰하세요.');
    }

    const isOptimized = recommendations.length === 0;

    return {
      isOptimized,
      observedElements: this.observedElements.size,
      metrics,
      recommendations
    };
  }
}

/**
 * 성능 메트릭 인터페이스
 */
interface PerformanceMetrics {
  initTime: number;
  renderTime: number;
  lastUpdateTime: number;
  memoryUsage: number;
  domElementCount: number;
}