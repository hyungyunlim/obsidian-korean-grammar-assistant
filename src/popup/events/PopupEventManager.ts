/**
 * Phase 6: Popup Event Manager
 * 
 * 모든 팝업 이벤트를 관리하고 조율하는 중앙 이벤트 제어 클래스입니다.
 * 클릭, 호버, 터치, 키보드 이벤트를 통합 관리합니다.
 */

import { IPopupServiceManager, RenderContext } from '../types/PopupTypes';
import { Platform, App } from 'obsidian';
import { Logger } from '../../utils/logger';

// 이벤트 핸들러 타입 정의
export type EventHandlerCallback = (event: Event, context: EventContext) => Promise<boolean> | boolean;
export type EventType = 'click' | 'hover' | 'mouseenter' | 'mouseleave' | 'touchstart' | 'touchend' | 'touchhold' | 'focus' | 'blur';

/**
 * 이벤트 컨텍스트 정보
 */
export interface EventContext {
  target: HTMLElement;
  eventType: EventType;
  correctionIndex?: number;
  suggestionIndex?: number;
  isError?: boolean;
  isSuggestion?: boolean;
  isNavigation?: boolean;
  metadata?: Record<string, any>;
}

/**
 * 등록된 이벤트 리스너 정보
 */
interface RegisteredListener {
  element: HTMLElement;
  eventType: string;
  handler: EventListener;
  callback: EventHandlerCallback;
  options?: AddEventListenerOptions;
}

/**
 * 이벤트 위임 규칙
 */
interface DelegationRule {
  selector: string;
  eventType: EventType;
  callback: EventHandlerCallback;
  condition?: (element: HTMLElement) => boolean;
}

/**
 * PopupEventManager
 * 모든 팝업 이벤트를 중앙에서 관리하는 클래스
 */
export class PopupEventManager implements IPopupServiceManager {
  private app: App;
  private containerElement?: HTMLElement;
  private renderContext?: RenderContext;
  
  // 등록된 리스너들
  private registeredListeners: Set<RegisteredListener> = new Set();
  
  // 이벤트 위임 규칙들
  private delegationRules: DelegationRule[] = [];
  
  // 중앙 위임 리스너
  private delegationListener?: EventListener;
  
  // 터치홀드 타이머
  private touchHoldTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly TOUCH_HOLD_DURATION = 500; // 0.5초
  
  // 이벤트 상태
  private isEventSystemActive: boolean = false;
  private lastTouchTarget?: HTMLElement;
  
  constructor(app: App) {
    this.app = app;
    Logger.log('PopupEventManager 생성됨');
  }

  /**
   * IPopupServiceManager 인터페이스 구현
   */
  async initialize(context: RenderContext): Promise<void> {
    Logger.log('PopupEventManager 초기화 시작');
    
    this.renderContext = context;
    this.containerElement = context.container;
    
    // 이벤트 위임 설정
    this.setupEventDelegation();
    
    // 기본 이벤트 규칙들 등록
    this.registerDefaultEventRules();
    
    this.isEventSystemActive = true;
    
    Logger.log('PopupEventManager 초기화 완료', {
      hasContainer: !!this.containerElement,
      delegationRulesCount: this.delegationRules.length
    });
  }

  /**
   * IPopupServiceManager 인터페이스 구현
   */
  destroy(): void {
    Logger.log('PopupEventManager 정리 시작');
    
    this.isEventSystemActive = false;
    
    // 모든 등록된 리스너 제거
    this.removeAllListeners();
    
    // 위임 리스너 제거
    this.removeDelegationListener();
    
    // 터치홀드 타이머 정리
    this.clearAllTouchHoldTimers();
    
    // 상태 초기화
    this.delegationRules = [];
    this.lastTouchTarget = undefined;
    this.containerElement = undefined;
    this.renderContext = undefined;
    
    Logger.log('PopupEventManager 정리 완료');
  }

