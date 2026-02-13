/**
 * InteractionHandler.ts
 * 
 * Phase 7: UI 컴포넌트 및 렌더링 시스템
 * UI 상호작용 핸들러 - 실시간 UI 업데이트, 상태 동기화, 플랫폼별 최적화
 */

import { App } from 'obsidian';
import { PageCorrection, CorrectionState, RenderContext, EventContext } from '../../types/interfaces';
import { Logger } from '../../utils/logger';
import { ErrorRenderer } from './ErrorRenderer';

export interface InteractionConfig {
  enableAnimations: boolean;
  showTooltips: boolean;
  mobileOptimized: boolean;
  debounceMs: number;
  scrollBehavior: 'smooth' | 'instant' | 'auto';
}

export interface UIUpdateContext {
  correctionIndex: number;
  newState: CorrectionState;
  isActive: boolean;
  isFocused: boolean;
  shouldAnimate: boolean;
  trigger: 'user' | 'ai' | 'keyboard' | 'system';
}

export interface StateChangeEvent {
  type: 'state-change';
  correctionIndex: number;
  oldState: CorrectionState;
  newState: CorrectionState;
  trigger: string;
  timestamp: number;
}

export class InteractionHandler {
  private app: App;
  private errorRenderer: ErrorRenderer;
  private config: InteractionConfig;
  
  // 상태 관리
  private currentStates: Map<number, CorrectionState> = new Map();
  private activeIndex: number = -1;
  private focusedIndex: number = -1;
  
