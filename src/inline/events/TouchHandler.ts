/**
 * 터치 이벤트 처리 (모바일 전용)
 * 기존 inlineModeService의 모바일 터치 로직을 분리
 */

import { Platform } from 'obsidian';
import { TouchEventData, EventHandler } from '../types/EventTypes';
import { InlineError } from '../../types/interfaces';
import { Logger } from '../../utils/logger';

interface TouchGesture {
  type: 'tap' | 'hold' | 'double-tap';
  startTime: number;
  element: HTMLElement;
  position: { x: number; y: number };
}

export class TouchHandler {
  private touchTimeout: NodeJS.Timeout | null = null;
  private lastTouchTime: number = 0;
  private currentGesture: TouchGesture | null = null;
  
  // 터치 설정
  private holdDelay: number = 500; // 0.5초 홀드
  private doubleTapDelay: number = 300; // 0.3초 이내 더블탭
  private touchMoveThreshold: number = 10; // 10px 이내 움직임은 무시
  
  // 이벤트 콜백들
  private onErrorTap?: EventHandler<TouchEventData>;
  private onErrorHold?: EventHandler<TouchEventData>;
  private onErrorDoubleTap?: EventHandler<TouchEventData>;
  
  // 터치 상태 추적
  private touchStartPosition: { x: number; y: number } | null = null;
  private isTouchMoved: boolean = false;
  
  constructor() {
    // 모바일에서만 활성화
    if (!Platform.isMobile) {
      Logger.log('TouchHandler: 데스크톱 환경에서는 비활성화');
      return;
    }
    
    Logger.log('TouchHandler: 모바일 환경에서 초기화 완료');
  }
  
  /**
   * 이벤트 콜백 등록
   */
  setEventHandlers(handlers: {
    onErrorTap?: EventHandler<TouchEventData>;
    onErrorHold?: EventHandler<TouchEventData>;
    onErrorDoubleTap?: EventHandler<TouchEventData>;
  }): void {
    this.onErrorTap = handlers.onErrorTap;
    this.onErrorHold = handlers.onErrorHold;
    this.onErrorDoubleTap = handlers.onErrorDoubleTap;
    
    Logger.log('TouchHandler: 터치 이벤트 핸들러 등록 완료');
  }
  
  /**
   * 터치 이벤트 등록
   */
  registerTouchEvents(container: HTMLElement): void {
    if (!Platform.isMobile) {
      Logger.log('TouchHandler: 모바일이 아니므로 터치 이벤트 등록 건너뜀');
      return;
    }
    
    // 터치 이벤트들
    container.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    container.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    container.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
    container.addEventListener('touchcancel', this.handleTouchCancel.bind(this), { passive: false });
    
    Logger.log('TouchHandler: 터치 이벤트 등록 완료');
  }
  
  /**
   * 터치 이벤트 해제
   */
  unregisterTouchEvents(container: HTMLElement): void {
    if (!Platform.isMobile) {
      return;
    }
    
    container.removeEventListener('touchstart', this.handleTouchStart.bind(this));
    container.removeEventListener('touchmove', this.handleTouchMove.bind(this));
    container.removeEventListener('touchend', this.handleTouchEnd.bind(this));
    container.removeEventListener('touchcancel', this.handleTouchCancel.bind(this));
    
    // 상태 정리
    this.clearTouchTimeout();
    this.currentGesture = null;
    this.touchStartPosition = null;
    
    Logger.log('TouchHandler: 터치 이벤트 해제 완료');
  }
  
  /**
   * 터치 시작 처리
   */
  private handleTouchStart(event: TouchEvent): void {
    try {
      const target = event.target as HTMLElement;
      if (!this.isTouchableErrorElement(target)) {
        return;
      }
      
      // 멀티터치 무시
      if (event.touches.length > 1) {
        this.clearTouchTimeout();
        return;
      }
      
      const touch = event.touches[0];
      const position = { x: touch.clientX, y: touch.clientY };
      
      this.touchStartPosition = position;
      this.isTouchMoved = false;
      
      const errorId = target.getAttribute('data-error-id');
      if (!errorId) {
        Logger.warn('TouchHandler: 터치 대상에서 오류 ID를 찾을 수 없음');
        return;
      }
      
      Logger.log('TouchHandler: 터치 시작', { errorId, position });
      
      // 홀드 제스처 감지 타이머 시작
      this.touchTimeout = setTimeout(() => {
        if (!this.isTouchMoved && this.touchStartPosition) {
          this.handleHoldGesture(target, errorId, event);
        }
      }, this.holdDelay);
      
      // 현재 제스처 설정
      this.currentGesture = {
        type: 'tap',
        startTime: Date.now(),
        element: target,
        position
      };
      
    } catch (error) {
      Logger.error('TouchHandler: 터치 시작 처리 중 오류', error);
    }
  }
  
