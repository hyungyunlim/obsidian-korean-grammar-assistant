/**
 * Phase 6: Hover Handler
 * 
 * 호버 이벤트를 전문적으로 처리하는 핸들러입니다.
 * 데스크톱에서 마우스 호버 시 툴팁 및 미리보기를 표시합니다.
 */

import { EventContext } from './PopupEventManager';
import { Platform } from 'obsidian';
import { Logger } from '../../utils/logger';
import { setCssVariable } from '../../utils/domUtils';

/**
 * 호버 액션 타입
 */
export type HoverActionType = 
  | 'error-preview'       // 오류 미리보기 표시
  | 'suggestion-tooltip'  // 제안 툴팁 표시
  | 'help-tooltip'        // 도움말 툴팁 표시
  | 'button-hint'         // 버튼 힌트 표시
  | 'ai-info'            // AI 분석 정보 표시
  | 'navigation-hint'     // 네비게이션 힌트
  | 'unknown';           // 알 수 없는 액션

/**
 * 호버 상태
 */
export type HoverState = 'enter' | 'leave' | 'move';

/**
 * 호버 결과 정보
 */
export interface HoverResult {
  success: boolean;
  action: HoverActionType;
  state: HoverState;
  data?: Record<string, unknown>;
  shouldShowTooltip?: boolean;
  tooltipContent?: string;
  tooltipPosition?: { x: number; y: number };
}

/**
 * 호버 핸들러 콜백 타입
 */
export type HoverHandlerCallback = (result: HoverResult, context: EventContext) => Promise<void> | void;

/**
 * 툴팁 설정
 */
interface TooltipConfig {
  content: string;
  position: { x: number; y: number };
  delay: number;
  maxWidth: number;
  className?: string;
}

/**
 * HoverHandler
 * 호버 이벤트 전문 처리 클래스 (데스크톱 전용)
 */
export class HoverHandler {
  private callbacks: Map<HoverActionType, HoverHandlerCallback[]> = new Map();
  
  // 호버 상태 관리
  private currentHoverTarget?: HTMLElement;
  private hoverTimer?: number;
  private readonly HOVER_DELAY = 500; // 500ms
  
  // 툴팁 관리
  private activeTooltip?: HTMLElement;
  private tooltipContainer?: HTMLElement;
  
  // 호버 영역 추적
  private hoverAreas: Map<HTMLElement, HoverActionType> = new Map();
  
  constructor() {
    // 모바일에서는 호버를 사용하지 않음
    if (Platform.isMobile) {
      Logger.log('HoverHandler: 모바일 플랫폼에서는 비활성화됨');
      return;
    }
    
    Logger.log('HoverHandler 생성됨 (데스크톱)');
    this.initializeDefaultActions();
    this.createTooltipContainer();
  }

  /**
   * 기본 액션 타입들 초기화
   */
  private initializeDefaultActions(): void {
    const actionTypes: HoverActionType[] = [
      'error-preview', 'suggestion-tooltip', 'help-tooltip',
      'button-hint', 'ai-info', 'navigation-hint', 'unknown'
    ];
    
    actionTypes.forEach(actionType => {
      this.callbacks.set(actionType, []);
    });
  }

  /**
   * 툴팁 컨테이너 생성
   */
  private createTooltipContainer(): void {
    this.tooltipContainer = createDiv();
    this.tooltipContainer.className = 'kga-popup-tooltip-container';
    activeDocument.body.appendChild(this.tooltipContainer);
  }

  /**
   * 호버 시작 처리 (mouseenter)
   */
  public async handleHoverEnter(event: Event, context: EventContext): Promise<boolean> {
    if (Platform.isMobile) return false;
    
    Logger.debug('HoverHandler: 호버 시작', {
      targetClass: context.target.className,
      correctionIndex: context.correctionIndex
    });

    try {
      // 이전 호버 정리
      this.clearCurrentHover();
      
      // 새 호버 설정
      this.currentHoverTarget = context.target;
      
      // 호버 액션 타입 결정
      const actionType = this.determineHoverAction(context);
      
      // 지연 후 툴팁 표시
      this.hoverTimer = activeWindow.setTimeout(async () => {
        await this.showHoverTooltip(actionType, context, event as MouseEvent);
      }, this.HOVER_DELAY);
      
      // 호버 결과 생성
      const result: HoverResult = {
        success: true,
        action: actionType,
        state: 'enter',
        data: { correctionIndex: context.correctionIndex }
      };
      
      // 콜백 실행
      await this.executeCallbacks(result, context);
      
      return true;
      
    } catch (error) {
      Logger.error('HoverHandler: 호버 시작 중 오류', error);
      return false;
    }
  }

