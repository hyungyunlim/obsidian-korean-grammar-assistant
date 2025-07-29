/**
 * 페이지 분할 로직 담당 클래스
 * 스마트 문장 경계 감지 및 자연스러운 페이지 분할을 수행
 */

import { createEl } from '../../utils/domUtils';
import { PageInfo, PageSplitOptions, IPopupComponent, RenderContext } from '../types/PopupTypes';
import { Logger } from '../../utils/logger';

export class PageSplitter implements IPopupComponent {
  private splitOptions: PageSplitOptions;
  private sentenceEndPatterns: RegExp[];
  private sentenceBreakChars: string[];

  constructor() {
    this.splitOptions = this.createDefaultOptions();
    this.initializeSentencePatterns();
  }

  async initialize(context: RenderContext): Promise<void> {
    Logger.log('[PageSplitter] 초기화 시작');
    
    // 컨텍스트에서 옵션 업데이트
    if (context.pagination.charsPerPage) {
      this.splitOptions.defaultPageSize = context.pagination.charsPerPage;
    }
    
    Logger.log('[PageSplitter] 초기화 완료', { options: this.splitOptions });
  }

  render(): HTMLElement {
    // PageSplitter는 UI 컴포넌트가 아니므로 빈 div 반환
    return createEl('div', { cls: 'page-splitter-placeholder', attr: { style: 'display: none;' } });
  }

  update(): void {
    // 필요 시 분할 옵션 업데이트
  }

  dispose(): void {
    Logger.log('[PageSplitter] 정리 완료');
  }

  isVisible(): boolean {
    return false; // UI 컴포넌트가 아님
  }

  // =============================================================================
  // 페이지 분할 핵심 메서드
  // =============================================================================

  /**
   * 텍스트를 페이지별로 분할
   */
  splitTextIntoPages(text: string, options?: Partial<PageSplitOptions>): PageInfo[] {
    const finalOptions = { ...this.splitOptions, ...options };
    Logger.log('[PageSplitter] 텍스트 분할 시작', {
      textLength: text.length,
      pageSize: finalOptions.defaultPageSize,
      options: finalOptions
    });

    if (text.length <= finalOptions.defaultPageSize) {
      // 단일 페이지 처리
      return [{
        index: 0,
        startPos: 0,
        endPos: text.length,
        text: text,
        errorCount: 0,
        size: text.length
      }];
    }

    const pages: PageInfo[] = [];
    let currentPos = 0;
    let pageIndex = 0;

    while (currentPos < text.length) {
      const remainingText = text.length - currentPos;
      let targetSize = Math.min(finalOptions.defaultPageSize, remainingText);

      // 마지막 페이지가 최소 크기보다 작으면 이전 페이지와 합침
      if (remainingText <= finalOptions.maxPageSize && 
          remainingText < finalOptions.minPageSize && 
          pages.length > 0) {
        const lastPage = pages.pop()!;
        targetSize = text.length - lastPage.startPos;
        currentPos = lastPage.startPos;
        pageIndex--;
      }

      const endPos = this.findOptimalBreakPoint(text, currentPos, currentPos + targetSize, finalOptions);
      const pageText = text.slice(currentPos, endPos);

      pages.push({
        index: pageIndex,
        startPos: currentPos,
        endPos: endPos,
        text: pageText,
        errorCount: 0, // 나중에 교정 정보로 업데이트
        size: pageText.length
      });

      currentPos = endPos;
      pageIndex++;

      // 무한 루프 방지
      if (pageIndex > 100) {
        Logger.warn('[PageSplitter] 페이지 분할 한계 초과, 강제 종료');
        break;
      }
    }

    Logger.log('[PageSplitter] 텍스트 분할 완료', {
      totalPages: pages.length,
      averageSize: Math.round(text.length / pages.length)
    });

    return pages;
  }

  /**
   * 최적의 분할 지점 찾기
   */
  private findOptimalBreakPoint(text: string, startPos: number, targetPos: number, options: PageSplitOptions): number {
    const maxPos = Math.min(targetPos + 200, text.length); // 최대 200자까지 검색
    const minPos = Math.max(targetPos - 200, startPos + 100); // 최소 100자는 보장

    if (targetPos >= text.length) {
      return text.length;
    }

    if (!options.preferSentenceBoundary) {
      return targetPos;
    }

    let bestBreakPoint = targetPos;
    let bestScore = 0;

    // 목표 지점 주변에서 최적 분할점 탐색
    for (let pos = minPos; pos <= maxPos; pos++) {
      const score = this.calculateBreakPointScore(text, pos, targetPos);
      if (score > bestScore) {
        bestScore = score;
        bestBreakPoint = pos;
      }
    }

    // 적절한 분할점을 찾지 못한 경우 폴백
    if (bestScore === 0) {
      bestBreakPoint = this.findFallbackBreakPoint(text, startPos, targetPos);
    }

    Logger.debug('[PageSplitter] 분할점 선택', {
      targetPos,
      bestBreakPoint,
      bestScore,
      searchRange: `${minPos}-${maxPos}`
    });

    return bestBreakPoint;
  }

