/**
 * Phase 6: Click Handler
 * 
 * 클릭 이벤트를 전문적으로 처리하는 핸들러입니다.
 * 오류 텍스트, 제안 항목, 버튼 등의 클릭을 처리합니다.
 */

import { EventContext } from './PopupEventManager';
import { Platform } from 'obsidian';
import { Logger } from '../../utils/logger';

/**
 * 클릭 액션 타입
 */
export type ClickActionType = 
  | 'error-toggle'        // 오류 상태 토글
  | 'suggestion-select'   // 제안 선택
  | 'navigation'          // 네비게이션 (페이지 이동)
  | 'button-action'       // 버튼 액션
  | 'toggle-ui'           // UI 토글 (요약 영역 등)
  | 'edit-mode'           // 편집 모드 진입
  | 'unknown';            // 알 수 없는 액션

/**
 * 클릭 결과 정보
 */
export interface ClickResult {
  success: boolean;
  action: ClickActionType;
  data?: any;
  shouldUpdate?: boolean;
  preventDefault?: boolean;
}

/**
 * 클릭 핸들러 콜백 타입
 */
export type ClickHandlerCallback = (result: ClickResult, context: EventContext) => Promise<void> | void;

/**
 * ClickHandler
 * 클릭 이벤트 전문 처리 클래스
 */
export class ClickHandler {
  private callbacks: Map<ClickActionType, ClickHandlerCallback[]> = new Map();
  
  // 더블클릭 감지
  private lastClickTime: number = 0;
  private lastClickTarget?: HTMLElement;
  private readonly DOUBLE_CLICK_THRESHOLD = 300; // 300ms
  
  constructor() {
    Logger.log('ClickHandler 생성됨');
    this.initializeDefaultActions();
  }

  /**
   * 기본 액션 타입들 초기화
   */
  private initializeDefaultActions(): void {
    const actionTypes: ClickActionType[] = [
      'error-toggle', 'suggestion-select', 'navigation', 
      'button-action', 'toggle-ui', 'edit-mode', 'unknown'
    ];
    
    actionTypes.forEach(actionType => {
      this.callbacks.set(actionType, []);
    });
  }

  /**
   * 클릭 이벤트 처리 (메인 엔트리 포인트)
   */
  public async handleClick(event: Event, context: EventContext): Promise<boolean> {
    Logger.debug('ClickHandler: 클릭 이벤트 처리 시작', {
      targetClass: context.target.className,
      platform: Platform.isMobile ? 'mobile' : 'desktop'
    });

    try {
      // 클릭 액션 타입 결정
      const actionType = this.determineClickAction(context);
      
      // 더블클릭 감지
      const isDoubleClick = this.isDoubleClick(context.target);
      
      // 클릭 결과 생성
      const result = await this.processClick(actionType, context, isDoubleClick);
      
      // 콜백 실행
      await this.executeCallbacks(result, context);
      
      // 기본 동작 방지 여부 결정
      if (result.preventDefault) {
        event.preventDefault();
        event.stopPropagation();
      }
      
      Logger.debug('ClickHandler: 클릭 처리 완료', {
        action: result.action,
        success: result.success,
        shouldUpdate: result.shouldUpdate
      });
      
      return result.success;
      
    } catch (error) {
      Logger.error('ClickHandler: 클릭 처리 중 오류', error);
      return false;
    }
  }

  /**
   * 클릭 액션 타입 결정
   */
  private determineClickAction(context: EventContext): ClickActionType {
    const { target } = context;
    
    // 오류 텍스트 클릭
    if (target.classList.contains('error-text') || 
        target.classList.contains('error-highlight') ||
        target.closest('.error-text, .error-highlight')) {
      return 'error-toggle';
    }
    
    // 제안 항목 클릭
    if (target.classList.contains('suggestion-item') ||
        target.closest('.suggestion-item')) {
      return 'suggestion-select';
    }
    
    // 편집 버튼 클릭
    if (target.classList.contains('edit-btn') ||
        target.classList.contains('error-edit-btn') ||
        target.closest('.edit-btn, .error-edit-btn')) {
      return 'edit-mode';
    }
    
    // 네비게이션 버튼 클릭
    if (target.classList.contains('nav-button') ||
        target.classList.contains('kga-pagination-btn') ||
        target.closest('.nav-button, .kga-pagination-btn')) {
      return 'navigation';
    }
    
    // UI 토글 버튼
    if (target.classList.contains('toggle-btn') ||
        target.classList.contains('summary-toggle') ||
        target.closest('.toggle-btn, .summary-toggle')) {
      return 'toggle-ui';
    }
    
    // 일반 버튼
    if (target.tagName === 'BUTTON' ||
        target.classList.contains('btn') ||
        target.closest('button, .btn')) {
      return 'button-action';
    }
    
    return 'unknown';
  }