  /**
   * 호버 종료 처리 (mouseleave)
   */
  public async handleHoverLeave(event: Event, context: EventContext): Promise<boolean> {
    if (Platform.isMobile) return false;
    
    Logger.debug('HoverHandler: 호버 종료', {
      targetClass: context.target.className
    });

    try {
      // 호버 정리
      this.clearCurrentHover();
      
      // 툴팁 숨김
      this.hideTooltip();
      
      // 호버 액션 타입 결정
      const actionType = this.determineHoverAction(context);
      
      // 호버 결과 생성
      const result: HoverResult = {
        success: true,
        action: actionType,
        state: 'leave',
        data: { correctionIndex: context.correctionIndex }
      };
      
      // 콜백 실행
      await this.executeCallbacks(result, context);
      
      return true;
      
    } catch (error) {
      Logger.error('HoverHandler: 호버 종료 중 오류', error);
      return false;
    }
  }

  /**
   * 마우스 이동 처리 (mousemove)
   */
  public async handleMouseMove(event: MouseEvent, context: EventContext): Promise<boolean> {
    if (Platform.isMobile || !this.activeTooltip) return false;
    
    // 툴팁 위치 업데이트
    this.updateTooltipPosition(event);
    
    return true;
  }

  /**
   * 호버 액션 타입 결정
   */
  private determineHoverAction(context: EventContext): HoverActionType {
    const { target } = context;
    
    // 오류 텍스트 호버
    if (target.classList.contains('error-text') || 
        target.classList.contains('error-highlight') ||
        target.closest('.error-text, .error-highlight')) {
      return 'error-preview';
    }
    
    // 제안 항목 호버
    if (target.classList.contains('suggestion-item') ||
        target.closest('.suggestion-item')) {
      return 'suggestion-tooltip';
    }
    
    // AI 분석 결과 호버
    if (target.classList.contains('ai-analysis') ||
        target.classList.contains('ai-confidence') ||
        target.closest('.ai-analysis, .ai-confidence')) {
      return 'ai-info';
    }
    
    // 도움말 아이콘 호버
    if (target.classList.contains('help-icon') ||
        target.classList.contains('info-icon') ||
        target.closest('.help-icon, .info-icon')) {
      return 'help-tooltip';
    }
    
    // 네비게이션 버튼 호버
    if (target.classList.contains('nav-button') ||
        target.classList.contains('kga-pagination-btn') ||
        target.closest('.nav-button, .kga-pagination-btn')) {
      return 'navigation-hint';
    }
    
    // 일반 버튼 호버
    if (target.tagName === 'BUTTON' ||
        target.classList.contains('btn') ||
        target.closest('button, .btn')) {
      return 'button-hint';
    }
    
    return 'unknown';
  }

  /**
   * 호버 툴팁 표시
   */
  private async showHoverTooltip(
    actionType: HoverActionType, 
    context: EventContext, 
    mouseEvent: MouseEvent
  ): Promise<void> {
    
    const tooltipConfig = await this.createTooltipConfig(actionType, context, mouseEvent);
    
    if (!tooltipConfig) {
      Logger.debug('HoverHandler: 툴팁 설정이 없어 표시 건너뜀');
      return;
    }
    
    // 기존 툴팁 제거
    this.hideTooltip();
    
    // 새 툴팁 생성
    this.activeTooltip = this.createTooltipElement(tooltipConfig);
    
    if (this.tooltipContainer) {
      this.tooltipContainer.appendChild(this.activeTooltip);
      
      // 위치 조정 (화면 경계 확인)
      this.adjustTooltipPosition(this.activeTooltip, tooltipConfig.position);
    }
    
    Logger.debug('HoverHandler: 툴팁 표시됨', { 
      action: actionType,
      position: tooltipConfig.position 
    });
  }

