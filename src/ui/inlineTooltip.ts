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
      min-width: 250px;
      max-width: 450px;
      max-height: 300px;
      overflow-y: auto;
    `;

    // 병합된 오류인 경우 원본 오류별로 구분해서 표시
    if (error.isMerged && error.originalErrors && error.originalErrors.length > 0) {
      this.createMergedErrorTooltip(error, targetElement);
    } else {
      this.createSingleErrorTooltip(error, targetElement, triggerType);
    }

    document.body.appendChild(this.tooltip);
  }

  /**
   * 툴팁 위치 조정
   */
  private positionTooltip(targetElement: HTMLElement): void {
    if (!this.tooltip) return;

    const targetRect = targetElement.getBoundingClientRect();
    const tooltipRect = this.tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const gap = 8;
    const minSpacing = 12;
    
    let finalLeft = 0;
    let finalTop = 0;

    // 아래쪽에 표시하는 것을 기본으로 하되, 공간이 부족하면 위쪽으로
    if (targetRect.bottom + gap + tooltipRect.height <= viewportHeight - minSpacing) {
      // 아래쪽에 표시
      finalTop = targetRect.bottom + gap;
    } else {
      // 위쪽에 표시
      finalTop = targetRect.top - tooltipRect.height - gap;
    }

    // 가로 위치는 타겟 중앙 정렬
    finalLeft = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);

    // 경계 보정
    if (finalLeft < minSpacing) {
      finalLeft = minSpacing;
    } else if (finalLeft + tooltipRect.width > viewportWidth - minSpacing) {
      finalLeft = viewportWidth - tooltipRect.width - minSpacing;
    }

    if (finalTop < minSpacing) {
      finalTop = minSpacing;
    } else if (finalTop + tooltipRect.height > viewportHeight - minSpacing) {
      finalTop = viewportHeight - tooltipRect.height - minSpacing;
    }

    // 최종 위치 적용
    this.tooltip.style.position = 'fixed';
    this.tooltip.style.left = `${finalLeft}px`;
    this.tooltip.style.top = `${finalTop}px`;
    this.tooltip.style.zIndex = '1000';
    this.tooltip.style.visibility = 'visible';
  }

  /**
   * 병합된 오류용 툴팁 생성
   */
  private createMergedErrorTooltip(mergedError: InlineError, targetElement: HTMLElement): void {
    if (!this.tooltip || !mergedError.originalErrors) return;

    // 헤더 영역
    const header = this.tooltip.createEl('div', { cls: 'tooltip-header' });
    header.style.cssText = `
      padding: 8px 12px;
      border-bottom: 1px solid var(--background-modifier-border);
      background: var(--background-secondary);
      font-weight: 600;
      font-size: 12px;
      color: var(--text-muted);
      text-align: center;
    `;
    header.textContent = `${mergedError.originalErrors.length}개의 오류가 병합됨`;

    // 스크롤 가능한 내용 영역
    const scrollContainer = this.tooltip.createEl('div', { cls: 'tooltip-scroll-container' });
    scrollContainer.style.cssText = `
      flex: 1;
      overflow-y: auto;
      max-height: 250px;
    `;

    // 각 원본 오류별로 섹션 생성
    mergedError.originalErrors.forEach((originalError, index) => {
      const errorSection = scrollContainer.createEl('div', { cls: 'error-section' });
      errorSection.style.cssText = `
        padding: 8px 12px;
        ${index > 0 ? 'border-top: 1px solid var(--background-modifier-border-hover);' : ''}
      `;

      // 한 줄 레이아웃 (오류 → 제안들)
      const errorLine = errorSection.createEl('div', { cls: 'error-line' });
      errorLine.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: nowrap;
        min-height: 28px;
      `;

      // 오류 단어 표시 (고정 너비)
      const errorWord = errorLine.createEl('span', { 
        text: originalError.correction.original,
        cls: 'error-word'
      });
      errorWord.style.cssText = `
        color: var(--text-error);
        font-weight: 600;
        background: rgba(255, 0, 0, 0.1);
        padding: 3px 6px;
        border-radius: 3px;
        font-size: 12px;
        white-space: nowrap;
        flex-shrink: 0;
        min-width: 60px;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
      `;

      // 화살표 (고정)
      const arrow = errorLine.createEl('span', { text: '→' });
      arrow.style.cssText = `
        color: var(--text-muted);
        font-weight: bold;
        flex-shrink: 0;
      `;

      // 수정 제안들을 가로로 나열 (남은 공간 활용)
      const suggestionsList = errorLine.createEl('div', { cls: 'suggestions-list' });
      suggestionsList.style.cssText = `
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 1;
        flex-wrap: wrap;
        overflow: hidden;
      `;

      // 수정 제안 버튼들 (컴팩트하게)
      originalError.correction.corrected.forEach((suggestion) => {
        const suggestionButton = suggestionsList.createEl('button', {
          text: suggestion,
          cls: 'suggestion-button'
        });
        
        suggestionButton.style.cssText = `
          background: var(--interactive-normal);
          border: 1px solid var(--background-modifier-border);
          border-radius: 3px;
          padding: 2px 6px;
          cursor: pointer;
          transition: all 0.2s;
          color: var(--text-normal);
          font-size: 11px;
          white-space: nowrap;
          flex-shrink: 0;
          max-width: 100px;
          overflow: hidden;
          text-overflow: ellipsis;
        `;

        // 호버 효과
        suggestionButton.addEventListener('mouseenter', () => {
          suggestionButton.style.background = 'var(--interactive-hover)';
          suggestionButton.style.transform = 'translateY(-1px)';
        });

        suggestionButton.addEventListener('mouseleave', () => {
          suggestionButton.style.background = 'var(--interactive-normal)';
          suggestionButton.style.transform = 'translateY(0)';
        });

        // 개별 클릭 이벤트 (병합된 오류에서 해당 원본 오류만 적용)
        suggestionButton.addEventListener('click', (e) => {
          e.stopPropagation();
          // 클릭 후 툴팁 유지하기 위해 applySuggestion 수정
          this.applySuggestionKeepOpen(mergedError, suggestion, targetElement);
        });
      });

      // 도움말 아이콘 추가 (원본 오류에 도움말이 있는 경우)
      if (originalError.correction.help) {
        const helpContainer = errorLine.createEl('div', { cls: 'help-container' });
        helpContainer.style.cssText = `
          display: flex;
          align-items: center;
          margin-left: 4px;
          flex-shrink: 0;
        `;
        this.createHelpIcon(originalError.correction.help, helpContainer);
      }
    });

    // 하단 액션 영역
    const footer = this.tooltip.createEl('div', { cls: 'tooltip-footer' });
    footer.style.cssText = `
      padding: 6px 12px;
      border-top: 1px solid var(--background-modifier-border);
      background: var(--background-secondary);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    `;

    // 정보 텍스트
    const infoText = footer.createEl('span', {
      text: '개별 클릭으로 하나씩 수정',
      cls: 'info-text'
    });
    infoText.style.cssText = `
      font-size: 10px;
      color: var(--text-muted);
      flex: 1;
    `;

    // 닫기 버튼
    const closeButton = footer.createEl('button', {
      text: '닫기',
      cls: 'close-button'
    });
    closeButton.style.cssText = `
      background: var(--interactive-normal);
      color: var(--text-normal);
      border: 1px solid var(--background-modifier-border);
      border-radius: 3px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 10px;
      transition: all 0.2s;
    `;

    closeButton.addEventListener('mouseenter', () => {
      closeButton.style.background = 'var(--interactive-hover)';
    });

    closeButton.addEventListener('mouseleave', () => {
      closeButton.style.background = 'var(--interactive-normal)';
    });

    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });

    // 호버 상태 관리 (병합된 오류용)
    this.setupHoverEvents(targetElement);
  }

  /**
   * 호버 이벤트 설정 (공통)
   */
  private setupHoverEvents(targetElement: HTMLElement): void {
    let hideTimeout: NodeJS.Timeout | undefined;
    let isHovering = false;
    
    const startHideTimer = () => {
      hideTimeout = setTimeout(() => {
        if (!isHovering) {
          this.hide();
        }
      }, 300); // 300ms로 줄여서 더 빠른 반응
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
    this.tooltip?.addEventListener('mouseenter', onTooltipMouseEnter);
    this.tooltip?.addEventListener('mouseleave', onTooltipMouseLeave);

    // 정리 함수 저장 (나중에 제거용)
    (this.tooltip as any)._cleanup = () => {
      targetElement.removeEventListener('mouseenter', onTargetMouseEnter);
      targetElement.removeEventListener('mouseleave', onTargetMouseLeave);
      this.tooltip?.removeEventListener('mouseenter', onTooltipMouseEnter);
      this.tooltip?.removeEventListener('mouseleave', onTooltipMouseLeave);
      if (hideTimeout) clearTimeout(hideTimeout);
    };
  }

  /**
   * 단일 오류용 툴팁 생성 (기존 로직 유지)
   */
  private createSingleErrorTooltip(error: InlineError, targetElement: HTMLElement, triggerType: 'hover' | 'click'): void {
    if (!this.tooltip) return;

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
      flex-wrap: wrap;
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
      gap: 6px;
    `;

    // 도움말 아이콘 (간소화)
    if (error.correction.help) {
      this.createHelpIcon(error.correction.help, actionsContainer);
    }

    // 클릭 모드가 아닌 경우 마우스 떠나면 자동 숨김 (개선된 로직)
    if (triggerType === 'hover') {
      this.setupHoverEvents(targetElement);
    } else {
      // 클릭 모드에서는 바깥 클릭으로 닫기
      setTimeout(() => {
        document.addEventListener('click', this.handleOutsideClick.bind(this), { once: true });
      }, 0);
    }
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
   * 수정 제안 적용 (클릭 후 툴팁 유지)
   */
  private applySuggestionKeepOpen(mergedError: InlineError, suggestion: string, targetElement: HTMLElement): void {
    Logger.log(`인라인 모드: 수정 제안 적용 (클릭 후 툴팁 유지) - "${mergedError.correction.original}" → "${suggestion}"`);
    
    // 툴팁 유지 모드 플래그 설정
    (window as any).tooltipKeepOpenMode = true;
    
    // 여기서 실제 텍스트 교체 로직 구현
    // EditorView를 통해 텍스트 교체
    if ((window as any).InlineModeService) {
      (window as any).InlineModeService.applySuggestion(mergedError, suggestion);
    }
    
    // 툴팁 유지 모드 해제 (약간의 지연 후)
    setTimeout(() => {
      (window as any).tooltipKeepOpenMode = false;
    }, 200);
    
    // 툴팁 상태 유지 (현재 오류 정보 업데이트는 InlineModeService에서 처리)
    Logger.debug('툴팁 유지 모드로 교정 적용 완료');
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

  /**
   * 도움말 상세 표시
   */
  private showHelpDetail(helpText: string, helpIcon: HTMLElement): void {
    // 새로운 도움말 툴팁 생성
    const helpTooltip = document.createElement('div');
    helpTooltip.className = 'korean-grammar-help-tooltip';
    helpTooltip.style.cssText = `
      position: fixed;
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 6px;
      padding: 0;
      box-shadow: var(--shadow-s);
      z-index: 1001;
      font-size: 13px;
      color: var(--text-normal);
      display: flex;
      flex-direction: column;
      min-width: 250px;
      max-width: 400px;
      max-height: 300px;
    `;

    // 도움말 헤더
    const helpHeader = helpTooltip.createEl('div', { cls: 'help-header' });
    helpHeader.style.cssText = `
      padding: 8px 12px;
      border-bottom: 1px solid var(--background-modifier-border);
      background: var(--background-secondary);
      font-weight: 600;
      font-size: 12px;
      color: var(--text-muted);
      text-align: center;
    `;
    helpHeader.textContent = '📖 문법 도움말';

    // 도움말 내용
    const helpContent = helpTooltip.createEl('div', { cls: 'help-content' });
    helpContent.style.cssText = `
      padding: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 13px;
      color: var(--text-normal);
      line-height: 1.4;
      overflow-y: auto;
      flex: 1;
    `;
    helpContent.textContent = helpText;

    // 하단 버튼 영역
    const buttonArea = helpTooltip.createEl('div', { cls: 'help-buttons' });
    buttonArea.style.cssText = `
      padding: 8px 12px;
      border-top: 1px solid var(--background-modifier-border);
      background: var(--background-secondary);
      display: flex;
      justify-content: center;
    `;

    // 닫기 버튼
    const closeButton = buttonArea.createEl('button', {
      text: '확인',
      cls: 'help-close-button'
    });
    closeButton.style.cssText = `
      background: var(--interactive-accent);
      color: var(--text-on-accent);
      border: none;
      border-radius: 4px;
      padding: 6px 16px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.2s;
    `;

    closeButton.addEventListener('mouseenter', () => {
      closeButton.style.background = 'var(--interactive-accent-hover)';
    });

    closeButton.addEventListener('mouseleave', () => {
      closeButton.style.background = 'var(--interactive-accent)';
    });

    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (helpTooltip.parentNode) {
        helpTooltip.parentNode.removeChild(helpTooltip);
      }
    });

    // 바깥 클릭으로 닫기
    const handleOutsideClick = (event: MouseEvent) => {
      if (helpTooltip && !helpTooltip.contains(event.target as Node)) {
        if (helpTooltip.parentNode) {
          helpTooltip.parentNode.removeChild(helpTooltip);
        }
        document.removeEventListener('click', handleOutsideClick);
      }
    };

    document.body.appendChild(helpTooltip);
    
    // 위치 조정
    const helpIconRect = helpIcon.getBoundingClientRect();
    const tooltipRect = helpTooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let left = helpIconRect.left + helpIconRect.width / 2 - tooltipRect.width / 2;
    let top = helpIconRect.bottom + 8;
    
    // 경계 체크
    if (left < 12) left = 12;
    if (left + tooltipRect.width > viewportWidth - 12) {
      left = viewportWidth - tooltipRect.width - 12;
    }
    if (top + tooltipRect.height > viewportHeight - 12) {
      top = helpIconRect.top - tooltipRect.height - 8;
    }
    
    helpTooltip.style.left = `${left}px`;
    helpTooltip.style.top = `${top}px`;

    // 짧은 지연 후 바깥 클릭 이벤트 등록
    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
    }, 100);

    Logger.debug(`도움말 표시: "${helpText.substring(0, 50)}..."`);
  }

  /**
   * 도움말 아이콘 생성 (공통)
   */
  private createHelpIcon(helpText: string, container: HTMLElement): void {
    if (!helpText) return;

    const helpIcon = container.createEl('span', { text: '?' });
    helpIcon.style.cssText = `
      color: var(--text-muted);
      cursor: pointer;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--text-muted);
      border-radius: 50%;
      font-size: 10px;
      font-weight: bold;
      transition: all 0.2s;
      background: var(--background-primary);
      flex-shrink: 0;
    `;
    helpIcon.title = helpText;

    // 호버 효과
    helpIcon.addEventListener('mouseenter', () => {
      helpIcon.style.background = 'var(--interactive-hover)';
      helpIcon.style.borderColor = 'var(--text-normal)';
      helpIcon.style.color = 'var(--text-normal)';
      helpIcon.style.transform = 'scale(1.1)';
    });

    helpIcon.addEventListener('mouseleave', () => {
      helpIcon.style.background = 'var(--background-primary)';
      helpIcon.style.borderColor = 'var(--text-muted)';
      helpIcon.style.color = 'var(--text-muted)';
      helpIcon.style.transform = 'scale(1)';
    });

    // 클릭 이벤트 - 도움말 상세 표시
    helpIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showHelpDetail(helpText, helpIcon);
    });
  }
}

/**
 * 전역 툴팁 인스턴스
 */
export const globalInlineTooltip = new InlineTooltip();

// Window 객체에 노출 (InlineModeService에서 접근하기 위해)
(window as any).globalInlineTooltip = globalInlineTooltip;