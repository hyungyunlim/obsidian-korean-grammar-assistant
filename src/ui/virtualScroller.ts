import { Logger } from '../utils/logger';

/**
 * 가상 스크롤 아이템 인터페이스
 */
interface VirtualItem {
  id: string;
  content: string;
  height?: number;
  data?: any;
}

/**
 * 가상 스크롤 설정 인터페이스
 */
interface VirtualScrollConfig {
  containerHeight: number;
  itemHeight: number;
  overscan: number; // 화면 밖 렌더링할 아이템 수
  buffer: number;   // 메모리에 유지할 아이템 수
}

/**
 * 렌더링 범위 인터페이스
 */
interface RenderRange {
  startIndex: number;
  endIndex: number;
  visibleItems: VirtualItem[];
}

/**
 * 가상 스크롤링 관리자
 * 대용량 리스트의 성능 최적화를 위한 가상화 구현
 */
export class VirtualScroller {
  private container: HTMLElement;
  private viewport: HTMLElement;
  private content: HTMLElement;
  private config: VirtualScrollConfig;
  private items: VirtualItem[] = [];
  private renderedItems = new Map<string, HTMLElement>();
  private currentRange: RenderRange = { startIndex: 0, endIndex: 0, visibleItems: [] };
  private scrollTop = 0;
  private isScrolling = false;
  private scrollTimeout?: NodeJS.Timeout;
  private resizeObserver?: ResizeObserver;
  
  // 성능 관련 설정
  private readonly SCROLL_DEBOUNCE = 16; // 60fps
  private readonly RESIZE_DEBOUNCE = 100;
  
  // 렌더링 콜백
  private renderItemCallback?: (item: VirtualItem, element: HTMLElement) => void;
  private itemClickCallback?: (item: VirtualItem, event: MouseEvent) => void;

  constructor(
    container: HTMLElement,
    config: Partial<VirtualScrollConfig> = {},
    callbacks: {
      renderItem?: (item: VirtualItem, element: HTMLElement) => void;
      onItemClick?: (item: VirtualItem, event: MouseEvent) => void;
    } = {}
  ) {
    this.container = container;
    this.config = {
      containerHeight: 400,
      itemHeight: 30,
      overscan: 5,
      buffer: 50,
      ...config
    };
    
    this.renderItemCallback = callbacks.renderItem;
    this.itemClickCallback = callbacks.onItemClick;
    
    this.initializeStructure();
    this.setupEventListeners();
    
    Logger.debug('VirtualScroller 초기화:', this.config);
  }

  /**
   * 아이템 리스트를 설정합니다
   */
  setItems(items: VirtualItem[]): void {
    this.items = [...items];
    this.clearRenderedItems();
    this.updateContentHeight();
    this.calculateVisibleRange();
    this.renderVisibleItems();
    
    Logger.debug('VirtualScroller 아이템 설정:', { 
      totalItems: items.length,
      contentHeight: this.getTotalHeight()
    });
  }

  /**
   * 특정 아이템으로 스크롤합니다
   */
  scrollToItem(itemId: string): void {
    const index = this.items.findIndex(item => item.id === itemId);
    if (index === -1) return;
    
    const targetScrollTop = index * this.config.itemHeight;
    this.viewport.scrollTop = targetScrollTop;
    this.handleScroll();
    
    Logger.debug('아이템으로 스크롤:', { itemId, index, targetScrollTop });
  }

  /**
   * 특정 인덱스로 스크롤합니다
   */
  scrollToIndex(index: number): void {
    if (index < 0 || index >= this.items.length) return;
    
    const targetScrollTop = index * this.config.itemHeight;
    this.viewport.scrollTop = targetScrollTop;
    this.handleScroll();
    
    Logger.debug('인덱스로 스크롤:', { index, targetScrollTop });
  }

