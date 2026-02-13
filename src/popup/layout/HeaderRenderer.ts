/**
 * 헤더 렌더러
 * 팝업 헤더 영역(제목, AI 버튼, 닫기 버튼)을 관리
 */

import { Platform } from 'obsidian';
import { RenderContext, IPopupComponent, PopupState, AIIntegrationState } from '../types/PopupTypes';
import { Logger } from '../../utils/logger';
import { setIcon } from 'obsidian';
import { createEl } from '../../utils/domUtils';
import { clearElement } from '../../utils/domUtils';

/**
 * 헤더 버튼 타입
 */
export type HeaderButtonType = 'ai-analyze' | 'settings' | 'help' | 'close';

/**
 * 헤더 버튼 이벤트 타입
 */
export type HeaderButtonEvent = {
  type: HeaderButtonType;
  data?: any;
};

export type HeaderButtonListener = (event: HeaderButtonEvent) => void;

/**
 * 헤더 렌더러 클래스
 */
export class HeaderRenderer implements IPopupComponent {
  private context?: RenderContext;
  private containerElement?: HTMLElement;
  
  // 하위 요소들
  private titleElement?: HTMLElement;
  private buttonContainerElement?: HTMLElement;
  private aiButtonElement?: HTMLElement;
  private settingsButtonElement?: HTMLElement;
  private helpButtonElement?: HTMLElement;
  private closeButtonElement?: HTMLElement;
  
  // 상태 관리
  private isInitialized: boolean = false;
  private buttonListeners: Set<HeaderButtonListener> = new Set();
  
  // AI 분석 관련
  private isAiAnalyzing: boolean = false;
  private tokenCount: number = 0;
  private tokenThreshold: number = 1000;
  
  constructor() {
    Logger.log('HeaderRenderer: 초기화 완료');
  }
  
  // =============================================================================
  // IPopupComponent 구현
  // =============================================================================
  
  /**
   * 컴포넌트 초기화
   */
  async initialize(context: RenderContext): Promise<void> {
    try {
      this.context = context;
      this.isInitialized = true;
      
      Logger.log('HeaderRenderer: 초기화 완료');
      
    } catch (error) {
      Logger.error('HeaderRenderer: 초기화 중 오류', error);
      throw error;
    }
  }
  
  /**
   * 헤더 영역 렌더링
   */
  render(): HTMLElement {
    if (!this.context) {
      throw new Error('HeaderRenderer: 초기화되지 않은 상태에서 render 호출');
    }
    
    try {
      // 헤더 컨테이너 생성
      this.containerElement = this.createHeaderContainer();
      
      // 제목 영역 렌더링
      this.renderTitle();
      
      // 버튼들 렌더링
      this.renderButtons();
      
      Logger.debug('HeaderRenderer: 렌더링 완료');
      
      return this.containerElement;
      
    } catch (error) {
      Logger.error('HeaderRenderer: 렌더링 중 오류', error);
      throw error;
    }
  }
  
  /**
   * 컴포넌트 업데이트
   */
  update(state: Partial<PopupState>): void {
    if (!this.isInitialized || !this.context) {
      Logger.warn('HeaderRenderer: 초기화되지 않은 상태에서 update 호출');
      return;
    }
    
    try {
      // 컨텍스트 상태 업데이트
      this.context.state = { ...this.context.state, ...state };
      
      // AI 분석 상태 업데이트
      if (state.isAiAnalyzing !== undefined) {
        this.isAiAnalyzing = state.isAiAnalyzing;
        this.updateAIButton();
      }
      
      // 제목 업데이트 (페이지 정보 변경 시)
      if (state.currentPreviewPage !== undefined || state.totalPreviewPages !== undefined) {
        this.updateTitle();
      }
      
      Logger.debug('HeaderRenderer: 업데이트 완료', { updatedFields: Object.keys(state) });
      
    } catch (error) {
      Logger.error('HeaderRenderer: 업데이트 중 오류', error);
    }
  }
  
  /**
   * 컴포넌트 정리
   */
  dispose(): void {
    try {
      // 이벤트 리스너 정리
      this.buttonListeners.clear();
      
      // DOM 요소 정리
      if (this.containerElement) {
        this.containerElement.remove();
        this.containerElement = undefined;
      }
      
      this.titleElement = undefined;
      this.buttonContainerElement = undefined;
      this.aiButtonElement = undefined;
      this.settingsButtonElement = undefined;
      this.helpButtonElement = undefined;
      this.closeButtonElement = undefined;
      
      this.isInitialized = false;
      this.context = undefined;
      
      Logger.log('HeaderRenderer: 정리 완료');
      
    } catch (error) {
      Logger.error('HeaderRenderer: 정리 중 오류', error);
    }
  }
  
