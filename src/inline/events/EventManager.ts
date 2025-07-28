/**
 * 이벤트 매니저
 * 모든 이벤트 핸들러들을 통합 관리
 */

import { EditorView } from '@codemirror/view';
import { Platform } from 'obsidian';
import { 
  IEventManager, 
  IEventSubscriber,
  ClickEventData, 
  HoverEventData, 
  KeyboardEventData,
  TouchEventData,
  EventDelegationConfig 
} from '../types/EventTypes';
import { InlineError } from '../../types/interfaces';
import { Logger } from '../../utils/logger';

import { ClickHandler } from './ClickHandler';
import { HoverHandler } from './HoverHandler';
import { KeyboardHandler } from './KeyboardHandler';
import { TouchHandler } from './TouchHandler';

export class EventManager implements IEventManager {
  private clickHandler: ClickHandler;
  private hoverHandler: HoverHandler;
  private keyboardHandler: KeyboardHandler;
  private touchHandler: TouchHandler;
  
  private currentView: EditorView | null = null;
  private container: HTMLElement | null = null;
  private isEventsRegistered: boolean = false;
  
  // 이벤트 구독자들
  private subscribers: Set<IEventSubscriber> = new Set();
  
  // 설정
  private config: EventDelegationConfig = {
    rootSelector: '.cm-editor',
    errorSelector: '.korean-grammar-error-inline',
    aiSelector: '.korean-grammar-ai-widget',
    enableTouch: Platform.isMobile,
    enableKeyboard: true,
    debounceMs: 50
  };
  
  // 디바운싱
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(config?: Partial<EventDelegationConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    // 핸들러들 초기화
    this.clickHandler = new ClickHandler();
    this.hoverHandler = new HoverHandler();
    this.keyboardHandler = new KeyboardHandler();
    this.touchHandler = new TouchHandler();
    
    // 핸들러별 콜백 등록
    this.setupHandlerCallbacks();
    
    Logger.log('EventManager: 초기화 완료', { config: this.config });
  }
  
  /**
   * 핸들러별 콜백 설정
   */
  private setupHandlerCallbacks(): void {
    // 클릭 핸들러 콜백
    this.clickHandler.setEventHandlers({
      onErrorClick: this.handleClick.bind(this),
      onErrorDoubleClick: this.handleDoubleClick.bind(this),
      onAIWidgetClick: this.handleAIWidgetClick.bind(this)
    });
    
    // 호버 핸들러 콜백
    this.hoverHandler.setEventHandlers({
      onErrorHover: this.handleHover.bind(this),
      onErrorUnhover: this.handleUnhover.bind(this)
    });
    
    // 키보드 핸들러 콜백
    this.keyboardHandler.setEventHandler(this.handleKeyboard.bind(this));
    
    // 터치 핸들러 콜백 (모바일에서만)
    if (this.config.enableTouch) {
      this.touchHandler.setEventHandlers({
        onErrorTap: this.handleTouch.bind(this),
        onErrorHold: this.handleTouch.bind(this),
        onErrorDoubleTap: this.handleTouch.bind(this)
      });
    }
    
    Logger.log('EventManager: 핸들러 콜백 설정 완료');
  }
  
  /**
   * 이벤트 등록
   */
  registerEvents(view: EditorView): void {
    if (this.isEventsRegistered) {
      Logger.warn('EventManager: 이미 이벤트가 등록되어 있음');
      this.unregisterEvents();
    }
    
    this.currentView = view;
    this.container = view.dom;
    
    if (!this.container) {
      Logger.error('EventManager: 컨테이너를 찾을 수 없음');
      return;
    }
    
    Logger.log('EventManager: 이벤트 등록 시작');
    
    try {
      // 각 핸들러별 이벤트 등록
      this.clickHandler.registerClickEvents(this.container);
      this.hoverHandler.registerHoverEvents(this.container);
      
      if (this.config.enableKeyboard) {
        this.keyboardHandler.registerKeyboardEvents(this.container);
      }
      
      if (this.config.enableTouch && Platform.isMobile) {
        this.touchHandler.registerTouchEvents(this.container);
      }
      
      // 커서 위치 모니터링 설정
      this.setupCursorMonitoring(view);
      
      this.isEventsRegistered = true;
      Logger.log('EventManager: 이벤트 등록 완료');
      
    } catch (error) {
      Logger.error('EventManager: 이벤트 등록 중 오류', error);
      this.unregisterEvents();
    }
  }
  
