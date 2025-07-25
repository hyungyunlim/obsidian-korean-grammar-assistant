import { InlineError } from '../types/interfaces';
import { Logger } from '../utils/logger';
import { Platform, MarkdownView } from 'obsidian';
import { InlineModeService } from '../services/inlineModeService';

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
  show(error: InlineError, targetElement: HTMLElement, triggerType: 'hover' | 'click', mousePosition?: { x: number; y: number }): void {
    // 같은 오류에 대한 툴팁이 이미 표시 중이면 무시
    if (this.isVisible && this.currentError?.uniqueId === error.uniqueId) {
      Logger.debug(`인라인 툴팁 이미 표시 중: ${error.correction.original}`);
      return;
    }
    
    this.hide(); // 기존 툴팁 제거
    
    this.currentError = error;
    this.createTooltip(error, targetElement, triggerType);
    this.positionTooltip(targetElement, mousePosition);
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
    
    const isMobile = Platform.isMobile;
    
    // 툴팁 전체 컨테이너 (세로 레이아웃) - 모바일 최적화
    this.tooltip.style.cssText = `
      position: absolute;
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: ${isMobile ? '12px' : '6px'};
      padding: 0;
      box-shadow: ${isMobile ? '0 8px 32px rgba(0, 0, 0, 0.3)' : 'var(--shadow-s)'};
      z-index: 1000;
      font-size: ${isMobile ? '14px' : '13px'};
      color: var(--text-normal);
      display: flex;
      flex-direction: column;
      ${isMobile ? 'width: 320px;' : 'min-width: 250px; max-width: 450px;'}
      ${isMobile ? 'max-height: 200px;' : 'max-height: 300px;'}
      overflow-y: auto;
      ${isMobile ? 'touch-action: manipulation;' : ''}
    `;

    // 모바일에서 터치 이벤트 방지 (툴팁 자체 클릭 시 닫히지 않도록)
    if (isMobile) {
      this.tooltip.addEventListener('touchstart', (e) => {
        e.stopPropagation();
      }, { passive: true });
      
      this.tooltip.addEventListener('touchend', (e) => {
        e.stopPropagation();
      }, { passive: true });
    }

    // 병합된 오류인 경우 원본 오류별로 구분해서 표시
    if (error.isMerged && error.originalErrors && error.originalErrors.length > 0) {
      this.createMergedErrorTooltip(error, targetElement);
    } else {
      this.createSingleErrorTooltip(error, targetElement, triggerType);
    }

    document.body.appendChild(this.tooltip);
    
    // 모바일에서 툴팁 표시 로그
    if (isMobile) {
      Logger.log(`📱 모바일 툴팁 생성: ${error.correction.original} (${triggerType})`);
    }
  }

  /**
   * 툴팁 위치 조정 (Obsidian API 기반 고급 처리)
   */
  private positionTooltip(targetElement: HTMLElement, mousePosition?: { x: number; y: number }): void {
    if (!this.tooltip) return;

    const targetRect = targetElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const isMobile = Platform.isMobile;
    const isPhone = (Platform as any).isPhone || (viewportWidth <= 480);
    const isTablet = (Platform as any).isTablet || (viewportWidth <= 768 && viewportWidth > 480);
    
    // 🔧 Obsidian App 정보 활용
    const app = (window as any).app;
    let editorScrollInfo = null;
    let editorContainerRect = null;
    
    if (app && app.workspace) {
      try {
        // 현재 활성 뷰 가져오기
        const activeView = app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.editor) {
          // 에디터 스크롤 정보
          editorScrollInfo = activeView.editor.getScrollInfo();
          // 에디터 컨테이너 정보
          if (activeView.containerEl) {
            editorContainerRect = activeView.containerEl.getBoundingClientRect();
          }
        }
      } catch (error) {
        Logger.debug('Obsidian API 접근 중 오류 (무시됨):', error);
      }
    }
    
    // 🔧 스크롤 정보 고려 (Obsidian API 우선, 폴백은 기본 API)
    const scrollTop = editorScrollInfo?.top || window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = editorScrollInfo?.left || window.pageXOffset || document.documentElement.scrollLeft;
    
    // 🔧 모바일 키보드 감지 (뷰포트 높이 변화로 추정)
    const baseViewportHeight = window.screen.height || viewportHeight;
    const keyboardVisible = isMobile && (viewportHeight < baseViewportHeight * 0.75);
    const keyboardHeight = keyboardVisible ? baseViewportHeight - viewportHeight : 0;
    
    Logger.debug(`🔧 위치 계산 정보:`, {
      isMobile, isPhone, isTablet,
      viewportSize: `${viewportWidth}x${viewportHeight}`,
      keyboardVisible, keyboardHeight,
      targetRect: `${targetRect.left},${targetRect.top} ${targetRect.width}x${targetRect.height}`,
      scroll: `${scrollLeft},${scrollTop}`,
      editorContainer: editorContainerRect ? `${editorContainerRect.width}x${editorContainerRect.height}` : 'none',
      obsidianAPI: !!app
    });

    if (isMobile) {
      this.positionTooltipMobile(targetElement, targetRect, viewportWidth, viewportHeight, keyboardHeight, isPhone, editorContainerRect, mousePosition);
    } else {
      this.positionTooltipDesktop(targetElement, targetRect, viewportWidth, viewportHeight, editorContainerRect, mousePosition);
    }
  }

  /**
   * 모바일 툴팁 위치 계산 (화면 구석 완전 대응)
   */
  private positionTooltipMobile(
    targetElement: HTMLElement, 
    targetRect: DOMRect, 
    viewportWidth: number, 
    viewportHeight: number,
    keyboardHeight: number,
    isPhone: boolean,
    editorContainerRect: DOMRect | null = null,
    mousePosition?: { x: number; y: number }
  ): void {
    if (!this.tooltip) return;

    // 🔧 에디터 컨테이너 고려한 위치 조정
    const editorLeft = editorContainerRect?.left || 0;
    const editorTop = editorContainerRect?.top || 0;
    const editorWidth = editorContainerRect?.width || viewportWidth;
    const editorHeight = editorContainerRect?.height || viewportHeight;

    // 🔧 내용에 따른 적응형 크기 계산
    const adaptiveSize = this.calculateAdaptiveTooltipSize(
      viewportWidth, viewportHeight, keyboardHeight, isPhone, editorWidth, editorHeight
    );
    
    this.tooltip.style.width = `${adaptiveSize.width}px`;
    this.tooltip.style.maxHeight = `${adaptiveSize.maxHeight}px`;
    this.tooltip.style.minWidth = `${adaptiveSize.minWidth}px`;
    this.tooltip.style.fontSize = adaptiveSize.fontSize;

    // 🎯 터치/마우스 위치 우선 고려 (모바일 엣지케이스 해결)
    let referenceCenterX: number;
    let referenceCenterY: number;
    
    if (mousePosition) {
      // 🔧 터치 위치 기반: 정확한 터치 지점 주변에 표시
      referenceCenterX = mousePosition.x;
      referenceCenterY = mousePosition.y;
      
      Logger.debug(`🎯 터치 위치 기반 툴팁 배치: (${mousePosition.x}, ${mousePosition.y})`);
    } else {
      // 🔧 기존 방식: targetElement 중심
      referenceCenterX = targetRect.left + targetRect.width / 2;
      referenceCenterY = targetRect.top + targetRect.height / 2;
      
      Logger.debug(`📍 타겟 요소 기반 툴팁 배치: (${referenceCenterX}, ${referenceCenterY})`);
    }
    
    // 🔧 화면 구석 감지 (에디터 영역 및 터치 위치 기준)
    const cornerThreshold = mousePosition ? 40 : 60; // 터치 위치 있으면 더 정밀하게
    const effectiveLeft = Math.max(referenceCenterX - 8, editorLeft);
    const effectiveRight = Math.min(referenceCenterX + 8, editorLeft + editorWidth);
    const effectiveTop = Math.max(referenceCenterY - 10, editorTop);
    const effectiveBottom = Math.min(referenceCenterY + 10, editorTop + editorHeight);
    
    const isLeftEdge = effectiveLeft - editorLeft < cornerThreshold;
    const isRightEdge = editorLeft + editorWidth - effectiveRight < cornerThreshold;
    const isTopEdge = effectiveTop - editorTop < cornerThreshold;
    const isBottomEdge = editorTop + editorHeight - effectiveBottom < cornerThreshold;
    
    const fingerOffset = mousePosition ? (isPhone ? 35 : 30) : (isPhone ? 60 : 50); // 터치 위치 있으면 줄임
    const safeMargin = 16;
    
    let finalLeft = 0;
    let finalTop = 0;

    // 🔧 가로 위치 계산 (터치 위치 정밀 고려)
    if (isLeftEdge) {
      finalLeft = Math.max(safeMargin, editorLeft + safeMargin);
      Logger.debug('📱 왼쪽 구석 감지: 에디터 영역 내 오른쪽으로 이동');
    } else if (isRightEdge) {
      finalLeft = Math.min(viewportWidth - adaptiveSize.width - safeMargin, editorLeft + editorWidth - adaptiveSize.width - safeMargin);
      Logger.debug('📱 오른쪽 구석 감지: 에디터 영역 내 왼쪽으로 이동');
    } else {
      // 중앙 영역: 터치 위치 중심 정렬
      if (mousePosition) {
        finalLeft = Math.max(safeMargin, Math.min(
          referenceCenterX - adaptiveSize.width / 2,
          viewportWidth - adaptiveSize.width - safeMargin
        ));
      } else {
        // 기존 방식: 에디터 중앙 정렬
        const editorCenterX = editorLeft + editorWidth / 2;
        finalLeft = Math.max(safeMargin, Math.min(
          editorCenterX - adaptiveSize.width / 2,
          viewportWidth - adaptiveSize.width - safeMargin
        ));
      }
    }

    // 🔧 세로 위치 계산 (터치 위치 최적화)
    const effectiveViewportHeight = Math.min(viewportHeight - keyboardHeight, editorTop + editorHeight);
    const spaceAbove = referenceCenterY - editorTop;
    const spaceBelow = effectiveViewportHeight - referenceCenterY;
    
    if (isTopEdge && spaceBelow > adaptiveSize.maxHeight + fingerOffset + safeMargin) {
      finalTop = referenceCenterY + fingerOffset;
      Logger.debug(`📱 상단 구석: 아래쪽 배치 (오프셋: ${fingerOffset}px)`);
    } else if (isBottomEdge && spaceAbove > adaptiveSize.maxHeight + fingerOffset + safeMargin) {
      finalTop = referenceCenterY - adaptiveSize.maxHeight - fingerOffset;
      Logger.debug(`📱 하단 구석: 위쪽 배치 (오프셋: ${fingerOffset}px)`);
    } else if (spaceAbove > adaptiveSize.maxHeight + fingerOffset + safeMargin) {
      finalTop = referenceCenterY - adaptiveSize.maxHeight - (mousePosition ? 20 : 30);
      Logger.debug(`📱 위쪽 배치 (터치 최적화)`);
    } else if (spaceBelow > adaptiveSize.maxHeight + fingerOffset + safeMargin) {
      finalTop = referenceCenterY + (mousePosition ? 20 : 30);
      Logger.debug(`📱 아래쪽 배치 (터치 최적화)`);
    } else {
      // 공간 매우 부족: 터치 지점에 최대한 가깝게
      const centerY = effectiveViewportHeight / 2;
      
      if (Math.abs(centerY - referenceCenterY) < adaptiveSize.maxHeight / 2) {
        finalTop = Math.max(editorTop + safeMargin, referenceCenterY - adaptiveSize.maxHeight - 10);
      } else {
        finalTop = Math.max(editorTop + safeMargin, centerY - adaptiveSize.maxHeight / 2);
      }
      Logger.debug('📱 공간 부족: 터치 지점 인접 배치');
    }

    // 🔧 최종 경계 보정 (에디터 및 키보드 고려)
    finalTop = Math.max(
      Math.max(safeMargin, editorTop), 
      Math.min(finalTop, effectiveViewportHeight - adaptiveSize.maxHeight - safeMargin)
    );
    finalLeft = Math.max(safeMargin, Math.min(finalLeft, viewportWidth - adaptiveSize.width - safeMargin));

    // 🔧 위치 적용
    this.tooltip.style.position = 'fixed';
    this.tooltip.style.left = `${finalLeft}px`;
    this.tooltip.style.top = `${finalTop}px`;
    this.tooltip.style.zIndex = '1000';
    this.tooltip.style.visibility = 'visible';
    this.tooltip.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
    this.tooltip.style.borderRadius = '12px';

    Logger.log(`📱 최종 모바일 툴팁 위치: ${adaptiveSize.width}x${adaptiveSize.maxHeight} at (${finalLeft}, ${finalTop})`, {
      corners: { isLeftEdge, isRightEdge, isTopEdge, isBottomEdge },
      keyboard: { visible: keyboardHeight > 0, height: keyboardHeight },
      spaces: { above: spaceAbove, below: spaceBelow },
      editor: editorContainerRect ? `${editorWidth}x${editorHeight} at (${editorLeft}, ${editorTop})` : 'none',
      adaptive: `${adaptiveSize.width}px (내용 맞춤)`,
      touchMode: mousePosition ? `touch (${mousePosition.x}, ${mousePosition.y})` : 'element center',
      reference: `(${referenceCenterX}, ${referenceCenterY})`
    });
  }

  /**
   * 데스크톱 툴팁 위치 계산 (개선된 구석 처리)
   */
  private positionTooltipDesktop(
    targetElement: HTMLElement,
    targetRect: DOMRect,
    viewportWidth: number,
    viewportHeight: number,
    editorContainerRect: DOMRect | null = null,
    mousePosition?: { x: number; y: number }
  ): void {
    if (!this.tooltip) return;

    // 🔧 에디터 컨테이너 정보 고려
    const editorLeft = editorContainerRect?.left || 0;
    const editorTop = editorContainerRect?.top || 0;
    const editorWidth = editorContainerRect?.width || viewportWidth;
    const editorHeight = editorContainerRect?.height || viewportHeight;

    // 🔧 내용에 따른 적응형 크기 계산
    const adaptiveSize = this.calculateAdaptiveTooltipSize(
      viewportWidth, viewportHeight, 0, false, editorWidth, editorHeight
    );
    
    this.tooltip.style.width = `${adaptiveSize.width}px`;
    this.tooltip.style.maxHeight = `${adaptiveSize.maxHeight}px`;
    this.tooltip.style.minWidth = `${adaptiveSize.minWidth}px`;
    this.tooltip.style.fontSize = adaptiveSize.fontSize;

    const gap = 8;
    const minSpacing = 12;

    // 🎯 마우스 위치 우선 고려 (엣지케이스 해결)
    let referenceRect: DOMRect;
    let referenceCenterX: number;
    let referenceCenterY: number;
    
    if (mousePosition) {
      // 🔧 마우스 위치 기반: 두 줄로 나뉜 오류의 정확한 처리
      referenceCenterX = mousePosition.x;
      referenceCenterY = mousePosition.y;
      
      // 마우스 위치 주변의 가상 사각형 생성 (16x20px)
      referenceRect = new DOMRect(
        mousePosition.x - 8, 
        mousePosition.y - 10, 
        16, 
        20
      );
      
      Logger.debug(`🎯 마우스 위치 기반 툴팁 배치: (${mousePosition.x}, ${mousePosition.y})`);
    } else {
      // 🔧 기존 방식: targetElement 중심
      referenceRect = targetRect;
      referenceCenterX = targetRect.left + targetRect.width / 2;
      referenceCenterY = targetRect.top + targetRect.height / 2;
      
      Logger.debug(`📍 타겟 요소 기반 툴팁 배치: (${referenceCenterX}, ${referenceCenterY})`);
    }

    // 🔧 화면 구석 감지 (에디터 및 마우스 위치 기준)
    const cornerThreshold = mousePosition ? 60 : 100; // 마우스 위치 있으면 더 정밀하게
    const isLeftEdge = referenceCenterX - editorLeft < cornerThreshold;
    const isRightEdge = editorLeft + editorWidth - referenceCenterX < cornerThreshold;
    const isTopEdge = referenceCenterY - editorTop < cornerThreshold;
    const isBottomEdge = editorTop + editorHeight - referenceCenterY < cornerThreshold;

    let finalLeft = 0;
    let finalTop = 0;

    // 🔧 세로 위치 (마우스 위치 최적화)
    const smallOffset = mousePosition ? 5 : gap; // 마우스 위치 있으면 최소 오프셋
    const availableSpaceBelow = Math.min(viewportHeight, editorTop + editorHeight) - referenceCenterY;
    const availableSpaceAbove = referenceCenterY - editorTop;

    if (isBottomEdge) {
      // 하단 구석: 위쪽 배치
      finalTop = referenceCenterY - adaptiveSize.maxHeight - smallOffset;
      Logger.debug(`🖥️ 하단 구석: 위쪽 배치 (오프셋: ${smallOffset}px)`);
    } else if (availableSpaceBelow >= adaptiveSize.maxHeight + smallOffset + minSpacing) {
      // 아래쪽에 충분한 공간: 아래쪽 배치
      finalTop = referenceCenterY + smallOffset;
      Logger.debug(`🖥️ 아래쪽 배치 (오프셋: ${smallOffset}px)`);
    } else if (availableSpaceAbove >= adaptiveSize.maxHeight + smallOffset + minSpacing) {
      // 위쪽에 충분한 공간: 위쪽 배치
      finalTop = referenceCenterY - adaptiveSize.maxHeight - smallOffset;
      Logger.debug(`🖥️ 위쪽 배치 (오프셋: ${smallOffset}px)`);
    } else {
      // 공간 부족: 가능한 한 마우스에 가깝게
      if (availableSpaceBelow > availableSpaceAbove) {
        finalTop = referenceCenterY + 2; // 마우스 바로 아래
      } else {
        finalTop = referenceCenterY - adaptiveSize.maxHeight - 2; // 마우스 바로 위
      }
      Logger.debug(`🖥️ 공간 부족: 마우스 인접 배치`);
    }

    // 🔧 가로 위치 (마우스 위치 기준 정밀 배치)
    if (isLeftEdge) {
      finalLeft = Math.max(referenceCenterX + 5, editorLeft); // 마우스 오른쪽 약간
      Logger.debug('🖥️ 왼쪽 구석: 마우스 오른쪽 인접');
    } else if (isRightEdge) {
      finalLeft = Math.min(referenceCenterX - adaptiveSize.width - 5, editorLeft + editorWidth - adaptiveSize.width); // 마우스 왼쪽 약간
      Logger.debug('🖥️ 오른쪽 구석: 마우스 왼쪽 인접');
    } else {
      // 일반적인 경우: 마우스 중심 정렬
      finalLeft = referenceCenterX - (adaptiveSize.width / 2);
    }

    // 🔧 최종 경계 보정 (에디터 영역 고려)
    finalLeft = Math.max(
      Math.max(minSpacing, editorLeft), 
      Math.min(finalLeft, Math.min(viewportWidth, editorLeft + editorWidth) - adaptiveSize.width - minSpacing)
    );
    finalTop = Math.max(
      Math.max(minSpacing, editorTop), 
      Math.min(finalTop, Math.min(viewportHeight, editorTop + editorHeight) - adaptiveSize.maxHeight - minSpacing)
    );

    // 🔧 위치 적용
    this.tooltip.style.position = 'fixed';
    this.tooltip.style.left = `${finalLeft}px`;
    this.tooltip.style.top = `${finalTop}px`;
    this.tooltip.style.zIndex = '1000';
    this.tooltip.style.visibility = 'visible';

    Logger.log(`🖥️ 데스크톱 툴팁 위치: ${adaptiveSize.width}x${adaptiveSize.maxHeight} at (${finalLeft}, ${finalTop})`, {
      corners: { isLeftEdge, isRightEdge, isTopEdge, isBottomEdge },
      editor: editorContainerRect ? `${editorWidth}x${editorHeight} at (${editorLeft}, ${editorTop})` : 'none',
      adaptive: `${adaptiveSize.width}px (내용 맞춤)`,
      mouseMode: mousePosition ? `mouse (${mousePosition.x}, ${mousePosition.y})` : 'element center',
      reference: `(${referenceCenterX}, ${referenceCenterY})`
    });
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
        
        const isMobile = Platform.isMobile;
        
        suggestionButton.style.cssText = `
          background: var(--interactive-normal);
          border: 1px solid var(--background-modifier-border);
          border-radius: ${isMobile ? '6px' : '3px'};
          padding: ${isMobile ? '4px 8px' : '2px 6px'};
          cursor: pointer;
          transition: all 0.2s;
          color: var(--text-normal);
          font-size: ${isMobile ? '12px' : '11px'};
          white-space: nowrap;
          flex-shrink: 0;
          max-width: ${isMobile ? '120px' : '100px'};
          overflow: hidden;
          text-overflow: ellipsis;
          min-height: ${isMobile ? '28px' : 'auto'};
          ${isMobile ? 'touch-action: manipulation;' : ''}
        `;

        // 호버/터치 효과
        const onActivate = () => {
          suggestionButton.style.background = 'var(--interactive-hover)';
          suggestionButton.style.transform = 'translateY(-1px)';
          if (isMobile && 'vibrate' in navigator) {
            navigator.vibrate(10);
          }
        };

        const onDeactivate = () => {
          suggestionButton.style.background = 'var(--interactive-normal)';
          suggestionButton.style.transform = 'translateY(0)';
        };

        suggestionButton.addEventListener('mouseenter', onActivate);
        suggestionButton.addEventListener('mouseleave', onDeactivate);

        // 모바일 터치 피드백
        if (isMobile) {
          suggestionButton.addEventListener('touchstart', (e) => {
            e.preventDefault(); // 더블 탭 방지
            onActivate();
          }, { passive: false });
          
          suggestionButton.addEventListener('touchend', (e) => {
            e.preventDefault();
            onDeactivate();
            
            // 🔧 모바일에서 터치 종료 시 직접 수정 적용
            Logger.log(`📱 모바일 터치로 제안 적용: "${suggestion}"`);
            this.applySuggestionKeepOpen(mergedError, suggestion, targetElement);
          }, { passive: false });
        }

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
      
      const isMobile = Platform.isMobile;
      
      suggestionButton.style.cssText = `
        background: var(--interactive-normal);
        border: 1px solid var(--background-modifier-border);
        border-radius: ${isMobile ? '6px' : '4px'};
        padding: ${isMobile ? '6px 10px' : '4px 8px'};
        cursor: pointer;
        transition: all 0.2s;
        color: var(--text-normal);
        font-size: ${isMobile ? '13px' : '12px'};
        white-space: nowrap;
        min-height: ${isMobile ? '32px' : 'auto'};
        ${isMobile ? 'touch-action: manipulation;' : ''}
      `;

      // 호버/터치 효과 함수
      const onActivate = () => {
        suggestionButton.style.background = 'var(--interactive-hover) !important';
        suggestionButton.style.color = 'var(--text-normal) !important';
        suggestionButton.style.transform = 'translateY(-1px)';
        suggestionButton.style.border = '1px solid var(--background-modifier-border) !important';
        suggestionButton.setAttribute('data-hovered', 'true');
        
        if (isMobile && 'vibrate' in navigator) {
          navigator.vibrate(10);
        }
      };

      const onDeactivate = () => {
        suggestionButton.removeAttribute('data-hovered');
        suggestionButton.style.transform = 'translateY(0)';
        // 키보드 하이라이트 상태 복원
        if ((window as any).InlineModeService) {
          (window as any).InlineModeService.updateTooltipHighlight();
        }
      };

      // 호버 효과 (키보드 하이라이트보다 우선)
      suggestionButton.addEventListener('mouseenter', onActivate);
      suggestionButton.addEventListener('mouseleave', onDeactivate);

      // 모바일 터치 피드백
      if (isMobile) {
        suggestionButton.addEventListener('touchstart', (e) => {
          e.preventDefault(); // 더블 탭 방지
          onActivate();
        }, { passive: false });
        
        suggestionButton.addEventListener('touchend', (e) => {
          e.preventDefault();
          onDeactivate();
          
          // 🔧 모바일에서 터치 종료 시 직접 수정 적용
          Logger.log(`📱 모바일 터치로 제안 적용: "${suggestion}"`);
          this.applySuggestion(error, suggestion, targetElement);
        }, { passive: false });
      }

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
   * 수정 제안 적용 (클릭 후 툴팁 유지)
   */
  private applySuggestionKeepOpen(mergedError: InlineError, suggestion: string, targetElement: HTMLElement): void {
    Logger.log(`인라인 모드: 수정 제안 적용 (클릭 후 툴팁 유지) - "${mergedError.correction.original}" → "${suggestion}"`);
    
    // 툴팁 유지 모드 플래그 설정
    (window as any).tooltipKeepOpenMode = true;
    
    // 🔧 직접 import한 InlineModeService 사용
    try {
      InlineModeService.applySuggestion(mergedError, suggestion);
      Logger.log(`✅ 병합된 오류 수정 적용 성공: "${mergedError.correction.original}" → "${suggestion}"`);
    } catch (error) {
      Logger.error('❌ 수정 제안 적용 중 오류:', error);
    }
    
    // 툴팁 유지 모드 해제 (약간의 지연 후)
    setTimeout(() => {
      (window as any).tooltipKeepOpenMode = false;
    }, 200);
    
    // 툴팁 상태 유지 (현재 오류 정보 업데이트는 InlineModeService에서 처리)
    Logger.debug('툴팁 유지 모드로 교정 적용 완료');
  }

  /**
   * 수정 제안 적용 (일반 모드)
   */
  private applySuggestion(error: InlineError, suggestion: string, targetElement: HTMLElement): void {
    Logger.log(`인라인 모드: 수정 제안 적용 - "${error.correction.original}" → "${suggestion}"`);
    
    // 🔧 직접 import한 InlineModeService 사용
    try {
      InlineModeService.applySuggestion(error, suggestion);
      Logger.log(`✅ 일반 오류 수정 적용 성공: "${error.correction.original}" → "${suggestion}"`);
      
      // 툴팁 숨기기
      this.hide();
    } catch (error) {
      Logger.error('❌ 수정 제안 적용 중 오류:', error);
    }
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

  /**
   * 툴팁 내용에 따른 적응형 크기 계산
   */
  private calculateAdaptiveTooltipSize(
    viewportWidth: number, 
    viewportHeight: number,
    keyboardHeight: number,
    isPhone: boolean,
    editorWidth: number,
    editorHeight: number
  ): { width: number; maxHeight: number; minWidth: number; fontSize: string } {
    if (!this.tooltip) {
      return { width: 250, maxHeight: 200, minWidth: 200, fontSize: '14px' };
    }

    // 🔧 임시로 툴팁을 보이지 않게 하여 내용 크기 측정
    const originalDisplay = this.tooltip.style.display;
    const originalVisibility = this.tooltip.style.visibility;
    const originalPosition = this.tooltip.style.position;
    const originalWidth = this.tooltip.style.width;
    
    this.tooltip.style.position = 'absolute';
    this.tooltip.style.visibility = 'hidden';
    this.tooltip.style.display = 'block';
    this.tooltip.style.width = 'auto';
    this.tooltip.style.maxWidth = 'none';
    this.tooltip.style.minWidth = 'none';
    
    // 📏 실제 내용 크기 측정
    const naturalWidth = this.tooltip.scrollWidth;
    const naturalHeight = this.tooltip.scrollHeight;
    
    Logger.debug(`📏 툴팁 자연 크기: ${naturalWidth}x${naturalHeight}`);
    
    // 🔧 플랫폼별 크기 범위 설정
    let minWidth: number, maxWidth: number, maxHeight: number, fontSize: string;
    
    if (Platform.isMobile) {
      fontSize = isPhone ? '13px' : '14px';
      minWidth = isPhone ? 200 : 240;
      maxWidth = Math.min(
        isPhone ? 320 : 380, 
        Math.min(viewportWidth, editorWidth) - 32
      );
      
      const availableHeight = Math.min(viewportHeight, editorHeight) - keyboardHeight - 60;
      maxHeight = Math.min(
        isPhone ? 180 : 220, 
        availableHeight * 0.6
      );
    } else {
      fontSize = '14px';
      minWidth = 180;
      maxWidth = Math.min(500, Math.min(viewportWidth, editorWidth) - 40);
      maxHeight = Math.min(300, Math.min(viewportHeight, editorHeight) - 40);
    }
    
    // 🔧 내용에 맞는 최적 너비 계산
    let optimalWidth = naturalWidth + 24; // 패딩 고려
    
    // 내용이 너무 짧으면 최소 너비 보장
    optimalWidth = Math.max(minWidth, optimalWidth);
    
    // 내용이 너무 길면 최대 너비로 제한
    optimalWidth = Math.min(maxWidth, optimalWidth);
    
    // 🔧 원래 스타일 복원
    this.tooltip.style.display = originalDisplay;
    this.tooltip.style.visibility = originalVisibility;
    this.tooltip.style.position = originalPosition;
    this.tooltip.style.width = originalWidth;
    
    const result = {
      width: optimalWidth,
      maxHeight,
      minWidth: optimalWidth, // 계산된 너비로 고정
      fontSize
    };
    
    Logger.log(`🎯 적응형 툴팁 크기:`, {
      natural: `${naturalWidth}x${naturalHeight}`,
      calculated: `${optimalWidth}x${maxHeight}`,
      range: `${minWidth}-${maxWidth}`,
      platform: Platform.isMobile ? (isPhone ? 'phone' : 'tablet') : 'desktop'
    });
    
    return result;
  }
}

/**
 * 전역 툴팁 인스턴스
 */
export const globalInlineTooltip = new InlineTooltip();

// Window 객체에 노출 (InlineModeService에서 접근하기 위해)
(window as any).globalInlineTooltip = globalInlineTooltip;