  /**
   * 가시성 확인
   */
  isVisible(): boolean {
    return this.isInitialized && !!this.containerElement && this.containerElement.isConnected;
  }
  
  // =============================================================================
  // 헤더 구조 생성
  // =============================================================================
  
  /**
   * 헤더 컨테이너 생성
   */
  private createHeaderContainer(): HTMLElement {
    const container = createEl('div', {
      cls: 'korean-grammar-popup-header-container'
    });

    return container;
  }
  
  /**
   * 제목 영역 렌더링
   */
  private renderTitle(): void {
    if (!this.containerElement) return;

    // 제목 컨테이너
    const titleContainer = createEl('div', {
      cls: 'korean-grammar-popup-title-container',
      parent: this.containerElement
    });

    // 아이콘
    const iconElement = createEl('div', {
      cls: 'korean-grammar-popup-icon',
      parent: titleContainer
    });

    setIcon(iconElement, 'spell-check');

    // 제목 텍스트 (div로 변경)
    this.titleElement = createEl('div', {
      cls: 'korean-grammar-popup-title',
      text: this.getTitleText(),
      parent: titleContainer
    });

    // 페이지 정보 (긴 텍스트인 경우)
    if (this.context?.state.isLongText) {
      const pageInfoElement = createEl('span', {
        cls: 'korean-grammar-popup-page-info',
        text: this.getPageInfoText(),
        parent: titleContainer
      });
    }
  }
  
  /**
   * 버튼들 렌더링
   */
  private renderButtons(): void {
    if (!this.containerElement) return;

    // 버튼 컨테이너
    this.buttonContainerElement = createEl('div', {
      cls: 'korean-grammar-popup-header-buttons',
      parent: this.containerElement
    });

    // AI 분석 버튼
    this.renderAIButton();

    // 설정 버튼 (데스크톱에서만)
    if (!Platform.isMobile) {
      this.renderSettingsButton();
    }

    // 도움말 버튼
    this.renderHelpButton();

    // 닫기 버튼
    this.renderCloseButton();
  }
  
  /**
   * AI 분석 버튼 렌더링
   */
  private renderAIButton(): void {
    if (!this.buttonContainerElement) return;
    
    this.aiButtonElement = this.createButton({
      type: 'ai-analyze',
      icon: 'bot',
      text: this.isAiAnalyzing ? 'AI 분석 중...' : '🤖 AI 분석',
      tooltip: 'AI를 활용한 자동 교정 분석',
      disabled: this.isAiAnalyzing,
      primary: true
    });
    
    this.buttonContainerElement.appendChild(this.aiButtonElement);
  }
  
  /**
   * 설정 버튼 렌더링
   */
  private renderSettingsButton(): void {
    if (!this.buttonContainerElement) return;
    
    this.settingsButtonElement = this.createButton({
      type: 'settings',
      icon: 'settings',
      tooltip: '설정',
      iconOnly: true
    });
    
    this.buttonContainerElement.appendChild(this.settingsButtonElement);
  }
  
  /**
   * 도움말 버튼 렌더링
   */
  private renderHelpButton(): void {
    if (!this.buttonContainerElement) return;
    
    this.helpButtonElement = this.createButton({
      type: 'help',
      icon: 'help-circle',
      tooltip: '키보드 단축키 도움말',
      iconOnly: true
    });
    
    this.buttonContainerElement.appendChild(this.helpButtonElement);
  }
  
  /**
   * 닫기 버튼 렌더링
   */
  private renderCloseButton(): void {
    if (!this.buttonContainerElement) return;
    
    this.closeButtonElement = this.createButton({
      type: 'close',
      icon: 'x',
      tooltip: '닫기 (Esc)',
      iconOnly: true,
      danger: true
    });
    
    this.buttonContainerElement.appendChild(this.closeButtonElement);
  }
  
  // =============================================================================
  // 버튼 생성 및 관리
  // =============================================================================
  