  /**
   * 이벤트 해제
   */
  unregisterEvents(): void {
    if (!this.isEventsRegistered || !this.container) {
      Logger.log('EventManager: 해제할 이벤트가 없음');
      return;
    }
    
    Logger.log('EventManager: 이벤트 해제 시작');
    
    try {
      // 각 핸들러별 이벤트 해제
      this.clickHandler.unregisterClickEvents(this.container);
      this.hoverHandler.unregisterHoverEvents(this.container);
      this.keyboardHandler.unregisterKeyboardEvents(this.container);
      
      if (Platform.isMobile) {
        this.touchHandler.unregisterTouchEvents(this.container);
      }
      
      // 디바운스 타이머 정리
      this.clearAllDebounceTimers();
      
      // 상태 초기화
      this.currentView = null;
      this.container = null;
      this.isEventsRegistered = false;
      
      Logger.log('EventManager: 이벤트 해제 완료');
      
    } catch (error) {
      Logger.error('EventManager: 이벤트 해제 중 오류', error);
    }
  }
  
  /**
   * 커서 위치 모니터링 설정
   */
  private setupCursorMonitoring(view: EditorView): void {
    // TODO: 기존 커서 모니터링 로직 구현
    // 현재는 기존 InlineModeService의 setupCursorMonitoring을 사용
    Logger.log('EventManager: 커서 모니터링 설정 (TODO: 구현 필요)');
  }
  
  /**
   * 클릭 이벤트 처리
   */
  async handleClick(data: ClickEventData): Promise<void> {
    await this.debounceAndNotify('click', data, async () => {
      Logger.log('EventManager: 클릭 이벤트 처리', { errorId: data.errorId });
      
      for (const subscriber of this.subscribers) {
        if (subscriber.onErrorClick) {
          await subscriber.onErrorClick(data);
        }
      }
    });
  }
  
  /**
   * 더블클릭 이벤트 처리
   */
  private async handleDoubleClick(data: ClickEventData): Promise<void> {
    Logger.log('EventManager: 더블클릭 이벤트 처리', { errorId: data.errorId });
    
    // 더블클릭은 디바운싱하지 않음 (즉시 처리)
    for (const subscriber of this.subscribers) {
      if (subscriber.onErrorClick) {
        // 더블클릭 표시를 위해 데이터 수정
        const doubleClickData = { ...data, mouseEvent: { ...data.mouseEvent, detail: 2 } };
        await subscriber.onErrorClick(doubleClickData);
      }
    }
  }
  
  /**
   * AI 위젯 클릭 처리
   */
  private async handleAIWidgetClick(data: ClickEventData): Promise<void> {
    Logger.log('EventManager: AI 위젯 클릭 이벤트 처리', { errorId: data.errorId });
    
    for (const subscriber of this.subscribers) {
      if (subscriber.onErrorClick) {
        await subscriber.onErrorClick(data);
      }
    }
  }
  
  /**
   * 호버 이벤트 처리
   */
  async handleHover(data: HoverEventData): Promise<void> {
    await this.debounceAndNotify('hover', data, async () => {
      Logger.log('EventManager: 호버 이벤트 처리', { 
        errorId: data.errorId, 
        isEntering: data.isEntering 
      });
      
      for (const subscriber of this.subscribers) {
        if (subscriber.onErrorHover) {
          await subscriber.onErrorHover(data);
        }
      }
    });
  }
  
  /**
   * 호버 해제 처리
   */
  private async handleUnhover(data: HoverEventData): Promise<void> {
    Logger.log('EventManager: 호버 해제 이벤트 처리', { errorId: data.errorId });
    
    for (const subscriber of this.subscribers) {
      if (subscriber.onErrorHover) {
        await subscriber.onErrorHover(data);
      }
    }
  }
  
