import { UIComponent } from '../types/interfaces';
import { safeRemoveElement, addEventListenerWithCleanup } from '../utils/htmlUtils';
import { parseHTMLSafely, clearElement } from '../utils/domUtils';

/**
 * UI 컴포넌트의 기본 클래스
 */
export abstract class BaseComponent implements UIComponent {
  protected element: HTMLElement;
  protected cleanupFunctions: Array<() => void> = [];
  protected isDestroyed: boolean = false;

  constructor(tagName: string = 'div', className?: string) {
    this.element = document.createElement(tagName);
    if (className) {
      this.element.className = className;
    }
  }

  /**
   * 컴포넌트를 렌더링합니다.
   * 하위 클래스에서 구현해야 합니다.
   */
  abstract render(): HTMLElement;

  /**
   * 이벤트 리스너를 추가하고 정리 함수를 등록합니다.
   * @param element 대상 요소
   * @param event 이벤트 타입
   * @param handler 이벤트 핸들러
   */
  protected addEventListener(
    element: HTMLElement,
    event: string,
    handler: EventListener
  ): void {
    const cleanup = addEventListenerWithCleanup(element, event, handler);
    this.cleanupFunctions.push(cleanup);
  }

  /**
   * 컴포넌트의 루트 요소를 반환합니다.
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * 컴포넌트를 DOM에 추가합니다.
   * @param parent 부모 요소
   */
  appendTo(parent: HTMLElement): void {
    if (!this.isDestroyed) {
      parent.appendChild(this.element);
    }
  }

  /**
   * 컴포넌트를 DOM에서 제거합니다.
   */
  remove(): void {
    safeRemoveElement(this.element);
  }

  /**
   * 컴포넌트를 완전히 파괴하고 리소스를 정리합니다.
   */
  destroy(): void {
    if (this.isDestroyed) return;

    // 모든 이벤트 리스너 정리
    this.cleanupFunctions.forEach(cleanup => cleanup());
    this.cleanupFunctions = [];

    // DOM에서 제거
    this.remove();

    this.isDestroyed = true;
  }

  /**
   * 컴포넌트가 파괴되었는지 확인합니다.
   */
  isComponentDestroyed(): boolean {
    return this.isDestroyed;
  }

  /**
   * CSS 클래스를 추가합니다.
   * @param className 클래스명
   */
  addClass(className: string): void {
    this.element.classList.add(className);
  }

  /**
   * CSS 클래스를 제거합니다.
   * @param className 클래스명
   */
  removeClass(className: string): void {
    this.element.classList.remove(className);
  }

  /**
   * CSS 클래스를 토글합니다.
   * @param className 클래스명
   * @param force 강제 설정값
   */
  toggleClass(className: string, force?: boolean): void {
    this.element.classList.toggle(className, force);
  }

  /**
   * 요소의 내용을 설정합니다.
   * @param content HTML 또는 텍스트 내용
   * @param isHTML HTML 여부 (기본값: false)
   */
  setContent(content: string, isHTML: boolean = false): void {
    if (isHTML) {
      // DOM API를 사용하여 안전하게 HTML 콘텐츠 설정
      clearElement(this.element);
      const fragment = parseHTMLSafely(content);
      this.element.appendChild(fragment);
    } else {
      this.element.textContent = content;
    }
  }

  /**
   * 요소에 속성을 설정합니다.
   * @param name 속성명
   * @param value 속성값
   */
  setAttribute(name: string, value: string): void {
    this.element.setAttribute(name, value);
  }

  /**
   * 요소의 스타일을 설정합니다.
   * @param property CSS 속성
   * @param value CSS 값
   */
  setStyle(property: string, value: string): void {
    (this.element.style as any)[property] = value;
  }
}