  /**
   * 버튼 생성
   */
  private createButton(options: {
    type: HeaderButtonType;
    icon: string;
    text?: string;
    tooltip?: string;
    disabled?: boolean;
    primary?: boolean;
    danger?: boolean;
    iconOnly?: boolean;
  }): HTMLElement {
    const button = createEl('button', {
      cls: ['korean-grammar-popup-header-button']
    });

    // 버튼 타입별 클래스 추가
    button.classList.add(`korean-grammar-popup-header-button-${options.type}`);

    if (options.primary) {
      button.classList.add('korean-grammar-popup-header-button-primary');
    }

    if (options.danger) {
      button.classList.add('korean-grammar-popup-header-button-danger');
    }

    if (options.iconOnly) {
      button.classList.add('korean-grammar-popup-header-button-icon-only');
    }

    // 활성화/비활성화 상태 클래스 추가
    if (options.disabled) {
      button.classList.add('kga-header-button-disabled');
    } else {
      button.classList.add('kga-header-button-enabled');
    }

    // 아이콘 추가
    const iconElement = createEl('div', {
      cls: 'korean-grammar-popup-header-button-icon',
      parent: button
    });

    setIcon(iconElement, options.icon);

    // 텍스트 추가 (아이콘 전용이 아닌 경우)
    if (!options.iconOnly && options.text) {
      const textElement = createEl('span', {
        cls: 'korean-grammar-popup-header-button-text',
        text: options.text,
        parent: button
      });
    }

    // 툴팁 설정
    if (options.tooltip) {
      button.setAttribute('aria-label', options.tooltip);
      button.setAttribute('title', options.tooltip);
    }

    // 비활성화 상태
    if (options.disabled) {
      button.setAttribute('disabled', 'true');
    }

    // 클릭 이벤트
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (options.disabled) return;

      this.handleButtonClick(options.type);
    });

    return button;
  }
  
  /**
   * 버튼 클릭 처리
   */
  private handleButtonClick(type: HeaderButtonType): void {
    Logger.debug('HeaderRenderer: 버튼 클릭', { type });
    
    // 버튼 이벤트 발생
    this.notifyButtonListeners({
      type,
      data: { timestamp: Date.now() }
    });
  }
  
  // =============================================================================
  // 업데이트 메서드들
  // =============================================================================
  
  /**
   * 제목 업데이트
   */
  private updateTitle(): void {
    if (!this.titleElement) return;
    
    this.titleElement.textContent = this.getTitleText();
    
    Logger.debug('HeaderRenderer: 제목 업데이트');
  }
  
  /**
   * AI 버튼 업데이트
   */
  private updateAIButton(): void {
    if (!this.aiButtonElement) return;

    // 버튼 텍스트 업데이트
    const textElement = this.aiButtonElement.querySelector('.korean-grammar-popup-header-button-text');
    if (textElement) {
      textElement.textContent = this.isAiAnalyzing ? 'AI 분석 중...' : '🤖 AI 분석';
    }

    // 버튼 상태 업데이트
    if (this.isAiAnalyzing) {
      this.aiButtonElement.setAttribute('disabled', 'true');
      this.aiButtonElement.classList.add('kga-header-button-disabled');
      this.aiButtonElement.classList.remove('kga-header-button-enabled');
    } else {
      this.aiButtonElement.removeAttribute('disabled');
      this.aiButtonElement.classList.remove('kga-header-button-disabled');
      this.aiButtonElement.classList.add('kga-header-button-enabled');
    }

    // 아이콘 애니메이션 (분석 중일 때)
    const iconElement = this.aiButtonElement.querySelector('.korean-grammar-popup-header-button-icon');
    if (iconElement && iconElement instanceof HTMLElement) {
      if (this.isAiAnalyzing) {
        iconElement.classList.add('kga-spin');
      } else {
        iconElement.classList.remove('kga-spin');
      }
    }

    Logger.debug('HeaderRenderer: AI 버튼 업데이트', { isAnalyzing: this.isAiAnalyzing });
  }
  
  // =============================================================================
  // 텍스트 생성 메서드들
  // =============================================================================
  
  /**
   * 제목 텍스트 생성
   */
  private getTitleText(): string {
    if (!this.context) return '한국어 맞춤법 검사';
    
    const { state } = this.context;
    
    if (state.isLongText) {
      return `한국어 맞춤법 검사 (${state.currentPreviewPage + 1}/${state.totalPreviewPages})`;
    }
    
    return '한국어 맞춤법 검사';
  }
  
  /**
   * 페이지 정보 텍스트 생성
   */
  private getPageInfoText(): string {
    if (!this.context?.state.isLongText) return '';
    
    const { currentPreviewPage, totalPreviewPages } = this.context.state;
    return `${currentPreviewPage + 1} / ${totalPreviewPages}`;
  }
  
  // =============================================================================
  // 리사이즈 처리
  // =============================================================================
  
  /**
   * 리사이즈 처리
   */
  handleResize(): void {
    if (!this.containerElement) return;
    
    // 모바일에서는 제목 텍스트 축약
    if (Platform.isMobile && this.titleElement) {
      const containerWidth = this.containerElement.getBoundingClientRect().width;
      
      if (containerWidth < 400) {
        this.titleElement.textContent = '맞춤법 검사';
      } else {
        this.titleElement.textContent = this.getTitleText();
      }
    }
    
    Logger.debug('HeaderRenderer: 리사이즈 처리 완료');
  }
  
  // =============================================================================
  // 이벤트 관리
  // =============================================================================
  
  /**
   * 버튼 이벤트 리스너 추가
   */
  addButtonListener(listener: HeaderButtonListener): void {
    this.buttonListeners.add(listener);
    Logger.debug('HeaderRenderer: 버튼 리스너 추가', {
      listenerCount: this.buttonListeners.size
    });
  }
  
  /**
   * 버튼 이벤트 리스너 제거
   */
  removeButtonListener(listener: HeaderButtonListener): void {
    const removed = this.buttonListeners.delete(listener);
    Logger.debug('HeaderRenderer: 버튼 리스너 제거', {
      removed,
      listenerCount: this.buttonListeners.size
    });
  }
  
  /**
   * 버튼 리스너들에게 알림
   */
  private notifyButtonListeners(event: HeaderButtonEvent): void {
    for (const listener of this.buttonListeners) {
      try {
        listener(event);
      } catch (error) {
        Logger.error('HeaderRenderer: 버튼 리스너 실행 중 오류', { error, event });
      }
    }
  }
  
  // =============================================================================
  // 공개 API
  // =============================================================================
  
  /**
   * AI 분석 상태 설정
   */
  setAIAnalyzing(isAnalyzing: boolean): void {
    if (this.isAiAnalyzing !== isAnalyzing) {
      this.isAiAnalyzing = isAnalyzing;
      this.updateAIButton();
    }
  }
  
  /**
   * 토큰 정보 업데이트
   */
  updateTokenInfo(tokenCount: number, threshold: number): void {
    this.tokenCount = tokenCount;
    this.tokenThreshold = threshold;
    
    // AI 버튼 툴팁 업데이트
    if (this.aiButtonElement) {
      const tooltip = `AI를 활용한 자동 교정 분석 (예상 토큰: ${tokenCount}/${threshold})`;
      this.aiButtonElement.setAttribute('title', tooltip);
      this.aiButtonElement.setAttribute('aria-label', tooltip);
    }
  }
  
  /**
   * 버튼 활성화/비활성화
   */
  setButtonEnabled(type: HeaderButtonType, enabled: boolean): void {
    const button = this.getButtonElement(type);
    if (!button) return;

    if (enabled) {
      button.removeAttribute('disabled');
      button.classList.remove('kga-header-button-disabled');
      button.classList.add('kga-header-button-enabled');
    } else {
      button.setAttribute('disabled', 'true');
      button.classList.add('kga-header-button-disabled');
      button.classList.remove('kga-header-button-enabled');
    }

    Logger.debug('HeaderRenderer: 버튼 활성화 상태 변경', { type, enabled });
  }
  
  /**
   * 버튼 요소 조회
   */
  private getButtonElement(type: HeaderButtonType): HTMLElement | undefined {
    switch (type) {
      case 'ai-analyze':
        return this.aiButtonElement;
      case 'settings':
        return this.settingsButtonElement;
      case 'help':
        return this.helpButtonElement;
      case 'close':
        return this.closeButtonElement;
      default:
        return undefined;
    }
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      isInitialized: this.isInitialized,
      hasContainer: !!this.containerElement,
      isAiAnalyzing: this.isAiAnalyzing,
      tokenInfo: {
        count: this.tokenCount,
        threshold: this.tokenThreshold
      },
      elements: {
        title: !!this.titleElement,
        buttonContainer: !!this.buttonContainerElement,
        aiButton: !!this.aiButtonElement,
        settingsButton: !!this.settingsButtonElement,
        helpButton: !!this.helpButtonElement,
        closeButton: !!this.closeButtonElement
      },
      listenerCount: this.buttonListeners.size
    };
  }
}