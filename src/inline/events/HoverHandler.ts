/**
 * 호버 이벤트 처리
 * 기존 inlineModeService의 호버 로직을 분리
 */

import { HoverEventData, EventHandler } from '../types/EventTypes';
import { InlineError } from '../../types/interfaces';
import { Logger } from '../../utils/logger';

export class HoverHandler {
  private hoverTimeout: NodeJS.Timeout | null = null;
  private currentHoveredError: InlineError | null = null;
  private hoverDelay: number = 300;
  private unhoverDelay: number = 150;
  
  // 이벤트 콜백들
  private onErrorHover?: EventHandler<HoverEventData>;
  private onErrorUnhover?: EventHandler<HoverEventData>;
  
  // 형태소 기반 호버 확장
  private morphemeExpansionEnabled: boolean = true;
  private expandedElements: Set<HTMLElement> = new Set();
  
  constructor() {
    Logger.log('HoverHandler: 초기화 완료');
  }
  
  /**
   * 이벤트 콜백 등록
   */
  setEventHandlers(handlers: {
    onErrorHover?: EventHandler<HoverEventData>;
    onErrorUnhover?: EventHandler<HoverEventData>;
  }): void {
    this.onErrorHover = handlers.onErrorHover;
    this.onErrorUnhover = handlers.onErrorUnhover;
    
    Logger.log('HoverHandler: 이벤트 핸들러 등록 완료');
  }
  
  /**
   * 호버 이벤트 등록
   */
  registerHoverEvents(container: HTMLElement): void {
    // mouseenter 이벤트 (호버 시작)
    container.addEventListener('mouseenter', this.handleMouseEnter.bind(this), true);
    
    // mouseleave 이벤트 (호버 종료)
    container.addEventListener('mouseleave', this.handleMouseLeave.bind(this), true);
    
    Logger.log('HoverHandler: 호버 이벤트 등록 완료');
  }
  
  /**
   * 호버 이벤트 해제
   */
  unregisterHoverEvents(container: HTMLElement): void {
    container.removeEventListener('mouseenter', this.handleMouseEnter.bind(this), true);
    container.removeEventListener('mouseleave', this.handleMouseLeave.bind(this), true);
    
    // 타이머 및 상태 정리
    this.clearHoverTimeout();
    this.currentHoveredError = null;
    this.expandedElements.clear();
    
    Logger.log('HoverHandler: 호버 이벤트 해제 완료');
  }
  
  /**
   * 마우스 진입 처리
   */
  private handleMouseEnter(event: MouseEvent): void {
    try {
      const target = event.target as HTMLElement;
      if (!this.isHoverableErrorElement(target)) {
        return;
      }
      
      const errorId = target.getAttribute('data-error-id');
      if (!errorId) {
        Logger.warn('HoverHandler: 오류 ID를 찾을 수 없음');
        return;
      }
      
      // 이미 동일한 오류에 호버 중이면 무시
      if (this.currentHoveredError?.uniqueId === errorId) {
        Logger.debug('HoverHandler: 이미 호버 중인 오류', { errorId });
        return;
      }
      
      // 이전 호버 타이머 취소
      this.clearHoverTimeout();
      
      Logger.log('HoverHandler: 새로운 오류 호버 시작', { errorId });
      
      // 마우스 위치 정보 수집
      const mousePosition = { x: event.clientX, y: event.clientY };
      
      // 형태소 기반 호버 영역 확장
      if (this.morphemeExpansionEnabled) {
        this.expandHoverAreaByMorphemes(target, errorId);
      }
      
      // 지연 후 호버 처리
      this.hoverTimeout = setTimeout(() => {
        const error = this.getErrorFromElement(target);
        this.currentHoveredError = error;
        this.handleErrorHover(error, target, mousePosition, true);
      }, this.hoverDelay);
      
    } catch (error) {
      Logger.error('HoverHandler: 마우스 진입 처리 중 오류', error);
    }
  }
  
  /**
   * 마우스 이탈 처리
   */
  private handleMouseLeave(event: MouseEvent): void {
    try {
      const target = event.target as HTMLElement;
      if (!this.isHoverableErrorElement(target)) {
        return;
      }
      
      const errorId = target.getAttribute('data-error-id');
      
      // 현재 호버 중인 오류에서 벗어날 때만 처리
      if (this.currentHoveredError?.uniqueId === errorId) {
        Logger.log('HoverHandler: 오류 호버 종료', { errorId });
        
        this.clearHoverTimeout();
        
        // 지연 후 호버 상태 해제 (툴팁으로 마우스 이동 시간 확보)
        setTimeout(() => {
          if (this.currentHoveredError?.uniqueId === errorId) {
            const mousePosition = { x: event.clientX, y: event.clientY };
            this.handleErrorHover(this.currentHoveredError, target, mousePosition, false);
            this.currentHoveredError = null;
            
            // 확장된 호버 영역 정리
            this.clearExpandedHoverArea();
          }
        }, this.unhoverDelay);
      }
      
    } catch (error) {
      Logger.error('HoverHandler: 마우스 이탈 처리 중 오류', error);
    }
  }
  
  /**
   * 오류 호버 처리
   */
  private async handleErrorHover(
    error: InlineError, 
    element: HTMLElement, 
    mousePosition: { x: number; y: number },
    isEntering: boolean
  ): Promise<void> {
    const handler = isEntering ? this.onErrorHover : this.onErrorUnhover;
    
    if (!handler) {
      Logger.warn('HoverHandler: 호버 핸들러가 등록되지 않음', { isEntering });
      return;
    }
    
    const hoverData: HoverEventData = {
      errorId: error.uniqueId,
      error,
      element,
      mouseEvent: new MouseEvent(isEntering ? 'mouseenter' : 'mouseleave'),
      position: mousePosition,
      isEntering
    };
    
    await handler(hoverData);
  }
  
