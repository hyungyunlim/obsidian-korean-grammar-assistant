/**
 * Phase 6: Mobile Event Handler
 * 
 * 모바일 터치 이벤트를 전문적으로 처리하는 핸들러입니다.
 * 터치홀드, 스와이프, 터치 제스처 등을 처리합니다.
 */

import { EventContext } from './PopupEventManager';
import { Platform } from 'obsidian';
import { Logger } from '../../utils/logger';

/**
 * 모바일 액션 타입
 */
export type MobileActionType = 
  | 'touch-hold'          // 터치홀드 (0.5초)
  | 'touch-tap'           // 짧은 터치
  | 'swipe-left'          // 왼쪽 스와이프
  | 'swipe-right'         // 오른쪽 스와이프
  | 'swipe-up'            // 위쪽 스와이프
  | 'swipe-down'          // 아래쪽 스와이프
  | 'pinch-zoom'          // 핀치 줌
  | 'double-tap'          // 더블 탭
  | 'long-press'          // 롱 프레스 (1초)
  | 'unknown';            // 알 수 없는 액션

/**
 * 터치 정보
 */
interface TouchInfo {
  id: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startTime: number;
  target: HTMLElement;
}

/**
 * 제스처 결과
 */
export interface GestureResult {
  success: boolean;
  action: MobileActionType;
  data?: any;
  shouldPreventDefault?: boolean;
  shouldStopPropagation?: boolean;
}

/**
 * 모바일 핸들러 콜백 타입
 */
export type MobileHandlerCallback = (result: GestureResult, context: EventContext) => Promise<void> | void;

/**
 * 스와이프 설정
 */
interface SwipeConfig {
  minDistance: number;      // 최소 이동 거리
  maxTime: number;         // 최대 시간
  maxDeviation: number;    // 최대 편차 (직선성 확인)
}

/**
 * MobileEventHandler
 * 모바일 터치 이벤트 전문 처리 클래스
 */
export class MobileEventHandler {
  private callbacks: Map<MobileActionType, MobileHandlerCallback[]> = new Map();
  
  // 터치 상태 관리
  private activeTouches: Map<number, TouchInfo> = new Map();
  private touchHoldTimers: Map<number, NodeJS.Timeout> = new Map();
  private longPressTimers: Map<number, NodeJS.Timeout> = new Map();
  
  // 제스처 설정
  private readonly TOUCH_HOLD_DURATION = 500;    // 0.5초
  private readonly LONG_PRESS_DURATION = 1000;   // 1초
  private readonly DOUBLE_TAP_THRESHOLD = 300;   // 0.3초
  
  private readonly swipeConfig: SwipeConfig = {
    minDistance: 50,      // 50px
    maxTime: 300,         // 0.3초
    maxDeviation: 100     // 100px
  };
  
  // 더블탭 감지
  private lastTapTime: number = 0;
  private lastTapTarget?: HTMLElement;
  
  // 편집 모드 관리
  private editModeElements: Map<HTMLElement, HTMLInputElement> = new Map();
  
  constructor() {
    // 데스크톱에서는 모바일 핸들러를 사용하지 않음
    if (!Platform.isMobile) {
      Logger.log('MobileEventHandler: 데스크톱 플랫폼에서는 비활성화됨');
      return;
    }
    
    Logger.log('MobileEventHandler 생성됨 (모바일)');
    this.initializeDefaultActions();
  }

  /**
   * 기본 액션 타입들 초기화
   */
  private initializeDefaultActions(): void {
    const actionTypes: MobileActionType[] = [
      'touch-hold', 'touch-tap', 'swipe-left', 'swipe-right',
      'swipe-up', 'swipe-down', 'pinch-zoom', 'double-tap',
      'long-press', 'unknown'
    ];
    
    actionTypes.forEach(actionType => {
      this.callbacks.set(actionType, []);
    });
  }

  /**
   * 터치 시작 처리
   */
  public async handleTouchStart(event: TouchEvent, context: EventContext): Promise<boolean> {
    if (!Platform.isMobile) return false;
    
    Logger.debug('MobileEventHandler: 터치 시작', {
      touchCount: event.touches.length,
      targetClass: context.target.className
    });

    try {
      // 각 터치 포인트 처리
      for (let i = 0; i < event.touches.length; i++) {
        const touch = event.touches[i];
        await this.processTouchStart(touch, context);
      }
      
      return true;
      
    } catch (error) {
      Logger.error('MobileEventHandler: 터치 시작 중 오류', error);
      return false;
    }
  }