  /**
   * 분할점 점수 계산
   */
  private calculateBreakPointScore(text: string, pos: number, targetPos: number): number {
    if (pos <= 0 || pos >= text.length) {
      return 0;
    }

    let score = 0;
    const char = text[pos - 1];
    const nextChar = text[pos];
    const context = text.slice(Math.max(0, pos - 3), Math.min(text.length, pos + 3));

    // 1. 문장 끝 패턴 점수 (가장 높은 우선순위)
    if (this.isSentenceEnd(context, pos - Math.max(0, pos - 3))) {
      score += 100;
    }

    // 2. 단락 경계 점수
    if (char === '\n' && nextChar === '\n') {
      score += 90;
    }

    // 3. 줄바꿈 점수
    if (char === '\n') {
      score += 70;
    }

    // 4. 구두점 점수
    if (this.sentenceBreakChars.includes(char)) {
      score += 60;
    }

    // 5. 공백 점수
    if (char === ' ' || char === '\t') {
      score += 30;
    }

    // 6. 목표 지점과의 거리 보정 (거리 기반 패널티)
    const distance = Math.abs(pos - targetPos);
    const distancePenalty = Math.max(0, 50 - distance * 0.5);
    score += distancePenalty;

    // 7. 한국어 특화: 조사/어미 앞에서 끊지 않기
    if (this.isKoreanParticle(nextChar)) {
      score -= 20;
    }

    return score;
  }

  /**
   * 문장 끝 패턴 검사
   */
  private isSentenceEnd(context: string, relativePos: number): boolean {
    for (const pattern of this.sentenceEndPatterns) {
      if (pattern.test(context.slice(0, relativePos + 1))) {
        return true;
      }
    }
    return false;
  }

  /**
   * 한국어 조사/어미 검사
   */
  private isKoreanParticle(char: string): boolean {
    const koreanParticles = ['은', '는', '이', '가', '을', '를', '에', '에서', '로', '와', '과', '의'];
    return koreanParticles.some(particle => char === particle[0]);
  }

  /**
   * 폴백 분할점 찾기 (문장 경계를 찾지 못한 경우)
   */
  private findFallbackBreakPoint(text: string, startPos: number, targetPos: number): number {
    const searchEnd = Math.min(targetPos + 100, text.length);
    
    // 1차: 공백이나 구두점 찾기
    for (let pos = targetPos; pos < searchEnd; pos++) {
      const char = text[pos];
      if (char === ' ' || char === '\n' || this.sentenceBreakChars.includes(char)) {
        return pos + 1;
      }
    }

    // 2차: 역방향으로 공백 찾기
    for (let pos = targetPos - 1; pos > startPos + 50; pos--) {
      const char = text[pos];
      if (char === ' ' || char === '\n') {
        return pos + 1;
      }
    }

    // 최종: 목표 지점 그대로 사용
    return targetPos;
  }

  /**
   * 페이지 정보에 오류 개수 업데이트
   */
  updatePageErrorCounts(pages: PageInfo[], text: string, corrections: any[]): PageInfo[] {
    return pages.map(page => {
      let errorCount = 0;
      const pageText = text.slice(page.startPos, page.endPos);

      corrections.forEach(correction => {
        if (pageText.includes(correction.original)) {
          errorCount++;
        }
      });

      return {
        ...page,
        errorCount
      };
    });
  }

  // =============================================================================
  // 설정 관련 메서드
  // =============================================================================

  updateSplitOptions(options: Partial<PageSplitOptions>): void {
    this.splitOptions = { ...this.splitOptions, ...options };
    Logger.log('[PageSplitter] 분할 옵션 업데이트', { options: this.splitOptions });
  }

  getSplitOptions(): PageSplitOptions {
    return { ...this.splitOptions };
  }

  // =============================================================================
  // Private 초기화 메서드
  // =============================================================================

  private createDefaultOptions(): PageSplitOptions {
    return {
      defaultPageSize: 800,
      minPageSize: 500,
      maxPageSize: 1800,
      preferSentenceBoundary: true,
      considerErrorExpansion: true
    };
  }

  private initializeSentencePatterns(): void {
    // 한국어 문장 끝 패턴
    this.sentenceEndPatterns = [
      /[.!?][\s]*$/,           // 기본 문장부호 + 공백
      /[.][\s]+[A-Z가-힣]/,     // 마침표 + 공백 + 대문자/한글
      /[!?][\s]+/,             // 느낌표/물음표 + 공백
      /다\.[\s]*/,             // "다." 패턴
      /습니다\.[\s]*/,         // "습니다." 패턴
      /였습니다\.[\s]*/,       // "였습니다." 패턴
      /입니다\.[\s]*/,         // "입니다." 패턴
      /겠습니다\.[\s]*/,       // "겠습니다." 패턴
      /니다\.[\s]*/,           // "니다." 패턴
      /요\.[\s]*/,             // "요." 패턴
      /죠\.[\s]*/,             // "죠." 패턴
      /네\.[\s]*/,             // "네." 패턴
      /예\.[\s]*/              // "예." 패턴
    ];

    this.sentenceBreakChars = ['.', '!', '?', ':', ';', ',', ')', ']', '}', '"', "'"];
  }
}