  /**
   * 툴팁 설정 생성
   */
  private async createTooltipConfig(
    actionType: HoverActionType, 
    context: EventContext, 
    mouseEvent: MouseEvent
  ): Promise<TooltipConfig | null> {
    
    let content = '';
    let className = 'kga-hover-tooltip';
    
    switch (actionType) {
      case 'error-preview':
        content = await this.createErrorPreviewContent(context);
        className = 'kga-error-preview-tooltip';
        break;
        
      case 'suggestion-tooltip':
        content = await this.createSuggestionTooltipContent(context);
        className = 'kga-suggestion-tooltip';
        break;
        
      case 'ai-info':
        content = await this.createAIInfoContent(context);
        className = 'kga-ai-info-tooltip';
        break;
        
      case 'help-tooltip':
        content = await this.createHelpTooltipContent(context);
        className = 'kga-help-tooltip';
        break;
        
      case 'button-hint':
        content = await this.createButtonHintContent(context);
        className = 'kga-button-hint-tooltip';
        break;
        
      case 'navigation-hint':
        content = await this.createNavigationHintContent(context);
        className = 'kga-navigation-hint-tooltip';
        break;
        
      default:
        return null;
    }
    
    if (!content) return null;
    
    return {
      content,
      position: { x: mouseEvent.clientX + 10, y: mouseEvent.clientY + 10 },
      delay: this.HOVER_DELAY,
      maxWidth: 300,
      className
    };
  }

  // =============================================================================
  // 툴팁 콘텐츠 생성 메서드들
  // =============================================================================

  /**
   * 오류 미리보기 콘텐츠 생성
   */
  private async createErrorPreviewContent(context: EventContext): Promise<string> {
    const { target, correctionIndex } = context;
    
    if (correctionIndex === undefined) return '';
    
    // 기본 오류 정보
    let content = `<div class="kga-error-preview-content">`;
    content += `<div class="kga-error-title">맞춤법 오류 #${correctionIndex + 1}</div>`;
    
    // 오류 텍스트
    const errorText = target.textContent || '';
    if (errorText) {
      content += `<div class="kga-error-original">원본: "${errorText}"</div>`;
    }
    
    // 추가 정보 (Phase 7에서 상태 관리자와 연결 예정)
    content += `<div class="kga-error-hint">클릭하여 수정 제안 확인</div>`;
    content += `</div>`;
    
    return content;
  }

  /**
   * 제안 툴팁 콘텐츠 생성
   */
  private async createSuggestionTooltipContent(context: EventContext): Promise<string> {
    const { target } = context;
    
    const suggestionText = target.textContent || '';
    if (!suggestionText) return '';
    
    let content = `<div class="kga-suggestion-tooltip-content">`;
    content += `<div class="kga-suggestion-text">"${suggestionText}"</div>`;
    content += `<div class="kga-suggestion-hint">클릭하여 이 제안 적용</div>`;
    content += `</div>`;
    
    return content;
  }

  /**
   * AI 정보 콘텐츠 생성
   */
  private async createAIInfoContent(context: EventContext): Promise<string> {
    const { target } = context;
    
    // AI 분석 관련 데이터 추출 (data 속성에서)
    const confidence = target.dataset.confidence || '';
    const reasoning = target.dataset.reasoning || '';
    
    let content = `<div class="kga-ai-info-content">`;
    content += `<div class="kga-ai-title">🤖 AI 분석 정보</div>`;
    
    if (confidence) {
      content += `<div class="kga-ai-confidence">신뢰도: ${confidence}%</div>`;
    }
    
    if (reasoning) {
      content += `<div class="kga-ai-reasoning">${reasoning}</div>`;
    }
    
    content += `</div>`;
    
    return content;
  }

  /**
   * 도움말 툴팁 콘텐츠 생성
   */
  private async createHelpTooltipContent(context: EventContext): Promise<string> {
    const { target } = context;
    
    const helpText = target.dataset.help || target.title || '';
    if (!helpText) return '';
    
    let content = `<div class="kga-help-tooltip-content">`;
    content += `<div class="kga-help-text">${helpText}</div>`;
    content += `</div>`;
    
    return content;
  }

