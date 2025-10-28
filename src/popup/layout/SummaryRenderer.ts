/**
 * 오류 요약 렌더러
 * 팝업 오류 요약 영역(오류 카드, 상태 표시)을 관리
 */

import { Platform } from 'obsidian';
import { RenderContext, IPopupComponent, PopupState } from '../types/PopupTypes';
import { Correction, PageCorrection, AIAnalysisResult } from '../../types/interfaces';
import { Logger } from '../../utils/logger';
import { setIcon } from 'obsidian';
import { createEl } from '../../utils/domUtils';
import { escapeHtml } from '../../utils/htmlUtils';

/**
 * 오류 카드 액션 타입
 */
export type ErrorCardAction = 
  | 'toggle-correction'
  | 'edit-original' 
  | 'apply-suggestion'
  | 'ignore-error'
  | 'show-help';

/**
 * 오류 카드 이벤트 타입
 */
export type ErrorCardEvent = {
  action: ErrorCardAction;
  correctionIndex: number;
  correction: Correction;
  data?: any;
};

export type ErrorCardListener = (event: ErrorCardEvent) => void;

/**
 * 요약 토글 이벤트 타입
 */
export type SummaryToggleEvent = {
  isExpanded: boolean;
};

export type SummaryToggleListener = (event: SummaryToggleEvent) => void;

/**
 * 오류 요약 렌더러 클래스
 */
export class SummaryRenderer implements IPopupComponent {
  private context?: RenderContext;
  private containerElement?: HTMLElement;
  
  // 하위 요소들
  private headerElement?: HTMLElement;
  private toggleButtonElement?: HTMLElement;
  private contentElement?: HTMLElement;
  private errorListElement?: HTMLElement;
  private statsElement?: HTMLElement;
  
  // 상태 관리
  private isInitialized: boolean = false;
  private isExpanded: boolean = true;
  private currentCorrections: PageCorrection[] = [];
  private aiAnalysisResults: AIAnalysisResult[] = [];
  
  // 이벤트 관리
  private errorCardListeners: Set<ErrorCardListener> = new Set();
  private summaryToggleListeners: Set<SummaryToggleListener> = new Set();
  
