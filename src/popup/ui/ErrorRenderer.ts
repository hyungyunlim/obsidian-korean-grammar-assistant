/**
 * ErrorRenderer.ts
 * 
 * Phase 7: UI 컴포넌트 및 렌더링 시스템
 * 오류 표시 전용 렌더러 - 오류 하이라이트, 상태 표시, 시각적 피드백 담당
 */

import { App } from 'obsidian';
import { PageCorrection, CorrectionState, RenderContext } from '../../types/interfaces';
import { Logger } from '../../utils/logger';
import { createEl } from '../../utils/domUtils';

export interface ErrorRenderOptions {
  showTooltips: boolean;
  enableHover: boolean;
  mobileOptimized: boolean;
  animationEnabled: boolean;
  colorScheme: 'auto' | 'light' | 'dark';
}

export interface ErrorElementData {
  correctionIndex: number;
  originalText: string;
  state: CorrectionState;
  isActive: boolean;
  isFocused: boolean;
}

export class ErrorRenderer {
  private app: App;
  private renderOptions: ErrorRenderOptions;
  private activeElements: Map<number, HTMLElement> = new Map();
  private tooltipCache: Map<string, HTMLElement> = new Map();
  private animationTimeouts: Map<number, NodeJS.Timeout> = new Map();

  constructor(app: App, options: Partial<ErrorRenderOptions> = {}) {
    this.app = app;
    this.renderOptions = {
      showTooltips: true,
      enableHover: true,
      mobileOptimized: false,
      animationEnabled: true,
      colorScheme: 'auto',
      ...options
    };
    
    Logger.debug('ErrorRenderer: 초기화 완료', { options: this.renderOptions });
  }

  /**
   * 오류 하이라이트 요소 생성
   */
  createErrorHighlight(
    correction: PageCorrection, 
    context: RenderContext
  ): HTMLElement {
    const { state, isActive, isFocused } = context;
    
    const errorSpan = createEl('span', {
      cls: this.getErrorClasses(state, isActive, isFocused),
      attr: {
        'data-correction-index': correction.originalIndex.toString(),
        'data-error-state': state,
        'data-original-text': correction.correction.original,
        'data-page-index': correction.pageIndex?.toString() || '0',
        'role': 'button',
        'tabindex': this.renderOptions.mobileOptimized ? '-1' : '0',
        'aria-label': this.generateAriaLabel(correction, state)
      }
    });

    // 텍스트 내용 설정
    this.setErrorText(errorSpan, correction, state);
    
    // 이벤트 데이터 설정
    this.setElementData(errorSpan, {
      correctionIndex: correction.originalIndex,
      originalText: correction.correction.original,
      state,
      isActive,
      isFocused
    });

    // 활성 요소 캐시에 추가
    this.activeElements.set(correction.originalIndex, errorSpan);

    // 애니메이션 적용
    if (this.renderOptions.animationEnabled && isActive) {
      this.applyFocusAnimation(errorSpan, correction.originalIndex);
    }

    Logger.debug(`ErrorRenderer: 오류 하이라이트 생성`, {
      index: correction.originalIndex,
      state,
      isActive,
      classes: errorSpan.className
    });

    return errorSpan;
  }

  /**
   * 오류 상태에 따른 CSS 클래스 생성
   */
  private getErrorClasses(
    state: CorrectionState, 
    isActive: boolean, 
    isFocused: boolean
  ): string {
    const classes = ['spell-error'];
    
    // 상태별 클래스
    switch (state) {
      case 'error':
        classes.push('error-state');
        break;
      case 'corrected':
        classes.push('corrected-state');
        break;
      case 'exception-processed':
        classes.push('exception-state');
        break;
      case 'original-kept':
        classes.push('kept-state');
        break;
      case 'user-edited':
        classes.push('edited-state');
        break;
    }

    // 활성화 상태
    if (isActive) {
      classes.push('active');
    }
    if (isFocused) {
      classes.push('focused');
    }

    // 플랫폼별 클래스
    if (this.renderOptions.mobileOptimized) {
      classes.push('mobile-optimized');
    }

    // 호버 지원
    if (this.renderOptions.enableHover && !this.renderOptions.mobileOptimized) {
      classes.push('hover-enabled');
    }

    return classes.join(' ');
  }

  /**
   * 상태에 따른 오류 텍스트 설정
   */
  private setErrorText(
    element: HTMLElement, 
    correction: PageCorrection, 
    state: CorrectionState
  ): void {
    let displayText: string;
    
    switch (state) {
      case 'error':
        displayText = correction.correction.original;
        break;
      case 'corrected':
        displayText = (correction.correction.suggestions && correction.correction.suggestions.length > 0) 
          ? correction.correction.suggestions[0].value 
          : correction.correction.original;
        break;
      case 'exception-processed':
        displayText = correction.correction.original;
        break;
      case 'original-kept':
        displayText = correction.correction.original;
        break;
      case 'user-edited':
        // 사용자 편집값이 있다면 그것을 사용, 없으면 원본
        displayText = correction.correction.userEditedValue || correction.correction.original;
        break;
      default:
        displayText = correction.correction.original;
    }

    element.textContent = displayText;
  }

