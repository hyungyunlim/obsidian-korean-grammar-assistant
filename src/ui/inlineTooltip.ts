import { InlineError } from '../types/interfaces';
import { Logger } from '../utils/logger';

/**
 * 인라인 오류 툴팁 클래스
 * 호버/클릭 시 수정 제안을 표시하는 툴팁
 */
export class InlineTooltip {
  private tooltip: HTMLElement | null = null;
  private currentError: InlineError | null = null;
  private isVisible: boolean = false;

  /**
   * 툴팁 표시
   */
  show(error: InlineError, targetElement: HTMLElement, triggerType: 'hover' | 'click'): void {
    // 같은 오류에 대한 툴팁이 이미 표시 중이면 무시
    if (this.isVisible && this.currentError?.uniqueId === error.uniqueId) {
      Logger.debug(`인라인 툴팁 이미 표시 중: ${error.correction.original}`);
      return;
    }
    
    this.hide(); // 기존 툴팁 제거
    
    this.currentError = error;
    this.createTooltip(error, targetElement, triggerType);
    this.positionTooltip(targetElement);
    this.isVisible = true;

    Logger.debug(`인라인 툴팁 표시: ${error.correction.original} (${triggerType})`);
  }

  /**
   * 툴팁 숨김
   */
  hide(): void {
    if (this.tooltip) {
      try {
        // 정리 함수 호출 (이벤트 리스너 제거)
        if ((this.tooltip as any)._cleanup) {
          (this.tooltip as any)._cleanup();
        }
        
        // DOM에서 완전 제거
        if (this.tooltip.parentNode) {
          this.tooltip.parentNode.removeChild(this.tooltip);
        } else {
          this.tooltip.remove();
        }
        
        Logger.debug('인라인 툴팁 숨김 완료');
      } catch (err) {
        Logger.warn('툴팁 제거 중 오류:', err);
      } finally {
        // 상태 완전 초기화
        this.tooltip = null;
        this.currentError = null;
        this.isVisible = false;
      }
    }
  }

  /**
   * 툴팁이 표시 중인지 확인
   */
  get visible(): boolean {
    return this.isVisible;
  }