  /**
   * 터치 이동 처리
   */
  private handleTouchMove(event: TouchEvent): void {
    if (!this.touchStartPosition || event.touches.length === 0) {
      return;
    }
    
    const touch = event.touches[0];
    const currentPosition = { x: touch.clientX, y: touch.clientY };
    
    // 이동 거리 계산
    const moveDistance = Math.sqrt(
      Math.pow(currentPosition.x - this.touchStartPosition.x, 2) +
      Math.pow(currentPosition.y - this.touchStartPosition.y, 2)
    );
    
    // 임계값을 초과하면 터치 이동으로 간주
    if (moveDistance > this.touchMoveThreshold) {
      this.isTouchMoved = true;
      this.clearTouchTimeout(); // 홀드 제스처 취소
      
      Logger.debug('TouchHandler: 터치 이동 감지', { moveDistance });
    }
  }
  
  /**
   * 터치 종료 처리
   */
  private handleTouchEnd(event: TouchEvent): void {
    try {
      const target = event.target as HTMLElement;
      if (!this.isTouchableErrorElement(target) || !this.currentGesture) {
        this.clearTouchTimeout();
        return;
      }
      
      const errorId = target.getAttribute('data-error-id');
      if (!errorId) {
        this.clearTouchTimeout();
        return;
      }
      
      // 홀드 타이머 취소
      this.clearTouchTimeout();
      
      // 터치가 이동했으면 제스처로 인식하지 않음
      if (this.isTouchMoved) {
        Logger.debug('TouchHandler: 터치 이동으로 인해 제스처 취소');
        this.currentGesture = null;
        return;
      }
      
      const touchDuration = Date.now() - this.currentGesture.startTime;
      
      // 홀드 제스처 (이미 처리됨) vs 탭 제스처
      if (touchDuration < this.holdDelay) {
        this.handleTapGesture(target, errorId, event);
      }
      
      this.currentGesture = null;
      
    } catch (error) {
      Logger.error('TouchHandler: 터치 종료 처리 중 오류', error);
    }
  }
  
  /**
   * 터치 취소 처리
   */
  private handleTouchCancel(event: TouchEvent): void {
    Logger.debug('TouchHandler: 터치 취소됨');
    this.clearTouchTimeout();
    this.currentGesture = null;
    this.touchStartPosition = null;
    this.isTouchMoved = false;
  }
  
  /**
   * 탭 제스처 처리
   */
  private async handleTapGesture(element: HTMLElement, errorId: string, touchEvent: TouchEvent): Promise<void> {
    const currentTime = Date.now();
    const isDoubleTap = currentTime - this.lastTouchTime < this.doubleTapDelay;
    this.lastTouchTime = currentTime;
    
    if (isDoubleTap) {
      await this.handleDoubleTapGesture(element, errorId, touchEvent);
    } else {
      // 더블탭 대기 후 단일 탭 처리
      setTimeout(async () => {
        if (Date.now() - this.lastTouchTime >= this.doubleTapDelay) {
          await this.handleSingleTapGesture(element, errorId, touchEvent);
        }
      }, this.doubleTapDelay);
    }
  }
  
  /**
   * 단일 탭 처리
   */
  private async handleSingleTapGesture(element: HTMLElement, errorId: string, touchEvent: TouchEvent): Promise<void> {
    Logger.log('TouchHandler: 단일 탭 제스처', { errorId });
    
    if (!this.onErrorTap) {
      Logger.warn('TouchHandler: 탭 핸들러가 등록되지 않음');
      return;
    }
    
    const touchData: TouchEventData = {
      errorId,
      error: this.getErrorFromElement(element),
      element,
      touchEvent,
      position: this.touchStartPosition || { x: 0, y: 0 },
      gestureType: 'tap',
      duration: 0
    };
    
    await this.onErrorTap(touchData);
  }
  
