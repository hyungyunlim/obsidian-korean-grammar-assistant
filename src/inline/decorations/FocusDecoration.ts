/**
 * 포커스 데코레이션 관리
 * 키보드 네비게이션 및 포커스 상태 시각화
 */

import { Decoration } from '@codemirror/view';
import { InlineError } from '../../types/interfaces';
import { Logger } from '../../utils/logger';

/**
 * 포커스 데코레이션 클래스
 */
export class FocusDecoration {
  private static instance: FocusDecoration;
  private focusedErrorId: string | null = null;
  private focusHistory: string[] = [];
  private maxHistorySize: number = 10;
  
  public static getInstance(): FocusDecoration {
    if (!FocusDecoration.instance) {
      FocusDecoration.instance = new FocusDecoration();
    }
    return FocusDecoration.instance;
  }
  
  /**
   * 포커스 데코레이션 생성
   */
  createFocusDecoration(error: InlineError): Decoration {
    Logger.log('FocusDecoration: 포커스 데코레이션 생성', {
      errorId: error.uniqueId,
      range: `${error.start}-${error.end}`
    });
    
    return Decoration.mark({
      class: 'korean-grammar-error-inline korean-grammar-focused',
      attributes: {
        'data-error-id': error.uniqueId,
        'data-focused': 'true',
        'data-original': error.correction.original,
        'data-corrected': JSON.stringify(error.correction.corrected),
        'data-help': error.correction.help || '',
        'data-ai-status': error.aiStatus || 'none',
        'data-ai-selected-value': error.aiSelectedValue || '',
        'role': 'button',
        'tabindex': '0',
        'aria-label': `오류: ${error.correction.original} → ${error.correction.corrected.join(', ')}`
      }
    });
  }
  
  /**
   * 호버 데코레이션 생성
   */
  createHoverDecoration(error: InlineError): Decoration {
    Logger.log('FocusDecoration: 호버 데코레이션 생성', {
      errorId: error.uniqueId
    });
    
    return Decoration.mark({
      class: 'korean-grammar-error-inline korean-grammar-hovered',
      attributes: {
        'data-error-id': error.uniqueId,
        'data-hovered': 'true',
        'data-original': error.correction.original,
        'data-corrected': JSON.stringify(error.correction.corrected),
        'data-help': error.correction.help || '',
        'role': 'button',
        'tabindex': '0'
      }
    });
  }
  
  /**
   * 포커스 + AI 상태 결합 데코레이션
   */
  createFocusedAIDecoration(error: InlineError): Decoration {
    const aiClass = error.aiStatus ? `korean-grammar-ai-${error.aiStatus}` : '';
    
    Logger.log('FocusDecoration: 포커스+AI 데코레이션 생성', {
      errorId: error.uniqueId,
      aiStatus: error.aiStatus
    });
    
    return Decoration.mark({
      class: `korean-grammar-error-inline korean-grammar-focused ${aiClass}`,
      attributes: {
        'data-error-id': error.uniqueId,
        'data-focused': 'true',
        'data-ai-status': error.aiStatus || 'none',
        'data-ai-confidence': error.aiAnalysis?.confidence?.toString() || '0',
        'data-original': error.correction.original,
        'data-corrected': JSON.stringify(error.correction.corrected),
        'data-help': error.correction.help || '',
        'role': 'button',
        'tabindex': '0',
        'aria-label': this.createAriaLabel(error)
      }
    });
  }
  
  /**
   * 접근성을 위한 ARIA 라벨 생성
   */
  private createAriaLabel(error: InlineError): string {
    let label = `오류: ${error.correction.original}`;
    
    if (error.aiStatus === 'corrected' && error.aiSelectedValue) {
      label += ` → AI 교정: ${error.aiSelectedValue}`;
      if (error.aiAnalysis?.confidence) {
        label += ` (신뢰도 ${error.aiAnalysis.confidence}%)`;
      }
    } else if (error.correction.corrected.length > 0) {
      label += ` → 제안: ${error.correction.corrected.join(', ')}`;
    }
    
    if (error.correction.help) {
      label += `. 도움말: ${error.correction.help}`;
    }
    
    return label;
  }
  