  /**
   * 버튼 힌트 콘텐츠 생성
   */
  private async createButtonHintContent(context: EventContext): Promise<string> {
    const { target } = context;
    
    const buttonText = target.textContent || '';
    const shortcut = target.dataset.shortcut || '';
    
    let content = `<div class="kga-button-hint-content">`;
    
    if (buttonText) {
      content += `<div class="kga-button-name">${buttonText}</div>`;
    }
    
    if (shortcut) {
      content += `<div class="kga-button-shortcut">단축키: ${shortcut}</div>`;
    }
    
    content += `</div>`;
    
    return content;
  }

  /**
   * 네비게이션 힌트 콘텐츠 생성
   */
  private async createNavigationHintContent(context: EventContext): Promise<string> {
    const { target } = context;
    
    let hintText = '';
    
    if (target.classList.contains('next-btn')) {
      hintText = '다음 페이지로 이동';
    } else if (target.classList.contains('prev-btn')) {
      hintText = '이전 페이지로 이동';
    } else if (target.dataset.page) {
      hintText = `${target.dataset.page}페이지로 이동`;
    } else {
      hintText = target.title || target.dataset.hint || '';
    }
    
    if (!hintText) return '';
    
    let content = `<div class="kga-navigation-hint-content">`;
    content += `<div class="kga-navigation-text">${hintText}</div>`;
    content += `</div>`;
    
    return content;
  }

  // =============================================================================
  // 툴팁 DOM 관리
  // =============================================================================

  /**
   * 툴팁 요소 생성
   */
  private createTooltipElement(config: TooltipConfig): HTMLElement {
    const tooltip = createDiv();
    tooltip.className = `kga-popup-tooltip ${config.className || ''} kga-dynamic-position kga-tooltip-enter`;

    // Set position using CSS variables
    setCssVariable(tooltip, '--kga-pos-left', `${config.position.x}px`);
    setCssVariable(tooltip, '--kga-pos-top', `${config.position.y}px`);

    tooltip.textContent = config.content;

    // 애니메이션으로 나타나기
    activeWindow.setTimeout(() => {
      tooltip.classList.remove('kga-tooltip-enter');
      tooltip.classList.add('kga-tooltip-visible');
    }, 10);

    return tooltip;
  }

  /**
   * 툴팁 위치 조정 (화면 경계 확인)
   */
  private adjustTooltipPosition(tooltip: HTMLElement, position: { x: number; y: number }): void {
    const rect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let { x, y } = position;

    // 오른쪽 경계 확인
    if (x + rect.width > viewportWidth - 10) {
      x = viewportWidth - rect.width - 10;
    }

    // 하단 경계 확인
    if (y + rect.height > viewportHeight - 10) {
      y = position.y - rect.height - 10; // 마우스 위로 이동
    }

    // 왼쪽/상단 경계 확인
    x = Math.max(10, x);
    y = Math.max(10, y);

    // Update position using CSS variables
    setCssVariable(tooltip, '--kga-pos-left', `${x}px`);
    setCssVariable(tooltip, '--kga-pos-top', `${y}px`);
  }

  /**
   * 툴팁 위치 업데이트 (마우스 이동 시)
   */
  private updateTooltipPosition(mouseEvent: MouseEvent): void {
    if (!this.activeTooltip) return;
    
    const newPosition = {
      x: mouseEvent.clientX + 10,
      y: mouseEvent.clientY + 10
    };
    
    this.adjustTooltipPosition(this.activeTooltip, newPosition);
  }

  /**
   * 툴팁 숨김
   */
  private hideTooltip(): void {
    if (this.activeTooltip) {
      // 페이드아웃 애니메이션
      this.activeTooltip.classList.remove('kga-tooltip-visible');
      this.activeTooltip.classList.add('kga-tooltip-exit');

      // DOM에서 제거
      activeWindow.setTimeout(() => {
        if (this.activeTooltip && this.tooltipContainer) {
          this.tooltipContainer.removeChild(this.activeTooltip);
          this.activeTooltip = undefined;
        }
      }, 200);
    }
  }

  // =============================================================================
  // 상태 관리 및 정리
  // =============================================================================