  /**
   * 접근성을 위한 ARIA 레이블 생성
   */
  private generateAriaLabel(correction: PageCorrection, state: CorrectionState): string {
    const original = correction.correction.original;
    const suggestions = correction.correction.suggestions;
    
    switch (state) {
      case 'error':
        return `맞춤법 오류: ${original}. ${suggestions?.length || 0}개의 수정 제안이 있습니다.`;
      case 'corrected':
        const corrected = (suggestions && suggestions.length > 0) ? suggestions[0].value : original;
        return `수정됨: ${original} → ${corrected}`;
      case 'exception-processed':
        return `예외 처리됨: ${original}. 향후 검사에서 제외됩니다.`;
      case 'original-kept':
        return `원본 유지: ${original}. 이번에만 유지됩니다.`;
      case 'user-edited':
        const edited = correction.correction.userEditedValue || original;
        return `사용자 편집: ${original} → ${edited}`;
      default:
        return `오류: ${original}`;
    }
  }

  /**
   * 요소에 데이터 설정
   */
  private setElementData(element: HTMLElement, data: ErrorElementData): void {
    // 커스텀 프로퍼티로 데이터 저장 (이벤트 핸들러에서 사용)
    (element as any).__errorData = data;
  }

  /**
   * 포커스 애니메이션 적용
   */
  private applyFocusAnimation(element: HTMLElement, correctionIndex: number): void {
    // 기존 애니메이션 타이머 정리
    const existingTimeout = this.animationTimeouts.get(correctionIndex);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // 애니메이션 클래스 추가
    element.classList.add('focus-animation');
    
    // 애니메이션 종료 후 클래스 제거
    const timeout = setTimeout(() => {
      element.classList.remove('focus-animation');
      this.animationTimeouts.delete(correctionIndex);
    }, 600); // CSS 애니메이션 지속시간과 일치

    this.animationTimeouts.set(correctionIndex, timeout);
  }

  /**
   * 오류 상태 업데이트
   */
  updateErrorState(
    correctionIndex: number, 
    newState: CorrectionState, 
    isActive: boolean = false,
    isFocused: boolean = false
  ): void {
    const element = this.activeElements.get(correctionIndex);
    if (!element) {
      Logger.warn(`ErrorRenderer: 인덱스 ${correctionIndex}에 해당하는 요소를 찾을 수 없음`);
      return;
    }

    // 클래스 업데이트
    element.className = '';
    element.classList.add(...this.getErrorClasses(newState, isActive, isFocused).split(' '));

    // 속성 업데이트
    element.setAttribute('data-error-state', newState);
    
    // 데이터 업데이트
    const currentData = (element as any).__errorData as ErrorElementData;
    if (currentData) {
      currentData.state = newState;
      currentData.isActive = isActive;
      currentData.isFocused = isFocused;
    }

    // 애니메이션 적용
    if (this.renderOptions.animationEnabled && (isActive || isFocused)) {
      this.applyFocusAnimation(element, correctionIndex);
    }

    Logger.debug(`ErrorRenderer: 오류 상태 업데이트`, {
      index: correctionIndex,
      newState,
      isActive,
      isFocused
    });
  }

  /**
   * 포커스 상태 업데이트
   */
  updateFocusState(correctionIndex: number, isFocused: boolean): void {
    const element = this.activeElements.get(correctionIndex);
    if (!element) return;

    if (isFocused) {
      element.classList.add('focused');
      element.setAttribute('aria-selected', 'true');
      
      // 스크롤하여 보이게 하기
      this.scrollIntoViewIfNeeded(element);
      
      // 포커스 애니메이션
      if (this.renderOptions.animationEnabled) {
        this.applyFocusAnimation(element, correctionIndex);
      }
    } else {
      element.classList.remove('focused');
      element.setAttribute('aria-selected', 'false');
    }

    // 데이터 업데이트
    const currentData = (element as any).__errorData as ErrorElementData;
    if (currentData) {
      currentData.isFocused = isFocused;
    }
  }

