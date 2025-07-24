import { Logger } from './logger';

/**
 * DOM 업데이트 배치 아이템 인터페이스
 */
interface DOMUpdate {
  element: HTMLElement;
  property: string;
  value: any;
  type: 'style' | 'attribute' | 'textContent' | 'innerHTML' | 'className';
}

/**
 * 렌더링 성능 메트릭 인터페이스
 */
interface RenderMetrics {
  totalUpdates: number;
  batchedUpdates: number;
  frameCount: number;
  averageFrameTime: number;
  droppedFrames: number;
}

/**
 * DOM 최적화 관리자
 * 배치 DOM 업데이트, RAF 기반 렌더링, 레이아웃 스래싱 방지
 */
export class DOMOptimizer {
  private static instance: DOMOptimizer | null = null;
  private updateQueue: DOMUpdate[] = [];
  private isScheduled = false;
  private rafId?: number;
  private observer?: IntersectionObserver;
  private visibleElements = new Set<HTMLElement>();
  
  // 성능 메트릭
  private metrics: RenderMetrics = {
    totalUpdates: 0,
    batchedUpdates: 0,
    frameCount: 0,
    averageFrameTime: 0,
    droppedFrames: 0
  };
  
  private frameTimes: number[] = [];
  private lastFrameTime = 0;
  private readonly MAX_FRAME_TIME = 16.67; // 60fps 기준

  private constructor() {
    this.setupIntersectionObserver();
    Logger.debug('DOMOptimizer 초기화');
  }

  /**
   * 싱글톤 인스턴스 반환
   */
  static getInstance(): DOMOptimizer {
    if (!DOMOptimizer.instance) {
      DOMOptimizer.instance = new DOMOptimizer();
    }
    return DOMOptimizer.instance;
  }

  /**
   * DOM 업데이트를 배치에 추가합니다
   */
  scheduleUpdate(
    element: HTMLElement,
    updates: {
      style?: Record<string, string>;
      attributes?: Record<string, string>;
      textContent?: string;
      innerHTML?: string;
      className?: string;
    }
  ): void {
    // 각 업데이트 타입별로 큐에 추가
    Object.entries(updates).forEach(([type, value]) => {
      if (type === 'style' && typeof value === 'object') {
        Object.entries(value).forEach(([property, styleValue]) => {
          this.updateQueue.push({
            element,
            property,
            value: styleValue,
            type: 'style'
          });
        });
      } else if (type === 'attributes' && typeof value === 'object') {
        Object.entries(value).forEach(([property, attrValue]) => {
          this.updateQueue.push({
            element,
            property,
            value: attrValue,
            type: 'attribute'
          });
        });
      } else {
        this.updateQueue.push({
          element,
          property: type,
          value,
          type: type as any
        });
      }
    });

    this.metrics.totalUpdates++;
    this.scheduleFlush();
  }

  /**
   * 스타일 업데이트를 배치로 처리합니다
   */
  updateStyles(element: HTMLElement, styles: Record<string, string>): void {
    this.scheduleUpdate(element, { style: styles });
  }

  /**
   * 텍스트 콘텐츠를 업데이트합니다
   */
  updateText(element: HTMLElement, text: string): void {
    this.scheduleUpdate(element, { textContent: text });
  }

  /**
   * HTML 콘텐츠를 업데이트합니다
   */
  updateHTML(element: HTMLElement, html: string): void {
    this.scheduleUpdate(element, { innerHTML: html });
  }

  /**
   * 클래스명을 업데이트합니다
   */
  updateClassName(element: HTMLElement, className: string): void {
    this.scheduleUpdate(element, { className });
  }

  /**
   * 요소의 가시성을 관찰합니다
   */
  observeElement(element: HTMLElement): void {
    if (this.observer) {
      this.observer.observe(element);
    }
  }

  /**
   * 요소 관찰을 중단합니다
   */
  unobserveElement(element: HTMLElement): void {
    if (this.observer) {
      this.observer.unobserve(element);
    }
    this.visibleElements.delete(element);
  }

  /**
   * 요소가 현재 보이는지 확인합니다
   */
  isElementVisible(element: HTMLElement): boolean {
    return this.visibleElements.has(element);
  }

  /**
   * 성능 메트릭을 반환합니다
   */
  getMetrics(): RenderMetrics {
    return { ...this.metrics };
  }