  /**
   * 현재 호버 정리
   */
  private clearCurrentHover(): void {
    if (this.hoverTimer) {
      activeWindow.clearTimeout(this.hoverTimer);
      this.hoverTimer = undefined;
    }
    
    this.currentHoverTarget = undefined;
  }

  /**
   * 호버 영역 등록
   */
  public registerHoverArea(element: HTMLElement, actionType: HoverActionType): void {
    this.hoverAreas.set(element, actionType);
    Logger.debug('HoverHandler: 호버 영역 등록됨', { 
      actionType,
      elementTag: element.tagName 
    });
  }

  /**
   * 호버 영역 제거
   */
  public unregisterHoverArea(element: HTMLElement): void {
    this.hoverAreas.delete(element);
    Logger.debug('HoverHandler: 호버 영역 제거됨');
  }

  // =============================================================================
  // 콜백 시스템
  // =============================================================================

  /**
   * 액션 타입별 콜백 등록
   */
  public onAction(actionType: HoverActionType, callback: HoverHandlerCallback): void {
    const callbacks = this.callbacks.get(actionType);
    if (callbacks) {
      callbacks.push(callback);
      Logger.debug('HoverHandler: 콜백 등록됨', { 
        actionType, 
        totalCallbacks: callbacks.length 
      });
    }
  }

  /**
   * 액션 타입별 콜백 제거
   */
  public removeAction(actionType: HoverActionType, callback: HoverHandlerCallback): void {
    const callbacks = this.callbacks.get(actionType);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
        Logger.debug('HoverHandler: 콜백 제거됨', { 
          actionType, 
          remainingCallbacks: callbacks.length 
        });
      }
    }
  }

  /**
   * 등록된 콜백들 실행
   */
  private async executeCallbacks(result: HoverResult, context: EventContext): Promise<void> {
    const callbacks = this.callbacks.get(result.action);
    if (!callbacks || callbacks.length === 0) return;
    
    Logger.debug('HoverHandler: 콜백 실행 시작', { 
      action: result.action, 
      state: result.state,
      callbackCount: callbacks.length 
    });
    
    for (const callback of callbacks) {
      try {
        await callback(result, context);
      } catch (error) {
        Logger.error('HoverHandler: 콜백 실행 중 오류', { 
          action: result.action, 
          error 
        });
      }
    }
  }

  // =============================================================================
  // 유틸리티 및 디버그
  // =============================================================================

  /**
   * 호버 가능한 요소 확인
   */
  public isHoverableElement(element: HTMLElement): boolean {
    if (Platform.isMobile) return false;
    
    const hoverableClasses = [
      'error-text', 'error-highlight', 'suggestion-item',
      'ai-analysis', 'ai-confidence', 'help-icon', 'info-icon',
      'nav-button', 'pagination-btn', 'btn'
    ];
    
    return hoverableClasses.some(cls => element.classList.contains(cls)) ||
           !!element.closest(hoverableClasses.map(cls => `.${cls}`).join(', ')) ||
           this.hoverAreas.has(element);
  }

  /**
   * 디버그 정보
   */
  public getDebugInfo(): Record<string, unknown> {
    const callbackCounts: Record<string, number> = {};
    
    this.callbacks.forEach((callbacks, actionType) => {
      callbackCounts[actionType] = callbacks.length;
    });
    
    return {
      isEnabled: !Platform.isMobile,
      registeredCallbacks: callbackCounts,
      hasActiveTooltip: !!this.activeTooltip,
      currentHoverTarget: this.currentHoverTarget?.tagName || null,
      hoverAreasCount: this.hoverAreas.size,
      hoverDelay: this.HOVER_DELAY
    };
  }

  /**
   * 리소스 정리
   */
  public dispose(): void {
    // 타이머 정리
    this.clearCurrentHover();
    
    // 툴팁 정리
    this.hideTooltip();
    
    // 툴팁 컨테이너 제거
    if (this.tooltipContainer) {
      activeDocument.body.removeChild(this.tooltipContainer);
      this.tooltipContainer = undefined;
    }
    
    // 상태 초기화
    this.callbacks.clear();
    this.hoverAreas.clear();
    this.currentHoverTarget = undefined;
    
    Logger.debug('HoverHandler: 리소스 정리 완료');
  }
}
