/**
 * DOM 조작을 위한 안전한 유틸리티 함수들
 */

/**
 * Obsidian Window 인터페이스 확장
 * sanitizeHTMLToDom 메서드를 포함한 Obsidian API
 */
interface ObsidianWindow extends Window {
  sanitizeHTMLToDom?: (html: string) => DocumentFragment;
}

/**
 * API 성능 메트릭 인터페이스
 */
interface ApiMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  queueLength: number;
  activeBatches: number;
}

/**
 * 캐시 통계 인터페이스
 */
interface CacheStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRatio: number;
  cacheSize: number;
  memoryUsage: number;
}

/**
 * 확장된 메트릭 인터페이스 (로그 통계, 에러 통계 포함)
 */
interface ExtendedMetrics extends ApiMetrics {
  cache?: CacheStats;
  morphemeCache?: CacheStats;
  logStats?: {
    debug: number;
    info: number;
    warn: number;
    error: number;
    total: number;
  };
  errorStats?: {
    totalErrors: number;
    errorsByCategory: Record<string, number>;
    recentErrors: Array<{
      timestamp: number;
      category: string;
      message: string;
    }>;
  };
}

/**
 * 검증 결과 인터페이스
 */
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 최적화 제안 인터페이스
 */
interface OptimizationSuggestion {
  type?: 'cost' | 'usability' | 'performance';
  title: string;
  description?: string;
  impact: 'high' | 'medium' | 'low';
  action: string;
}

/**
 * HTML 요소를 생성합니다.
 * @param tag 요소 태그명
 * @param options 요소 옵션 (클래스, 텍스트, 부모 등)
 * @returns 생성된 HTML 요소
 */
export function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: {
    cls?: string | string[];
    text?: string;
    parent?: HTMLElement;
    attr?: Record<string, string>;
  }
): HTMLElementTagNameMap[K] {
  const el = activeDocument.createElement(tag);
  
  if (options) {
    if (options.cls) {
      if (Array.isArray(options.cls)) {
        el.classList.add(...options.cls);
      } else {
        el.classList.add(options.cls);
      }
    }
    
    if (options.text) {
      el.textContent = options.text;
    }
    
    if (options.attr) {
      for (const [key, value] of Object.entries(options.attr)) {
        el.setAttribute(key, value);
      }
    }
    
    if (options.parent) {
      options.parent.appendChild(el);
    }
  }
  
  return el;
}

/**
 * 안전하게 HTML 콘텐츠를 설정합니다. (보안상 innerHTML 사용 제한됨)
 * 대신 createSafeElement나 textContent를 사용하세요.
 * @deprecated innerHTML 사용으로 인한 보안 위험
 */
export function setHtmlContent(element: HTMLElement, content: string): void {
  // innerHTML 사용 금지 - 보안상 위험
  element.textContent = content; // innerHTML 대신 textContent 사용
}

/**
 * 안전하게 텍스트 콘텐츠를 설정합니다.
 * @param element 대상 요소
 * @param text 텍스트 콘텐츠
 */
export function setTextContent(element: HTMLElement, text: string): void {
  element.textContent = text;
}

/**
 * CSS custom property 값을 설정합니다. 실제 스타일 규칙은 CSS 파일에 둡니다.
 */
export function setCssVariable(element: HTMLElement, name: string, value: string): void {
  element.style.setProperty(name, value);
}

/**
 * 리스트 요소를 생성합니다.
 * @param items 리스트 항목들
 * @param ordered 순서가 있는 리스트인지 여부
 * @returns 생성된 리스트 요소
 */
export function createList(items: string[], ordered: boolean = false): HTMLElement {
  const listElement = createEl(ordered ? 'ol' : 'ul');

  items.forEach(item => {
    const listItem = listElement.createEl('li');
    listItem.textContent = item;
  });

  return listElement;
}

/**
 * 단락을 생성합니다.
 * @param text 텍스트 내용
 * @returns 생성된 단락 요소
 */
export function createParagraph(text: string): HTMLParagraphElement {
  const paragraph = createEl('p');
  paragraph.textContent = text;
  return paragraph;
}

/**
 * 링크를 생성합니다.
 * @param text 링크 텍스트
 * @param href 링크 URL
 * @param target 링크 타겟
 * @returns 생성된 링크 요소
 */
export function createLink(text: string, href: string, target: string = '_blank'): HTMLAnchorElement {
  const link = createEl('a');
  link.textContent = text;
  link.href = href;
  link.target = target;
  return link;
}

/**
 * 안전한 HTML 해석을 위한 함수
 * @param htmlString HTML 문자열
 * @returns 파싱된 DOM 요소들
 */