  // =============================================================================
  // 이벤트 위임 시스템
  // =============================================================================

  /**
   * 이벤트 위임 설정
   */
  private setupEventDelegation(): void {
    if (!this.containerElement) {
      Logger.warn('PopupEventManager: 컨테이너 요소가 없어 이벤트 위임을 설정할 수 없습니다');
      return;
    }

    // 중앙 위임 리스너 생성
    this.delegationListener = (event: Event) => {
      this.handleDelegatedEvent(event);
    };

    // 모든 관련 이벤트 타입에 대해 위임 리스너 등록
    const eventTypes = ['click', 'mouseenter', 'mouseleave', 'touchstart', 'touchend', 'focus', 'blur'];
    
    eventTypes.forEach(eventType => {
      this.containerElement!.addEventListener(eventType, this.delegationListener!, {
        capture: true,
        passive: false
      });
    });

    Logger.debug('PopupEventManager: 이벤트 위임 설정 완료', { eventTypes });
  }

  /**
   * 위임된 이벤트 처리
   */
  private handleDelegatedEvent(event: Event): void {
    if (!this.isEventSystemActive) return;

    const target = event.target as HTMLElement;
    if (!target) return;

    // 각 위임 규칙 확인
    for (const rule of this.delegationRules) {
      if (this.matchesDelegationRule(target, rule, event)) {
        const context = this.createEventContext(target, rule.eventType, event);
        
        try {
          const result = rule.callback(event, context);
          
          // Promise인 경우 에러 처리
          if (result instanceof Promise) {
            result.catch(error => {
              Logger.error('PopupEventManager: 비동기 이벤트 핸들러 오류', { 
                eventType: rule.eventType,
                selector: rule.selector,
                error 
              });
            });
          }
          
        } catch (error) {
          Logger.error('PopupEventManager: 이벤트 핸들러 오류', { 
            eventType: rule.eventType,
            selector: rule.selector,
            error 
          });
        }
      }
    }

    // 특별한 터치홀드 처리
    if (event.type === 'touchstart') {
      this.handleTouchStart(event as TouchEvent, target);
    } else if (event.type === 'touchend') {
      this.handleTouchEnd(event as TouchEvent, target);
    }
  }

  /**
   * 위임 규칙 매칭 확인
   */
  private matchesDelegationRule(target: HTMLElement, rule: DelegationRule, event: Event): boolean {
    // 이벤트 타입 확인
    if (event.type !== rule.eventType) return false;

    // 셀렉터 매칭 확인
    if (!target.matches(rule.selector) && !target.closest(rule.selector)) return false;

    // 추가 조건 확인
    if (rule.condition && !rule.condition(target)) return false;

    return true;
  }

  /**
   * 이벤트 컨텍스트 생성
   */
  private createEventContext(target: HTMLElement, eventType: EventType, event: Event): EventContext {
    const context: EventContext = {
      target,
      eventType,
      metadata: {}
    };

    // 교정 인덱스 추출
    const correctionIndexAttr = target.getAttribute('data-correction-index') || 
                               target.closest('[data-correction-index]')?.getAttribute('data-correction-index');
    if (correctionIndexAttr) {
      context.correctionIndex = parseInt(correctionIndexAttr, 10);
    }

    // 제안 인덱스 추출
    const suggestionIndexAttr = target.getAttribute('data-suggestion-index') ||
                               target.closest('[data-suggestion-index]')?.getAttribute('data-suggestion-index');
    if (suggestionIndexAttr) {
      context.suggestionIndex = parseInt(suggestionIndexAttr, 10);
    }

    // 요소 타입 판단
    context.isError = target.classList.contains('error-text') || !!target.closest('.error-text');
    context.isSuggestion = target.classList.contains('suggestion-item') || !!target.closest('.suggestion-item');
    context.isNavigation = target.classList.contains('nav-button') || !!target.closest('.nav-button');

    // 이벤트 메타데이터
    context.metadata = {
      platform: Platform.isMobile ? 'mobile' : 'desktop',
      timestamp: Date.now(),
      eventPhase: event.eventPhase,
      bubbles: event.bubbles
    };

    return context;
  }