  constructor() {
    Logger.log('SummaryRenderer: 초기화 완료');
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
      this.isExpanded = context.state.isErrorSummaryExpanded;
      this.isInitialized = true;
      
      Logger.log('SummaryRenderer: 초기화 완료');
      
    } catch (error) {
      Logger.error('SummaryRenderer: 초기화 중 오류', error);
      throw error;
    }
  }
  
  /**
   * 오류 요약 영역 렌더링
   */
  render(): HTMLElement {
    if (!this.context) {
      throw new Error('SummaryRenderer: 초기화되지 않은 상태에서 render 호출');
    }
    
    try {
      // 요약 컨테이너 생성
      this.containerElement = this.createSummaryContainer();
      
      // 헤더 렌더링
      this.renderHeader();
      
      // 콘텐츠 렌더링
      this.renderContent();
      
      // 초기 확장/축소 상태 적용
      this.updateExpandedState();
      
      Logger.debug('SummaryRenderer: 렌더링 완료');
      
      return this.containerElement;
      
    } catch (error) {
      Logger.error('SummaryRenderer: 렌더링 중 오류', error);
      throw error;
    }
  }
  
  /**
   * 컴포넌트 업데이트
   */
  update(state: Partial<PopupState>): void {
    if (!this.isInitialized || !this.context) {
      Logger.warn('SummaryRenderer: 초기화되지 않은 상태에서 update 호출');
      return;
    }
    
    try {
      // 컨텍스트 상태 업데이트
      this.context.state = { ...this.context.state, ...state };
      
      // 확장/축소 상태 변경 처리
      if (state.isErrorSummaryExpanded !== undefined) {
        this.isExpanded = state.isErrorSummaryExpanded;
        this.updateExpandedState();
        this.updateToggleButton();
      }
      
      // AI 분석 상태 변경 처리
      if (state.isAiAnalyzing !== undefined) {
        this.updateStats();
      }
      
      // 페이지 변경 처리 (오류 목록 업데이트)
      if (state.currentPreviewPage !== undefined) {
        this.updateErrorList();
      }
      
      Logger.debug('SummaryRenderer: 업데이트 완료', { updatedFields: Object.keys(state) });
      
    } catch (error) {
      Logger.error('SummaryRenderer: 업데이트 중 오류', error);
    }
  }
  
  /**
   * 컴포넌트 정리
   */
  dispose(): void {
    try {
      // 이벤트 리스너 정리
      this.errorCardListeners.clear();
      this.summaryToggleListeners.clear();
      
      // DOM 요소 정리
      if (this.containerElement) {
        this.containerElement.remove();
        this.containerElement = undefined;
      }
      
      this.headerElement = undefined;
      this.toggleButtonElement = undefined;
      this.contentElement = undefined;
      this.errorListElement = undefined;
      this.statsElement = undefined;
      
      // 상태 초기화
      this.currentCorrections = [];
      this.aiAnalysisResults = [];
      
      this.isInitialized = false;
      this.context = undefined;
      
      Logger.log('SummaryRenderer: 정리 완료');
      
    } catch (error) {
      Logger.error('SummaryRenderer: 정리 중 오류', error);
    }
  }
  
  /**
   * 가시성 확인
   */
  isVisible(): boolean {
    return this.isInitialized && !!this.containerElement && this.containerElement.isConnected;
  }
  
  // =============================================================================
  // 요약 구조 생성
  // =============================================================================
  
  /**
   * 요약 컨테이너 생성
   */
  private createSummaryContainer(): HTMLElement {
    const container = createEl('div', {
      cls: 'korean-grammar-popup-summary-container'
    });

    return container;
  }
  
  /**
   * 헤더 렌더링
   */
  private renderHeader(): void {
    if (!this.containerElement) return;

    // 헤더 요소 생성
    this.headerElement = createEl('div', {
      cls: 'korean-grammar-popup-summary-header',
      parent: this.containerElement
    });

    // 헤더 클릭 이벤트 (토글)
    this.headerElement.addEventListener('click', () => {
      this.toggleExpanded();
    });

    // 제목 및 통계 정보
    const titleContainer = createEl('div', {
      cls: 'korean-grammar-popup-summary-title-container',
      parent: this.headerElement
    });

    // 아이콘
    const iconElement = createEl('div', {
      cls: 'korean-grammar-popup-summary-icon',
      parent: titleContainer
    });

    setIcon(iconElement, 'list');

    // 제목
    createEl('div', {
      cls: 'korean-grammar-popup-summary-title',
      text: '오류 요약',
      parent: titleContainer
    });

    // 통계 정보
    this.statsElement = createEl('span', {
      cls: 'korean-grammar-popup-summary-stats',
      parent: titleContainer
    });

    // 토글 버튼
    this.renderToggleButton();

    // 초기 통계 업데이트
    this.updateStats();
  }
  
  /**
   * 토글 버튼 렌더링
   */
  private renderToggleButton(): void {
    if (!this.headerElement) return;

    this.toggleButtonElement = createEl('button', {
      cls: 'korean-grammar-popup-summary-toggle',
      parent: this.headerElement
    });

    // 토글 버튼 클릭 이벤트
    this.toggleButtonElement.addEventListener('click', (e) => {
      e.stopPropagation(); // 헤더 클릭 이벤트 방지
      this.toggleExpanded();
    });

    // 초기 토글 버튼 업데이트
    this.updateToggleButton();
  }
  
  /**
   * 콘텐츠 렌더링
   */
  private renderContent(): void {
    if (!this.containerElement) return;

    // 콘텐츠 영역 생성
    const classes = ['korean-grammar-popup-summary-content'];
    if (Platform.isMobile) {
      classes.push('kga-mobile');
    }

    this.contentElement = createEl('div', {
      cls: classes,
      parent: this.containerElement
    });

    // 오류 목록 렌더링
    this.renderErrorList();
  }
  
  /**
   * 오류 목록 렌더링
   */
  private renderErrorList(): void {
    if (!this.contentElement) return;

    // 오류 목록 컨테이너 생성
    this.errorListElement = createEl('div', {
      cls: 'korean-grammar-popup-summary-error-list',
      parent: this.contentElement
    });

    // 초기 오류 목록 업데이트
    this.updateErrorList();
  }
  
  // =============================================================================
  // 오류 카드 생성
  // =============================================================================
  
  /**
   * 오류 카드 생성
   */
  private createErrorCard(correction: Correction, index: number, aiResult?: AIAnalysisResult): HTMLElement {
    const card = createEl('div', {
      cls: 'korean-grammar-popup-summary-error-card'
    });

    // 카드 헤더
    const cardHeader = this.createErrorCardHeader(correction, index, aiResult);
    card.appendChild(cardHeader);

    // 카드 콘텐츠
    const cardContent = this.createErrorCardContent(correction, index, aiResult);
    card.appendChild(cardContent);

    // 카드 액션
    const cardActions = this.createErrorCardActions(correction, index);
    card.appendChild(cardActions);

    return card;
  }
  
  /**
   * 오류 카드 헤더 생성
   */
  private createErrorCardHeader(correction: Correction, index: number, aiResult?: AIAnalysisResult): HTMLElement {
    const header = createEl('div', {
      cls: 'korean-grammar-popup-summary-error-card-header'
    });

    // 원본 텍스트
    createEl('span', {
      cls: 'korean-grammar-popup-summary-error-original',
      text: correction.original,
      parent: header
    });

    // 상태 배지
    const statusBadge = this.createStatusBadge(correction, aiResult);
    header.appendChild(statusBadge);

    return header;
  }
  
  /**
   * 상태 배지 생성
   */
  private createStatusBadge(correction: Correction, aiResult?: AIAnalysisResult): HTMLElement {
    const classes = ['korean-grammar-popup-summary-error-status-badge'];
    let badgeText = '오류';

    // AI 결과가 있는 경우 상태 업데이트
    if (aiResult) {
      badgeText = `AI 분석 (${aiResult.confidence}%)`;
      classes.push('kga-ai-analyzed');
    }

    const badge = createEl('span', {
      cls: classes,
      text: badgeText
    });

    return badge;
  }
  
  /**
   * 오류 카드 콘텐츠 생성
   */
  private createErrorCardContent(correction: Correction, index: number, aiResult?: AIAnalysisResult): HTMLElement {
    const content = createEl('div', {
      cls: 'korean-grammar-popup-summary-error-card-content'
    });

    // 수정 제안 목록
    if (correction.corrected && correction.corrected.length > 0) {
      const suggestionsContainer = createEl('div', {
        cls: 'korean-grammar-popup-summary-error-suggestions',
        parent: content
      });

      createEl('div', {
        cls: 'korean-grammar-popup-summary-error-suggestions-label',
        text: '수정 제안:',
        parent: suggestionsContainer
      });

      const suggestionsList = createEl('div', {
        cls: 'korean-grammar-popup-summary-error-suggestions-list',
        parent: suggestionsContainer
      });

      // 각 수정 제안 렌더링
      correction.corrected.forEach((suggestion, suggestionIndex) => {
        const isSelected = aiResult?.selectedValue === suggestion;
        const classes = ['korean-grammar-popup-summary-error-suggestion'];
        if (isSelected) {
          classes.push('kga-selected');
        }

        const suggestionElement = createEl('span', {
          cls: classes,
          text: suggestion,
          parent: suggestionsList
        });

        // 클릭 이벤트
        suggestionElement.addEventListener('click', () => {
          this.handleErrorCardAction('apply-suggestion', index, correction, {
            suggestion,
            suggestionIndex
          });
        });
      });
    }

    // 도움말 텍스트
    if (correction.help) {
      createEl('div', {
        cls: 'korean-grammar-popup-summary-error-help',
        text: correction.help,
        parent: content
      });
    }

    // AI 분석 결과 (있는 경우)
    if (aiResult && aiResult.reasoning) {
      createEl('div', {
        cls: 'korean-grammar-popup-summary-error-ai-reasoning',
        text: `AI 분석: ${aiResult.reasoning}`,
        parent: content
      });
    }

    return content;
  }
  
  /**
   * 오류 카드 액션 생성
   */
  private createErrorCardActions(correction: Correction, index: number): HTMLElement {
    const actions = createEl('div', {
      cls: 'korean-grammar-popup-summary-error-card-actions'
    });

    // 편집 버튼
    const editButton = this.createActionButton('edit', '편집', () => {
      this.handleErrorCardAction('edit-original', index, correction);
    });
    actions.appendChild(editButton);

    // 무시 버튼
    const ignoreButton = this.createActionButton('ignore', '무시', () => {
      this.handleErrorCardAction('ignore-error', index, correction);
    });
    actions.appendChild(ignoreButton);

    // 도움말 버튼
    if (correction.help) {
      const helpButton = this.createActionButton('help', '?', () => {
        this.handleErrorCardAction('show-help', index, correction);
      });
      actions.appendChild(helpButton);
    }

    return actions;
  }
  
  /**
   * 액션 버튼 생성
   */
  private createActionButton(type: string, text: string, onClick: () => void): HTMLElement {
    const button = createEl('button', {
      cls: [`korean-grammar-popup-summary-error-action-button`, `korean-grammar-popup-summary-error-action-button-${type}`],
      text
    });

    // 클릭 이벤트
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });

    return button;
  }
  
  // =============================================================================
  // 업데이트 메서드들
  // =============================================================================
  
  /**
   * 확장/축소 상태 업데이트
   */
  private updateExpandedState(): void {
    if (!this.containerElement || !this.contentElement) return;

    if (this.isExpanded) {
      this.contentElement.classList.remove('kga-collapsed');
    } else {
      this.contentElement.classList.add('kga-collapsed');
    }

    Logger.debug('SummaryRenderer: 확장 상태 업데이트', { isExpanded: this.isExpanded });
  }
  
  /**
   * 토글 버튼 업데이트
   */
  private updateToggleButton(): void {
    if (!this.toggleButtonElement) return;

    // 토글 버튼 아이콘 업데이트
    const iconName = this.isExpanded ? 'chevron-up' : 'chevron-down';
    this.toggleButtonElement.empty();

    const iconElement = createEl('div', {
      cls: 'korean-grammar-popup-summary-toggle-icon',
      parent: this.toggleButtonElement
    });

    setIcon(iconElement, iconName);

    // 툴팁 업데이트
    const tooltip = this.isExpanded ? '오류 요약 접기' : '오류 요약 펼치기';
    this.toggleButtonElement.setAttribute('title', tooltip);
    this.toggleButtonElement.setAttribute('aria-label', tooltip);
  }
  
  /**
   * 통계 정보 업데이트
   */
  private updateStats(): void {
    if (!this.statsElement || !this.context) return;
    
    const totalErrors = this.currentCorrections.length;
    const aiAnalyzedCount = this.aiAnalysisResults.length;
    
    let statsText = `${totalErrors}개 오류`;
    
    if (aiAnalyzedCount > 0) {
      statsText += ` (AI 분석: ${aiAnalyzedCount}개)`;
    }
    
    if (this.context.state.isAiAnalyzing) {
      statsText += ' - 분석 중...';
    }
    
    this.statsElement.textContent = statsText;
    
    Logger.debug('SummaryRenderer: 통계 업데이트', { totalErrors, aiAnalyzedCount });
  }
  
  /**
   * 오류 목록 업데이트
   */
  private updateErrorList(): void {
    if (!this.errorListElement) return;

    // 기존 오류 카드들 제거
    this.errorListElement.empty();

    if (this.currentCorrections.length === 0) {
      // 오류가 없는 경우 플레이스홀더 표시
      createEl('div', {
        cls: 'korean-grammar-popup-summary-no-errors',
        text: '현재 페이지에 오류가 없습니다.',
        parent: this.errorListElement
      });

      return;
    }

    // 오류 카드들 렌더링
    this.currentCorrections.forEach((correction, index) => {
      // AI 분석 결과 찾기
      const aiResult = this.aiAnalysisResults.find(result =>
        result.correctionIndex === index
      );

      const errorCard = this.createErrorCard(correction.correction, index, aiResult);
      this.errorListElement!.appendChild(errorCard);
    });

    Logger.debug('SummaryRenderer: 오류 목록 업데이트 완료', {
      correctionCount: this.currentCorrections.length
    });
  }
  
  // =============================================================================
  // 이벤트 처리
  // =============================================================================
  
  /**
   * 확장/축소 토글
   */
  private toggleExpanded(): void {
    this.isExpanded = !this.isExpanded;
    this.updateExpandedState();
    this.updateToggleButton();
    
    // 토글 이벤트 발생
    this.notifySummaryToggleListeners({
      isExpanded: this.isExpanded
    });
    
    Logger.debug('SummaryRenderer: 확장 상태 토글', { isExpanded: this.isExpanded });
  }
  
  /**
   * 오류 카드 액션 처리
   */
  private handleErrorCardAction(action: ErrorCardAction, index: number, correction: Correction, data?: any): void {
    Logger.debug('SummaryRenderer: 오류 카드 액션', { action, index });
    
    // 오류 카드 이벤트 발생
    this.notifyErrorCardListeners({
      action,
      correctionIndex: index,
      correction,
      data
    });
  }
  
  // =============================================================================
  // 리사이즈 처리
  // =============================================================================
  
  /**
   * 리사이즈 처리
   */
  handleResize(): void {
    if (!this.contentElement) return;

    // 모바일에서 최대 높이 조정
    // CSS 변수 사용으로 인라인 스타일 제거
    if (Platform.isMobile) {
      const windowHeight = window.innerHeight;
      const maxHeight = Math.min(200, Math.floor(windowHeight * 0.3));
      this.contentElement.style.setProperty('--summary-content-max-height', `${maxHeight}px`);
    }

    Logger.debug('SummaryRenderer: 리사이즈 처리 완료');
  }
  
  // =============================================================================
  // 이벤트 관리
  // =============================================================================
  
  /**
   * 오류 카드 리스너 추가
   */
  addErrorCardListener(listener: ErrorCardListener): void {
    this.errorCardListeners.add(listener);
    Logger.debug('SummaryRenderer: 오류 카드 리스너 추가', {
      listenerCount: this.errorCardListeners.size
    });
  }
  
  /**
   * 오류 카드 리스너 제거
   */
  removeErrorCardListener(listener: ErrorCardListener): void {
    const removed = this.errorCardListeners.delete(listener);
    Logger.debug('SummaryRenderer: 오류 카드 리스너 제거', {
      removed,
      listenerCount: this.errorCardListeners.size
    });
  }
  
  /**
   * 요약 토글 리스너 추가
   */
  addSummaryToggleListener(listener: SummaryToggleListener): void {
    this.summaryToggleListeners.add(listener);
    Logger.debug('SummaryRenderer: 요약 토글 리스너 추가', {
      listenerCount: this.summaryToggleListeners.size
    });
  }
  
  /**
   * 요약 토글 리스너 제거
   */
  removeSummaryToggleListener(listener: SummaryToggleListener): void {
    const removed = this.summaryToggleListeners.delete(listener);
    Logger.debug('SummaryRenderer: 요약 토글 리스너 제거', {
      removed,
      listenerCount: this.summaryToggleListeners.size
    });
  }
  
  /**
   * 오류 카드 리스너들에게 알림
   */
  private notifyErrorCardListeners(event: ErrorCardEvent): void {
    for (const listener of this.errorCardListeners) {
      try {
        listener(event);
      } catch (error) {
        Logger.error('SummaryRenderer: 오류 카드 리스너 실행 중 오류', { error, event });
      }
    }
  }
  
  /**
   * 요약 토글 리스너들에게 알림
   */
  private notifySummaryToggleListeners(event: SummaryToggleEvent): void {
    for (const listener of this.summaryToggleListeners) {
      try {
        listener(event);
      } catch (error) {
        Logger.error('SummaryRenderer: 요약 토글 리스너 실행 중 오류', { error, event });
      }
    }
  }
  
  // =============================================================================
  // 공개 API
  // =============================================================================
  
  /**
   * 교정 목록 설정
   */
  setCorrections(corrections: PageCorrection[]): void {
    this.currentCorrections = [...corrections];
    this.updateErrorList();
    this.updateStats();
    
    Logger.debug('SummaryRenderer: 교정 목록 설정 완료', { correctionCount: corrections.length });
  }
  
  /**
   * AI 분석 결과 설정
   */
  setAIAnalysisResults(results: AIAnalysisResult[]): void {
    this.aiAnalysisResults = [...results];
    this.updateErrorList();
    this.updateStats();
    
    Logger.debug('SummaryRenderer: AI 분석 결과 설정 완료', { resultCount: results.length });
  }
  
  /**
   * 확장 상태 설정
   */
  setExpanded(expanded: boolean): void {
    if (this.isExpanded !== expanded) {
      this.isExpanded = expanded;
      this.updateExpandedState();
      this.updateToggleButton();
    }
  }
  
  /**
   * 확장 상태 조회
   */
  getExpanded(): boolean {
    return this.isExpanded;
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      isInitialized: this.isInitialized,
      hasContainer: !!this.containerElement,
      isExpanded: this.isExpanded,
      correctionCount: this.currentCorrections.length,
      aiResultCount: this.aiAnalysisResults.length,
      elements: {
        header: !!this.headerElement,
        toggleButton: !!this.toggleButtonElement,
        content: !!this.contentElement,
        errorList: !!this.errorListElement,
        stats: !!this.statsElement
      },
      listeners: {
        errorCard: this.errorCardListeners.size,
        summaryToggle: this.summaryToggleListeners.size
      }
    };
  }
}