  /**
   * 메트릭을 초기화합니다
   */
  resetMetrics(): void {
    this.metrics = {
      totalUpdates: 0,
      batchedUpdates: 0,
      frameCount: 0,
      averageFrameTime: 0,
      droppedFrames: 0
    };
    this.frameTimes = [];
  }

  /**
   * DOM 트리의 깊이를 최적화합니다
   */
  optimizeElementStructure(container: HTMLElement): {
    optimized: boolean;
    beforeDepth: number;
    afterDepth: number;
    savings: number;
  } {
    const beforeDepth = this.calculateMaxDepth(container);
    let optimized = false;
    
    // 불필요한 래퍼 요소 제거
    this.removeUnnecessaryWrappers(container);
    
    // 빈 요소 제거
    this.removeEmptyElements(container);
    
    const afterDepth = this.calculateMaxDepth(container);
    const savings = beforeDepth - afterDepth;
    
    if (savings > 0) {
      optimized = true;
      Logger.debug('DOM 구조 최적화:', { beforeDepth, afterDepth, savings });
    }
    
    return { optimized, beforeDepth, afterDepth, savings };
  }

  /**
   * 메모리 사용량을 최적화합니다
   */
  optimizeMemory(): void {
    // 분리된 DOM 노드 정리
    this.cleanupDetachedNodes();
    
    // 이벤트 리스너 정리 (가능한 경우)
    this.cleanupEventListeners();
    
    Logger.debug('DOM 메모리 최적화 완료');
  }

  /**
   * DOMOptimizer를 종료합니다
   */
  static destroy(): void {
    if (DOMOptimizer.instance) {
      DOMOptimizer.instance.cleanup();
      DOMOptimizer.instance = null;
    }
  }

  /**
   * 배치 flush를 스케줄링합니다
   */
  private scheduleFlush(): void {
    if (this.isScheduled) return;
    
    this.isScheduled = true;
    this.rafId = requestAnimationFrame(() => {
      this.flushUpdates();
    });
  }

  /**
   * 배치된 업데이트를 실행합니다
   */
  private flushUpdates(): void {
    const startTime = performance.now();
    
    if (this.updateQueue.length === 0) {
      this.isScheduled = false;
      return;
    }
    
    // 읽기 작업과 쓰기 작업 분리 (레이아웃 스래싱 방지)
    const reads: (() => void)[] = [];
    const writes: (() => void)[] = [];
    
    for (const update of this.updateQueue) {
      // 가시성 체크 (보이지 않는 요소는 건너뛰기)
      if (!this.isElementVisible(update.element) && update.element.isConnected) {
        continue;
      }
      
      writes.push(() => this.applyUpdate(update));
    }
    
    // 읽기 작업 먼저 실행
    reads.forEach(read => read());
    
    // 쓰기 작업 실행
    writes.forEach(write => write());
    
    // 큐 비우기
    this.updateQueue = [];
    this.isScheduled = false;
    this.metrics.batchedUpdates++;
    
    // 성능 메트릭 업데이트
    const frameTime = performance.now() - startTime;
    this.updateFrameMetrics(frameTime);
    
    Logger.debug('DOM 배치 업데이트 완료:', { 
      updatesCount: writes.length,
      frameTime: Math.round(frameTime * 100) / 100
    });
  }

  /**
   * 개별 업데이트를 적용합니다
   */
  private applyUpdate(update: DOMUpdate): void {
    try {
      const { element, property, value, type } = update;
      
      switch (type) {
        case 'style':
          (element.style as any)[property] = value;
          break;
        case 'attribute':
          element.setAttribute(property, value);
          break;
        case 'textContent':
          element.textContent = value;
          break;
        case 'innerHTML':
          element.innerHTML = value;
          break;
        case 'className':
          element.className = value;
          break;
      }
    } catch (error) {
      Logger.warn('DOM 업데이트 실패:', { update, error });
    }
  }