  // =============================================================================
  // 이벤트 규칙 등록 시스템
  // =============================================================================

  /**
   * 기본 이벤트 규칙들 등록
   */
  private registerDefaultEventRules(): void {
    // 오류 텍스트 클릭
    this.addEventRule('.error-text, .error-highlight', 'click', async (event, context) => {
      Logger.debug('오류 텍스트 클릭됨', { correctionIndex: context.correctionIndex });
      return await this.handleErrorClick(event, context);
    });

    // 제안 항목 클릭
    this.addEventRule('.suggestion-item', 'click', async (event, context) => {
      Logger.debug('제안 항목 클릭됨', { 
        correctionIndex: context.correctionIndex,
        suggestionIndex: context.suggestionIndex 
      });
      return await this.handleSuggestionClick(event, context);
    });

    // 데스크톱 호버 (모바일이 아닌 경우만)
    if (!Platform.isMobile) {
      this.addEventRule('.error-text, .error-highlight', 'mouseenter', async (event, context) => {
        Logger.debug('오류 텍스트 호버 시작', { correctionIndex: context.correctionIndex });
        return await this.handleErrorHover(event, context);
      });

      this.addEventRule('.error-text, .error-highlight', 'mouseleave', async (event, context) => {
        Logger.debug('오류 텍스트 호버 종료', { correctionIndex: context.correctionIndex });
        return await this.handleErrorHoverEnd(event, context);
      });
    }

    // 네비게이션 버튼 클릭
    this.addEventRule('.nav-button, .pagination-btn', 'click', async (event, context) => {
      Logger.debug('네비게이션 버튼 클릭됨');
      return await this.handleNavigationClick(event, context);
    });

    Logger.debug('PopupEventManager: 기본 이벤트 규칙 등록 완료', {
      rulesCount: this.delegationRules.length,
      isMobile: Platform.isMobile
    });
  }

  /**
   * 새로운 이벤트 규칙 추가
   */
  public addEventRule(
    selector: string, 
    eventType: EventType, 
    callback: EventHandlerCallback,
    condition?: (element: HTMLElement) => boolean
  ): void {
    const rule: DelegationRule = {
      selector,
      eventType,
      callback,
      condition
    };

    this.delegationRules.push(rule);
    
    Logger.debug('PopupEventManager: 이벤트 규칙 추가됨', { 
      selector, 
      eventType,
      totalRules: this.delegationRules.length 
    });
  }

  /**
   * 이벤트 규칙 제거
   */
  public removeEventRule(selector: string, eventType: EventType): void {
    const initialLength = this.delegationRules.length;
    this.delegationRules = this.delegationRules.filter(rule => 
      !(rule.selector === selector && rule.eventType === eventType)
    );
    
    const removedCount = initialLength - this.delegationRules.length;
    Logger.debug('PopupEventManager: 이벤트 규칙 제거됨', { 
      selector, 
      eventType, 
      removedCount,
      remainingRules: this.delegationRules.length 
    });
  }

  // =============================================================================
  // 터치홀드 시스템 (모바일)
  // =============================================================================

  /**
   * 터치 시작 처리
   */
  private handleTouchStart(event: TouchEvent, target: HTMLElement): void {
    if (!Platform.isMobile) return;

    this.lastTouchTarget = target;
    
    // 오류 텍스트에 대한 터치홀드만 처리
    if (target.classList.contains('error-text') || target.closest('.error-text')) {
      const touchId = this.getTouchId(target);
      
      // 이전 타이머 제거
      this.clearTouchHoldTimer(touchId);
      
      // 새 타이머 설정
      const timer = setTimeout(() => {
        this.handleTouchHold(target);
      }, this.TOUCH_HOLD_DURATION);
      
      this.touchHoldTimers.set(touchId, timer);
      
      Logger.debug('PopupEventManager: 터치홀드 타이머 시작', { touchId });
    }
  }

