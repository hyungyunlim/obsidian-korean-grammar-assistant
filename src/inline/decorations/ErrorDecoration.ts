/**
 * 오류 데코레이션 관리
 * 기존 inlineModeService의 데코레이션 로직을 분리
 */

import { Decoration, WidgetType } from '@codemirror/view';
import { EnhancedInlineError } from '../types/InlineTypes';
import { InlineError } from '../../types/interfaces';
import { Logger } from '../../utils/logger';

/**
 * AI 교정 텍스트 Widget - Replace Decoration용
 * 기존 AITextWidget과 동일한 기능
 */
export class AITextWidget extends WidgetType {
  constructor(
    private aiText: string,
    private errorId: string,
    private originalText: string
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');

    // 텍스트 내용 안전하게 설정
    span.textContent = this.aiText;

    // 클래스 기반 스타일 적용 (인라인 스타일 제거)
    span.className = 'korean-grammar-ai-widget';

    // 데이터 속성 설정
    span.setAttribute('data-error-id', this.errorId);
    span.setAttribute('data-original', this.originalText);
    span.setAttribute('data-ai-status', 'corrected');
    span.setAttribute('data-ai-selected-value', this.aiText);
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');

    // 호버 효과 추가
    this.addHoverEffects(span);

    // 클릭 이벤트 추가
    this.addClickHandler(span);

    return span;
  }
  
  private addHoverEffects(span: HTMLElement): void {
    span.addEventListener('mouseenter', (e) => {
      // CSS :hover 상태는 자동으로 처리됨
      // 툴팁 표시 로직만 실행
      this.showTooltip(e, span);
    });

    span.addEventListener('mouseleave', () => {
      // CSS :hover 상태는 자동으로 처리됨
      // 툴팁 숨기기 로직만 실행
      this.hideTooltip();
    });
  }
  
  private addClickHandler(span: HTMLElement): void {
    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      Logger.log('AITextWidget: 클릭됨', {
        errorId: this.errorId,
        aiText: this.aiText,
        originalText: this.originalText
      });
      
      // 클릭 이벤트를 상위로 전파
      const customEvent = new CustomEvent('ai-widget-click', {
        detail: {
          errorId: this.errorId,
          aiText: this.aiText,
          originalText: this.originalText,
          element: span
        },
        bubbles: true
      });
      
      span.dispatchEvent(customEvent);
    });
  }
  
  private showTooltip(event: MouseEvent, element: HTMLElement): void {
    // 기존 툴팁 로직과 호환되도록 구현
    const mockError: InlineError = {
      uniqueId: this.errorId,
      correction: {
        original: this.originalText,
        corrected: [this.aiText],
        help: 'AI가 선택한 수정사항'
      },
      start: 0,
      end: 0,
      line: 0,
      ch: 0,
      isActive: true,
      aiAnalysis: {
        selectedValue: this.aiText,
        confidence: 90,
        reasoning: 'AI가 자동으로 선택한 수정사항입니다.',
        isExceptionProcessed: false
      },
      aiStatus: 'corrected',
      aiSelectedValue: this.aiText
    };
    
    // 글로벌 툴팁 표시
    if ((window as any).globalInlineTooltip) {
      const mousePosition = { x: event.clientX, y: event.clientY };
      (window as any).globalInlineTooltip.show(mockError, element, 'hover', mousePosition);
    }
  }
  
  private hideTooltip(): void {
    setTimeout(() => {
      if ((window as any).globalInlineTooltip && !(window as any).globalInlineTooltip.isHovered) {
        (window as any).globalInlineTooltip.hide();
      }
    }, 500);
  }
  
  eq(other: AITextWidget): boolean {
    return this.aiText === other.aiText && 
           this.errorId === other.errorId && 
           this.originalText === other.originalText;
  }
}

/**
 * 오류 데코레이션 생성 및 관리 클래스
 */
export class ErrorDecoration {
  private static instance: ErrorDecoration;
  
  public static getInstance(): ErrorDecoration {
    if (!ErrorDecoration.instance) {
      ErrorDecoration.instance = new ErrorDecoration();
    }
    return ErrorDecoration.instance;
  }
  
  /**
   * AI 교정 Replace 데코레이션 생성
   */
  createAIReplaceDecoration(error: InlineError): Decoration {
    Logger.log('ErrorDecoration: AI Replace 데코레이션 생성', {
      errorId: error.uniqueId,
      aiSelectedValue: error.aiSelectedValue
    });
    
    return Decoration.replace({
      widget: new AITextWidget(
        error.aiSelectedValue || '',
        error.uniqueId,
        error.correction.original
      )
    });
  }
  
  /**
   * 기본 Mark 데코레이션 생성
   */
  createErrorMarkDecoration(error: InlineError, isFocused: boolean = false): Decoration {
    Logger.log('ErrorDecoration: Mark 데코레이션 생성', {
      errorId: error.uniqueId,
      isFocused
    });
    
    return Decoration.mark({
      class: `korean-grammar-error-inline ${isFocused ? 'korean-grammar-focused' : ''}`,
      attributes: {
        'data-error-id': error.uniqueId,
        'data-original': error.correction.original,
        'data-corrected': JSON.stringify(error.correction.corrected),
        'data-help': error.correction.help || '',
        'data-ai-status': error.aiStatus || 'none',
        'data-ai-selected-value': error.aiSelectedValue || '',
        'role': 'button',
        'tabindex': '0'
      }
    });
  }
  
  /**
   * 포커스 데코레이션 생성
   */
  createFocusDecoration(error: InlineError): Decoration {
    Logger.log('ErrorDecoration: 포커스 데코레이션 생성', {
      errorId: error.uniqueId
    });
    
    return Decoration.mark({
      class: 'korean-grammar-error-inline korean-grammar-focused',
      attributes: {
        'data-error-id': error.uniqueId,
        'data-original': error.correction.original,
        'data-corrected': JSON.stringify(error.correction.corrected),
        'data-help': error.correction.help || '',
        'data-ai-status': error.aiStatus || 'none',
        'data-ai-selected-value': error.aiSelectedValue || '',
        'role': 'button',
        'tabindex': '0'
      }
    });
  }
  
  /**
   * 데코레이션 타입 결정
   */
  determineDecorationType(error: InlineError, focusedErrorId?: string): 'replace' | 'mark' | 'focus' {
    // AI 분석 후 corrected 상태면 Replace 데코레이션
    if (error.aiStatus === 'corrected' && error.aiSelectedValue) {
      return 'replace';
    }
    
    // 포커스된 오류면 포커스 데코레이션
    if (focusedErrorId === error.uniqueId) {
      return 'focus';
    }
    
    // 기본은 Mark 데코레이션
    return 'mark';
  }
  
  /**
   * 적절한 데코레이션 생성
   */
  createDecoration(error: InlineError, focusedErrorId?: string): Decoration {
    const type = this.determineDecorationType(error, focusedErrorId);
    
    switch (type) {
      case 'replace':
        return this.createAIReplaceDecoration(error);
      case 'focus':
        return this.createFocusDecoration(error);
      case 'mark':
      default:
        return this.createErrorMarkDecoration(error, false);
    }
  }
}