  /**
   * 터치 이동 처리
   */
  public async handleTouchMove(event: TouchEvent, context: EventContext): Promise<boolean> {
    if (!Platform.isMobile) return false;
    
    try {
      // 각 터치 포인트 업데이트
      for (let i = 0; i < event.touches.length; i++) {
        const touch = event.touches[i];
        this.updateTouchInfo(touch);
      }
      
      // 스크롤 방지 (특정 요소에서)
      if (this.shouldPreventScroll(context.target)) {
        event.preventDefault();
      }
      
      return true;
      
    } catch (error) {
      Logger.error('MobileEventHandler: 터치 이동 중 오류', error);
      return false;
    }
  }

  /**
   * 터치 종료 처리
   */
  public async handleTouchEnd(event: TouchEvent, context: EventContext): Promise<boolean> {
    if (!Platform.isMobile) return false;
    
    Logger.debug('MobileEventHandler: 터치 종료', {
      remainingTouches: event.touches.length
    });

    try {
      // 종료된 터치들 처리
      for (let i = 0; i < event.changedTouches.length; i++) {
        const touch = event.changedTouches[i];
        await this.processTouchEnd(touch, context);
      }
      
      return true;
      
    } catch (error) {
      Logger.error('MobileEventHandler: 터치 종료 중 오류', error);
      return false;
    }
  }

  /**
   * 커스텀 터치홀드 이벤트 처리
   */
  public async handleTouchHold(event: CustomEvent, context: EventContext): Promise<boolean> {
    if (!Platform.isMobile) return false;
    
    Logger.debug('MobileEventHandler: 터치홀드 감지됨', {
      targetClass: context.target.className,
      correctionIndex: context.correctionIndex
    });

    try {
      // 터치홀드 결과 생성
      const result: GestureResult = {
        success: true,
        action: 'touch-hold',
        data: { 
          correctionIndex: context.correctionIndex,
          target: context.target
        },
        shouldPreventDefault: true,
        shouldStopPropagation: true
      };
      
      // 터치홀드 액션 처리
      await this.handleTouchHoldAction(result, context);
      
      // 콜백 실행
      await this.executeCallbacks(result, context);
      
      return true;
      
    } catch (error) {
      Logger.error('MobileEventHandler: 터치홀드 처리 중 오류', error);
      return false;
    }
  }

  // =============================================================================
  // 터치 처리 내부 메서드들
  // =============================================================================

  /**
   * 터치 시작 처리
   */
  private async processTouchStart(touch: Touch, context: EventContext): Promise<void> {
    const touchInfo: TouchInfo = {
      id: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY,
      startTime: Date.now(),
      target: context.target
    };
    
    this.activeTouches.set(touch.identifier, touchInfo);
    
    // 터치홀드 타이머 설정
    this.setTouchHoldTimer(touch.identifier, touchInfo);
    
    // 롱프레스 타이머 설정
    this.setLongPressTimer(touch.identifier, touchInfo);
    
    // 더블탭 감지
    this.checkForDoubleTap(touchInfo, context);
  }

  /**
   * 터치 정보 업데이트
   */
  private updateTouchInfo(touch: Touch): void {
    const touchInfo = this.activeTouches.get(touch.identifier);
    if (touchInfo) {
      touchInfo.currentX = touch.clientX;
      touchInfo.currentY = touch.clientY;
    }
  }

  /**
   * 터치 종료 처리
   */
  private async processTouchEnd(touch: Touch, context: EventContext): Promise<void> {
    const touchInfo = this.activeTouches.get(touch.identifier);
    if (!touchInfo) return;
    
    // 타이머들 정리
    this.clearTouchTimers(touch.identifier);
    
    // 제스처 감지 및 처리
    await this.detectAndProcessGesture(touchInfo, context);
    
    // 터치 정보 제거
    this.activeTouches.delete(touch.identifier);
  }

  /**
   * 제스처 감지 및 처리
   */
  private async detectAndProcessGesture(touchInfo: TouchInfo, context: EventContext): Promise<void> {
    const duration = Date.now() - touchInfo.startTime;
    const deltaX = touchInfo.currentX - touchInfo.startX;
    const deltaY = touchInfo.currentY - touchInfo.startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    let actionType: MobileActionType = 'unknown';
    let gestureData: any = {};
    
    // 스와이프 감지
    if (distance >= this.swipeConfig.minDistance && 
        duration <= this.swipeConfig.maxTime) {
      
      const swipeType = this.detectSwipeDirection(deltaX, deltaY, distance);
      if (swipeType !== 'unknown') {
        actionType = swipeType;
        gestureData = { deltaX, deltaY, distance, duration };
      }
    }
    
    // 짧은 탭 (이미 터치홀드나 롱프레스가 발생하지 않은 경우)
    if (actionType === 'unknown' && 
        distance < this.swipeConfig.minDistance && 
        duration < this.TOUCH_HOLD_DURATION) {
      actionType = 'touch-tap';
      gestureData = { duration };
    }
    
    // 제스처 결과 생성 및 처리
    if (actionType !== 'unknown') {
      const result: GestureResult = {
        success: true,
        action: actionType,
        data: { 
          ...gestureData,
          correctionIndex: context.correctionIndex,
          target: touchInfo.target
        }
      };
      
      await this.executeCallbacks(result, context);
    }
  }