  /**
   * 더블클릭 감지
   */
  private isDoubleClick(target: HTMLElement): boolean {
    const now = Date.now();
    const isDouble = (
      this.lastClickTarget === target &&
      (now - this.lastClickTime) <= this.DOUBLE_CLICK_THRESHOLD
    );
    
    this.lastClickTime = now;
    this.lastClickTarget = target;
    
    return isDouble;
  }

  /**
   * 클릭 처리 실행
   */
  private async processClick(
    actionType: ClickActionType, 
    context: EventContext, 
    isDoubleClick: boolean
  ): Promise<ClickResult> {
    
    switch (actionType) {
      case 'error-toggle':
        return await this.handleErrorToggle(context, isDoubleClick);
        
      case 'suggestion-select':
        return await this.handleSuggestionSelect(context);
        
      case 'navigation':
        return await this.handleNavigation(context);
        
      case 'button-action':
        return await this.handleButtonAction(context);
        
      case 'toggle-ui':
        return await this.handleUIToggle(context);
        
      case 'edit-mode':
        return await this.handleEditMode(context);
        
      default:
        return this.createResult(false, actionType, null, false, false);
    }
  }

  // =============================================================================
  // 개별 클릭 액션 핸들러들
  // =============================================================================

  /**
   * 오류 토글 처리
   */
  private async handleErrorToggle(context: EventContext, isDoubleClick: boolean): Promise<ClickResult> {
    Logger.debug('ClickHandler: 오류 토글 처리', {
      correctionIndex: context.correctionIndex,
      isDoubleClick
    });
    
    if (context.correctionIndex === undefined) {
      Logger.warn('ClickHandler: 교정 인덱스가 없음');
      return this.createResult(false, 'error-toggle', null, false, true);
    }
    
    // 더블클릭인 경우 편집 모드로 전환
    if (isDoubleClick) {
      Logger.debug('ClickHandler: 더블클릭으로 편집 모드 전환');
      return this.createResult(true, 'edit-mode', {
        correctionIndex: context.correctionIndex,
        trigger: 'double-click'
      }, true, true);
    }
    
    // 단일클릭인 경우 상태 토글
    return this.createResult(true, 'error-toggle', {
      correctionIndex: context.correctionIndex,
      action: 'toggle-state'
    }, true, true);
  }

  /**
   * 제안 선택 처리
   */
  private async handleSuggestionSelect(context: EventContext): Promise<ClickResult> {
    Logger.debug('ClickHandler: 제안 선택 처리', {
      correctionIndex: context.correctionIndex,
      suggestionIndex: context.suggestionIndex
    });
    
    if (context.correctionIndex === undefined || context.suggestionIndex === undefined) {
      Logger.warn('ClickHandler: 교정 또는 제안 인덱스가 없음');
      return this.createResult(false, 'suggestion-select', null, false, true);
    }
    
    return this.createResult(true, 'suggestion-select', {
      correctionIndex: context.correctionIndex,
      suggestionIndex: context.suggestionIndex,
      action: 'select-suggestion'
    }, true, true);
  }

  /**
   * 네비게이션 처리
   */
  private async handleNavigation(context: EventContext): Promise<ClickResult> {
    const { target } = context;
    
    // 네비게이션 타입 결정
    let navAction = 'unknown';
    if (target.classList.contains('next-btn') || target.dataset.action === 'next') {
      navAction = 'next';
    } else if (target.classList.contains('prev-btn') || target.dataset.action === 'prev') {
      navAction = 'prev';
    } else if (target.dataset.page) {
      navAction = 'goto-page';
    }
    
    Logger.debug('ClickHandler: 네비게이션 처리', { navAction });
    
    return this.createResult(true, 'navigation', {
      action: navAction,
      page: target.dataset.page ? parseInt(target.dataset.page, 10) : undefined
    }, true, true);
  }

  /**
   * 버튼 액션 처리
   */
  private async handleButtonAction(context: EventContext): Promise<ClickResult> {
    const { target } = context;
    const buttonAction = target.dataset.action || target.className || 'unknown';
    
    Logger.debug('ClickHandler: 버튼 액션 처리', { buttonAction });
    
    return this.createResult(true, 'button-action', {
      action: buttonAction,
      value: target.dataset.value
    }, true, true);
  }

  /**
   * UI 토글 처리
   */
  private async handleUIToggle(context: EventContext): Promise<ClickResult> {
    const { target } = context;
    const toggleTarget = target.dataset.toggle || 'unknown';
    
    Logger.debug('ClickHandler: UI 토글 처리', { toggleTarget });
    
    return this.createResult(true, 'toggle-ui', {
      target: toggleTarget
    }, true, true);
  }

