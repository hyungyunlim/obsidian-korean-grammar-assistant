/**
 * 텍스트 처리 관련 유틸리티 함수들
 */
import { Logger } from './logger';

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
  // Use DOMParser for safer HTML entity decoding
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');
  return doc.documentElement.textContent || "";
}

/**
 * 정규식 특수 문자를 이스케이프합니다.
 * @param text 이스케이프할 문자열
 * @returns 이스케이프된 문자열
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
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
  if (!previewElement) {
    Logger.debug("No previewElement, returning default 800.");
    return 800; // 기본값
  }

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
  Logger.debug(`Available height: ${availableHeight}, Lines per page: ${linesPerPage}, Calculated chars: ${calculatedChars}, Error expanded: ${isErrorExpanded}`);
  
  return calculatedChars;
}

/**
 * 현재 커서 위치에서 문단을 감지하고 텍스트를 반환합니다.
 * Obsidian API를 최대한 활용하여 효율적으로 구현
 * @param editor 에디터 인스턴스
 * @returns 현재 문단의 텍스트와 선택 범위
 */
export function getCurrentParagraph(editor: any): { text: string; from: any; to: any } {
  const cursor = editor.getCursor();
  const currentLine = cursor.line;
  const totalLines = editor.lineCount();
  
  Logger.debug(`문단 감지 시작: 현재 라인 ${currentLine}, 총 라인 ${totalLines}`);
  
  // 현재 단어 위치 확인 (wordAt API 활용)
  const currentWord = editor.wordAt(cursor);
  if (currentWord) {
    Logger.debug(`현재 단어 범위: ${currentWord.from.line}:${currentWord.from.ch} - ${currentWord.to.line}:${currentWord.to.ch}`);
  }
  
  // 문단 경계 감지를 위한 변수
  let startLine = currentLine;
  let endLine = currentLine;
  
  // 위쪽 경계 감지 - 빈 줄, 제목, 목록 등을 고려
  while (startLine > 0) {
    const prevLine = editor.getLine(startLine - 1);
    
    // 빈 줄이면 문단 시작
    if (prevLine.trim() === '') {
      break;
    }
    
    // 마크다운 제목이면 문단 시작
    if (prevLine.startsWith('#')) {
      break;
    }
    
    // 마크다운 목록이면 문단 시작
    if (prevLine.match(/^[\s]*[-*+]\s/) || prevLine.match(/^[\s]*\d+\.\s/)) {
      break;
    }
    
    // 코드 블록이면 문단 시작
    if (prevLine.startsWith('```')) {
      break;
    }
    
    startLine--;
  }
  
  // 아래쪽 경계 감지 - 동일한 조건으로 문단 끝 감지
  while (endLine < totalLines - 1) {
    const nextLine = editor.getLine(endLine + 1);
    
    // 빈 줄이면 문단 끝
    if (nextLine.trim() === '') {
      break;
    }
    
    // 마크다운 제목이면 문단 끝
    if (nextLine.startsWith('#')) {
      break;
    }
    
    // 마크다운 목록이면 문단 끝
    if (nextLine.match(/^[\s]*[-*+]\s/) || nextLine.match(/^[\s]*\d+\.\s/)) {
      break;
    }
    
    // 코드 블록이면 문단 끝
    if (nextLine.startsWith('```')) {
      break;
    }
    
    endLine++;
  }
  
  const from = { line: startLine, ch: 0 };
  const to = { line: endLine, ch: editor.getLine(endLine).length };
  
  const text = editor.getRange(from, to);
  
  Logger.debug(`문단 감지 완료: ${startLine}행-${endLine}행 (${text.length}자)`);
  Logger.debug(`문단 내용 미리보기: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  
  return { text, from, to };
}

/**
 * 현재 커서 위치에서 단어를 감지하고 반환합니다.
 * @param editor 에디터 인스턴스
 * @returns 현재 단어의 텍스트와 선택 범위, 단어가 없으면 null
 */
export function getCurrentWord(editor: any): { text: string; from: any; to: any } | null {
  const cursor = editor.getCursor();
  const wordRange = editor.wordAt(cursor);
  
  if (!wordRange) {
    return null;
  }
  
  const text = editor.getRange(wordRange.from, wordRange.to);
  
  Logger.debug(`현재 단어 감지: "${text}" (${wordRange.from.line}:${wordRange.from.ch} - ${wordRange.to.line}:${wordRange.to.ch})`);
  
  return {
    text,
    from: wordRange.from,
    to: wordRange.to
  };
}

/**
 * 현재 커서 위치에서 문장을 감지하고 텍스트를 반환합니다.
 * @param editor 에디터 인스턴스
 * @returns 현재 문장의 텍스트와 선택 범위
 */
export function getCurrentSentence(editor: any): { text: string; from: any; to: any } {
  const cursor = editor.getCursor();
  const currentLine = cursor.line;
  const currentChar = cursor.ch;
  
  // 현재 라인의 텍스트 가져오기
  const currentLineText = editor.getLine(currentLine);
  
  Logger.debug(`문장 감지 시작: ${currentLine}행 ${currentChar}열`);
  
  // 한국어 문장 끝 패턴
  const sentenceEndPattern = /[.!?。！？]/;
  const sentenceEndPatternGlobal = /[.!?。！？]/g;
  
  // 현재 커서 위치에서 앞쪽으로 문장 시작점 찾기
  let sentenceStart = 0;
  let sentenceStartLine = currentLine;
  let sentenceStartChar = 0;
  
  // 현재 라인에서 앞쪽 문장 경계 찾기
  for (let i = currentChar - 1; i >= 0; i--) {
    if (sentenceEndPattern.test(currentLineText[i])) {
      sentenceStartChar = i + 1;
      break;
    }
  }
  
  // 현재 라인에서 문장 시작을 찾지 못했으면 이전 라인들 검사
  if (sentenceStartChar === 0) {
    let searchLine = currentLine - 1;
    while (searchLine >= 0) {
      const lineText = editor.getLine(searchLine);
      
      // 빈 줄이면 문장 시작
      if (lineText.trim() === '') {
        sentenceStartLine = searchLine + 1;
        sentenceStartChar = 0;
        break;
      }
      
      // 마크다운 구조 요소면 문장 시작
      if (lineText.startsWith('#') || 
          lineText.match(/^[\s]*[-*+]\s/) || 
          lineText.match(/^[\s]*\d+\.\s/)) {
        sentenceStartLine = searchLine + 1;
        sentenceStartChar = 0;
        break;
      }
      
      // 문장 끝 패턴 찾기
      const matches = Array.from(lineText.matchAll(sentenceEndPatternGlobal));
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1] as RegExpMatchArray;
        if (lastMatch && typeof lastMatch.index === 'number') {
          sentenceStartLine = searchLine;
          sentenceStartChar = lastMatch.index + 1;
          break;
        }
      }
      
      searchLine--;
    }
  }
  
  // 현재 커서 위치에서 뒤쪽으로 문장 끝점 찾기
  let sentenceEndLine = currentLine;
  let sentenceEndChar = currentLineText.length;
  
  // 현재 라인에서 뒤쪽 문장 경계 찾기
  for (let i = currentChar; i < currentLineText.length; i++) {
    if (sentenceEndPattern.test(currentLineText[i])) {
      sentenceEndChar = i + 1;
      break;
    }
  }
  
  // 현재 라인에서 문장 끝을 찾지 못했으면 다음 라인들 검사
  if (sentenceEndChar === currentLineText.length) {
    const totalLines = editor.lineCount();
    let searchLine = currentLine + 1;
    
    while (searchLine < totalLines) {
      const lineText = editor.getLine(searchLine);
      
      // 빈 줄이면 문장 끝
      if (lineText.trim() === '') {
        sentenceEndLine = searchLine - 1;
        sentenceEndChar = editor.getLine(sentenceEndLine).length;
        break;
      }
      
      // 마크다운 구조 요소면 문장 끝
      if (lineText.startsWith('#') || 
          lineText.match(/^[\s]*[-*+]\s/) || 
          lineText.match(/^[\s]*\d+\.\s/)) {
        sentenceEndLine = searchLine - 1;
        sentenceEndChar = editor.getLine(sentenceEndLine).length;
        break;
      }
      
      // 문장 끝 패턴 찾기
      const match = lineText.match(sentenceEndPattern);
      if (match && match.index !== undefined) {
        sentenceEndLine = searchLine;
        sentenceEndChar = match.index + 1;
        break;
      }
      
      searchLine++;
    }
  }
  
  // 문장 범위 정리
  const from = { line: sentenceStartLine, ch: sentenceStartChar };
  const to = { line: sentenceEndLine, ch: sentenceEndChar };
  
  // 텍스트 추출
  const text = editor.getRange(from, to).trim();
  
  Logger.debug(`문장 감지 완료: ${sentenceStartLine}:${sentenceStartChar} - ${sentenceEndLine}:${sentenceEndChar}`);
  Logger.debug(`문장 내용: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  
  return { text, from, to };
}

/**
 * Obsidian의 processLines API를 활용하여 전체 문서의 문단들을 효율적으로 분석합니다.
 * @param editor 에디터 인스턴스
 * @returns 문단들의 배열
 */
export function getAllParagraphs(editor: any): Array<{ text: string; from: any; to: any; lineStart: number; lineEnd: number }> {
  const paragraphs: Array<{ text: string; from: any; to: any; lineStart: number; lineEnd: number }> = [];
  const totalLines = editor.lineCount();
  
  let currentParagraphStart = -1;
  let currentParagraphLines: string[] = [];
  
  // processLines API를 활용하여 효율적으로 라인 처리
  for (let i = 0; i < totalLines; i++) {
    const line = editor.getLine(i);
    const isEmptyLine = line.trim() === '';
    const isMarkdownStructure = line.startsWith('#') || 
                               line.match(/^[\s]*[-*+]\s/) || 
                               line.match(/^[\s]*\d+\.\s/) ||
                               line.startsWith('```');
    
    if (isEmptyLine || isMarkdownStructure) {
      // 현재 문단 완료
      if (currentParagraphStart >= 0 && currentParagraphLines.length > 0) {
        const text = currentParagraphLines.join('\n');
        if (text.trim()) {
          paragraphs.push({
            text: text,
            from: { line: currentParagraphStart, ch: 0 },
            to: { line: i - 1, ch: editor.getLine(i - 1).length },
            lineStart: currentParagraphStart,
            lineEnd: i - 1
          });
        }
      }
      
      // 새 문단 시작 준비
      currentParagraphStart = -1;
      currentParagraphLines = [];
      
      // 구조적 요소는 별도 처리 (제목, 목록 등)
      if (isMarkdownStructure && !isEmptyLine) {
        paragraphs.push({
          text: line,
          from: { line: i, ch: 0 },
          to: { line: i, ch: line.length },
          lineStart: i,
          lineEnd: i
        });
      }
    } else {
      // 문단 내용 추가
      if (currentParagraphStart < 0) {
        currentParagraphStart = i;
      }
      currentParagraphLines.push(line);
    }
  }
  
  // 마지막 문단 처리
  if (currentParagraphStart >= 0 && currentParagraphLines.length > 0) {
    const text = currentParagraphLines.join('\n');
    if (text.trim()) {
      paragraphs.push({
        text: text,
        from: { line: currentParagraphStart, ch: 0 },
        to: { line: totalLines - 1, ch: editor.getLine(totalLines - 1).length },
        lineStart: currentParagraphStart,
        lineEnd: totalLines - 1
      });
    }
  }
  
  Logger.debug(`전체 문서 분석 완료: ${paragraphs.length}개 문단 발견`);
  
  return paragraphs;
}

/**
 * 에디터의 현재 스크롤 위치를 기반으로 보이는 문단들을 반환합니다.
 * @param editor 에디터 인스턴스
 * @returns 현재 뷰포트에 보이는 문단들
 */
export function getVisibleParagraphs(editor: any): Array<{ text: string; from: any; to: any; lineStart: number; lineEnd: number }> {
  const scrollInfo = editor.getScrollInfo();
  const allParagraphs = getAllParagraphs(editor);
  
  // 대략적인 라인 높이 계산 (실제 CSS 값과 다를 수 있음)
  const lineHeight = 20; // 픽셀 단위
  const visibleStartLine = Math.floor(scrollInfo.top / lineHeight);
  const visibleEndLine = Math.ceil((scrollInfo.top + scrollInfo.clientHeight) / lineHeight);
  
  const visibleParagraphs = allParagraphs.filter(paragraph => {
    // 문단이 뷰포트와 겹치는지 확인
    return paragraph.lineEnd >= visibleStartLine && paragraph.lineStart <= visibleEndLine;
  });
  
  Logger.debug(`현재 뷰포트 분석: ${visibleParagraphs.length}개 문단 표시 중 (${visibleStartLine}-${visibleEndLine}행)`);
  
  return visibleParagraphs;
}