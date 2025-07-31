/**
 * AI 분석 결과 전용 데코레이션
 * AI 교정, 예외처리, 원본유지 등의 상태를 시각화
 */

import { Decoration, WidgetType } from '@codemirror/view';
import { InlineError, AIAnalysisResult } from '../../types/interfaces';
import { Logger } from '../../utils/logger';

/**
 * AI 상태 표시 위젯
 * AI 분석 결과를 시각적으로 표현
 */
export class AIStatusWidget extends WidgetType {
  constructor(
    private aiStatus: string,
    private confidence: number,
    private reasoning: string,
    private errorId: string
  ) {
    super();
  }
  
  toDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = 'korean-grammar-ai-status';
    
    // 상태에 따른 스타일 적용
    const statusConfig = this.getStatusConfig(this.aiStatus);
    
    // AI 상태별 클래스 추가
    const statusClass = this.getStatusClass(this.aiStatus);
    if (statusClass) {
      container.classList.add(statusClass);
    }
    
    // 상태 아이콘
    const icon = document.createElement('span');
    icon.className = 'korean-grammar-ai-status-icon';
    icon.textContent = statusConfig.icon;
    container.appendChild(icon);
    
    // 신뢰도 표시 (있는 경우)
    if (this.confidence > 0) {
      const confidenceSpan = document.createElement('span');
      confidenceSpan.className = 'korean-grammar-ai-status-confidence';
      confidenceSpan.textContent = `${this.confidence}%`;
      container.appendChild(confidenceSpan);
    }
    
    // 툴팁 정보 설정
    container.title = `AI 분석: ${this.reasoning} (신뢰도: ${this.confidence}%)`;
    container.setAttribute('data-error-id', this.errorId);
    container.setAttribute('data-ai-status', this.aiStatus);
    
    return container;
  }
  
  private getStatusConfig(status: string): {
    icon: string;
    background: string;
    color: string;
    border: string;
  } {
    switch (status) {
      case 'corrected':
        return {
          icon: '🤖',
          background: 'rgba(16, 185, 129, 0.1)',
          color: '#059669',
          border: '#10b981'
        };
      case 'exception-processed':
        return {
          icon: '🔵',
          background: 'rgba(59, 130, 246, 0.1)',
          color: '#2563eb',
          border: '#3b82f6'
        };
      case 'original-kept':
        return {
          icon: '🟠',
          background: 'rgba(245, 158, 11, 0.1)',
          color: '#d97706',
          border: '#f59e0b'
        };
      default:
        return {
          icon: '⚡',
          background: 'rgba(139, 92, 246, 0.1)',
          color: '#7c3aed',
          border: '#8b5cf6'
        };
    }
  }
  
  private getStatusClass(status: string): string | null {
    switch (status) {
      case 'corrected':
        return 'korean-grammar-ai-status-corrected';
      case 'exception-processed':
        return 'korean-grammar-ai-status-exception';
      case 'original-kept':
        return 'korean-grammar-ai-status-keep';
      default:
        return null;
    }
  }
  
  eq(other: AIStatusWidget): boolean {
    return this.aiStatus === other.aiStatus &&
           this.confidence === other.confidence &&
           this.reasoning === other.reasoning &&
           this.errorId === other.errorId;
  }
}

/**
 * AI 데코레이션 클래스
 */
export class AIDecoration {
  private static instance: AIDecoration;
  
  public static getInstance(): AIDecoration {
    if (!AIDecoration.instance) {
      AIDecoration.instance = new AIDecoration();
    }
    return AIDecoration.instance;
  }
  
  /**
   * AI 교정 데코레이션 생성
   * 텍스트를 교정된 내용으로 완전히 교체
   */
  createAICorrectionDecoration(error: InlineError): Decoration {
    Logger.log('AIDecoration: AI 교정 데코레이션 생성', {
      errorId: error.uniqueId,
      original: error.correction.original,
      corrected: error.aiSelectedValue
    });
    
    // AI가 선택한 텍스트로 완전 교체
    return Decoration.replace({
      widget: new AITextWidget(
        error.aiSelectedValue || error.correction.corrected[0] || '',
        error.uniqueId,
        error.correction.original
      )
    });
  }
  
  /**
   * AI 상태 표시 데코레이션 생성
   * 원본 텍스트는 유지하고 AI 상태만 표시
   */
  createAIStatusDecoration(error: InlineError): Decoration {
    const analysis = error.aiAnalysis;
    if (!analysis) {
      return this.createBasicAIDecoration(error);
    }
    
    Logger.log('AIDecoration: AI 상태 데코레이션 생성', {
      errorId: error.uniqueId,
      status: error.aiStatus,
      confidence: analysis.confidence
    });
    
    return Decoration.mark({
      class: `korean-grammar-error-inline korean-grammar-ai-${error.aiStatus}`,
      attributes: {
        'data-error-id': error.uniqueId,
        'data-ai-status': error.aiStatus || 'none',
        'data-ai-confidence': analysis.confidence?.toString() || '0',
        'data-ai-reasoning': analysis.reasoning || '',
        'data-original': error.correction.original,
        'role': 'button',
        'tabindex': '0'
      }
    });
  }
  
