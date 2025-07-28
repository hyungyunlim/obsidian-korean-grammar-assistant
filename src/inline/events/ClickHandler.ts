/**
 * 클릭 이벤트 처리
 * 기존 inlineModeService의 클릭 로직을 분리
 */

import { Platform } from 'obsidian';
import { ClickEventData, EventHandler } from '../types/EventTypes';
import { InlineError } from '../../types/interfaces';
import { Logger } from '../../utils/logger';

export class ClickHandler {
  private clickTimeout: NodeJS.Timeout | null = null;
  private lastClickTime: number = 0;
  private doubleClickDelay: number = 300;
  
  // 이벤트 콜백들
  private onErrorClick?: EventHandler<ClickEventData>;
  private onErrorDoubleClick?: EventHandler<ClickEventData>;
  private onAIWidgetClick?: EventHandler<ClickEventData>;
  
  constructor() {
    Logger.log('ClickHandler: 초기화 완료');
  }
  
  /**
   * 이벤트 콜백 등록
   */
  setEventHandlers(handlers: {
    onErrorClick?: EventHandler<ClickEventData>;
    onErrorDoubleClick?: EventHandler<ClickEventData>;
    onAIWidgetClick?: EventHandler<ClickEventData>;
  }): void {
    this.onErrorClick = handlers.onErrorClick;
    this.onErrorDoubleClick = handlers.onErrorDoubleClick;
    this.onAIWidgetClick = handlers.onAIWidgetClick;
    
    Logger.log('ClickHandler: 이벤트 핸들러 등록 완료');
  }
  
  /**
   * 클릭 이벤트 등록
   */
  registerClickEvents(container: HTMLElement): void {
    // 일반 클릭 이벤트
    container.addEventListener('click', this.handleClick.bind(this), true);
    
    // AI 위젯 클릭 이벤트 (커스텀 이벤트)
    container.addEventListener('ai-widget-click', this.handleAIWidgetClick.bind(this), true);
    
    Logger.log('ClickHandler: 클릭 이벤트 등록 완료');
  }
  
  /**
   * 클릭 이벤트 해제
   */
  unregisterClickEvents(container: HTMLElement): void {
    container.removeEventListener('click', this.handleClick.bind(this), true);
    container.removeEventListener('ai-widget-click', this.handleAIWidgetClick.bind(this), true);
    
    // 타이머 정리
    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
      this.clickTimeout = null;
    }
    