  /**
   * 포커스 상태 설정
   */
  setFocusedError(errorId: string | null): void {
    const previousId = this.focusedErrorId;
    this.focusedErrorId = errorId;
    
    // 포커스 히스토리 관리
    if (errorId && errorId !== previousId) {
      this.addToHistory(errorId);
    }
    
    Logger.log('FocusDecoration: 포커스 변경', {
      previous: previousId,
      current: errorId,
      historySize: this.focusHistory.length
    });
  }
  
  /**
   * 현재 포커스된 오류 ID 반환
   */
  getFocusedErrorId(): string | null {
    return this.focusedErrorId;
  }
  
  /**
   * 포커스 히스토리에 추가
   */
  private addToHistory(errorId: string): void {
    // 중복 제거
    const index = this.focusHistory.indexOf(errorId);
    if (index > -1) {
      this.focusHistory.splice(index, 1);
    }
    
    // 맨 앞에 추가
    this.focusHistory.unshift(errorId);
    
    // 최대 크기 유지
    if (this.focusHistory.length > this.maxHistorySize) {
      this.focusHistory = this.focusHistory.slice(0, this.maxHistorySize);
    }
  }
  
  /**
   * 이전 포커스로 돌아가기
   */
  focusPrevious(): string | null {
    if (this.focusHistory.length > 1) {
      // 현재 포커스를 제거하고 이전 것으로 설정
      this.focusHistory.shift();
      const previousId = this.focusHistory[0];
      this.setFocusedError(previousId);
      return previousId;
    }
    return null;
  }
  
  /**
   * 포커스 히스토리 조회
   */
  getFocusHistory(): string[] {
    return [...this.focusHistory];
  }
  
  /**
   * 포커스 히스토리 초기화
   */
  clearFocusHistory(): void {
    this.focusHistory = [];
    this.focusedErrorId = null;
    Logger.log('FocusDecoration: 포커스 히스토리 초기화');
  }
  
  /**
   * 오류가 포커스되어 있는지 확인
   */
  isErrorFocused(errorId: string): boolean {
    return this.focusedErrorId === errorId;
  }
  
  /**
   * 포커스 관련 CSS 클래스 생성
   */
  generateFocusClasses(error: InlineError, isFocused: boolean, isHovered: boolean = false): string {
    const classes = ['korean-grammar-error-inline'];
    
    if (isFocused) {
      classes.push('korean-grammar-focused');
    }
    
    if (isHovered) {
      classes.push('korean-grammar-hovered');
    }
    
    // AI 상태 클래스 추가
    if (error.aiStatus) {
      classes.push(`korean-grammar-ai-${error.aiStatus}`);
    }
    
    return classes.join(' ');
  }
  
  /**
   * 키보드 네비게이션을 위한 다음 오류 찾기
   */
  findNextFocusableError(
    errors: Map<string, InlineError>, 
    currentId: string | null,
    direction: 'next' | 'prev' = 'next'
  ): string | null {
    const errorIds = Array.from(errors.keys()).sort((a, b) => {
      const errorA = errors.get(a);
      const errorB = errors.get(b);
      if (!errorA || !errorB) return 0;
      return errorA.start - errorB.start;
    });
    
    if (errorIds.length === 0) return null;
    
    if (!currentId) {
      return direction === 'next' ? errorIds[0] : errorIds[errorIds.length - 1];
    }
    
    const currentIndex = errorIds.indexOf(currentId);
    if (currentIndex === -1) {
      return direction === 'next' ? errorIds[0] : errorIds[errorIds.length - 1];
    }
    
    if (direction === 'next') {
      return currentIndex < errorIds.length - 1 ? errorIds[currentIndex + 1] : errorIds[0];
    } else {
      return currentIndex > 0 ? errorIds[currentIndex - 1] : errorIds[errorIds.length - 1];
    }
  }
  
  /**
   * 디버그 정보 반환
   */
  getDebugInfo(): any {
    return {
      focusedErrorId: this.focusedErrorId,
      focusHistory: this.focusHistory,
      historySize: this.focusHistory.length,
      maxHistorySize: this.maxHistorySize
    };
  }
}