import { InlineError } from '../types/interfaces';
import { Logger } from '../utils/logger';
import { Platform, MarkdownView, Notice } from 'obsidian';
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
    // 🔧 고정 크기 제거하고 내용 기반 사이징만 사용
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

    // 모바일 최적화를 위한 플랫폼 감지 (병합 툴팁용)
    const isMobileDevice = Platform.isMobile;
    const isPhoneDevice = (Platform as any).isPhone || (window.innerWidth <= 480);

    // 헤더 영역 - 닫기 버튼 포함
    const header = this.tooltip.createEl('div', { cls: 'tooltip-header' });
    header.style.cssText = `
      padding: ${isMobileDevice ? (isPhoneDevice ? '10px 12px' : '11px 13px') : '8px 12px'};
      border-bottom: 1px solid var(--background-modifier-border);
      background: var(--background-secondary);
      font-weight: 600;
      font-size: ${isMobileDevice ? (isPhoneDevice ? '11px' : '12px') : '12px'};
      color: var(--text-muted);
      text-align: center;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // 헤더 텍스트
    const headerText = header.createEl('span', { 
      text: `${mergedError.originalErrors.length}개 오류 병합됨`,
      cls: 'header-text'
    });
    headerText.style.cssText = `
      flex: 1;
      text-align: center;
    `;

    // 우상단 닫기 버튼 (✕)
    const headerCloseButton = header.createEl('button', { 
      text: '✕',
      cls: 'header-close-button'
    });
    headerCloseButton.style.cssText = `
      position: absolute;
      right: ${isMobileDevice ? '8px' : '6px'};
      top: 50%;
      transform: translateY(-50%);
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: ${isMobileDevice ? (isPhoneDevice ? '14px' : '15px') : '16px'};
      color: var(--text-muted);
      padding: ${isMobileDevice ? '4px' : '2px'};
      border-radius: 3px;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: ${isMobileDevice ? '24px' : '20px'};
      min-height: ${isMobileDevice ? '24px' : '20px'};
      ${isMobileDevice ? 'touch-action: manipulation;' : ''}
    `;

    // 닫기 버튼 이벤트
    headerCloseButton.addEventListener('mouseenter', () => {
      headerCloseButton.style.background = 'var(--interactive-hover)';
      headerCloseButton.style.color = 'var(--text-normal)';
    });

    headerCloseButton.addEventListener('mouseleave', () => {
      headerCloseButton.style.background = 'transparent';
      headerCloseButton.style.color = 'var(--text-muted)';
    });

    // 모바일 터치 피드백
    if (isMobileDevice) {
      headerCloseButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        headerCloseButton.style.background = 'var(--interactive-hover)';
        headerCloseButton.style.color = 'var(--text-normal)';
        if ('vibrate' in navigator) {
          navigator.vibrate(10);
        }
      }, { passive: false });
      
      headerCloseButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }, { passive: false });
    }

    headerCloseButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });

    // 스크롤 가능한 내용 영역 - 모바일 최적화
    const scrollContainer = this.tooltip.createEl('div', { cls: 'tooltip-scroll-container' });
    scrollContainer.style.cssText = `
      flex: 1;
      overflow-y: auto;
      max-height: ${isMobileDevice ? (isPhoneDevice ? '280px' : '320px') : '250px'};
      min-height: ${isMobileDevice ? (isPhoneDevice ? '120px' : '140px') : 'auto'};
    `;

    // 각 원본 오류별로 섹션 생성 - 모바일 최적화
    mergedError.originalErrors.forEach((originalError, index) => {
      const errorSection = scrollContainer.createEl('div', { cls: 'error-section' });
      errorSection.style.cssText = `
        padding: ${isMobileDevice ? (isPhoneDevice ? '10px 12px' : '11px 13px') : '8px 12px'};
        ${index > 0 ? 'border-top: 1px solid var(--background-modifier-border-hover);' : ''}
      `;

      // 한 줄 레이아웃 (오류 → 제안들) - 모바일 최적화
      const errorLine = errorSection.createEl('div', { cls: 'error-line' });
      errorLine.style.cssText = `
        display: flex;
        align-items: center;
        gap: ${isMobileDevice ? (isPhoneDevice ? '6px' : '7px') : '8px'};
        flex-wrap: nowrap;
        min-height: ${isMobileDevice ? (isPhoneDevice ? '32px' : '34px') : '28px'};
      `;

      // 오류 단어 표시 (고정 너비) - 모바일 최적화
      const errorWord = errorLine.createEl('span', { 
        text: originalError.correction.original,
        cls: 'error-word'
      });
      errorWord.style.cssText = `
        color: var(--text-error);
        font-weight: 600;
        background: rgba(255, 0, 0, 0.1);
        padding: ${isMobileDevice ? (isPhoneDevice ? '4px 7px' : '4px 8px') : '3px 6px'};
        border-radius: 3px;
        font-size: ${isMobileDevice ? (isPhoneDevice ? '11px' : '12px') : '12px'};
        white-space: nowrap;
        flex-shrink: 0;
        min-width: ${isMobileDevice ? '70px' : '60px'};
        max-width: ${isMobileDevice ? (isPhoneDevice ? '100px' : '110px') : '120px'};
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: ${isMobileDevice ? '1.3' : '1.2'};
      `;

      // 화살표 (고정) - 모바일 최적화
      const arrow = errorLine.createEl('span', { text: '→' });
      arrow.style.cssText = `
        color: var(--text-muted);
        font-weight: bold;
        flex-shrink: 0;
        font-size: ${isMobileDevice ? (isPhoneDevice ? '12px' : '13px') : '14px'};
      `;

      // 수정 제안들을 가로로 나열 (남은 공간 활용) - 모바일 최적화
      const suggestionsList = errorLine.createEl('div', { cls: 'suggestions-list' });
      suggestionsList.style.cssText = `
        display: flex;
        align-items: center;
        gap: ${isMobileDevice ? (isPhoneDevice ? '3px' : '4px') : '4px'};
        flex: 1;
        flex-wrap: wrap;
        overflow: hidden;
      `;

      // 수정 제안 버튼들 (원본 오류 단어와 비슷한 크기로) - 모바일 최적화
      originalError.correction.corrected.forEach((suggestion) => {
        const suggestionButton = suggestionsList.createEl('button', {
          text: suggestion,
          cls: 'suggestion-button'
        });
        
        suggestionButton.style.cssText = `
          background: var(--interactive-normal);
          border: 1px solid var(--background-modifier-border);
          border-radius: 3px;
          padding: ${isMobileDevice ? (isPhoneDevice ? '4px 7px' : '4px 8px') : '3px 6px'};
          cursor: pointer;
          transition: all 0.2s;
          color: var(--text-normal);
          font-size: ${isMobileDevice ? (isPhoneDevice ? '11px' : '12px') : '12px'};
          white-space: nowrap;
          flex-shrink: 0;
          max-width: ${isMobileDevice ? (isPhoneDevice ? '100px' : '110px') : '120px'};
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: ${isMobileDevice ? '1.3' : '1.2'};
          min-height: ${isMobileDevice ? (isPhoneDevice ? '26px' : '28px') : 'auto'};
          ${isMobileDevice ? 'touch-action: manipulation;' : ''}
        `;

        // 호버/터치 효과
        const onActivate = () => {
          suggestionButton.style.background = 'var(--interactive-hover)';
          suggestionButton.style.transform = 'translateY(-1px)';
          if (isMobileDevice && 'vibrate' in navigator) {
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
        if (isMobileDevice) {
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
        
        // 📖 도움말을 하단에 표시하는 인라인 방식 사용
        this.createInlineHelpIcon(originalError.correction.help, helpContainer, () => {
          let helpArea = this.tooltip!.querySelector('.tooltip-help-area') as HTMLElement;
          if (!helpArea) {
            // 도움말 영역 생성
            helpArea = this.tooltip!.createEl('div', { cls: 'tooltip-help-area' });
            helpArea.style.cssText = `
              padding: 8px 12px;
              border-top: 1px solid var(--background-modifier-border);
              background: var(--background-secondary);
              font-size: 11px;
              color: var(--text-muted);
              line-height: 1.4;
              white-space: pre-wrap;
              word-break: break-word;
            `;
            helpArea.textContent = originalError.correction.help;
          } else {
            // 도움말 영역 토글 (숨기기/보이기)
            const isHidden = helpArea.style.display === 'none';
            helpArea.style.display = isHidden ? 'block' : 'none';
            if (!isHidden) {
              // 새로운 도움말로 내용 업데이트
              helpArea.textContent = originalError.correction.help;
            }
          }
        });
      }
    });

    // 하단 액션 영역 - 모바일 최적화
    const footer = this.tooltip.createEl('div', { cls: 'tooltip-footer' });
    const isMobile = Platform.isMobile;
    const isPhone = (Platform as any).isPhone || (window.innerWidth <= 480);
    
    footer.style.cssText = `
      padding: ${isMobile ? (isPhone ? '4px 8px' : '5px 10px') : '6px 12px'};
      border-top: 1px solid var(--background-modifier-border);
      background: var(--background-secondary);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: ${isMobile ? '6px' : '8px'};
      min-height: ${isMobile ? (isPhone ? '36px' : '40px') : 'auto'};
    `;

    // 정보 텍스트 - 모바일에서 더 컴팩트
    const infoText = footer.createEl('span', {
      text: isMobile ? '개별 클릭으로 수정' : '개별 클릭으로 하나씩 수정',
      cls: 'info-text'
    });
    infoText.style.cssText = `
      font-size: ${isMobile ? (isPhone ? '10px' : '11px') : '11px'};
      color: var(--text-muted);
      flex: 1;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;

    // 액션 버튼들 컨테이너 - 모바일 최적화
    const actionButtons = footer.createEl('div', { cls: 'action-buttons' });
    actionButtons.style.cssText = `
      display: flex;
      align-items: center;
      gap: ${isMobile ? '4px' : '6px'};
      flex-shrink: 0;
    `;

    // ❌ 병합된 오류 전체 무시 버튼 - 모바일 최적화
    const ignoreAllButton = actionButtons.createEl('button', { cls: 'ignore-all-button' });
    ignoreAllButton.innerHTML = '❌'; // X 표시
    ignoreAllButton.title = '이 오류들 모두 무시';
    ignoreAllButton.style.cssText = `
      background: var(--interactive-normal);
      border: 1px solid var(--background-modifier-border);
      border-radius: ${isMobile ? '5px' : '4px'};
      padding: ${isMobile ? (isPhone ? '6px' : '7px') : '6px'};
      cursor: pointer;
      transition: all 0.2s;
      font-size: ${isMobile ? (isPhone ? '12px' : '13px') : '12px'};
      min-height: ${isMobile ? (isPhone ? '28px' : '30px') : 'auto'};
      min-width: ${isMobile ? (isPhone ? '28px' : '30px') : 'auto'};
      max-height: ${isMobile ? (isPhone ? '28px' : '30px') : 'none'};
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      ${isMobile ? 'touch-action: manipulation;' : ''}
    `;

    // 무시 버튼 이벤트
    ignoreAllButton.addEventListener('mouseenter', () => {
      ignoreAllButton.style.background = 'var(--interactive-hover)';
      ignoreAllButton.style.transform = 'translateY(-1px)';
    });

    ignoreAllButton.addEventListener('mouseleave', () => {
      ignoreAllButton.style.background = 'var(--interactive-normal)';
      ignoreAllButton.style.transform = 'translateY(0)';
    });

    // 모바일 터치 피드백
    if (Platform.isMobile) {
      ignoreAllButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        ignoreAllButton.style.background = 'var(--interactive-hover)';
        if ('vibrate' in navigator) {
          navigator.vibrate(10);
        }
      }, { passive: false });
      
      ignoreAllButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.ignoreError(mergedError);
      }, { passive: false });
    }

    // 클릭 이벤트
    ignoreAllButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ignoreError(mergedError);
    });

    // 모든 수정 적용 버튼 - 체크 표시로 변경
    const applyAllButton = actionButtons.createEl('button', {
      text: '✓',
      cls: 'apply-all-button'
    });
    applyAllButton.title = '모든 수정 사항 적용';
    applyAllButton.style.cssText = `
      background: var(--interactive-accent);
      color: var(--text-on-accent);
      border: 1px solid var(--interactive-accent);
      border-radius: ${isMobileDevice ? '5px' : '4px'};
      padding: ${isMobileDevice ? (isPhoneDevice ? '6px' : '7px') : '6px'};
      cursor: pointer;
      font-size: ${isMobileDevice ? (isPhoneDevice ? '14px' : '15px') : '16px'};
      font-weight: 600;
      transition: all 0.2s;
      min-height: ${isMobileDevice ? (isPhoneDevice ? '28px' : '30px') : 'auto'};
      min-width: ${isMobileDevice ? (isPhoneDevice ? '28px' : '30px') : 'auto'};
      max-height: ${isMobileDevice ? (isPhoneDevice ? '28px' : '30px') : 'none'};
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      white-space: nowrap;
      ${isMobileDevice ? 'touch-action: manipulation;' : ''}
    `;

    applyAllButton.addEventListener('mouseenter', () => {
      applyAllButton.style.background = 'var(--interactive-accent-hover)';
      applyAllButton.style.transform = 'translateY(-1px)';
    });

    applyAllButton.addEventListener('mouseleave', () => {
      applyAllButton.style.background = 'var(--interactive-accent)';
      applyAllButton.style.transform = 'translateY(0)';
    });

    // 모바일 터치 피드백
    if (isMobileDevice) {
      applyAllButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        applyAllButton.style.background = 'var(--interactive-accent-hover)';
        if ('vibrate' in navigator) {
          navigator.vibrate(10);
        }
      }, { passive: false });
      
      applyAllButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 모든 오류의 첫 번째 제안 적용
        if (mergedError.originalErrors) {
          mergedError.originalErrors.forEach((originalError) => {
            if (originalError.correction.corrected.length > 0) {
              InlineModeService.applySuggestion(originalError, originalError.correction.corrected[0]);
            }
          });
        }
        this.hide();
      }, { passive: false });
    }

    // 클릭 이벤트 - 모든 수정 적용
    applyAllButton.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // 모든 오류의 첫 번째 제안 적용
      if (mergedError.originalErrors) {
        mergedError.originalErrors.forEach((originalError) => {
          if (originalError.correction.corrected.length > 0) {
            InlineModeService.applySuggestion(originalError, originalError.correction.corrected[0]);
          }
        });
      }
      
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
    let isHoveringTarget = false;
    let isHoveringTooltip = false;
    
    const startHideTimer = () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
      }
      hideTimeout = setTimeout(() => {
        if (!isHoveringTarget && !isHoveringTooltip) {
          Logger.debug('🔍 툴팁 자동 숨김 타이머 실행');
          this.hide();
        }
      }, 500); // 500ms로 여유 시간 증가
    };

    const cancelHideTimer = () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = undefined;
      }
    };

    const onTargetMouseEnter = () => {
      Logger.debug('🔍 타겟 요소 마우스 진입');
      isHoveringTarget = true;
      cancelHideTimer();
    };

    const onTargetMouseLeave = () => {
      Logger.debug('🔍 타겟 요소 마우스 이탈');
      isHoveringTarget = false;
      // 🔧 툴팁으로 이동할 시간을 주기 위해 약간의 지연
      setTimeout(() => {
        if (!isHoveringTarget && !isHoveringTooltip) {
          startHideTimer();
        }
      }, 100);
    };

    const onTooltipMouseEnter = () => {
      Logger.debug('🔍 툴팁 마우스 진입');
      isHoveringTooltip = true;
      cancelHideTimer();
    };

    const onTooltipMouseLeave = () => {
      Logger.debug('🔍 툴팁 마우스 이탈');
      isHoveringTooltip = false;
      // 🔧 타겟으로 돌아갈 시간을 주기 위해 약간의 지연
      setTimeout(() => {
        if (!isHoveringTarget && !isHoveringTooltip) {
          startHideTimer();
        }
      }, 100);
    };

    // 🔧 브라우저 호환성을 위한 추가 이벤트 (마우스가 완전히 벗어났을 때)
    const onDocumentMouseMove = (e: MouseEvent) => {
      if (!this.tooltip || !targetElement) return;
      
      const tooltipRect = this.tooltip.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      
      // 🔧 툴팁과 타겟 사이의 "브릿지" 영역 계산 (마우스 이동 경로 허용)
      const bridgeMargin = 10; // 10px 여유 공간
      const combinedRect = {
        left: Math.min(tooltipRect.left, targetRect.left) - bridgeMargin,
        right: Math.max(tooltipRect.right, targetRect.right) + bridgeMargin,
        top: Math.min(tooltipRect.top, targetRect.top) - bridgeMargin,
        bottom: Math.max(tooltipRect.bottom, targetRect.bottom) + bridgeMargin
      };
      
      const isInCombinedArea = (
        e.clientX >= combinedRect.left && e.clientX <= combinedRect.right &&
        e.clientY >= combinedRect.top && e.clientY <= combinedRect.bottom
      );
      
      // 🔧 완전히 벗어난 경우에만 강제 숨김 (더 관대한 조건)
      if (!isInCombinedArea && (isHoveringTarget || isHoveringTooltip)) {
        Logger.debug('🔍 마우스가 브릿지 영역을 완전히 벗어남 - 상태 초기화');
        isHoveringTarget = false;
        isHoveringTooltip = false;
        startHideTimer();
      }
    };

    // 이벤트 리스너 등록
    targetElement.addEventListener('mouseenter', onTargetMouseEnter);
    targetElement.addEventListener('mouseleave', onTargetMouseLeave);
    
    // 🔧 툴팁 이벤트는 비동기적으로 등록 (DOM 완전 생성 후)
    setTimeout(() => {
      if (this.tooltip) {
        this.tooltip.addEventListener('mouseenter', onTooltipMouseEnter);
        this.tooltip.addEventListener('mouseleave', onTooltipMouseLeave);
      }
    }, 50);
    
    document.addEventListener('mousemove', onDocumentMouseMove);

    // 정리 함수 저장 (나중에 제거용)
    (this.tooltip as any)._cleanup = () => {
      targetElement.removeEventListener('mouseenter', onTargetMouseEnter);
      targetElement.removeEventListener('mouseleave', onTargetMouseLeave);
      this.tooltip?.removeEventListener('mouseenter', onTooltipMouseEnter);
      this.tooltip?.removeEventListener('mouseleave', onTooltipMouseLeave);
      document.removeEventListener('mousemove', onDocumentMouseMove);
      if (hideTimeout) clearTimeout(hideTimeout);
    };
  }

  /**
   * 단일 오류용 툴팁 생성 (기존 로직 유지)
   */
  private createSingleErrorTooltip(error: InlineError, targetElement: HTMLElement, triggerType: 'hover' | 'click'): void {
    if (!this.tooltip) return;

    // 모바일 최적화를 위한 플랫폼 감지 (메서드 전체에서 사용)
    const isMobile = Platform.isMobile;
    const isPhone = (Platform as any).isPhone || (window.innerWidth <= 480);

    // 상단 메인 콘텐츠 영역 (가로 레이아웃) - 모바일 최적화
    const mainContent = this.tooltip.createEl('div', { cls: 'tooltip-main-content' });
    
    mainContent.style.cssText = `
      display: flex;
      align-items: center;
      gap: ${isMobile ? (isPhone ? '6px' : '7px') : '8px'};
      padding: ${isMobile ? (isPhone ? '6px 10px' : '7px 11px') : '8px 12px'};
      white-space: nowrap;
    `;

    // 오류 단어 표시 (간소화) - 모바일 최적화
    const errorWord = mainContent.createEl('span', { 
      text: error.correction.original,
      cls: 'error-word'
    });
    errorWord.style.cssText = `
      color: var(--text-error);
      font-weight: 600;
      background: rgba(255, 0, 0, 0.1);
      padding: ${isMobile ? (isPhone ? '1px 4px' : '2px 5px') : '2px 6px'};
      border-radius: 3px;
      font-size: ${isMobile ? (isPhone ? '11px' : '12px') : '12px'};
    `;

    // 화살표 - 모바일 최적화
    const arrow = mainContent.createEl('span', { text: '→' });
    arrow.style.cssText = `
      color: var(--text-muted);
      font-weight: bold;
      font-size: ${isMobile ? (isPhone ? '11px' : '12px') : '12px'};
    `;

    // 수정 제안들을 가로로 나열 - 모바일 최적화
    const suggestionsList = mainContent.createEl('div', { cls: 'suggestions-list' });
    suggestionsList.style.cssText = `
      display: flex;
      align-items: center;
      gap: ${isMobile ? (isPhone ? '4px' : '5px') : '6px'};
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
        suggestionButton.style.background = 'var(--interactive-hover)';
        suggestionButton.style.color = 'var(--text-normal)';
        suggestionButton.style.transform = 'translateY(-1px)';
        suggestionButton.style.border = '1px solid var(--background-modifier-border)';
        
        if (isMobile && 'vibrate' in navigator) {
          navigator.vibrate(10);
        }
      };

      const onDeactivate = () => {
        suggestionButton.style.background = 'var(--interactive-normal)';
        suggestionButton.style.color = 'var(--text-normal)';
        suggestionButton.style.transform = 'translateY(0)';
        suggestionButton.style.border = '1px solid var(--background-modifier-border)';
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

    // 📚 예외 단어 추가 버튼 (책 아이콘) - 모바일 최적화
    const exceptionButton = actionsContainer.createEl('button', { cls: 'exception-button' });
    exceptionButton.innerHTML = '📚'; // 책 아이콘
    exceptionButton.title = '예외 단어로 추가';
    
    exceptionButton.style.cssText = `
      background: var(--interactive-normal);
      border: 1px solid var(--background-modifier-border);
      border-radius: ${isMobile ? '5px' : '4px'};
      padding: ${isMobile ? (isPhone ? '5px' : '6px') : '6px'};
      cursor: pointer;
      transition: all 0.2s;
      font-size: ${isMobile ? (isPhone ? '13px' : '14px') : '14px'};
      min-height: ${isMobile ? (isPhone ? '26px' : '28px') : 'auto'};
      min-width: ${isMobile ? (isPhone ? '26px' : '28px') : 'auto'};
      max-height: ${isMobile ? (isPhone ? '26px' : '28px') : 'none'};
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      ${isMobile ? 'touch-action: manipulation;' : ''}
    `;

    // 예외 단어 버튼 이벤트
    exceptionButton.addEventListener('mouseenter', () => {
      exceptionButton.style.background = 'var(--interactive-hover)';
      exceptionButton.style.transform = 'translateY(-1px)';
    });

    exceptionButton.addEventListener('mouseleave', () => {
      exceptionButton.style.background = 'var(--interactive-normal)';
      exceptionButton.style.transform = 'translateY(0)';
    });

    // 모바일 터치 피드백
    if (isMobile) {
      exceptionButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        exceptionButton.style.background = 'var(--interactive-hover)';
        if ('vibrate' in navigator) {
          navigator.vibrate(10);
        }
      }, { passive: false });
      
      exceptionButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.addToExceptionWords(error);
      }, { passive: false });
    }

    // 클릭 이벤트
    exceptionButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addToExceptionWords(error);
    });

    // ❌ 오류 무시 버튼 (일시적 무시) - 모바일 최적화
    const ignoreButton = actionsContainer.createEl('button', { cls: 'ignore-button' });
    ignoreButton.innerHTML = '❌'; // X 표시
    ignoreButton.title = '이 오류 무시 (일시적)';
    ignoreButton.style.cssText = `
      background: var(--interactive-normal);
      border: 1px solid var(--background-modifier-border);
      border-radius: ${isMobile ? '5px' : '4px'};
      padding: ${isMobile ? (isPhone ? '5px' : '6px') : '6px'};
      cursor: pointer;
      transition: all 0.2s;
      font-size: ${isMobile ? (isPhone ? '11px' : '12px') : '12px'};
      min-height: ${isMobile ? (isPhone ? '26px' : '28px') : 'auto'};
      min-width: ${isMobile ? (isPhone ? '26px' : '28px') : 'auto'};
      max-height: ${isMobile ? (isPhone ? '26px' : '28px') : 'none'};
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      ${isMobile ? 'touch-action: manipulation;' : ''}
    `;

    // 무시 버튼 이벤트
    ignoreButton.addEventListener('mouseenter', () => {
      ignoreButton.style.background = 'var(--interactive-hover)';
      ignoreButton.style.transform = 'translateY(-1px)';
    });

    ignoreButton.addEventListener('mouseleave', () => {
      ignoreButton.style.background = 'var(--interactive-normal)';
      ignoreButton.style.transform = 'translateY(0)';
    });

    // 모바일 터치 피드백
    if (isMobile) {
      ignoreButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        ignoreButton.style.background = 'var(--interactive-hover)';
        if ('vibrate' in navigator) {
          navigator.vibrate(10);
        }
      }, { passive: false });
      
      ignoreButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.ignoreError(error);
      }, { passive: false });
    }

    // 클릭 이벤트
    ignoreButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ignoreError(error);
    });

    // 📖 도움말 영역 (하단에 표시될 영역)
    let helpArea: HTMLElement | null = null;
    if (error.correction.help) {
      // 도움말 아이콘 생성
      this.createInlineHelpIcon(error.correction.help, actionsContainer, () => {
        if (!helpArea) {
          // 도움말 영역 생성
          helpArea = this.tooltip!.createEl('div', { cls: 'tooltip-help-area' });
          helpArea.style.cssText = `
            padding: 8px 12px;
            border-top: 1px solid var(--background-modifier-border);
            background: var(--background-secondary);
            font-size: 11px;
            color: var(--text-muted);
            line-height: 1.4;
            white-space: pre-wrap;
            word-break: break-word;
          `;
          helpArea.textContent = error.correction.help;
        } else {
          // 도움말 영역 토글 (숨기기/보이기)
          const isHidden = helpArea.style.display === 'none';
          helpArea.style.display = isHidden ? 'block' : 'none';
        }
      });
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
   * 📚 예외 단어로 추가 (IgnoredWordsService와 연동)
   */
  private addToExceptionWords(error: InlineError): void {
    const word = error.correction.original;
    
    try {
      // IgnoredWordsService를 통해 예외 단어 추가
      const app = (window as any).app;
      if (app && app.plugins && app.plugins.plugins['korean-grammar-assistant']) {
        const plugin = app.plugins.plugins['korean-grammar-assistant'];
        const settings = plugin.settings;
        
        if (!settings.ignoredWords) {
          settings.ignoredWords = [];
        }
        
        // 이미 예외 단어에 있는지 확인
        if (settings.ignoredWords.includes(word)) {
          Logger.warn(`"${word}"는 이미 예외 단어 목록에 있습니다.`);
          new Notice(`"${word}"는 이미 예외 단어로 등록되어 있습니다.`);
          return;
        }
        
        // 예외 단어 추가
        settings.ignoredWords.push(word);
        plugin.saveSettings();
        
        Logger.log(`📚 예외 단어 추가: "${word}"`);
        new Notice(`"${word}"를 예외 단어로 추가했습니다.`);
        
        // 현재 오류 제거 (InlineModeService를 통해)
        if ((window as any).InlineModeService) {
          (window as any).InlineModeService.removeError(null, error.uniqueId);
          Logger.debug(`✅ 예외 단어 등록으로 인한 오류 제거: ${error.uniqueId}`);
        }
        
        // 툴팁 숨김
        this.hide();
        
      } else {
        Logger.error('Korean Grammar Assistant 플러그인을 찾을 수 없습니다.');
        new Notice('예외 단어 추가에 실패했습니다.');
      }
    } catch (error) {
      Logger.error('예외 단어 추가 중 오류:', error);
      new Notice('예외 단어 추가에 실패했습니다.');
    }
  }

  /**
   * ❌ 오류 일시적 무시 (해당 오류만 숨김, 예외 단어에는 추가되지 않음)
   */
  private ignoreError(error: InlineError): void {
    try {
      Logger.log(`❌ 오류 무시: "${error.correction.original}"`);
      
      // 현재 오류 제거 (InlineModeService를 통해)
      if ((window as any).InlineModeService) {
        (window as any).InlineModeService.removeError(null, error.uniqueId);
        Logger.debug(`✅ 일시적 무시로 인한 오류 제거: ${error.uniqueId}`);
      }
      
      // 툴팁 숨김
      this.hide();
      
      // 사용자 알림
      new Notice(`"${error.correction.original}" 오류를 무시했습니다.`);
      
    } catch (err) {
      Logger.error('오류 무시 중 문제 발생:', err);
      new Notice('오류 무시에 실패했습니다.');
    }
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
   * 도움말 아이콘 생성 (Inline 모드용) - 모바일 최적화
   */
  private createInlineHelpIcon(helpText: string, container: HTMLElement, onIconClick: () => void): void {
    const helpIcon = container.createEl('span', { text: '?' });
    
    // 모바일 감지 (메서드 내에서 사용)
    const isMobile = Platform.isMobile;
    const isPhone = (Platform as any).isPhone || (window.innerWidth <= 480);
    
    helpIcon.style.cssText = `
      color: var(--text-muted);
      cursor: pointer;
      width: ${isMobile ? (isPhone ? '16px' : '18px') : '18px'};
      height: ${isMobile ? (isPhone ? '16px' : '18px') : '18px'};
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--text-muted);
      border-radius: 50%;
      font-size: ${isMobile ? (isPhone ? '8px' : '9px') : '10px'};
      font-weight: bold;
      transition: all 0.2s;
      background: var(--background-primary);
      flex-shrink: 0;
      line-height: 1;
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

    // 모바일 터치 피드백
    if (isMobile) {
      helpIcon.addEventListener('touchstart', (e) => {
        e.preventDefault();
        helpIcon.style.background = 'var(--interactive-hover)';
        helpIcon.style.borderColor = 'var(--text-normal)';
        helpIcon.style.color = 'var(--text-normal)';
        if ('vibrate' in navigator) {
          navigator.vibrate(10);
        }
      }, { passive: false });
      
      helpIcon.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onIconClick();
      }, { passive: false });
    }

    // 클릭 이벤트 - 도움말 상세 표시
    helpIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      onIconClick(); // 클릭 시 도움말 영역을 토글하도록 전달
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