    Logger.log('ClickHandler: 클릭 이벤트 해제 완료');
  }
  
  /**
   * 일반 클릭 이벤트 처리
   */
  private handleClick(event: MouseEvent): void {
    try {
      // 모바일에서는 터치 이벤트를 사용하므로 클릭 무시
      if (Platform.isMobile) {
        Logger.debug('ClickHandler: 모바일에서 클릭 이벤트 무시 (터치 이벤트 사용)');
        return;
      }
      
      const target = event.target as HTMLElement;
      if (!this.isClickableErrorElement(target)) {
        return;
      }
      
      event.preventDefault();
      event.stopPropagation();
      
      const errorId = target.getAttribute('data-error-id');
      if (!errorId) {
        Logger.warn('ClickHandler: 오류 ID를 찾을 수 없음');
        return;
      }
      
      // 더블클릭 감지 로직
      const currentTime = Date.now();
      const isDoubleClick = currentTime - this.lastClickTime < this.doubleClickDelay;
      this.lastClickTime = currentTime;
      
      if (isDoubleClick) {
        // 더블클릭 처리
        this.handleDoubleClick(errorId, target, event);
      } else {
        // 단일 클릭 처리 (더블클릭 대기 시간 후)
        if (this.clickTimeout) {
          clearTimeout(this.clickTimeout);
        }
        
        this.clickTimeout = setTimeout(() => {
          this.handleSingleClick(errorId, target, event);
        }, this.doubleClickDelay);
      }
      
    } catch (error) {
      Logger.error('ClickHandler: 클릭 이벤트 처리 중 오류', error);
    }
  }
  
  /**
   * 단일 클릭 처리
   */
  private async handleSingleClick(errorId: string, element: HTMLElement, mouseEvent: MouseEvent): Promise<void> {
    Logger.log('ClickHandler: 단일 클릭 처리', { errorId });
    
    if (!this.onErrorClick) {
      Logger.warn('ClickHandler: 단일 클릭 핸들러가 등록되지 않음');
      return;
    }
    
    const clickData: ClickEventData = {
      errorId,
      error: this.getErrorFromElement(element),
      element,
      mouseEvent,
      position: { x: mouseEvent.clientX, y: mouseEvent.clientY },
      isMobile: Platform.isMobile
    };
    
    await this.onErrorClick(clickData);
  }
  
  /**
   * 더블클릭 처리
   */
  private async handleDoubleClick(errorId: string, element: HTMLElement, mouseEvent: MouseEvent): Promise<void> {
    Logger.log('ClickHandler: 더블클릭 처리', { errorId });
    
    // 단일 클릭 타이머 취소
    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
      this.clickTimeout = null;
    }
    
    if (!this.onErrorDoubleClick) {
      Logger.warn('ClickHandler: 더블클릭 핸들러가 등록되지 않음');
      return;
    }
    
    const clickData: ClickEventData = {
      errorId,
      error: this.getErrorFromElement(element),
      element,
      mouseEvent,
      position: { x: mouseEvent.clientX, y: mouseEvent.clientY },
      isMobile: Platform.isMobile
    };
    
    await this.onErrorDoubleClick(clickData);
  }
  
  /**
   * AI 위젯 클릭 처리
   */
  private async handleAIWidgetClick(event: CustomEvent): Promise<void> {
    const detail = event.detail;
    Logger.log('ClickHandler: AI 위젯 클릭 처리', { errorId: detail.errorId });
    
    if (!this.onAIWidgetClick) {
      Logger.warn('ClickHandler: AI 위젯 클릭 핸들러가 등록되지 않음');
      return;
    }
    
    const clickData: ClickEventData = {
      errorId: detail.errorId,
      error: this.createMockErrorFromAIWidget(detail),
      element: detail.element,
      mouseEvent: event as any, // CustomEvent를 MouseEvent처럼 처리
      position: { x: 0, y: 0 }, // AI 위젯에서는 위치 정보 불필요
      isMobile: Platform.isMobile
    };
    
    await this.onAIWidgetClick(clickData);
  }
  
  /**
   * 클릭 가능한 오류 요소인지 확인
   */
  private isClickableErrorElement(element: HTMLElement): boolean {
    return element && 
           element.classList && 
           (element.classList.contains('korean-grammar-error-inline') ||
            element.classList.contains('korean-grammar-ai-widget'));
  }
  
  /**
   * 요소에서 오류 정보 추출
   */
  private getErrorFromElement(element: HTMLElement): InlineError {
    // DOM 속성에서 오류 정보 재구성
    const errorId = element.getAttribute('data-error-id') || '';
    const original = element.getAttribute('data-original') || '';
    const correctedStr = element.getAttribute('data-corrected') || '[]';
    const help = element.getAttribute('data-help') || '';
    const aiStatus = element.getAttribute('data-ai-status') || 'none';
    const aiSelectedValue = element.getAttribute('data-ai-selected-value') || '';
    
    let corrected: string[] = [];
    try {
      corrected = JSON.parse(correctedStr);
    } catch (e) {
      Logger.warn('ClickHandler: 수정 제안 파싱 실패', { correctedStr });
    }
    
    return {
      uniqueId: errorId,
      correction: {
        original,
        corrected,
        help
      },
      start: 0, // DOM에서는 위치 정보 불가능
      end: 0,
      line: 0,
      ch: 0,
      isActive: true,
      aiStatus: aiStatus === 'none' ? undefined : aiStatus as 'corrected' | 'exception' | 'keep-original',
      aiSelectedValue: aiSelectedValue || undefined
    };
  }
  
  /**
   * AI 위젯 클릭에서 모의 오류 생성
   */
  private createMockErrorFromAIWidget(detail: any): InlineError {
    return {
      uniqueId: detail.errorId,
      correction: {
        original: detail.originalText,
        corrected: [detail.aiText],
        help: 'AI가 선택한 수정사항'
      },
      start: 0,
      end: 0,
      line: 0,
      ch: 0,
      isActive: true,
      aiStatus: 'corrected',
      aiSelectedValue: detail.aiText,
      aiAnalysis: {
        selectedValue: detail.aiText,
        confidence: 90,
        reasoning: 'AI가 자동으로 선택한 수정사항입니다.',
        isExceptionProcessed: false
      }
    };
  }
  
  /**
   * 설정 업데이트
   */
  updateSettings(settings: { doubleClickDelay?: number }): void {
    if (settings.doubleClickDelay !== undefined) {
      this.doubleClickDelay = settings.doubleClickDelay;
      Logger.log('ClickHandler: 더블클릭 지연시간 업데이트', { 
        doubleClickDelay: this.doubleClickDelay 
      });
    }
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      hasClickTimeout: !!this.clickTimeout,
      lastClickTime: this.lastClickTime,
      doubleClickDelay: this.doubleClickDelay,
      hasErrorClickHandler: !!this.onErrorClick,
      hasDoubleClickHandler: !!this.onErrorDoubleClick,
      hasAIWidgetClickHandler: !!this.onAIWidgetClick
    };
  }
}