  /**
   * 터치 종료 처리
   */
  private handleTouchEnd(event: TouchEvent, target: HTMLElement): void {
    if (!Platform.isMobile) return;

    const touchId = this.getTouchId(target);
    this.clearTouchHoldTimer(touchId);
    
    this.lastTouchTarget = undefined;
  }

  /**
   * 터치홀드 처리
   */
  private handleTouchHold(target: HTMLElement): void {
    Logger.log('PopupEventManager: 터치홀드 감지됨', {
      targetClass: target.className,
      targetId: target.id
    });

    // 터치홀드 이벤트 생성 및 발송
    const syntheticEvent = new CustomEvent('touchhold', {
      detail: { target },
      bubbles: true,
      cancelable: true
    });

    target.dispatchEvent(syntheticEvent);
  }

  /**
   * 터치 고유 ID 생성
   */
  private getTouchId(target: HTMLElement): string {
    return target.getAttribute('data-correction-index') || 
           target.getAttribute('id') || 
           target.tagName + '_' + Date.now();
  }

  /**
   * 터치홀드 타이머 제거
   */
  private clearTouchHoldTimer(touchId: string): void {
    const timer = this.touchHoldTimers.get(touchId);
    if (timer) {
      clearTimeout(timer);
      this.touchHoldTimers.delete(touchId);
    }
  }

  /**
   * 모든 터치홀드 타이머 제거
   */
  private clearAllTouchHoldTimers(): void {
    this.touchHoldTimers.forEach(timer => clearTimeout(timer));
    this.touchHoldTimers.clear();
  }

  // =============================================================================
  // 기본 이벤트 핸들러들
  // =============================================================================

  /**
   * 오류 클릭 처리 (기본 구현)
   */
  private async handleErrorClick(event: Event, context: EventContext): Promise<boolean> {
    Logger.debug('PopupEventManager: 기본 오류 클릭 처리', context);
    
    // 기본 동작 방지
    event.preventDefault();
    
    // 추후 Phase 7에서 UI 업데이트 로직과 연결 예정
    // 현재는 로그만 출력
    
    return true;
  }

  /**
   * 제안 클릭 처리 (기본 구현)
   */
  private async handleSuggestionClick(event: Event, context: EventContext): Promise<boolean> {
    Logger.debug('PopupEventManager: 기본 제안 클릭 처리', context);
    
    event.preventDefault();
    
    // 추후 Phase 7에서 상태 업데이트 로직과 연결 예정
    
    return true;
  }

  /**
   * 오류 호버 처리 (데스크톱)
   */
  private async handleErrorHover(event: Event, context: EventContext): Promise<boolean> {
    if (Platform.isMobile) return false;
    
    Logger.debug('PopupEventManager: 오류 호버 시작', context);
    
    // 추후 Phase 7에서 툴팁 표시 로직과 연결 예정
    
    return true;
  }

  /**
   * 오류 호버 종료 처리 (데스크톱)
   */
  private async handleErrorHoverEnd(event: Event, context: EventContext): Promise<boolean> {
    if (Platform.isMobile) return false;
    
    Logger.debug('PopupEventManager: 오류 호버 종료', context);
    
    // 추후 Phase 7에서 툴팁 숨김 로직과 연결 예정
    
    return true;
  }

  /**
   * 네비게이션 클릭 처리
   */
  private async handleNavigationClick(event: Event, context: EventContext): Promise<boolean> {
    Logger.debug('PopupEventManager: 네비게이션 클릭 처리', context);
    
    event.preventDefault();
    
    // 추후 Phase 7에서 페이지네이션 로직과 연결 예정
    
    return true;
  }

