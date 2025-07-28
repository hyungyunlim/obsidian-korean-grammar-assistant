/**
 * 인라인 모드 이벤트 관련 타입 정의
 */

import { EnhancedInlineError } from './InlineTypes';

// 이벤트 핸들러 타입
export type EventHandler<T = any> = (data: T) => void | Promise<void>;

// 클릭 이벤트 데이터
export interface ClickEventData {
  errorId: string;
  error: EnhancedInlineError;
  element: HTMLElement;
  mouseEvent: MouseEvent;
  position: { x: number; y: number };
  isMobile: boolean;
}

// 호버 이벤트 데이터
export interface HoverEventData {
  errorId: string;
  error: EnhancedInlineError;
  element: HTMLElement;
  mouseEvent: MouseEvent;
  position: { x: number; y: number };
  isEntering: boolean; // true: mouseenter, false: mouseleave
}

// 키보드 이벤트 데이터
export interface KeyboardEventData {
  errorId?: string;
  keyEvent: KeyboardEvent;
  action: 'focus' | 'navigate' | 'select' | 'edit' | 'escape';
  direction?: 'next' | 'prev' | 'first' | 'last';
}

// 터치 이벤트 데이터 (모바일용)
export interface TouchEventData {
  errorId: string;
  error: EnhancedInlineError;
  element: HTMLElement;
  touchEvent: TouchEvent;
  position: { x: number; y: number };
  gestureType: 'tap' | 'hold' | 'double-tap';
  duration?: number;
}

// 이벤트 리스너 등록 정보
export interface EventListenerInfo {
  element: HTMLElement;
  event: string;
  handler: EventListener;
  options?: AddEventListenerOptions;
}

// 이벤트 매니저 인터페이스
export interface IEventManager {
  registerEvents(view: any): void;
  unregisterEvents(): void;
  handleClick(data: ClickEventData): Promise<void>;
  handleHover(data: HoverEventData): Promise<void>;
  handleKeyboard(data: KeyboardEventData): Promise<void>;
  handleTouch?(data: TouchEventData): Promise<void>;
}

// 이벤트 구독자 인터페이스
export interface IEventSubscriber {
  onErrorClick?: EventHandler<ClickEventData>;
  onErrorHover?: EventHandler<HoverEventData>;
  onErrorKeyboard?: EventHandler<KeyboardEventData>;
  onErrorTouch?: EventHandler<TouchEventData>;
}

// 이벤트 위임 설정
export interface EventDelegationConfig {
  rootSelector: string;
  errorSelector: string;
  aiSelector: string;
  enableTouch: boolean;
  enableKeyboard: boolean;
  debounceMs: number;
}