  /**
   * 기본 AI 데코레이션 (분석 정보 없을 때)
   */
  private createBasicAIDecoration(error: InlineError): Decoration {
    return Decoration.mark({
      class: 'korean-grammar-error-inline korean-grammar-ai-basic',
      attributes: {
        'data-error-id': error.uniqueId,
        'data-ai-status': 'pending',
        'data-original': error.correction.original,
        'role': 'button',
        'tabindex': '0'
      }
    });
  }
  
  /**
   * AI 분석 결과에 따른 적절한 데코레이션 선택
   */
  createOptimalAIDecoration(error: InlineError): Decoration {
    // AI가 교정을 선택했고 텍스트가 다른 경우 → Replace 데코레이션
    if (error.aiStatus === 'corrected' && 
        error.aiSelectedValue && 
        error.aiSelectedValue !== error.correction.original) {
      return this.createAICorrectionDecoration(error);
    }
    
    // AI 분석이 있는 경우 → 상태 표시 데코레이션
    if (error.aiAnalysis) {
      return this.createAIStatusDecoration(error);
    }
    
    // 기본 데코레이션
    return this.createBasicAIDecoration(error);
  }
  
  /**
   * AI 분석 배치 적용
   */
  applyAIAnalysisResults(
    errors: Map<string, InlineError>, 
    results: AIAnalysisResult[]
  ): Map<string, InlineError> {
    const updatedErrors = new Map(errors);
    
    Logger.log('AIDecoration: AI 분석 결과 일괄 적용', {
      errorCount: errors.size,
      resultCount: results.length
    });
    
    for (const result of results) {
      const error = updatedErrors.get(result.correctionIndex.toString());
      if (error) {
        // AI 분석 결과를 오류 객체에 적용
        const updatedError: InlineError = {
          ...error,
          aiAnalysis: {
            selectedValue: result.selectedValue,
            confidence: result.confidence,
            reasoning: result.reasoning,
            isExceptionProcessed: result.isExceptionProcessed
          },
          aiStatus: result.isExceptionProcessed ? 'exception' : 'corrected',
          aiSelectedValue: result.selectedValue
        };
        
        updatedErrors.set(result.correctionIndex.toString(), updatedError);
      }
    }
    
    return updatedErrors;
  }
  
  /**
   * AI 상태별 CSS 클래스 반환
   */
  getAIStatusClass(status: string): string {
    const baseClass = 'korean-grammar-ai';
    
    switch (status) {
      case 'corrected':
        return `${baseClass}-corrected`;
      case 'exception-processed':
        return `${baseClass}-exception`;
      case 'original-kept':
        return `${baseClass}-kept`;
      case 'pending':
        return `${baseClass}-pending`;
      default:
        return `${baseClass}-unknown`;
    }
  }
}

/**
 * AI 텍스트 위젯 (기존 AITextWidget을 여기로 이동)
 */
class AITextWidget extends WidgetType {
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
    
    // AI 교정 스타일 적용
    span.className = 'korean-grammar-ai-widget';
    
    // 데이터 속성 설정
    span.setAttribute('data-error-id', this.errorId);
    span.setAttribute('data-original', this.originalText);
    span.setAttribute('data-ai-status', 'corrected');
    span.setAttribute('data-ai-selected-value', this.aiText);
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');
    
    // 이벤트 핸들러 추가
    this.addEventHandlers(span);
    
    return span;
  }
  
  private addEventHandlers(span: HTMLElement): void {
    // 호버 효과
    span.addEventListener('mouseenter', (e) => {
      this.showTooltip(e, span);
    });
    
    span.addEventListener('mouseleave', () => {
      setTimeout(() => {
        if ((window as any).globalInlineTooltip && !(window as any).globalInlineTooltip.isHovered) {
          (window as any).globalInlineTooltip.hide();
        }
      }, 500);
    });
    
    // 클릭 이벤트
    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // 커스텀 이벤트 발생
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
    // 툴팁 표시 로직 (기존 코드와 동일)
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
    
    if ((window as any).globalInlineTooltip) {
      const mousePosition = { x: event.clientX, y: event.clientY };
      (window as any).globalInlineTooltip.show(mockError, element, 'hover', mousePosition);
    }
  }
  
  eq(other: AITextWidget): boolean {
    return this.aiText === other.aiText && 
           this.errorId === other.errorId && 
           this.originalText === other.originalText;
  }
}