  /**
   * 아이템을 업데이트합니다
   */
  updateItem(itemId: string, updates: Partial<VirtualItem>): void {
    const index = this.items.findIndex(item => item.id === itemId);
    if (index === -1) return;
    
    this.items[index] = { ...this.items[index], ...updates };
    
    // 렌더링된 아이템이면 업데이트
    const renderedElement = this.renderedItems.get(itemId);
    if (renderedElement && this.renderItemCallback) {
      this.renderItemCallback(this.items[index], renderedElement);
    }
    
    Logger.debug('아이템 업데이트:', { itemId, updates });
  }

  /**
   * 컨테이너 크기를 업데이트합니다
   */
  updateSize(newHeight?: number): void {
    if (newHeight) {
      this.config.containerHeight = newHeight;
      this.viewport.style.height = `${newHeight}px`;
    }
    
    this.calculateVisibleRange();
    this.renderVisibleItems();
    
    Logger.debug('크기 업데이트:', { containerHeight: this.config.containerHeight });
  }

  /**
   * 현재 표시 중인 아이템들을 반환합니다
   */
  getVisibleItems(): VirtualItem[] {
    return this.currentRange.visibleItems;
  }

  /**
   * 메모리 사용량 정보를 반환합니다
   */
  getMemoryUsage(): { 
    totalItems: number; 
    renderedItems: number; 
    memoryRatio: number;
    estimatedBytes: number;
  } {
    const renderedCount = this.renderedItems.size;
    const memoryRatio = this.items.length > 0 ? renderedCount / this.items.length : 0;
    
    // 대략적인 메모리 사용량 추정
    const estimatedBytes = renderedCount * 200 + // DOM 요소당 약 200바이트
                          this.items.length * 100;  // 아이템 데이터당 약 100바이트
    
    return {
      totalItems: this.items.length,
      renderedItems: renderedCount,
      memoryRatio: Math.round(memoryRatio * 100) / 100,
      estimatedBytes
    };
  }