  /**
   * 형태소 기반 호버 영역 확장
   */
  private expandHoverAreaByMorphemes(target: HTMLElement, errorId: string): void {
    if (!this.morphemeExpansionEnabled) return;
    
    try {
      // 같은 형태소 그룹에 속하는 인접 요소들 찾기
      const parentElement = target.parentElement;
      if (!parentElement) return;
      
      const allErrorElements = parentElement.querySelectorAll('.korean-grammar-error-inline');
      const targetRect = target.getBoundingClientRect();
      const expandDistance = 50; // 50px 이내의 요소들 확장
      
      for (const element of Array.from(allErrorElements)) {
        const htmlElement = element as HTMLElement;
        if (htmlElement === target) continue;
        
        const elementRect = htmlElement.getBoundingClientRect();
        const distance = Math.abs(elementRect.left - targetRect.right);
        
        // 인접한 요소들을 호버 영역에 포함
        if (distance <= expandDistance) {
          htmlElement.classList.add('korean-grammar-inline-hover-bg');
          this.expandedElements.add(htmlElement);
          
          Logger.debug('HoverHandler: 호버 영역 확장', {
            mainErrorId: errorId,
            expandedElementId: htmlElement.getAttribute('data-error-id'),
            distance
          });
        }
      }
      
    } catch (error) {
      Logger.error('HoverHandler: 호버 영역 확장 중 오류', error);
    }
  }
  
  /**
   * 확장된 호버 영역 정리
   */
  private clearExpandedHoverArea(): void {
    for (const element of this.expandedElements) {
      element.classList.remove('korean-grammar-inline-hover-bg');
    }
    this.expandedElements.clear();
    
    Logger.debug('HoverHandler: 확장된 호버 영역 정리 완료');
  }
  
  /**
   * 호버 타이머 정리
   */
  private clearHoverTimeout(): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }
  }
  
  /**
   * 호버 가능한 오류 요소인지 확인
   */
  private isHoverableErrorElement(element: HTMLElement): boolean {
    return element && 
           element.classList && 
           (element.classList.contains('korean-grammar-error-inline') ||
            element.classList.contains('korean-grammar-ai-widget'));
  }
  
  /**
   * 요소에서 오류 정보 추출
   */
  private getErrorFromElement(element: HTMLElement): InlineError {
    const errorId = element.getAttribute('data-error-id') || '';
    const original = element.getAttribute('data-original') || '';
    const correctedStr = element.getAttribute('data-corrected') || '[]';
    const help = element.getAttribute('data-help') || '';
    const aiStatus = element.getAttribute('data-ai-status') || 'none';
    const aiSelectedValue = element.getAttribute('data-ai-selected-value') || '';
    const aiConfidence = element.getAttribute('data-ai-confidence') || '0';
    
    let corrected: string[] = [];
    try {
      corrected = JSON.parse(correctedStr);
    } catch (e) {
      Logger.warn('HoverHandler: 수정 제안 파싱 실패', { correctedStr });
    }
    
    const error: InlineError = {
      uniqueId: errorId,
      correction: {
        original,
        corrected,
        help
      },
      start: 0,
      end: 0,
      line: 0,
      ch: 0,
      isActive: true
    };
    
    // AI 관련 정보 추가
    if (aiStatus !== 'none') {
      error.aiStatus = aiStatus as 'corrected' | 'exception' | 'keep-original';
      error.aiSelectedValue = aiSelectedValue || undefined;
      
      if (aiConfidence !== '0') {
        error.aiAnalysis = {
          selectedValue: aiSelectedValue,
          confidence: parseInt(aiConfidence, 10) || 0,
          reasoning: `AI 분석 결과 (신뢰도 ${aiConfidence}%)`,
          isExceptionProcessed: aiStatus === 'exception-processed'
        };
      }
    }
    
    return error;
  }
  
  /**
   * 현재 호버된 오류 반환
   */
  getCurrentHoveredError(): InlineError | null {
    return this.currentHoveredError;
  }
  
  /**
   * 강제로 호버 상태 해제
   */
  clearHover(): void {
    this.clearHoverTimeout();
    this.currentHoveredError = null;
    this.clearExpandedHoverArea();
    
    Logger.log('HoverHandler: 호버 상태 강제 해제');
  }
  
  /**
   * 설정 업데이트
   */
  updateSettings(settings: {
    hoverDelay?: number;
    unhoverDelay?: number;
    morphemeExpansionEnabled?: boolean;
  }): void {
    if (settings.hoverDelay !== undefined) {
      this.hoverDelay = settings.hoverDelay;
    }
    if (settings.unhoverDelay !== undefined) {
      this.unhoverDelay = settings.unhoverDelay;
    }
    if (settings.morphemeExpansionEnabled !== undefined) {
      this.morphemeExpansionEnabled = settings.morphemeExpansionEnabled;
    }
    
    Logger.log('HoverHandler: 설정 업데이트', {
      hoverDelay: this.hoverDelay,
      unhoverDelay: this.unhoverDelay,
      morphemeExpansionEnabled: this.morphemeExpansionEnabled
    });
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      hasHoverTimeout: !!this.hoverTimeout,
      currentHoveredErrorId: this.currentHoveredError?.uniqueId || null,
      hoverDelay: this.hoverDelay,
      unhoverDelay: this.unhoverDelay,
      morphemeExpansionEnabled: this.morphemeExpansionEnabled,
      expandedElementsCount: this.expandedElements.size,
      hasHoverHandler: !!this.onErrorHover,
      hasUnhoverHandler: !!this.onErrorUnhover
    };
  }
}