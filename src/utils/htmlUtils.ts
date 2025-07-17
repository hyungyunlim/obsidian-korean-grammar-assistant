/**
 * HTML 처리 관련 유틸리티 함수들
 */

/**
 * HTML에 안전하게 텍스트를 삽입하기 위해 이스케이프 처리합니다.
 * @param text 이스케이프할 텍스트
 * @returns 이스케이프된 텍스트
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * DOM 요소를 안전하게 제거합니다.
 * @param element 제거할 요소
 */
export function safeRemoveElement(element: HTMLElement | null): void {
  if (element && element.parentNode) {
    element.parentNode.removeChild(element);
  }
}

/**
 * 이벤트 리스너를 추가하고 정리 함수를 반환합니다.
 * @param element 대상 요소
 * @param event 이벤트 타입
 * @param handler 이벤트 핸들러
 * @returns 정리 함수
 */
export function addEventListenerWithCleanup(
  element: HTMLElement,
  event: string,
  handler: EventListener
): () => void {
  element.addEventListener(event, handler);
  return () => element.removeEventListener(event, handler);
}

/**
 * CSS 클래스를 토글합니다.
 * @param element 대상 요소
 * @param className 클래스명
 * @param force 강제 설정값 (선택사항)
 */
export function toggleClass(element: HTMLElement, className: string, force?: boolean): void {
  if (force !== undefined) {
    element.classList.toggle(className, force);
  } else {
    element.classList.toggle(className);
  }
}

/**
 * 요소가 뷰포트에 보이는지 확인합니다.
 * @param element 확인할 요소
 * @returns 보이는지 여부
 */
export function isElementVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * 스크롤을 부드럽게 특정 요소로 이동합니다.
 * @param element 이동할 요소
 * @param behavior 스크롤 동작
 */
export function smoothScrollToElement(
  element: HTMLElement,
  behavior: ScrollBehavior = 'smooth'
): void {
  element.scrollIntoView({ behavior, block: 'nearest' });
}

/**
 * 임시 하이라이트 효과를 적용합니다.
 * @param element 대상 요소
 * @param className 하이라이트 클래스명
 * @param duration 지속 시간 (ms)
 */
export function temporaryHighlight(
  element: HTMLElement,
  className: string = 'highlight',
  duration: number = 2000
): void {
  element.classList.add(className);
  setTimeout(() => {
    element.classList.remove(className);
  }, duration);
}

/**
 * 모바일 디바이스인지 확인합니다.
 * @returns 모바일 여부
 */
export function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

/**
 * 터치 디바이스인지 확인합니다.
 * @returns 터치 디바이스 여부
 */
export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}