  /**
   * 요소가 보이도록 스크롤
   */
  private scrollIntoViewIfNeeded(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const container = element.closest('.spell-popup-content');
    
    if (container) {
      const containerRect = container.getBoundingClientRect();
      
      // 요소가 컨테이너 밖에 있으면 스크롤
      if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
        element.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'nearest'
        });
      }
    }
  }

  /**
   * 툴팁 생성 (데스크톱 전용)
   */
  createTooltip(correction: PageCorrection, state: CorrectionState): HTMLElement | null {
    if (this.renderOptions.mobileOptimized || !this.renderOptions.showTooltips) {
      return null;
    }

    const tooltipKey = `${correction.originalIndex}-${state}`;
    
    // 캐시된 툴팁이 있으면 재사용
    if (this.tooltipCache.has(tooltipKey)) {
      return this.tooltipCache.get(tooltipKey)!;
    }

    const tooltip = createEl('div', {
      cls: 'error-tooltip',
      attr: {
        'role': 'tooltip',
        'aria-hidden': 'true'
      }
    });

    // 툴팁 내용 생성
    this.populateTooltipContent(tooltip, correction, state);

    // 캐시에 저장
    this.tooltipCache.set(tooltipKey, tooltip);

    return tooltip;
  }

  /**
   * 툴팁 내용 채우기
   */
  private populateTooltipContent(
    tooltip: HTMLElement, 
    correction: PageCorrection, 
    state: CorrectionState
  ): void {
    const { original, suggestions, help } = correction.correction;

    // 제목
    const title = createEl('div', { cls: 'tooltip-title' });
    title.textContent = this.getTooltipTitle(state);
    tooltip.appendChild(title);

    // 원본 텍스트
    const originalDiv = createEl('div', { cls: 'tooltip-original' });
    originalDiv.textContent = `원본: ${original}`;
    tooltip.appendChild(originalDiv);

    // 상태별 추가 정보
    if (state === 'error' && suggestions && suggestions.length > 0) {
      const suggestionsDiv = createEl('div', { cls: 'tooltip-suggestions' });
      suggestionsDiv.textContent = `제안: ${suggestions.map(s => s.value).join(', ')}`;
      tooltip.appendChild(suggestionsDiv);
    }

    // 도움말
    if (help) {
      const helpDiv = createEl('div', { cls: 'tooltip-help' });
      helpDiv.textContent = help;
      tooltip.appendChild(helpDiv);
    }

    // 단축키 힌트 (데스크톱만)
    if (!this.renderOptions.mobileOptimized) {
      const shortcutDiv = createEl('div', { cls: 'tooltip-shortcuts' });
      shortcutDiv.textContent = 'Tab: 다음 오류, ←/→: 제안 변경, Enter: 적용';
      tooltip.appendChild(shortcutDiv);
    }
  }

  /**
   * 상태별 툴팁 제목
   */
  private getTooltipTitle(state: CorrectionState): string {
    switch (state) {
      case 'error': return '맞춤법 오류';
      case 'corrected': return '수정됨';
      case 'exception-processed': return '예외 처리됨';
      case 'original-kept': return '원본 유지';
      case 'user-edited': return '사용자 편집';
      default: return '오류';
    }
  }

  /**
   * 렌더링 옵션 업데이트
   */
  updateRenderOptions(options: Partial<ErrorRenderOptions>): void {
    this.renderOptions = { ...this.renderOptions, ...options };
    
    // 모든 활성 요소에 새 옵션 적용
    this.activeElements.forEach((element, index) => {
      const data = (element as any).__errorData as ErrorElementData;
      if (data) {
        element.className = '';
        element.classList.add(...this.getErrorClasses(data.state, data.isActive, data.isFocused).split(' '));
      }
    });

    Logger.debug('ErrorRenderer: 렌더링 옵션 업데이트', this.renderOptions);
  }

  /**
   * 특정 오류 요소 제거
   */
  removeErrorElement(correctionIndex: number): void {
    const element = this.activeElements.get(correctionIndex);
    if (element) {
      // 애니메이션 타이머 정리
      const timeout = this.animationTimeouts.get(correctionIndex);
      if (timeout) {
        clearTimeout(timeout);
        this.animationTimeouts.delete(correctionIndex);
      }

      // 요소 제거
      element.remove();
      this.activeElements.delete(correctionIndex);

      Logger.debug(`ErrorRenderer: 오류 요소 제거`, { index: correctionIndex });
    }
  }

  /**
   * 모든 리소스 정리
   */
  dispose(): void {
    // 모든 애니메이션 타이머 정리
    this.animationTimeouts.forEach(timeout => clearTimeout(timeout));
    this.animationTimeouts.clear();

    // 활성 요소 정리
    this.activeElements.clear();

    // 툴팁 캐시 정리
    this.tooltipCache.clear();

    Logger.debug('ErrorRenderer: 리소스 정리 완료');
  }

  /**
   * 현재 활성 요소 수 반환
   */
  getActiveElementCount(): number {
    return this.activeElements.size;
  }

  /**
   * 특정 인덱스의 요소 반환
   */
  getElement(correctionIndex: number): HTMLElement | undefined {
    return this.activeElements.get(correctionIndex);
  }

  /**
   * 모든 활성 요소의 인덱스 반환
   */
  getActiveIndices(): number[] {
    return Array.from(this.activeElements.keys());
  }
}