  /**
   * 툴팁 생성
   */
  private createTooltip(error: InlineError, targetElement: HTMLElement, triggerType: 'hover' | 'click'): void {
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'korean-grammar-inline-tooltip';
    
    // 툴팁 전체 컨테이너 (세로 레이아웃)
    this.tooltip.style.cssText = `
      position: absolute;
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 6px;
      padding: 0;
      box-shadow: var(--shadow-s);
      z-index: 1000;
      font-size: 13px;
      color: var(--text-normal);
      display: flex;
      flex-direction: column;
      min-width: 200px;
      max-width: 400px;
    `;

    // 상단 메인 콘텐츠 영역 (가로 레이아웃)
    const mainContent = this.tooltip.createEl('div', { cls: 'tooltip-main-content' });
    mainContent.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      white-space: nowrap;
    `;

    // 오류 단어 표시 (간소화)
    const errorWord = mainContent.createEl('span', { 
      text: error.correction.original,
      cls: 'error-word'
    });
    errorWord.style.cssText = `
      color: var(--text-error);
      font-weight: 600;
      background: rgba(255, 0, 0, 0.1);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
    `;

    // 화살표
    const arrow = mainContent.createEl('span', { text: '→' });
    arrow.style.cssText = `
      color: var(--text-muted);
      font-weight: bold;
    `;

    // 수정 제안들을 가로로 나열
    const suggestionsList = mainContent.createEl('div', { cls: 'suggestions-list' });
    suggestionsList.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
    `;

    // 수정 제안 버튼들 (컴팩트하게)
    error.correction.corrected.forEach((suggestion, index) => {
      const suggestionButton = suggestionsList.createEl('button', {
        text: suggestion,
        cls: 'suggestion-button'
      });
      
      suggestionButton.style.cssText = `
        background: var(--interactive-normal);
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        padding: 4px 8px;
        cursor: pointer;
        transition: all 0.2s;
        color: var(--text-normal);
        font-size: 12px;
        white-space: nowrap;
      `;

      // 호버 효과 (키보드 하이라이트보다 우선)
      suggestionButton.addEventListener('mouseenter', () => {
        suggestionButton.style.background = 'var(--interactive-hover) !important';
        suggestionButton.style.color = 'var(--text-normal) !important';
        suggestionButton.style.transform = 'translateY(-1px)';
        suggestionButton.style.border = '1px solid var(--background-modifier-border) !important';
        suggestionButton.setAttribute('data-hovered', 'true');
      });

      suggestionButton.addEventListener('mouseleave', () => {
        suggestionButton.removeAttribute('data-hovered');
        suggestionButton.style.transform = 'translateY(0)';
        // 키보드 하이라이트 상태 복원
        if ((window as any).InlineModeService) {
          (window as any).InlineModeService.updateTooltipHighlight();
        }
      });

      // 클릭 이벤트
      suggestionButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.applySuggestion(error, suggestion, targetElement);
      });
    });

    // 액션 영역 (적절한 간격) - 메인 콘텐츠 내부로 이동
    const actionsContainer = mainContent.createEl('div', { cls: 'actions-container' });
    actionsContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: 8px;
      opacity: 0.6;
    `;

    // 체크 아이콘 (오류 인지하고 표시 없애기) - 미니멀 스타일
    const checkIcon = actionsContainer.createEl('span', {
      text: '✓',
      cls: 'check-icon'
    });
    
    checkIcon.style.cssText = `
      color: var(--text-success);
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      padding: 2px;
      border-radius: 3px;
      user-select: none;
    `;

    checkIcon.addEventListener('mouseenter', () => {
      checkIcon.style.backgroundColor = 'var(--background-modifier-hover)';
      checkIcon.style.transform = 'scale(1.1)';
      checkIcon.style.opacity = '1';
    });

    checkIcon.addEventListener('mouseleave', () => {
      checkIcon.style.backgroundColor = 'transparent';
      checkIcon.style.transform = 'scale(1)';
      checkIcon.style.opacity = '0.8';
    });

    checkIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ignoreError(error, targetElement);
    });

    // 닫기 아이콘 (툴팁 닫기) - 미니멀 스타일
    const closeIcon = actionsContainer.createEl('span', {
      text: '×',
      cls: 'close-icon'
    });
    
    closeIcon.style.cssText = `
      color: var(--text-muted);
      font-size: 20px;
      font-weight: 400;
      cursor: pointer;
      transition: all 0.2s ease;
      padding: 2px;
      border-radius: 3px;
      user-select: none;
      line-height: 1;
    `;

    closeIcon.addEventListener('mouseenter', () => {
      closeIcon.style.backgroundColor = 'var(--background-modifier-hover)';
      closeIcon.style.color = 'var(--text-normal)';
      closeIcon.style.transform = 'scale(1.1)';
    });

    closeIcon.addEventListener('mouseleave', () => {
      closeIcon.style.backgroundColor = 'transparent';
      closeIcon.style.color = 'var(--text-muted)';
      closeIcon.style.transform = 'scale(1)';
    });

    closeIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });

    // 이유 표시 영역 추가 (하단에 작은 글씨로) - 툴팁 하단 별도 영역
    const reasonArea = this.tooltip.createEl('div', { cls: 'tooltip-reason-area' });
    reasonArea.style.cssText = `
      padding: 6px 12px;
      border-top: 1px solid var(--background-modifier-border);
      font-size: 10px;
      color: var(--text-muted);
      line-height: 1.3;
      opacity: 0.8;
      background: var(--background-secondary);
      border-radius: 0 0 6px 6px;
      text-align: center;
    `;

    // 간단한 오류 이유 생성
    const reason = this.generateErrorReason(error);
    reasonArea.textContent = reason;

    // 임시로 화면 밖에 추가하여 크기 측정
    this.tooltip.style.position = 'fixed';
    this.tooltip.style.left = '-9999px';
    this.tooltip.style.top = '-9999px';
    this.tooltip.style.visibility = 'hidden';
    document.body.appendChild(this.tooltip);

    // 클릭 모드가 아닌 경우 마우스 떠나면 자동 숨김 (개선된 로직)
    if (triggerType === 'hover') {
      let hideTimeout: NodeJS.Timeout | undefined;
      let isHovering = false;
      
      const startHideTimer = () => {
        hideTimeout = setTimeout(() => {
          if (!isHovering) {
            this.hide();
          }
        }, 500); // 500ms 지연으로 툴팁 사용 시간 확보
      };

      const cancelHideTimer = () => {
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = undefined;
        }
      };

      const onTargetMouseEnter = () => {
        isHovering = true;
        cancelHideTimer();
      };

      const onTargetMouseLeave = () => {
        isHovering = false;
        startHideTimer();
      };

      const onTooltipMouseEnter = () => {
        isHovering = true;
        cancelHideTimer();
      };

      const onTooltipMouseLeave = () => {
        isHovering = false;
        startHideTimer();
      };

      // 이벤트 리스너 등록
      targetElement.addEventListener('mouseenter', onTargetMouseEnter);
      targetElement.addEventListener('mouseleave', onTargetMouseLeave);
      this.tooltip.addEventListener('mouseenter', onTooltipMouseEnter);
      this.tooltip.addEventListener('mouseleave', onTooltipMouseLeave);

      // 정리 함수 저장 (나중에 제거용)
      (this.tooltip as any)._cleanup = () => {
        targetElement.removeEventListener('mouseenter', onTargetMouseEnter);
        targetElement.removeEventListener('mouseleave', onTargetMouseLeave);
        this.tooltip?.removeEventListener('mouseenter', onTooltipMouseEnter);
        this.tooltip?.removeEventListener('mouseleave', onTooltipMouseLeave);
        if (hideTimeout) clearTimeout(hideTimeout);
      };
    } else {
      // 클릭 모드에서는 바깥 클릭으로 닫기
      setTimeout(() => {
        document.addEventListener('click', this.handleOutsideClick.bind(this), { once: true });
      }, 0);
    }
  }

  /**
   * 툴팁 위치 조정 (Obsidian API 참고 개선 버전)
   */
  private positionTooltip(targetElement: HTMLElement): void {
    if (!this.tooltip) return;

    // DOM에 먼저 추가되어야 정확한 크기를 측정할 수 있음
    if (!this.tooltip.parentNode) {
      document.body.appendChild(this.tooltip);
    }

    const targetRect = targetElement.getBoundingClientRect();
    const tooltipRect = this.tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Obsidian API 스타일 위치 계산
    const gap = 8; // TooltipOptions.gap 기본값
    const minSpacing = 12; // 화면 가장자리 최소 여백
    
    let finalLeft = 0;
    let finalTop = 0;
    let selectedPlacement: 'bottom' | 'top' | 'right' | 'left' = 'bottom';

    // 1. 각 방향별 사용 가능 공간 계산
    const spaces = {
      bottom: viewportHeight - targetRect.bottom - gap,
      top: targetRect.top - gap,
      right: viewportWidth - targetRect.right - gap,
      left: targetRect.left - gap
    };

    // 2. 각 방향별 배치 가능성 체크 및 위치 계산
    const placements = [
      {
        name: 'bottom' as const,
        available: spaces.bottom >= tooltipRect.height,
        left: targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2),
        top: targetRect.bottom + gap
      },
      {
        name: 'top' as const,
        available: spaces.top >= tooltipRect.height,
        left: targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2),
        top: targetRect.top - tooltipRect.height - gap
      },
      {
        name: 'right' as const,
        available: spaces.right >= tooltipRect.width,
        left: targetRect.right + gap,
        top: targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2)
      },
      {
        name: 'left' as const,
        available: spaces.left >= tooltipRect.width,
        left: targetRect.left - tooltipRect.width - gap,
        top: targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2)
      }
    ];

    // 3. 사용 가능한 첫 번째 방향 선택 (우선순위: bottom > top > right > left)
    const availablePlacement = placements.find(p => p.available);
    
    if (availablePlacement) {
      selectedPlacement = availablePlacement.name;
      finalLeft = availablePlacement.left;
      finalTop = availablePlacement.top;
    } else {
      // 4. 모든 방향이 부족한 경우: 가장 큰 공간에 강제 배치
      const maxSpaceEntry = Object.entries(spaces).reduce((max, [key, value]) => 
        value > max.value ? { key: key as keyof typeof spaces, value } : max
      , { key: 'bottom' as keyof typeof spaces, value: spaces.bottom });
      
      const forcedPlacement = placements.find(p => p.name === maxSpaceEntry.key);
      if (forcedPlacement) {
        selectedPlacement = forcedPlacement.name;
        finalLeft = forcedPlacement.left;
        finalTop = forcedPlacement.top;
      }
    }

    // 5. 경계 보정 (Obsidian API 스타일)
    // 수평 위치 보정
    if (selectedPlacement === 'bottom' || selectedPlacement === 'top') {
      // 중앙 정렬 시 화면 밖으로 나가지 않도록 조정
      if (finalLeft < minSpacing) {
        finalLeft = minSpacing;
      } else if (finalLeft + tooltipRect.width > viewportWidth - minSpacing) {
        finalLeft = viewportWidth - tooltipRect.width - minSpacing;
      }
    }
    
    // 수직 위치 보정
    if (selectedPlacement === 'left' || selectedPlacement === 'right') {
      // 중앙 정렬 시 화면 밖으로 나가지 않도록 조정
      if (finalTop < minSpacing) {
        finalTop = minSpacing;
      } else if (finalTop + tooltipRect.height > viewportHeight - minSpacing) {
        finalTop = viewportHeight - tooltipRect.height - minSpacing;
      }
    }

    // 6. 절대적 경계 체크 (최후 보정)
    finalLeft = Math.max(minSpacing, Math.min(finalLeft, viewportWidth - tooltipRect.width - minSpacing));
    finalTop = Math.max(minSpacing, Math.min(finalTop, viewportHeight - tooltipRect.height - minSpacing));

    // 7. 최종 위치 적용
    this.tooltip.style.position = 'fixed';
    this.tooltip.style.left = `${finalLeft}px`;
    this.tooltip.style.top = `${finalTop}px`;
    this.tooltip.style.zIndex = '1000';
    this.tooltip.style.visibility = 'visible';

    // 8. 디버깅 정보
    Logger.debug(`툴팁 위치 계산 (Obsidian 스타일): placement=${selectedPlacement}, left=${finalLeft}, top=${finalTop}`);
    Logger.debug(`타겟 위치: (${targetRect.left}, ${targetRect.top}, ${targetRect.width}x${targetRect.height})`);
    Logger.debug(`툴팁 크기: ${tooltipRect.width}x${tooltipRect.height}, 뷰포트: ${viewportWidth}x${viewportHeight}`);
    Logger.debug(`공간 분석: bottom=${spaces.bottom}, top=${spaces.top}, right=${spaces.right}, left=${spaces.left}`);
  }

  /**
   * 수정 제안 적용
   */
  private applySuggestion(error: InlineError, suggestion: string, targetElement: HTMLElement): void {
    Logger.log(`인라인 모드: 수정 제안 적용 - "${error.correction.original}" → "${suggestion}"`);
    
    // 여기서 실제 텍스트 교체 로직 구현
    // EditorView를 통해 텍스트 교체
    if ((window as any).InlineModeService) {
      (window as any).InlineModeService.applySuggestion(error, suggestion);
    }
    
    this.hide();
  }

  /**
   * 오류 무시
   */
  private ignoreError(error: InlineError, targetElement: HTMLElement): void {
    Logger.log(`인라인 모드: 오류 무시 - "${error.correction.original}"`);
    
    // 해당 오류 제거
    if ((window as any).InlineModeService) {
      (window as any).InlineModeService.removeError(null, error.uniqueId);
    }
    
    this.hide();
  }

  /**
   * 바깥 클릭 처리
   */
  private handleOutsideClick(event: MouseEvent): void {
    if (this.tooltip && !this.tooltip.contains(event.target as Node)) {
      this.hide();
    }
  }

  /**
   * 오류 이유 생성
   */
  private generateErrorReason(error: InlineError): string {
    const original = error.correction.original;
    const corrected = error.correction.corrected;
    
    // 기본적인 오류 유형 분석
    if (corrected.length === 0) {
      return "수정 제안이 없는 오류입니다";
    }
    
    // 띄어쓰기 오류
    if (original.includes(' ') !== corrected[0].includes(' ')) {
      return "띄어쓰기 오류";
    }
    
    // 맞춤법 오류 (글자 수 비슷한 경우)
    if (Math.abs(original.length - corrected[0].length) <= 2) {
      return "맞춤법 오류";
    }
    
    // 문법 오류 (길이 차이가 큰 경우)
    if (original.length !== corrected[0].length) {
      return "문법 오류";
    }
    
    // 기타
    return "언어 표현 개선";
  }
}

/**
 * 전역 툴팁 인스턴스
 */
export const globalInlineTooltip = new InlineTooltip();

// Window 객체에 노출 (InlineModeService에서 접근하기 위해)
(window as any).globalInlineTooltip = globalInlineTooltip;