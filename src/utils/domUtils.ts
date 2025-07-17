/**
 * DOM 조작을 위한 안전한 유틸리티 함수들
 */

/**
 * 안전하게 HTML 콘텐츠를 설정합니다.
 * @param element 대상 요소
 * @param content HTML 콘텐츠
 */
export function setHtmlContent(element: HTMLElement, content: string): void {
  element.innerHTML = content;
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
 * 리스트 요소를 생성합니다.
 * @param items 리스트 항목들
 * @param ordered 순서가 있는 리스트인지 여부
 * @returns 생성된 리스트 요소
 */
export function createList(items: string[], ordered: boolean = false): HTMLElement {
  const listElement = document.createElement(ordered ? 'ol' : 'ul');
  
  items.forEach(item => {
    const listItem = document.createElement('li');
    listItem.textContent = item;
    listElement.appendChild(listItem);
  });
  
  return listElement;
}

/**
 * 단락을 생성합니다.
 * @param text 텍스트 내용
 * @returns 생성된 단락 요소
 */
export function createParagraph(text: string): HTMLParagraphElement {
  const paragraph = document.createElement('p');
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
  const link = document.createElement('a');
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
  const template = document.createElement('template');
  template.innerHTML = htmlString;
  return template.content;
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
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}