  /**
   * 편집 모드 처리
   */
  private async handleEditMode(context: EventContext): Promise<ClickResult> {
    Logger.debug('ClickHandler: 편집 모드 처리', {
      correctionIndex: context.correctionIndex
    });
    
    return this.createResult(true, 'edit-mode', {
      correctionIndex: context.correctionIndex,
      trigger: 'edit-button'
    }, true, true);
  }

  // =============================================================================
  // 콜백 시스템
  // =============================================================================

  /**
   * 액션 타입별 콜백 등록
   */
  public onAction(actionType: ClickActionType, callback: ClickHandlerCallback): void {
    const callbacks = this.callbacks.get(actionType);
    if (callbacks) {
      callbacks.push(callback);
      Logger.debug('ClickHandler: 콜백 등록됨', { 
        actionType, 
        totalCallbacks: callbacks.length 
      });
    }
  }

  /**
   * 액션 타입별 콜백 제거
   */
  public removeAction(actionType: ClickActionType, callback: ClickHandlerCallback): void {
    const callbacks = this.callbacks.get(actionType);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
        Logger.debug('ClickHandler: 콜백 제거됨', { 
          actionType, 
          remainingCallbacks: callbacks.length 
        });
      }
    }
  }

  /**
   * 등록된 콜백들 실행
   */
  private async executeCallbacks(result: ClickResult, context: EventContext): Promise<void> {
    const callbacks = this.callbacks.get(result.action);
    if (!callbacks || callbacks.length === 0) return;
    
    Logger.debug('ClickHandler: 콜백 실행 시작', { 
      action: result.action, 
      callbackCount: callbacks.length 
    });
    
    for (const callback of callbacks) {
      try {
        await callback(result, context);
      } catch (error) {
        Logger.error('ClickHandler: 콜백 실행 중 오류', { 
          action: result.action, 
          error 
        });
      }
    }
  }

  // =============================================================================
  // 헬퍼 메서드들
  // =============================================================================

  /**
   * 클릭 결과 생성 헬퍼
   */
  private createResult(
    success: boolean,
    action: ClickActionType,
    data: any,
    shouldUpdate: boolean,
    preventDefault: boolean
  ): ClickResult {
    return {
      success,
      action,
      data,
      shouldUpdate,
      preventDefault
    };
  }

  /**
   * 클릭 가능한 요소 확인
   */
  public isClickableElement(element: HTMLElement): boolean {
    // 클릭 가능한 클래스들
    const clickableClasses = [
      'error-text', 'error-highlight', 'suggestion-item',
      'nav-button', 'kga-pagination-btn', 'btn', 'toggle-btn',
      'edit-btn', 'error-edit-btn'
    ];
    
    // 클릭 가능한 태그들
    const clickableTags = ['BUTTON', 'A'];
    
    return clickableClasses.some(cls => element.classList.contains(cls)) ||
           clickableTags.includes(element.tagName) ||
           !!element.closest(clickableClasses.map(cls => `.${cls}`).join(', ')) ||
           !!element.dataset.clickable;
  }

  /**
   * 모바일 최적화 클릭 영역 확인
   */
  public isMobileOptimizedClick(element: HTMLElement): boolean {
    if (!Platform.isMobile) return true;
    
    // 모바일에서 충분한 터치 영역을 가진 요소인지 확인
    const rect = element.getBoundingClientRect();
    const minTouchSize = 44; // 44px - Apple HIG 권장사항
    
    return rect.width >= minTouchSize && rect.height >= minTouchSize;
  }

  /**
   * 컨텍스트 메뉴 방지 여부 확인 (모바일)
   */
  public shouldPreventContextMenu(element: HTMLElement): boolean {
    return Platform.isMobile && (
      element.classList.contains('error-text') ||
      element.classList.contains('suggestion-item') ||
      !!element.closest('.error-text, .suggestion-item')
    );
  }

  /**
   * 디버그 정보
   */
  public getDebugInfo(): any {
    const callbackCounts: Record<string, number> = {};
    
    this.callbacks.forEach((callbacks, actionType) => {
      callbackCounts[actionType] = callbacks.length;
    });
    
    return {
      registeredCallbacks: callbackCounts,
      lastClickTime: this.lastClickTime,
      lastClickTarget: this.lastClickTarget?.tagName || null,
      doubleClickThreshold: this.DOUBLE_CLICK_THRESHOLD,
      platform: Platform.isMobile ? 'mobile' : 'desktop'
    };
  }

  /**
   * 리소스 정리
   */
  public dispose(): void {
    this.callbacks.clear();
    this.lastClickTarget = undefined;
    this.lastClickTime = 0;
    
    Logger.debug('ClickHandler: 리소스 정리 완료');
  }
}