  // 이벤트 관리
  private stateChangeListeners: ((event: StateChangeEvent) => void)[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  
  // UI 요소 캐시
  private summaryElements: Map<number, HTMLElement> = new Map();
  private previewElements: Map<number, HTMLElement> = new Map();
  
  constructor(app: App, errorRenderer: ErrorRenderer, config: Partial<InteractionConfig> = {}) {
    this.app = app;
    this.errorRenderer = errorRenderer;
    this.config = {
      enableAnimations: true,
      showTooltips: true,
      mobileOptimized: false,
      debounceMs: 150,
      scrollBehavior: 'smooth',
      ...config
    };
    
    Logger.debug('InteractionHandler: 초기화 완료', { config: this.config });
  }

  /**
   * UI 상태 업데이트 처리
   */
  async handleStateChange(context: UIUpdateContext): Promise<void> {
    const { correctionIndex, newState, isActive, isFocused, shouldAnimate, trigger } = context;
    
    // 이전 상태 저장
    const oldState = this.currentStates.get(correctionIndex) || 'error';
    
    // 상태 변경 이벤트 발송
    this.emitStateChangeEvent({
      type: 'state-change',
      correctionIndex,
      oldState,
      newState,
      trigger,
      timestamp: Date.now()
    });

    // 디바운스 처리
    const debounceKey = `state-${correctionIndex}`;
    if (this.debounceTimers.has(debounceKey)) {
      clearTimeout(this.debounceTimers.get(debounceKey));
    }

    const timer = setTimeout(async () => {
      await this.performStateUpdate(context, oldState);
      this.debounceTimers.delete(debounceKey);
    }, this.config.debounceMs);

    this.debounceTimers.set(debounceKey, timer);
    
    // 즉시 상태 저장
    this.currentStates.set(correctionIndex, newState);
    
    Logger.debug('InteractionHandler: 상태 변경 요청', {
      index: correctionIndex,
      oldState,
      newState,
      trigger,
      isActive,
      isFocused
    });
  }

  /**
   * 실제 상태 업데이트 수행
   */
  private async performStateUpdate(context: UIUpdateContext, oldState: CorrectionState): Promise<void> {
    const { correctionIndex, newState, isActive, isFocused, shouldAnimate } = context;

    try {
      // 1. ErrorRenderer를 통한 하이라이트 업데이트
      this.errorRenderer.updateErrorState(correctionIndex, newState, isActive, isFocused);

      // 2. 요약 영역 업데이트
      await this.updateSummaryElement(correctionIndex, newState, isActive);

      // 3. 미리보기 영역 업데이트
      await this.updatePreviewElement(correctionIndex, newState);

      // 4. 포커스 관리
      if (isActive || isFocused) {
        this.setActiveIndex(correctionIndex);
      }
      if (isFocused) {
        this.setFocusedIndex(correctionIndex);
      }

      // 5. 애니메이션 적용
      if (shouldAnimate && this.config.enableAnimations) {
        await this.applyTransitionAnimation(correctionIndex, oldState, newState);
      }

      Logger.debug('InteractionHandler: 상태 업데이트 완료', {
        index: correctionIndex,
        newState,
        isActive,
        isFocused
      });

    } catch (error) {
      Logger.error('InteractionHandler: 상태 업데이트 실패', error);
    }
  }

  /**
   * 요약 영역 오류 카드 업데이트
   */
  private async updateSummaryElement(
    correctionIndex: number, 
    newState: CorrectionState, 
    isActive: boolean
  ): Promise<void> {
    const summaryElement = this.summaryElements.get(correctionIndex);
    if (!summaryElement) {
      Logger.warn(`InteractionHandler: 요약 요소를 찾을 수 없음 (${correctionIndex})`);
      return;
    }

    // 상태 표시 업데이트
    const stateIndicator = summaryElement.querySelector('.kga-error-state-indicator');
    if (stateIndicator) {
      stateIndicator.className = `kga-error-state-indicator state-${newState}`;
      stateIndicator.textContent = this.getStateDisplayText(newState);
    }

    // 활성화 상태 반영
    if (isActive) {
      summaryElement.classList.add('active');
    } else {
      summaryElement.classList.remove('active');
    }

    // 카드 색상 업데이트
    summaryElement.classList.remove('error', 'corrected', 'exception', 'kept', 'edited');
    summaryElement.classList.add(this.getStateClassName(newState));

    // ARIA 속성 업데이트
    summaryElement.setAttribute('aria-selected', isActive.toString());
    summaryElement.setAttribute('aria-label', this.generateSummaryAriaLabel(newState));
  }

  /**
   * 미리보기 영역 하이라이트 업데이트
   */
  private async updatePreviewElement(
    correctionIndex: number, 
    newState: CorrectionState
  ): Promise<void> {
    const previewElement = this.previewElements.get(correctionIndex);
    if (!previewElement) {
      // ErrorRenderer가 이미 처리했으므로 경고만 출력
      Logger.debug(`InteractionHandler: 미리보기 요소가 캐시에 없음 (${correctionIndex})`);
      return;
    }

    // 텍스트 색상 및 배경 업데이트 (ErrorRenderer와 동기화)
    previewElement.className = '';
    previewElement.classList.add('spell-error', `state-${newState}`);

    // 툴팁 업데이트 (데스크톱만)
    if (this.config.showTooltips && !this.config.mobileOptimized) {
      const existingTooltip = previewElement.querySelector('.error-tooltip');
      if (existingTooltip) {
        existingTooltip.remove();
      }
      
      // 새 툴팁은 호버 시 ErrorRenderer가 생성
    }
  }

  /**
   * 전환 애니메이션 적용
   */
  private async applyTransitionAnimation(
    correctionIndex: number, 
    oldState: CorrectionState, 
    newState: CorrectionState
  ): Promise<void> {
    const element = this.errorRenderer.getElement(correctionIndex);
    if (!element) return;

    // 애니메이션 클래스 추가
    element.classList.add('state-transition', `from-${oldState}`, `to-${newState}`);

    // 애니메이션 완료 대기
    return new Promise(resolve => {
      const handleAnimationEnd = () => {
        element.classList.remove('state-transition', `from-${oldState}`, `to-${newState}`);
        element.removeEventListener('animationend', handleAnimationEnd);
        resolve();
      };

      element.addEventListener('animationend', handleAnimationEnd);
      
      // 타임아웃으로 무한 대기 방지
      setTimeout(() => {
        element.removeEventListener('animationend', handleAnimationEnd);
        element.classList.remove('state-transition', `from-${oldState}`, `to-${newState}`);
        resolve();
      }, 1000);
    });
  }

  /**
   * 포커스 상태 업데이트
   */
  handleFocusChange(correctionIndex: number, isFocused: boolean): void {
    // 이전 포커스 해제
    if (this.focusedIndex !== -1 && this.focusedIndex !== correctionIndex) {
      this.errorRenderer.updateFocusState(this.focusedIndex, false);
    }

    // 새 포커스 설정
    this.errorRenderer.updateFocusState(correctionIndex, isFocused);
    
    if (isFocused) {
      this.focusedIndex = correctionIndex;
    } else if (this.focusedIndex === correctionIndex) {
      this.focusedIndex = -1;
    }

    Logger.debug('InteractionHandler: 포커스 변경', {
      index: correctionIndex,
      isFocused,
      previousFocus: this.focusedIndex
    });
  }

  /**
   * 활성 인덱스 설정
   */
  setActiveIndex(correctionIndex: number): void {
    this.activeIndex = correctionIndex;
  }

  /**
   * 포커스 인덱스 설정
   */
  setFocusedIndex(correctionIndex: number): void {
    this.focusedIndex = correctionIndex;
  }

  /**
   * 요약 요소 등록
   */
  registerSummaryElement(correctionIndex: number, element: HTMLElement): void {
    this.summaryElements.set(correctionIndex, element);
  }

  /**
   * 미리보기 요소 등록
   */
  registerPreviewElement(correctionIndex: number, element: HTMLElement): void {
    this.previewElements.set(correctionIndex, element);
  }

  /**
   * 상태 변경 리스너 등록
   */
  onStateChange(listener: (event: StateChangeEvent) => void): void {
    this.stateChangeListeners.push(listener);
  }

  /**
   * 상태 변경 이벤트 발송
   */
  private emitStateChangeEvent(event: StateChangeEvent): void {
    this.stateChangeListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        Logger.error('InteractionHandler: 상태 변경 리스너 오류', error);
      }
    });
  }

  /**
   * 전체 UI 새로고침
   */
  async refreshAllUI(corrections: PageCorrection[]): Promise<void> {
    Logger.debug('InteractionHandler: 전체 UI 새로고침 시작');

    for (const correction of corrections) {
      const currentState = this.currentStates.get(correction.originalIndex) || 'error';
      const isActive = this.activeIndex === correction.originalIndex;
      const isFocused = this.focusedIndex === correction.originalIndex;

      await this.handleStateChange({
        correctionIndex: correction.originalIndex,
        newState: currentState,
        isActive,
        isFocused,
        shouldAnimate: false,
        trigger: 'system'
      });
    }

    Logger.debug('InteractionHandler: 전체 UI 새로고침 완료');
  }

  /**
   * 상태별 표시 텍스트
   */
  private getStateDisplayText(state: CorrectionState): string {
    switch (state) {
      case 'error': return '오류';
      case 'corrected': return '수정됨';
      case 'exception-processed': return '예외처리';
      case 'original-kept': return '원본유지';
      case 'user-edited': return '사용자편집';
      default: return '알 수 없음';
    }
  }

  /**
   * 상태별 CSS 클래스명
   */
  private getStateClassName(state: CorrectionState): string {
    switch (state) {
      case 'error': return 'error';
      case 'corrected': return 'corrected';
      case 'exception-processed': return 'exception';
      case 'original-kept': return 'kept';
      case 'user-edited': return 'edited';
      default: return 'error';
    }
  }

  /**
   * 요약 영역 ARIA 레이블
   */
  private generateSummaryAriaLabel(state: CorrectionState): string {
    return `오류 카드, 상태: ${this.getStateDisplayText(state)}. 클릭하여 상태 변경 가능.`;
  }

  /**
   * 설정 업데이트
   */
  updateConfig(newConfig: Partial<InteractionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    Logger.debug('InteractionHandler: 설정 업데이트', this.config);
  }

  /**
   * 현재 상태 조회
   */
  getCurrentState(correctionIndex: number): CorrectionState | undefined {
    return this.currentStates.get(correctionIndex);
  }

  /**
   * 활성 인덱스 조회
   */
  getActiveIndex(): number {
    return this.activeIndex;
  }

  /**
   * 포커스 인덱스 조회
   */
  getFocusedIndex(): number {
    return this.focusedIndex;
  }

  /**
   * 모든 상태 조회
   */
  getAllStates(): Map<number, CorrectionState> {
    return new Map(this.currentStates);
  }

  /**
   * 통계 정보 조회
   */
  getStatistics(): {
    totalCorrections: number;
    stateDistribution: { [K in CorrectionState]: number };
    activeIndex: number;
    focusedIndex: number;
  } {
    const stateDistribution: { [K in CorrectionState]: number } = {
      'error': 0,
      'corrected': 0,
      'exception-processed': 0,
      'original-kept': 0,
      'user-edited': 0
    };

    this.currentStates.forEach(state => {
      stateDistribution[state]++;
    });

    return {
      totalCorrections: this.currentStates.size,
      stateDistribution,
      activeIndex: this.activeIndex,
      focusedIndex: this.focusedIndex
    };
  }

  /**
   * 특정 교정 제거
   */
  removeCorrection(correctionIndex: number): void {
    this.currentStates.delete(correctionIndex);
    this.summaryElements.delete(correctionIndex);
    this.previewElements.delete(correctionIndex);
    
    // 활성/포커스 인덱스 업데이트
    if (this.activeIndex === correctionIndex) {
      this.activeIndex = -1;
    }
    if (this.focusedIndex === correctionIndex) {
      this.focusedIndex = -1;
    }

    Logger.debug(`InteractionHandler: 교정 제거 (${correctionIndex})`);
  }

  /**
   * 모든 리소스 정리
   */
  dispose(): void {
    // 디바운스 타이머 정리
    this.debounceTimers.forEach(timer => clearTimeout(timer));
    this.debounceTimers.clear();

    // 상태 정리
    this.currentStates.clear();
    this.summaryElements.clear();
    this.previewElements.clear();
    this.stateChangeListeners.length = 0;

    // 인덱스 리셋
    this.activeIndex = -1;
    this.focusedIndex = -1;

    Logger.debug('InteractionHandler: 리소스 정리 완료');
  }
}