  /**
   * 스와이프 방향 감지
   */
  private detectSwipeDirection(deltaX: number, deltaY: number, distance: number): MobileActionType {
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    
    // 수평 스와이프
    if (absX > absY && absY < this.swipeConfig.maxDeviation) {
      return deltaX > 0 ? 'swipe-right' : 'swipe-left';
    }
    
    // 수직 스와이프
    if (absY > absX && absX < this.swipeConfig.maxDeviation) {
      return deltaY > 0 ? 'swipe-down' : 'swipe-up';
    }
    
    return 'unknown';
  }

  // =============================================================================
  // 타이머 관리
  // =============================================================================

  /**
   * 터치홀드 타이머 설정
   */
  private setTouchHoldTimer(touchId: number, touchInfo: TouchInfo): void {
    const timer = setTimeout(() => {
      this.triggerTouchHold(touchInfo);
    }, this.TOUCH_HOLD_DURATION);
    
    this.touchHoldTimers.set(touchId, timer);
  }

  /**
   * 롱프레스 타이머 설정
   */
  private setLongPressTimer(touchId: number, touchInfo: TouchInfo): void {
    const timer = setTimeout(() => {
      this.triggerLongPress(touchInfo);
    }, this.LONG_PRESS_DURATION);
    
    this.longPressTimers.set(touchId, timer);
  }