  /**
   * 리소스를 정리합니다
   */
  destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }
    
    this.clearRenderedItems();
    this.viewport.removeEventListener('scroll', this.handleScroll);
    
    Logger.debug('VirtualScroller 정리됨');
  }

  /**
   * DOM 구조를 초기화합니다
   */
  private initializeStructure(): void {
    this.container.innerHTML = '';
    this.container.className = 'virtual-scroller-container';
    
    // 뷰포트 (스크롤 가능한 영역)
    this.viewport = this.container.createEl('div', {
      cls: 'virtual-scroller-viewport',
      attr: {
        style: `
          height: ${this.config.containerHeight}px;
          overflow-y: auto;
          overflow-x: hidden;
          position: relative;
        `
      }
    });
    
    // 콘텐츠 영역 (전체 높이를 가진 스크롤 영역)
    this.content = this.viewport.createEl('div', {
      cls: 'virtual-scroller-content',
      attr: {
        style: `
          position: relative;
          width: 100%;
          min-height: 100%;
        `
      }
    });
  }

  /**
   * 이벤트 리스너를 설정합니다
   */
  private setupEventListeners(): void {
    // 스크롤 이벤트 (디바운싱 적용)
    this.viewport.addEventListener('scroll', this.handleScroll.bind(this));
    
    // 리사이즈 관찰자
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.debounce(() => {
          this.updateSize();
        }, this.RESIZE_DEBOUNCE)();
      });
      
      this.resizeObserver.observe(this.container);
    }
    
    // 클릭 이벤트 위임
    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const itemElement = target.closest('[data-virtual-item-id]') as HTMLElement;
      
      if (itemElement && this.itemClickCallback) {
        const itemId = itemElement.dataset.virtualItemId;
        const item = this.items.find(item => item.id === itemId);
        
        if (item) {
          this.itemClickCallback(item, event);
        }
      }
    });
  }

  /**
   * 스크롤 이벤트를 처리합니다
   */
  private handleScroll = this.debounce(() => {
    this.scrollTop = this.viewport.scrollTop;
    this.isScrolling = true;
    
    this.calculateVisibleRange();
    this.renderVisibleItems();
    
    // 스크롤 종료 감지
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }
    
    this.scrollTimeout = setTimeout(() => {
      this.isScrolling = false;
    }, 150);
  }, this.SCROLL_DEBOUNCE);

  /**
   * 표시할 아이템 범위를 계산합니다
   */
  private calculateVisibleRange(): void {
    const { itemHeight, overscan } = this.config;
    const containerHeight = this.config.containerHeight;
    
    const startIndex = Math.max(0, Math.floor(this.scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const endIndex = Math.min(this.items.length - 1, startIndex + visibleCount + overscan * 2);
    
    this.currentRange = {
      startIndex,
      endIndex,
      visibleItems: this.items.slice(startIndex, endIndex + 1)
    };
    
    Logger.debug('표시 범위 계산:', {
      startIndex,
      endIndex,
      visibleCount: this.currentRange.visibleItems.length,
      scrollTop: this.scrollTop
    });
  }

  /**
   * 현재 범위의 아이템들을 렌더링합니다
   */
  private renderVisibleItems(): void {
    const { startIndex, endIndex, visibleItems } = this.currentRange;
    const { itemHeight } = this.config;
    
    // 현재 범위 밖의 요소들 제거
    this.cleanupOutOfRangeItems(startIndex, endIndex);
    
    // 새로운 아이템들 렌더링
    visibleItems.forEach((item, index) => {
      const itemIndex = startIndex + index;
      let element = this.renderedItems.get(item.id);
      
      if (!element) {
        element = this.createItemElement(item, itemIndex);
        this.renderedItems.set(item.id, element);
        this.content.appendChild(element);
      } else {
        // 위치 업데이트
        this.updateItemPosition(element, itemIndex);
      }
      
      // 콘텐츠 렌더링
      if (this.renderItemCallback) {
        this.renderItemCallback(item, element);
      }
    });
  }

  /**
   * 아이템 요소를 생성합니다
   */
  private createItemElement(item: VirtualItem, index: number): HTMLElement {
    const element = document.createElement('div');
    element.className = 'virtual-scroller-item';
    element.dataset.virtualItemId = item.id;
    
    this.updateItemPosition(element, index);
    
    element.style.cssText += `
      position: absolute;
      width: 100%;
      box-sizing: border-box;
    `;
    
    return element;
  }

  /**
   * 아이템 위치를 업데이트합니다
   */
  private updateItemPosition(element: HTMLElement, index: number): void {
    const top = index * this.config.itemHeight;
    element.style.transform = `translateY(${top}px)`;
    element.style.height = `${this.config.itemHeight}px`;
  }

  /**
   * 범위 밖 아이템들을 정리합니다
   */
  private cleanupOutOfRangeItems(startIndex: number, endIndex: number): void {
    const toRemove: string[] = [];
    
    for (const [itemId, element] of this.renderedItems) {
      const itemIndex = this.items.findIndex(item => item.id === itemId);
      
      if (itemIndex < startIndex || itemIndex > endIndex) {
        element.remove();
        toRemove.push(itemId);
      }
    }
    
    toRemove.forEach(itemId => this.renderedItems.delete(itemId));
    
    if (toRemove.length > 0) {
      Logger.debug('범위 밖 아이템 정리:', { removedCount: toRemove.length });
    }
  }

  /**
   * 렌더링된 모든 아이템을 정리합니다
   */
  private clearRenderedItems(): void {
    this.renderedItems.forEach(element => element.remove());
    this.renderedItems.clear();
  }

  /**
   * 콘텐츠 높이를 업데이트합니다
   */
  private updateContentHeight(): void {
    const totalHeight = this.getTotalHeight();
    this.content.style.height = `${totalHeight}px`;
  }

  /**
   * 전체 콘텐츠 높이를 계산합니다
   */
  private getTotalHeight(): number {
    return this.items.length * this.config.itemHeight;
  }

  /**
   * 디바운스 유틸리티
   */
  private debounce(func: Function, wait: number): () => void {
    let timeout: NodeJS.Timeout;
    
    return function executedFunction(...args: any[]) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
}