export function parseHTMLSafely(htmlString: string): DocumentFragment {
  // Obsidian의 sanitizeHTMLToDom 사용
  const sanitized = (window as ObsidianWindow).sanitizeHTMLToDom?.(htmlString);
  const fragment = createFragment();
  if (sanitized) {
    fragment.appendChild(sanitized);
  }
  return fragment;
}

/**
 * 요소에 자식 요소들을 추가합니다.
 * @param parent 부모 요소
 * @param children 자식 요소들
 */
export function appendChildren(parent: HTMLElement, ...children: HTMLElement[]): void {
  children.forEach(child => parent.appendChild(child));
}

/**
 * 요소를 비웁니다.
 * @param element 대상 요소
 */
export function clearElement(element: HTMLElement): void {
  try {
    // 안전한 방법으로 모든 자식 요소 제거
    while (element.firstChild) {
      const child = element.firstChild;
      if (child.parentNode === element) {
        element.removeChild(child);
      } else {
        // 이미 다른 곳으로 이동된 경우 루프 탈출
        break;
      }
    }
  } catch {
    // 오류 발생 시 더 안전한 방법 사용
    element.textContent = '';
  }
}

/**
 * 안전한 메트릭 표시를 위한 구조화된 요소 생성
 * @param parent 부모 요소
 * @param metrics 메트릭 데이터
 */
export function createMetricsDisplay(parent: HTMLElement, metrics: ExtendedMetrics): void {
  clearElement(parent);
  
  // API 성능 통계 섹션
  const apiSection = parent.createEl('div');
  apiSection.createEl('strong', { text: 'API 성능 통계:' });
  apiSection.createEl('br');
  
  const apiMetrics = [
    `총 요청: ${metrics.totalRequests}`,
    `성공 요청: ${metrics.successfulRequests}`,
    `실패 요청: ${metrics.failedRequests}`,
    `평균 응답시간: ${metrics.averageResponseTime}ms`,
    `대기열 길이: ${metrics.queueLength}`,
    `활성 배치: ${metrics.activeBatches}`
  ];
  
  apiMetrics.forEach(metric => {
    apiSection.createEl('div', { text: `• ${metric}` });
  });
  
  parent.createEl('br');
  
  // 캐시 통계 섹션
  if (metrics.cache) {
    const cacheSection = parent.createEl('div');
    cacheSection.createEl('strong', { text: '캐시 통계:' });
    cacheSection.createEl('br');
    
    const cacheMetrics = [
      `총 요청: ${metrics.cache.totalRequests}`,
      `캐시 히트: ${metrics.cache.cacheHits}`,
      `캐시 미스: ${metrics.cache.cacheMisses}`,
      `히트율: ${metrics.cache.hitRatio}%`,
      `캐시 크기: ${metrics.cache.cacheSize}개`,
      `메모리 사용량: ${Math.round(metrics.cache.memoryUsage / 1024)}KB`
    ];
    
    cacheMetrics.forEach(metric => {
      cacheSection.createEl('div', { text: `• ${metric}` });
    });
  }
}

/**
 * 안전한 검증 결과 표시를 위한 구조화된 요소 생성
 * @param parent 부모 요소
 * @param validation 검증 결과
 * @param suggestions 최적화 제안
 */
export function createValidationDisplay(parent: HTMLElement, validation: ValidationResult, suggestions: OptimizationSuggestion[]): void {
  clearElement(parent);
  
  // 검증 결과 헤더
  const header = parent.createEl('div');
  header.createEl('strong', { text: '검증 결과:' });
  header.createEl('br');
  
  // 상태 표시
  const statusDiv = parent.createEl('div');
  if (validation.isValid) {
    statusDiv.createEl('span', { text: '✅ 설정이 유효합니다' });
  } else {
    statusDiv.createEl('span', { text: '❌ 설정에 오류가 있습니다' });
    validation.errors.forEach((error: string) => {
      statusDiv.createEl('br');
      statusDiv.createEl('span', { text: `• 오류: ${error}` });
    });
  }
  
  // 경고 섹션
  if (validation.warnings && validation.warnings.length > 0) {
    parent.createEl('br');
    parent.createEl('strong', { text: '경고:' });
    parent.createEl('br');

    validation.warnings.forEach((warning: string) => {
      parent.createEl('div', { text: `⚠️ ${warning}` });
    });
  }
  
  // 제안 섹션
  if (suggestions && suggestions.length > 0) {
    parent.createEl('br');
    parent.createEl('strong', { text: '최적화 제안:' });
    parent.createEl('br');

    suggestions.forEach((suggestion: OptimizationSuggestion) => {
      const icon = suggestion.impact === 'high' ? '🔴' :
                   suggestion.impact === 'medium' ? '🟡' : '🟢';
      parent.createEl('div', { text: `${icon} ${suggestion.title}: ${suggestion.action}` });
    });
  }
}