  /**
   * 터치 타이머들 정리
   */
  private clearTouchTimers(touchId: number): void {
    // 터치홀드 타이머 정리
    const touchHoldTimer = this.touchHoldTimers.get(touchId);
    if (touchHoldTimer) {
      clearTimeout(touchHoldTimer);
      this.touchHoldTimers.delete(touchId);
    }
    
    // 롱프레스 타이머 정리
    const longPressTimer = this.longPressTimers.get(touchId);
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      this.longPressTimers.delete(touchId);
    }
  }

  /**
   * 모든 타이머 정리
   */
  private clearAllTimers(): void {
    this.touchHoldTimers.forEach(timer => clearTimeout(timer));
    this.touchHoldTimers.clear();
    
    this.longPressTimers.forEach(timer => clearTimeout(timer));
    this.longPressTimers.clear();
  }

  // =============================================================================
  // 제스처 트리거 메서드들
  // =============================================================================

  /**
   * 터치홀드 트리거
   */
  private triggerTouchHold(touchInfo: TouchInfo): void {
    Logger.log('MobileEventHandler: 터치홀드 트리거됨', {
      targetClass: touchInfo.target.className
    });
    
    // 커스텀 이벤트 발송
    const touchHoldEvent = new CustomEvent('touchhold', {
      detail: { touchInfo },
      bubbles: true,
      cancelable: true
    });
    
    touchInfo.target.dispatchEvent(touchHoldEvent);
  }

  /**
   * 롱프레스 트리거
   */
  private triggerLongPress(touchInfo: TouchInfo): void {
    Logger.log('MobileEventHandler: 롱프레스 트리거됨', {
      targetClass: touchInfo.target.className
    });
    
    // 롱프레스 처리 (필요시 구현)
    const result: GestureResult = {
      success: true,
      action: 'long-press',
      data: { target: touchInfo.target }
    };
    
    // 콜백 실행 (비동기로)
    this.executeCallbacks(result, {
      target: touchInfo.target,
      eventType: 'touchstart'
    }).catch(error => {
      Logger.error('MobileEventHandler: 롱프레스 콜백 실행 중 오류', error);
    });
  }

  /**
   * 더블탭 감지
   */
  private checkForDoubleTap(touchInfo: TouchInfo, context: EventContext): void {
    const now = Date.now();
    const isDoubleTap = (
      this.lastTapTarget === touchInfo.target &&
      (now - this.lastTapTime) <= this.DOUBLE_TAP_THRESHOLD
    );
    
    if (isDoubleTap) {
      Logger.log('MobileEventHandler: 더블탭 감지됨');
      
      const result: GestureResult = {
        success: true,
        action: 'double-tap',
        data: { 
          correctionIndex: context.correctionIndex,
          target: touchInfo.target
        }
      };
      
      // 비동기로 콜백 실행
      this.executeCallbacks(result, context).catch(error => {
        Logger.error('MobileEventHandler: 더블탭 콜백 실행 중 오류', error);
      });
    }
    
    this.lastTapTime = now;
    this.lastTapTarget = touchInfo.target;
  }

  // =============================================================================
  // 특별한 액션 처리
  // =============================================================================

  /**
   * 터치홀드 액션 처리
   */
  private async handleTouchHoldAction(result: GestureResult, context: EventContext): Promise<void> {
    // 오류 텍스트에 대한 터치홀드인 경우 편집 모드 진입
    if (context.target.classList.contains('error-text') || 
        context.target.closest('.error-text')) {
      
      await this.enterEditMode(context.target, context);
    }
  }

  /**
   * 편집 모드 진입
   */
  private async enterEditMode(target: HTMLElement, context: EventContext): Promise<void> {
    Logger.log('MobileEventHandler: 편집 모드 진입', {
      correctionIndex: context.correctionIndex
    });

    // 이미 편집 중인 경우 무시
    if (this.editModeElements.has(target)) {
      return;
    }

    // 편집 가능한 input 요소 생성
    const input = document.createElement('input');
    input.type = 'text';
    input.value = target.textContent || '';
    input.className = 'error-original-input mobile-edit-input';

    // data 속성 복사
    if (context.correctionIndex !== undefined) {
      input.setAttribute('data-correction-index', context.correctionIndex.toString());
    }
    input.setAttribute('data-edit-mode', 'true');

    // 완료/취소 버튼 컨테이너 생성
    const buttonContainer = this.createEditButtonContainer(input, target, context);

    // 편집 컨테이너 생성
    const editContainer = document.createElement('div');
    editContainer.className = 'mobile-edit-container';

    editContainer.appendChild(input);
    editContainer.appendChild(buttonContainer);

    // 원본 요소 숨기고 편집 컨테이너 삽입
    target.classList.add('kga-mobile-edit-hidden');
    target.parentNode?.insertBefore(editContainer, target);

    // 편집 상태 기록
    this.editModeElements.set(target, input);

    // 포커스 및 선택
    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);
  }

  /**
   * 편집 버튼 컨테이너 생성
   */
  private createEditButtonContainer(
    input: HTMLInputElement,
    target: HTMLElement,
    context: EventContext
  ): HTMLElement {

    const container = document.createElement('div');
    container.className = 'mobile-edit-buttons';

    // 완료 버튼
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '✓';
    confirmBtn.className = 'mobile-edit-confirm';

    // 취소 버튼
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕';
    cancelBtn.className = 'mobile-edit-cancel';

    // 이벤트 리스너
    confirmBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.confirmEdit(input, target, context);
    });

    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.cancelEdit(input, target);
    });

    // Enter/Escape 키 처리
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.confirmEdit(input, target, context);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelEdit(input, target);
      }
    });

    container.appendChild(confirmBtn);
    container.appendChild(cancelBtn);

    return container;
  }

  /**
   * 편집 확인
   */
  private confirmEdit(input: HTMLInputElement, target: HTMLElement, context: EventContext): void {
    const newValue = input.value.trim();
    
    Logger.log('MobileEventHandler: 편집 확인됨', {
      correctionIndex: context.correctionIndex,
      newValue
    });
    
    // 빈 값인 경우 건너뛰기 (Phase 5에서 구현된 로직)
    if (!newValue) {
      this.cancelEdit(input, target);
      return;
    }
    
    // 값 변경 이벤트 발송
    const changeEvent = new CustomEvent('mobile-edit-confirm', {
      detail: { 
        correctionIndex: context.correctionIndex,
        newValue,
        originalValue: target.textContent
      },
      bubbles: true
    });
    
    target.dispatchEvent(changeEvent);
    
    // 편집 모드 종료
    this.exitEditMode(target);
  }

  /**
   * 편집 취소
   */
  private cancelEdit(input: HTMLInputElement, target: HTMLElement): void {
    Logger.log('MobileEventHandler: 편집 취소됨');
    
    // 편집 모드 종료
    this.exitEditMode(target);
  }

  /**
   * 편집 모드 종료
   */
  private exitEditMode(target: HTMLElement): void {
    const input = this.editModeElements.get(target);
    if (!input) return;

    // 편집 컨테이너 제거
    const editContainer = input.closest('.mobile-edit-container');
    if (editContainer) {
      editContainer.remove();
    }

    // 원본 요소 다시 표시
    target.classList.remove('kga-mobile-edit-hidden');

    // 편집 상태 제거
    this.editModeElements.delete(target);

    Logger.debug('MobileEventHandler: 편집 모드 종료 완료');
  }

  // =============================================================================
  // 유틸리티 메서드들
  // =============================================================================

  /**
   * 스크롤 방지 여부 확인
   */
  private shouldPreventScroll(target: HTMLElement): boolean {
    // 편집 중인 요소나 특정 UI 요소에서는 스크롤 방지
    return target.classList.contains('error-text') ||
           target.classList.contains('suggestion-item') ||
           target.classList.contains('mobile-edit-input') ||
           !!target.closest('.error-text, .suggestion-item, .mobile-edit-container');
  }

  /**
   * 터치 가능한 요소 확인
   */
  public isTouchableElement(element: HTMLElement): boolean {
    if (!Platform.isMobile) return false;
    
    const touchableClasses = [
      'error-text', 'error-highlight', 'suggestion-item',
      'nav-button', 'pagination-btn', 'btn', 'toggle-btn',
      'edit-btn'
    ];
    
    return touchableClasses.some(cls => element.classList.contains(cls)) ||
           !!element.closest(touchableClasses.map(cls => `.${cls}`).join(', '));
  }

  /**
   * 터치 영역 크기 확인 (44px 권장사항)
   */
  public hasSufficientTouchArea(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const minSize = 44; // Apple HIG 권장사항
    
    return rect.width >= minSize && rect.height >= minSize;
  }

  // =============================================================================
  // 콜백 시스템
  // =============================================================================

  /**
   * 액션 타입별 콜백 등록
   */
  public onAction(actionType: MobileActionType, callback: MobileHandlerCallback): void {
    const callbacks = this.callbacks.get(actionType);
    if (callbacks) {
      callbacks.push(callback);
      Logger.debug('MobileEventHandler: 콜백 등록됨', { 
        actionType, 
        totalCallbacks: callbacks.length 
      });
    }
  }

  /**
   * 액션 타입별 콜백 제거
   */
  public removeAction(actionType: MobileActionType, callback: MobileHandlerCallback): void {
    const callbacks = this.callbacks.get(actionType);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
        Logger.debug('MobileEventHandler: 콜백 제거됨', { 
          actionType, 
          remainingCallbacks: callbacks.length 
        });
      }
    }
  }

  /**
   * 등록된 콜백들 실행
   */
  private async executeCallbacks(result: GestureResult, context: EventContext): Promise<void> {
    const callbacks = this.callbacks.get(result.action);
    if (!callbacks || callbacks.length === 0) return;
    
    Logger.debug('MobileEventHandler: 콜백 실행 시작', { 
      action: result.action, 
      callbackCount: callbacks.length 
    });
    
    for (const callback of callbacks) {
      try {
        await callback(result, context);
      } catch (error) {
        Logger.error('MobileEventHandler: 콜백 실행 중 오류', { 
          action: result.action, 
          error 
        });
      }
    }
  }

  // =============================================================================
  // 상태 및 디버그
  // =============================================================================

  /**
   * 디버그 정보
   */
  public getDebugInfo(): any {
    const callbackCounts: Record<string, number> = {};
    
    this.callbacks.forEach((callbacks, actionType) => {
      callbackCounts[actionType] = callbacks.length;
    });
    
    return {
      isEnabled: Platform.isMobile,
      registeredCallbacks: callbackCounts,
      activeTouchesCount: this.activeTouches.size,
      touchHoldTimersCount: this.touchHoldTimers.size,
      longPressTimersCount: this.longPressTimers.size,
      editModeElementsCount: this.editModeElements.size,
      gestureConfig: {
        touchHoldDuration: this.TOUCH_HOLD_DURATION,
        longPressDuration: this.LONG_PRESS_DURATION,
        swipeConfig: this.swipeConfig
      }
    };
  }

  /**
   * 리소스 정리
   */
  public dispose(): void {
    // 모든 타이머 정리
    this.clearAllTimers();
    
    // 편집 모드 종료
    this.editModeElements.forEach((input, target) => {
      this.exitEditMode(target);
    });
    
    // 상태 초기화
    this.callbacks.clear();
    this.activeTouches.clear();
    this.editModeElements.clear();
    this.lastTapTarget = undefined;
    this.lastTapTime = 0;
    
    Logger.debug('MobileEventHandler: 리소스 정리 완료');
  }
}