  // =============================================================================
  // 직접 리스너 관리 (고급 사용)
  // =============================================================================

  /**
   * 직접 이벤트 리스너 등록
   */
  public addDirectListener(
    element: HTMLElement,
    eventType: string,
    callback: EventHandlerCallback,
    options?: AddEventListenerOptions
  ): void {
    const handler = (event: Event) => {
      if (!this.isEventSystemActive) return;
      
      const context = this.createEventContext(element, eventType as EventType, event);
      
      try {
        const result = callback(event, context);
        
        if (result instanceof Promise) {
          result.catch(error => {
            Logger.error('PopupEventManager: 직접 리스너 비동기 오류', { eventType, error });
          });
        }
        
      } catch (error) {
        Logger.error('PopupEventManager: 직접 리스너 오류', { eventType, error });
      }
    };

    element.addEventListener(eventType, handler, options);
    
    const listener: RegisteredListener = {
      element,
      eventType,
      handler,
      callback,
      options
    };
    
    this.registeredListeners.add(listener);
    
    Logger.debug('PopupEventManager: 직접 리스너 등록됨', { 
      eventType,
      elementTag: element.tagName,
      totalListeners: this.registeredListeners.size 
    });
  }

  /**
   * 직접 이벤트 리스너 제거
   */
  public removeDirectListener(element: HTMLElement, eventType: string, callback: EventHandlerCallback): void {
    const toRemove = Array.from(this.registeredListeners).find(listener =>
      listener.element === element && 
      listener.eventType === eventType && 
      listener.callback === callback
    );

    if (toRemove) {
      element.removeEventListener(eventType, toRemove.handler, toRemove.options);
      this.registeredListeners.delete(toRemove);
      
      Logger.debug('PopupEventManager: 직접 리스너 제거됨', { 
        eventType,
        remainingListeners: this.registeredListeners.size 
      });
    }
  }

  /**
   * 모든 등록된 리스너 제거
   */
  private removeAllListeners(): void {
    this.registeredListeners.forEach(listener => {
      listener.element.removeEventListener(listener.eventType, listener.handler, listener.options);
    });
    
    const removedCount = this.registeredListeners.size;
    this.registeredListeners.clear();
    
    Logger.debug('PopupEventManager: 모든 직접 리스너 제거됨', { removedCount });
  }

  /**
   * 위임 리스너 제거
   */
  private removeDelegationListener(): void {
    if (!this.containerElement || !this.delegationListener) return;

    const eventTypes = ['click', 'mouseenter', 'mouseleave', 'touchstart', 'touchend', 'focus', 'blur'];
    
    eventTypes.forEach(eventType => {
      this.containerElement!.removeEventListener(eventType, this.delegationListener!, true);
    });

    this.delegationListener = undefined;
    
    Logger.debug('PopupEventManager: 위임 리스너 제거됨');
  }

  // =============================================================================
  // 상태 및 디버그 메서드
  // =============================================================================

  /**
   * 이벤트 시스템 활성화/비활성화
   */
  public setEventSystemActive(active: boolean): void {
    this.isEventSystemActive = active;
    Logger.debug('PopupEventManager: 이벤트 시스템 상태 변경', { active });
  }

  /**
   * 이벤트 시스템 상태 확인
   */
  public isActive(): boolean {
    return this.isEventSystemActive;
  }

  /**
   * 디버그 정보 반환
   */
  public getDebugInfo(): any {
    return {
      isActive: this.isEventSystemActive,
      hasContainer: !!this.containerElement,
      delegationRulesCount: this.delegationRules.length,
      directListenersCount: this.registeredListeners.size,
      touchHoldTimersCount: this.touchHoldTimers.size,
      platform: Platform.isMobile ? 'mobile' : 'desktop',
      lastTouchTarget: this.lastTouchTarget?.tagName || null
    };
  }
}