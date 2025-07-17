/**
 * 텍스트 처리 관련 유틸리티 함수들
 */

/**
 * 텍스트에서 첫 번째 일치하는 부분을 플레이스홀더로 대체합니다.
 * @param text 원본 텍스트
 * @param search 찾을 문자열
 * @param placeholder 대체할 플레이스홀더
 * @returns 대체된 텍스트
 */
export function replaceFirstOccurrenceWithPlaceholder(
  text: string,
  search: string,
  placeholder: string
): string {
  const index = text.indexOf(search);
  if (index === -1) return text;
  return text.slice(0, index) + placeholder + text.slice(index + search.length);
}

/**
 * HTML 엔티티를 디코딩합니다.
 * @param text 디코딩할 텍스트
 * @returns 디코딩된 텍스트
 */
export function decodeHtmlEntities(text: string): string {
  const element = document.createElement("div");
  element.innerHTML = text;
  return element.textContent || "";
}

/**
 * 텍스트를 페이지별로 분할하기 위한 최적의 끊는 지점을 찾습니다.
 * @param text 분할할 텍스트
 * @param targetLength 목표 길이
 * @param tolerance 허용 오차
 * @returns 끊는 지점의 인덱스
 */
export function findOptimalBreakPoint(
  text: string,
  targetLength: number,
  tolerance: number = 200
): number {
  if (text.length <= targetLength) return text.length;

  const minLength = Math.max(0, targetLength - tolerance);
  const maxLength = Math.min(text.length, targetLength + tolerance);
  
  // 한국어 문장 끝 패턴들 (점수가 높을수록 좋은 끊는 지점)
  const patterns = [
    { regex: /[.!?]\s+/g, score: 100 },  // 문장 끝 + 공백
    { regex: /[.!?]$/g, score: 95 },     // 문장 끝 (텍스트 마지막)
    { regex: /[.!?]/g, score: 90 },      // 문장 끝
    { regex: /[,;]\s+/g, score: 80 },    // 쉼표, 세미콜론 + 공백
    { regex: /\n\s*/g, score: 85 },      // 줄바꿈
    { regex: /\s{2,}/g, score: 70 },     // 여러 공백
    { regex: /\s+/g, score: 60 },        // 단일 공백
  ];

  let bestBreakPoint = targetLength;
  let bestScore = -1;

  // 각 패턴에 대해 끊는 지점 후보를 찾고 점수를 계산
  for (const pattern of patterns) {
    const matches = Array.from(text.matchAll(pattern.regex));
    
    for (const match of matches) {
      const endIndex = match.index! + match[0].length;
      
      // 허용 범위 내에 있는지 확인
      if (endIndex >= minLength && endIndex <= maxLength) {
        // 목표 길이에 가까울수록 보너스 점수
        const distanceFromTarget = Math.abs(endIndex - targetLength);
        const distanceScore = Math.max(0, 50 - distanceFromTarget);
        const totalScore = pattern.score + distanceScore;
        
        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestBreakPoint = endIndex;
        }
      }
    }
  }

  // 좋은 끊는 지점을 찾지 못한 경우, 목표 길이에서 강제로 끊기
  return bestBreakPoint;
}

/**
 * 긴 텍스트를 페이지별로 분할합니다.
 * @param text 분할할 텍스트
 * @param charsPerPage 페이지당 문자 수
 * @returns 페이지 경계점들의 배열
 */
export function splitTextIntoPages(text: string, charsPerPage: number): number[] {
  if (text.length <= charsPerPage) {
    return [text.length];
  }

  const pageBreaks: number[] = [];
  let currentPosition = 0;

  while (currentPosition < text.length) {
    const remainingText = text.slice(currentPosition);
    
    if (remainingText.length <= charsPerPage) {
      // 마지막 페이지
      pageBreaks.push(text.length);
      break;
    }

    const breakPoint = findOptimalBreakPoint(remainingText, charsPerPage);
    const absoluteBreakPoint = currentPosition + breakPoint;
    
    pageBreaks.push(absoluteBreakPoint);
    currentPosition = absoluteBreakPoint;
  }

  return pageBreaks;
}

/**
 * 뷰포트 크기와 오류 영역 상태에 따라 동적으로 페이지당 문자 수를 계산합니다.
 * @param previewElement 미리보기 엘리먼트
 * @param isErrorExpanded 오류 영역 확장 여부
 * @returns 계산된 페이지당 문자 수
 */
export function calculateDynamicCharsPerPage(
  previewElement?: HTMLElement,
  isErrorExpanded: boolean = false
): number {
  if (!previewElement) return 800; // 기본값

  const previewRect = previewElement.getBoundingClientRect();
  const availableHeight = previewRect.height;
  const avgCharsPerLine = 75;
  const lineHeight = 15 * 1.7; // CSS line-height와 일치
  const linesPerPage = Math.floor(availableHeight / lineHeight);
  
  let calculatedChars: number;
  if (isErrorExpanded) {
    // 오류 영역이 펼쳐져 있으면 더 작은 페이지
    calculatedChars = Math.max(500, Math.min(1000, linesPerPage * avgCharsPerLine));
  } else {
    // 오류 영역이 접혀 있으면 더 큰 페이지
    calculatedChars = Math.max(800, Math.min(1800, linesPerPage * avgCharsPerLine));
  }
  
  return calculatedChars;
}