  /**
   * 키보드 이벤트 처리
   */
  async handleKeyboard(data: KeyboardEventData): Promise<void> {
    // 키보드 이벤트는 디바운싱하지 않음 (즉시 처리)
    Logger.log('EventManager: 키보드 이벤트 처리', { 
      action: data.action,
      errorId: data.errorId 
    });
    
    for (const subscriber of this.subscribers) {
      if (subscriber.onErrorKeyboard) {
        await subscriber.onErrorKeyboard(data);
      }
    }
  }
  
  /**
   * 터치 이벤트 처리
   */
  async handleTouch(data: TouchEventData): Promise<void> {
    if (!this.touchHandler.isMobileEnvironment()) {
      Logger.debug('EventManager: 모바일이 아니므로 터치 이벤트 무시');
      return;
    }
    
    Logger.log('EventManager: 터치 이벤트 처리', { 
      errorId: data.errorId,
      gestureType: data.gestureType 
    });
    
    for (const subscriber of this.subscribers) {
      if (subscriber.onErrorTouch) {
        await subscriber.onErrorTouch(data);
      }
    }
  }
  
  /**
   * 이벤트 구독자 추가
   */
  subscribe(subscriber: IEventSubscriber): void {
    this.subscribers.add(subscriber);
    Logger.log('EventManager: 구독자 추가', { subscriberCount: this.subscribers.size });
  }
  
  /**
   * 이벤트 구독자 제거
   */
  unsubscribe(subscriber: IEventSubscriber): void {
    const removed = this.subscribers.delete(subscriber);
    Logger.log('EventManager: 구독자 제거', { 
      removed, 
      subscriberCount: this.subscribers.size 
    });
  }
  
  /**
   * 모든 구독자 제거
   */
  clearSubscribers(): void {
    this.subscribers.clear();
    Logger.log('EventManager: 모든 구독자 제거');
  }
  
  /**
   * 오류 목록 업데이트 (키보드 네비게이션용)
   */
  updateErrorList(errors: Map<string, InlineError>): void {
    this.keyboardHandler.updateErrorList(errors);
    Logger.log('EventManager: 오류 목록 업데이트', { errorCount: errors.size });
  }
  
  /**
   * 포커스된 오류 설정
   */
  setFocusedError(errorId: string | null): void {
    this.keyboardHandler.setFocusedError(errorId);
    Logger.log('EventManager: 포커스 설정', { errorId });
  }
  
  /**
   * 디바운싱 및 알림
   */
  private async debounceAndNotify<T>(
    key: string, 
    data: T, 
    callback: () => Promise<void>
  ): Promise<void> {
    // 이전 타이머 취소
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // 새 타이머 설정
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(key);
      await callback();
    }, this.config.debounceMs);
    
    this.debounceTimers.set(key, timer);
  }
  
  /**
   * 모든 디바운스 타이머 정리
   */
  private clearAllDebounceTimers(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    
    Logger.log('EventManager: 모든 디바운스 타이머 정리 완료');
  }
  
  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<EventDelegationConfig>): void {
    this.config = { ...this.config, ...config };
    
    // 하위 핸들러들에도 설정 전파
    if (config.debounceMs !== undefined) {
      this.clickHandler.updateSettings({ doubleClickDelay: config.debounceMs * 6 });
      this.hoverHandler.updateSettings({ hoverDelay: config.debounceMs * 6 });
    }
    
    Logger.log('EventManager: 설정 업데이트', { config: this.config });
  }
  
  /**
   * 개별 핸들러 접근
   */
  getClickHandler(): ClickHandler {
    return this.clickHandler;
  }
  
  getHoverHandler(): HoverHandler {
    return this.hoverHandler;
  }
  
  getKeyboardHandler(): KeyboardHandler {
    return this.keyboardHandler;
  }
  
  getTouchHandler(): TouchHandler {
    return this.touchHandler;
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      isEventsRegistered: this.isEventsRegistered,
      hasView: !!this.currentView,
      hasContainer: !!this.container,
      subscriberCount: this.subscribers.size,
      debounceTimerCount: this.debounceTimers.size,
      config: this.config,
      handlers: {
        click: this.clickHandler.getDebugInfo(),
        hover: this.hoverHandler.getDebugInfo(),
        keyboard: this.keyboardHandler.getDebugInfo(),
        touch: this.touchHandler.getDebugInfo()
      }
    };
  }
}