  /**
   * IntersectionObserver를 설정합니다
   */
  private setupIntersectionObserver(): void {
    if (typeof IntersectionObserver === 'undefined') {
      Logger.warn('IntersectionObserver 미지원');
      return;
    }
    
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.visibleElements.add(entry.target as HTMLElement);
        } else {
          this.visibleElements.delete(entry.target as HTMLElement);
        }
      });
    }, {
      threshold: 0.1, // 10% 이상 보일 때 가시성 인정
      rootMargin: '50px' // 50px 마진으로 미리 로드
    });
  }

  /**
   * DOM 트리의 최대 깊이를 계산합니다
   */
  private calculateMaxDepth(element: HTMLElement): number {
    let maxDepth = 0;
    
    function traverse(node: HTMLElement, depth: number): void {
      maxDepth = Math.max(maxDepth, depth);
      
      for (const child of Array.from(node.children)) {
        if (child instanceof HTMLElement) {
          traverse(child, depth + 1);
        }
      }
    }
    
    traverse(element, 0);
    return maxDepth;
  }

  /**
   * 불필요한 래퍼 요소를 제거합니다
   */
  private removeUnnecessaryWrappers(container: HTMLElement): void {
    const wrappers = container.querySelectorAll('div:only-child');
    
    wrappers.forEach(wrapper => {
      const parent = wrapper.parentElement;
      const child = wrapper.children[0];
      
      if (parent && child && wrapper.children.length === 1) {
        // 스타일이나 클래스가 없는 경우에만 제거 (이벤트 리스너 체크는 생략)
        if (!wrapper.hasAttribute('style') && 
            !wrapper.hasAttribute('class')) {
          parent.replaceChild(child, wrapper);
        }
      }
    });
  }

  /**
   * 빈 요소를 제거합니다
   */
  private removeEmptyElements(container: HTMLElement): void {
    const empties = container.querySelectorAll('*:empty');
    
    empties.forEach(empty => {
      // 중요한 요소나 스타일이 있는 요소는 보존
      if (!empty.hasAttribute('style') && 
          !empty.hasAttribute('class') &&
          empty.tagName !== 'IMG' &&
          empty.tagName !== 'INPUT' &&
          empty.tagName !== 'BR') {
        empty.remove();
      }
    });
  }

  /**
   * 분리된 DOM 노드를 정리합니다
   */
  private cleanupDetachedNodes(): void {
    // 업데이트 큐에서 분리된 요소 제거
    this.updateQueue = this.updateQueue.filter(update => update.element.isConnected);
    
    // 가시성 관찰 대상에서 분리된 요소 제거
    this.visibleElements.forEach(element => {
      if (!element.isConnected) {
        this.visibleElements.delete(element);
      }
    });
  }

  /**
   * 이벤트 리스너를 정리합니다 (브라우저 지원 시)
   */
  private cleanupEventListeners(): void {
    // Chrome DevTools에서만 사용 가능한 getEventListeners() 활용 시도
    this.visibleElements.forEach(element => {
      try {
        // 개발자 도구에서만 사용 가능
        if (typeof (window as any).getEventListeners === 'function') {
          const listeners = (window as any).getEventListeners(element);
          
          if (listeners && typeof listeners === 'object') {
            Object.keys(listeners).forEach(eventType => {
              if (listeners[eventType] && listeners[eventType].length > 10) {
                Logger.warn('과도한 이벤트 리스너 감지:', { 
                  element: element.tagName, 
                  eventType, 
                  count: listeners[eventType].length 
                });
              }
            });
          }
        }
      } catch (error) {
        // getEventListeners는 개발자 도구에서만 사용 가능하므로 에러는 무시
        Logger.debug('getEventListeners 호출 실패 (정상 동작)');
      }
    });
  }

  /**
   * 프레임 성능 메트릭을 업데이트합니다
   */
  private updateFrameMetrics(frameTime: number): void {
    this.metrics.frameCount++;
    this.frameTimes.push(frameTime);
    
    // 드롭된 프레임 감지
    if (frameTime > this.MAX_FRAME_TIME) {
      this.metrics.droppedFrames++;
    }
    
    // 최근 100프레임의 평균 계산
    if (this.frameTimes.length > 100) {
      this.frameTimes = this.frameTimes.slice(-100);
    }
    
    this.metrics.averageFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  }

  /**
   * 리소스를 정리합니다
   */
  private cleanup(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    
    if (this.observer) {
      this.observer.disconnect();
    }
    
    this.updateQueue = [];
    this.visibleElements.clear();
    
    Logger.debug('DOMOptimizer 정리됨');
  }
}