  /**
   * 더블탭 처리
   */
  private async handleDoubleTapGesture(element: HTMLElement, errorId: string, touchEvent: TouchEvent): Promise<void> {
    Logger.log('TouchHandler: 더블탭 제스처', { errorId });
    
    if (!this.onErrorDoubleTap) {
      Logger.warn('TouchHandler: 더블탭 핸들러가 등록되지 않음');
      return;
    }
    
    const touchData: TouchEventData = {
      errorId,
      error: this.getErrorFromElement(element),
      element,
      touchEvent,
      position: this.touchStartPosition || { x: 0, y: 0 },
      gestureType: 'double-tap',
      duration: 0
    };
    
    await this.onErrorDoubleTap(touchData);
  }
  
  /**
   * 홀드 제스처 처리
   */
  private async handleHoldGesture(element: HTMLElement, errorId: string, touchEvent: TouchEvent): Promise<void> {
    Logger.log('TouchHandler: 홀드 제스처', { errorId });
    
    if (!this.onErrorHold) {
      Logger.warn('TouchHandler: 홀드 핸들러가 등록되지 않음');
      return;
    }
    
    const touchData: TouchEventData = {
      errorId,
      error: this.getErrorFromElement(element),
      element,
      touchEvent,
      position: this.touchStartPosition || { x: 0, y: 0 },
      gestureType: 'hold',
      duration: this.holdDelay
    };
    
    await this.onErrorHold(touchData);
  }
  
  /**
   * 터치 가능한 오류 요소인지 확인
   */
  private isTouchableErrorElement(element: HTMLElement): boolean {
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
    
    let corrected: string[] = [];
    try {
      corrected = JSON.parse(correctedStr);
    } catch (e) {
      Logger.warn('TouchHandler: 수정 제안 파싱 실패', { correctedStr });
    }
    
    return {
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
      isActive: true,
      aiStatus: aiStatus === 'none' ? undefined : aiStatus as 'corrected' | 'exception' | 'keep-original',
      aiSelectedValue: aiSelectedValue || undefined
    };
  }
  
  /**
   * 터치 타이머 정리
   */
  private clearTouchTimeout(): void {
    if (this.touchTimeout) {
      clearTimeout(this.touchTimeout);
      this.touchTimeout = null;
    }
  }
  
  /**
   * 모바일 환경인지 확인
   */
  isMobileEnvironment(): boolean {
    return Platform.isMobile;
  }
  
  /**
   * 설정 업데이트
   */
  updateSettings(settings: {
    holdDelay?: number;
    doubleTapDelay?: number;
    touchMoveThreshold?: number;
  }): void {
    if (settings.holdDelay !== undefined) {
      this.holdDelay = settings.holdDelay;
    }
    if (settings.doubleTapDelay !== undefined) {
      this.doubleTapDelay = settings.doubleTapDelay;
    }
    if (settings.touchMoveThreshold !== undefined) {
      this.touchMoveThreshold = settings.touchMoveThreshold;
    }
    
    Logger.log('TouchHandler: 설정 업데이트', {
      holdDelay: this.holdDelay,
      doubleTapDelay: this.doubleTapDelay,
      touchMoveThreshold: this.touchMoveThreshold
    });
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      isMobile: Platform.isMobile,
      hasTouchTimeout: !!this.touchTimeout,
      currentGesture: this.currentGesture ? {
        type: this.currentGesture.type,
        startTime: this.currentGesture.startTime,
        duration: Date.now() - this.currentGesture.startTime
      } : null,
      lastTouchTime: this.lastTouchTime,
      touchStartPosition: this.touchStartPosition,
      isTouchMoved: this.isTouchMoved,
      settings: {
        holdDelay: this.holdDelay,
        doubleTapDelay: this.doubleTapDelay,
        touchMoveThreshold: this.touchMoveThreshold
      },
      hasHandlers: {
        tap: !!this.onErrorTap,
        hold: !!this.onErrorHold,
        doubleTap: !!this.onErrorDoubleTap
      }
    };
  }
}