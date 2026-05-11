import { InlineError } from '../types/interfaces';
import { Logger } from '../utils/logger';
import { setCssVariable } from '../utils/domUtils';
import { Platform, MarkdownView, Notice, App, Editor } from 'obsidian';
import { InlineModeService } from '../services/inlineModeService';

// ==================== Type Extensions ====================

/**
 * Platform 확장 - 모바일 기기 타입 감지
 */
interface ExtendedPlatform {
  isMobile: boolean;
  isMobileApp: boolean;
  isPhone?: boolean;
  isTablet?: boolean;
  isDesktopApp: boolean;
  isIosApp: boolean;
  isAndroidApp: boolean;
  isSafari: boolean;
  isDesktop: boolean;
  isMacOS: boolean;
  isWin: boolean;
  isLinux: boolean;
}

/**
 * HTMLElement 확장 - 툴팁 정리 함수 저장
 */
interface ExtendedHTMLElement extends HTMLElement {
  _cleanup?: () => void;
}

/**
 * Editor 확장 - CodeMirror 접근
 */
interface ExtendedEditor extends Editor {
  cm?: {
    dom?: HTMLElement;
    [key: string]: any;
  };
}

// ==========================================================

/**
 * 인라인 오류 툴팁 클래스
 * 호버/클릭 시 수정 제안을 표시하는 툴팁
 */
export class InlineTooltip {
  private tooltip: HTMLElement | null = null;
  private currentError: InlineError | null = null;
  private isVisible: boolean = false;
  private hoverTimeout: NodeJS.Timeout | null = null;
  private hideTimeout: NodeJS.Timeout | null = null;
  public isHovered: boolean = false; // 🔍 툴팁 호버 상태 추적

  // 모듈 수준 상태
  public keepOpenMode: boolean = false;
  public tooltipProtected: boolean = false;
  private app: App | null = null;

  /**
   * Obsidian App 인스턴스 설정
   */
  setApp(app: App): void {
    this.app = app;
  }

  /**
   * 툴팁 표시
   */
  show(error: InlineError, targetElement: HTMLElement, triggerType: 'hover' | 'click', mousePosition?: { x: number; y: number }): void {
    // 같은 오류에 대한 툴팁이 이미 표시 중이면 무시
    if (this.isVisible && this.currentError?.uniqueId === error.uniqueId) {
      Logger.debug(`인라인 툴팁 이미 표시 중: ${error.correction.original}`);
      return;
    }
    
    this.hide(true); // 기존 툴팁 강제 제거
    
    this.currentError = error;
    
    // 배경 커서 숨기기 - CSS로 에디터 영역 커서 제거
    this.hideCursorInBackground();
    
    // 모바일에서 키보드 숨기기 및 에디터 포커스 해제 (툴팁 보호)
    if (Platform.isMobile) {
      // 🔧 툴팁 보호 플래그 설정 (모바일에서는 툴팁 수동 닫기만 허용)
      this.tooltipProtected = true;
      
      setTimeout(() => {
        // 🔧 키보드 숨김 활성화 - 이전 방식 유지
        this.hideKeyboardAndBlurEditor();
        
        Logger.debug('📱 모바일 툴팁 보호 플래그 유지 - 수동 닫기만 허용');
      }, 100);
    }
    
    this.createTooltip(error, targetElement, triggerType);
    this.positionTooltip(targetElement, mousePosition);
    this.isVisible = true;

    Logger.log(`인라인 툴팁 표시: "${error.correction.original}" (${triggerType})`);
  }

  /**
   * 툴팁 숨김
   */
  hide(forceHide: boolean = false): void {
    // 🔧 모바일 툴팁 보호: 강제 숨김이 아닌 경우 자동 숨김 방지
    if (Platform.isMobile && !forceHide) {
      Logger.debug('📱 모바일 툴팁: 자동 숨김 무시 - 수동 닫기만 허용');
      return;
    }
    
    // 🔧 모바일에서 강제 숨김 시 보호 플래그 해제
    if (Platform.isMobile && forceHide) {
      this.tooltipProtected = false;
      Logger.debug('📱 모바일 툴팁: 수동 닫기로 보호 플래그 해제');
    }
    
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
    
    // 배경 커서 다시 보이기
    this.showCursorInBackground();
    
    this.isVisible = false;
    this.currentError = null;
    this.isHovered = false; // 🔍 호버 상태 초기화
    
    // 호버 타이머 정리
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }
    
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  /**
   * 지연 후 툴팁 숨기기 예약
   */
  private scheduleHide(delay: number): void {
    this.clearHideTimeout(); // 기존 타이머 정리
    
    this.hideTimeout = setTimeout(() => {
      if (!this.isHovered) {
        Logger.debug(`🕐 예약된 툴팁 숨기기 실행 (${delay}ms 후)`);
        this.hide();
      }
    }, delay);
  }

  /**
   * 툴팁 숨기기 타이머 취소
   */
  private clearHideTimeout(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
      Logger.debug('⏰ 툴팁 숨기기 타이머 취소');
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
    const isMobilePhone = Platform.isMobileApp;

    // Add platform modifier classes
    if (isMobile) {
      this.tooltip.classList.add('kga-mobile');
    }
    if (isMobilePhone) {
      this.tooltip.classList.add('kga-mobile-phone');
    }

    // 툴팁 전체 컨테이너 (세로 레이아웃) - 모바일 최적화
    // 🔧 모든 스타일은 CSS 클래스로 처리됨

    // 모바일에서 터치 이벤트 방지 (툴팁 자체 클릭 시 닫히지 않도록)
    if (isMobile) {
      this.tooltip.addEventListener('touchstart', (e) => {
        e.stopPropagation();
      }, { passive: true });
      
      this.tooltip.addEventListener('touchend', (e) => {
        e.stopPropagation();
      }, { passive: true });
    }

    // 🔍 툴팁 타입 결정 디버깅
    Logger.debug(`🔍 툴팁 타입 결정: "${error.correction.original}"`);
    Logger.debug(`  isMerged: ${error.isMerged}`);
    Logger.debug(`  originalErrors: ${error.originalErrors?.length || 0}개`);
    Logger.debug(`  correction.corrected: [${error.correction.corrected.join(', ')}]`);
    
    // 병합된 오류인 경우 원본 오류별로 구분해서 표시
    if (error.isMerged && error.originalErrors && error.originalErrors.length > 0) {
      Logger.debug(`🔧 병합된 툴팁 사용: ${error.originalErrors.length}개 원본 오류`);
      this.createMergedErrorTooltip(error, targetElement, triggerType);
    } else {
      Logger.debug(`🔧 단일 툴팁 사용`);
      this.createSingleErrorTooltip(error, targetElement, triggerType);
    }

    // 🔍 툴팁 호버 상태 이벤트 추가 (AI Widget 지속성 지원)
    this.tooltip.addEventListener('mouseenter', () => {
      this.isHovered = true;
      this.clearHideTimeout(); // 숨기기 타이머 취소
      Logger.debug('🖱️ 툴팁 마우스 진입 - 호버 상태 유지');
    });
    
    this.tooltip.addEventListener('mouseleave', () => {
      this.isHovered = false;
      Logger.debug('🖱️ 툴팁 마우스 이탈 - 호버 상태 해제');
      
      // AI 툴팁의 경우 더 긴 딜레이 (오프셋이 커서 마우스 이동 시간 필요)
      const isAITooltip = this.currentError?.aiStatus === 'corrected' || 
                         this.currentError?.aiStatus === 'exception' || 
                         this.currentError?.aiStatus === 'keep-original';
      const hideDelay = isAITooltip ? 800 : 300; // AI 툴팁은 800ms, 일반은 300ms
      
      this.scheduleHide(hideDelay);
    });

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
    const isPhone = (Platform as ExtendedPlatform).isPhone || (viewportWidth <= 480);
    const isTablet = (Platform as ExtendedPlatform).isTablet || (viewportWidth <= 768 && viewportWidth > 480);

    // 🔧 Obsidian App 정보 활용
    const app = this.app;
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
      // 모바일에서 고정 위치 UI 사용 여부 결정
      const useFixedPosition = isPhone; // 폰에서는 고정 위치, 태블릿은 기존 방식
      
      if (useFixedPosition) {
        this.positionTooltipMobileFixed(targetElement, targetRect, viewportWidth, viewportHeight, keyboardHeight, mousePosition);
      } else {
        this.positionTooltipMobile(targetElement, targetRect, viewportWidth, viewportHeight, keyboardHeight, isPhone, editorContainerRect, mousePosition);
      }
    } else {
      this.positionTooltipDesktop(targetElement, targetRect, viewportWidth, viewportHeight, editorContainerRect, mousePosition);
    }
  }

  /**
   * 모바일 고정 위치 툴팁 (화면 하단 고정)
   */
  private positionTooltipMobileFixed(
    targetElement: HTMLElement,
    targetRect: DOMRect,
    viewportWidth: number,
    viewportHeight: number,
    keyboardHeight: number,
    mousePosition?: { x: number; y: number }
  ): void {
    if (!this.tooltip) return;

    Logger.log('📱 모바일 고정 위치 툴팁 활성화');

    // AI 분석 영역이 있는지 확인
    const hasAIAnalysis = this.tooltip.querySelector('.kga-tooltip-ai-area') !== null;
    
    // 컴팩트한 크기 설정 (AI 분석에 따라 높이 조정)
    const fixedWidth = viewportWidth - 16; // 양쪽 8px씩만 마진
    const fixedHeight = hasAIAnalysis ? 110 : 85; // AI 분석 시 25px 추가

    // CSS 변수로 동적 크기 설정
    this.tooltip.classList.add('kga-fixed-position');
    if (hasAIAnalysis) {
      this.tooltip.classList.add('kga-has-ai');
    }
    setCssVariable(this.tooltip, '--kga-width', `${fixedWidth}px`);
    setCssVariable(this.tooltip, '--kga-fixed-height', `${fixedHeight}px`);

    // 화면 하단에 고정 (AI 분석에 따라 여백 조정)
    const safeBottomMargin = hasAIAnalysis ? 90 : 80; // AI 분석 시 적절한 여백
    const bottomOffset = keyboardHeight > 0 ? keyboardHeight + 12 : safeBottomMargin;

    const finalLeft = (viewportWidth - fixedWidth) / 2; // 중앙 정렬
    const finalTop = viewportHeight - fixedHeight - bottomOffset;

    // CSS 변수로 동적 위치 설정
    setCssVariable(this.tooltip, '--kga-left', `${finalLeft}px`);
    setCssVariable(this.tooltip, '--kga-top', `${finalTop}px`);

    Logger.log(`📱 고정 툴팁 (${hasAIAnalysis ? 'AI+' : '기본'}): ${fixedWidth}x${fixedHeight}px (${Math.round((fixedWidth / viewportWidth) * 100)}% 너비)`, {
      position: `(${finalLeft}, ${finalTop})`,
      bottomMargin: `${safeBottomMargin}px (${hasAIAnalysis ? 'AI 확장' : '기본'})`,
      keyboard: keyboardHeight > 0,
      aiAnalysis: hasAIAnalysis,
      target: targetElement.textContent?.substring(0, 15) || 'unknown'
    });
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

    // CSS 변수로 동적 크기 설정
    this.tooltip.classList.add('kga-dynamic-position');
    setCssVariable(this.tooltip, '--kga-width', `${adaptiveSize.width}px`);
    setCssVariable(this.tooltip, '--kga-max-height', `${adaptiveSize.maxHeight}px`);
    setCssVariable(this.tooltip, '--kga-min-width', `${adaptiveSize.minWidth}px`);
    setCssVariable(this.tooltip, '--kga-font-size', adaptiveSize.fontSize);

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
    
    const fingerOffset = mousePosition ? (isPhone ? 15 : 12) : (isPhone ? 25 : 20); // 터치 위치 있으면 줄임
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
      finalTop = referenceCenterY - adaptiveSize.maxHeight - (mousePosition ? 8 : 12);
      Logger.debug(`📱 위쪽 배치 (터치 최적화)`);
    } else if (spaceBelow > adaptiveSize.maxHeight + fingerOffset + safeMargin) {
      finalTop = referenceCenterY + (mousePosition ? 8 : 12);
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

    // 🔧 CSS 변수로 동적 위치 설정
    setCssVariable(this.tooltip, '--kga-left', `${finalLeft}px`);
    setCssVariable(this.tooltip, '--kga-top', `${finalTop}px`);
    // All styling (z-index, visibility, box-shadow, border-radius) handled by CSS classes

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

    // CSS 변수로 동적 크기 설정
    this.tooltip.classList.add('kga-dynamic-position');
    setCssVariable(this.tooltip, '--kga-width', `${adaptiveSize.width}px`);
    setCssVariable(this.tooltip, '--kga-max-height', `${adaptiveSize.maxHeight}px`);
    setCssVariable(this.tooltip, '--kga-min-width', `${adaptiveSize.minWidth}px`);
    setCssVariable(this.tooltip, '--kga-font-size', adaptiveSize.fontSize);

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
    
    // 🔧 디버깅: 하단 감지 조건 확인
    Logger.debug(`🔍 하단 감지: isBottomEdge=${isBottomEdge}, availableSpaceBelow=${availableSpaceBelow}, 필요공간=${adaptiveSize.maxHeight + smallOffset + minSpacing}, 마우스Y=${mousePosition?.y}, 에디터하단=${editorTop + editorHeight}`);

    if (isBottomEdge || availableSpaceBelow < adaptiveSize.maxHeight + smallOffset + minSpacing) {
      // 하단 구석이거나 아래쪽 공간 부족: 마우스/오류 바로 위쪽에 배치
      if (mousePosition) {
        // 마우스 위치 기반: AI 상태에 따른 오프셋 적용
        const isAIError = this.currentError?.aiStatus === 'corrected' || this.currentError?.aiStatus === 'exception' || this.currentError?.aiStatus === 'keep-original';
        const mouseOffset = isAIError ? 120 : 80; // AI 툴팁은 더 큰 오프셋 필요
        finalTop = mousePosition.y - mouseOffset;
      } else {
        // 요소 기반: AI 상태에 따른 오프셋 적용 (AI 툴팁은 더 길어서 더 큰 오프셋 필요)
        const isAIError = this.currentError?.aiStatus === 'corrected' || this.currentError?.aiStatus === 'exception' || this.currentError?.aiStatus === 'keep-original';
        const aiOffset = isAIError ? 100 : smallOffset; // AI 오류에는 100px 오프셋 적용
        finalTop = referenceRect.top - adaptiveSize.maxHeight - aiOffset;
      }
      Logger.debug(`🖥️하단/공간부족: 바로 위쪽 배치 (finalTop: ${finalTop}, 마우스: ${mousePosition ? `(${mousePosition.x}, ${mousePosition.y})` : '없음'}, AI상태: ${this.currentError?.aiStatus || 'none'}, 공간: ${availableSpaceBelow}px)`);
    } else {
      // 아래쪽에 충분한 공간: 참조점 바로 아래 배치
      finalTop = referenceRect.bottom + smallOffset;
      Logger.debug(`🖥️ 아래쪽 배치 (finalTop: ${finalTop}, 참조bottom: ${referenceRect.bottom}, 공간: ${availableSpaceBelow}px)`);
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
    
    // 🔧 하단 영역에서는 더 관대한 경계 보정 (마우스 근처 배치 우선)
    if (isBottomEdge || availableSpaceBelow < adaptiveSize.maxHeight + smallOffset + minSpacing) {
      // 하단에서는 마우스 위치 우선 (경계 보정 최소화)
      finalTop = Math.max(50, finalTop); // 최소 50px만 확보하고 마우스 위치 우선
      Logger.debug(`🖥️ 하단 영역: 마우스 우선 배치 (finalTop: ${finalTop}, 원래계산: ${mousePosition ? mousePosition.y - 150 : 'N/A'})`);
    } else {
      // 일반 영역에서는 기존 로직 사용
      finalTop = Math.max(
        Math.max(minSpacing, editorTop), 
        Math.min(finalTop, Math.min(viewportHeight, editorTop + editorHeight) - adaptiveSize.maxHeight - minSpacing)
      );
    }

    // 🔧 CSS 변수로 동적 위치 설정
    this.tooltip.classList.add('kga-desktop');
    setCssVariable(this.tooltip, '--kga-left', `${finalLeft}px`);
    setCssVariable(this.tooltip, '--kga-top', `${finalTop}px`);

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
  private createMergedErrorTooltip(mergedError: InlineError, targetElement: HTMLElement, triggerType: 'hover' | 'click'): void {
    if (!this.tooltip || !mergedError.originalErrors) return;

    // 모바일 최적화를 위한 플랫폼 감지 (단일 툴팁과 일관성)
    const isMobile = Platform.isMobile;
    const isPhone = Platform.isPhone;

    // 🔧 먼저 중복 제거된 오류 계산 (헤더에서 사용하기 위해)
    Logger.debug(`🔍 병합된 툴팁 생성: ${mergedError.originalErrors.length}개 원본 오류`);
    mergedError.originalErrors.forEach((error, index) => {
      Logger.debug(`  ${index + 1}. "${error.correction.original}" → [${error.correction.corrected.join(', ')}]`);
    });
    
    const uniqueOriginalErrors = mergedError.originalErrors.filter((error, index, arr) => 
      arr.findIndex(e => e.correction.original === error.correction.original) === index
    );
    
    Logger.warn(`🔧 중복된 원본 오류 제거: ${mergedError.originalErrors.length}개 → ${uniqueOriginalErrors.length}개`);
    if (mergedError.originalErrors.length !== uniqueOriginalErrors.length) {
      Logger.warn(`🔧 이것이 툴팁에서 동일한 제안이 여러 번 나타나는 원인입니다!`);
    }

    // 헤더 영역 - 닫기 버튼 포함
    const header = this.tooltip.createEl('div', { cls: 'kga-tooltip-header' });
    if (isMobile) header.classList.add('kga-mobile');
    if (isPhone) header.classList.add('kga-mobile-phone');

    // 🔧 헤더 텍스트 (필터링된 개수 반영)
    const headerText = header.createEl('span', {
      text: `${uniqueOriginalErrors.length}개 오류 병합됨`,
      cls: 'kga-header-text'
    });

    // 우상단 닫기 버튼 (✕) - 순수 아이콘만
    const headerCloseButton = header.createEl('button', {
      text: '✕',
      cls: 'kga-header-close-button'
    });
    if (isMobile) headerCloseButton.classList.add('kga-mobile');
    if (isPhone) headerCloseButton.classList.add('kga-mobile-phone');

    // 닫기 버튼 이벤트 - CSS hover states handle the visual feedback
    // Touch feedback for mobile
    if (isMobile) {
      headerCloseButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if ('vibrate' in navigator) {
          navigator.vibrate(10);
        }
      }, { passive: false });

      headerCloseButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hide(true); // 강제 닫기
      }, { passive: false });
    }

    headerCloseButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide(true); // 강제 닫기
    });

    // 스크롤 가능한 내용 영역 - 모바일 최적화
    const scrollContainer = this.tooltip.createEl('div', { cls: 'kga-tooltip-scroll-container' });
    if (isMobile) scrollContainer.classList.add('kga-mobile');
    if (isPhone) scrollContainer.classList.add('kga-mobile-phone');

    // 🔍 각 원본 오류별로 섹션 생성 - 모바일 최적화 (이미 중복 제거됨)
    uniqueOriginalErrors.forEach((originalError, index) => {
      const errorSection = scrollContainer.createEl('div', { cls: 'kga-error-section' });
      if (isMobile) errorSection.classList.add('kga-mobile');
      if (isPhone) errorSection.classList.add('kga-mobile-phone');
      if (index > 0) errorSection.classList.add('kga-bordered');

      // 한 줄 레이아웃 (오류 → 제안들) - 모바일 최적화
      const errorLine = errorSection.createEl('div', { cls: 'kga-error-line' });
      if (isMobile) errorLine.classList.add('kga-mobile');
      if (isPhone) errorLine.classList.add('kga-mobile-phone');

      // 오류 단어 표시 (고정 너비) - 모바일 최적화
      const errorWord = errorLine.createEl('span', {
        text: originalError.correction.original,
        cls: 'kga-error-word'
      });
      if (isMobile) errorWord.classList.add('kga-mobile');
      if (isPhone) errorWord.classList.add('kga-mobile-phone');

      // 화살표 (고정) - 모바일 최적화
      const arrow = errorLine.createEl('span', { text: '→', cls: 'kga-arrow' });
      if (isMobile) arrow.classList.add('kga-mobile');
      if (isPhone) arrow.classList.add('kga-mobile-phone');

      // 수정 제안들을 가로로 나열 (남은 공간 활용) - 모바일 최적화
      const suggestionsList = errorLine.createEl('div', { cls: 'kga-suggestions-list' });
      if (isMobile) suggestionsList.classList.add('kga-mobile');
      if (isPhone) suggestionsList.classList.add('kga-mobile-phone');

      // 🔧 수정 제안들 (중복 제거 강화) - 모바일 최적화
      const uniqueSuggestions = [...new Set(originalError.correction.corrected)];
      Logger.debug(`🔧 병합된 툴팁 제안 중복 제거: ${originalError.correction.corrected.length}개 → ${uniqueSuggestions.length}개`);
      
      uniqueSuggestions.forEach((suggestion, index) => {
        const suggestionButton = suggestionsList.createEl('span', {
          text: suggestion,
          cls: 'kga-suggestion-button'
        });
        if (isMobile) suggestionButton.classList.add('kga-mobile');
        if (isPhone) suggestionButton.classList.add('kga-mobile-phone');

        // CSS handles hover states, only need touch feedback for mobile
        if (isMobile) {
          suggestionButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if ('vibrate' in navigator) {
              navigator.vibrate(10);
            }
          }, { passive: false });

          suggestionButton.addEventListener('touchend', (e) => {
            e.preventDefault();
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
        const helpContainer = errorLine.createEl('div', { cls: 'kga-help-container' });

        // 📖 도움말을 하단에 표시하는 인라인 방식 사용
        this.createInlineHelpIcon(originalError.correction.help, helpContainer, () => {
          let helpArea = this.tooltip!.querySelector('.kga-tooltip-help-area') as HTMLElement;
          if (!helpArea) {
            // 도움말 영역 생성
            helpArea = this.tooltip!.createEl('div', { cls: 'kga-tooltip-help-area' });
            if (isMobile) helpArea.classList.add('kga-mobile');
            if (isPhone) helpArea.classList.add('kga-mobile-phone');
            helpArea.textContent = originalError.correction.help;
          } else {
            // 도움말 영역 토글 (숨기기/보이기)
            const isHidden = helpArea.hasClass('kga-hidden');
            helpArea.toggleClass('kga-hidden', !isHidden);
            if (isHidden) {
              // 새로운 도움말로 내용 업데이트
              helpArea.textContent = originalError.correction.help;
            }
          }
        });
      }
    });

    // 하단 액션 컨테이너 (도움말 및 버튼들) - 아이폰 최적화
    const actionsContainer = this.tooltip.createEl('div', { cls: 'kga-tooltip-actions' });
    if (isMobile) actionsContainer.classList.add('kga-mobile');
    if (isPhone) actionsContainer.classList.add('kga-mobile-phone');

    // 정보 텍스트 - 아이폰 최적화
    const infoText = actionsContainer.createEl('span', {
      text: isMobile ? (isPhone ? '개별 수정' : '개별 클릭 수정') : '개별 클릭으로 하나씩 수정',
      cls: 'kga-info-text'
    });
    if (isMobile) infoText.classList.add('kga-mobile');
    if (isPhone) infoText.classList.add('kga-mobile-phone');

    // 액션 버튼들 컨테이너 - 아이폰 최적화
    const actionButtons = actionsContainer.createEl('div', { cls: 'kga-action-buttons' });
    if (isMobile) actionButtons.classList.add('kga-mobile');
    if (isPhone) actionButtons.classList.add('kga-mobile-phone');

    // ❌ 병합된 오류 전체 무시 버튼 - 체크박스와 일관된 스타일
    const ignoreAllButton = actionButtons.createEl('button', { cls: 'kga-ignore-all-button' });
    ignoreAllButton.textContent = '✕'; // X 표시
    ignoreAllButton.title = '이 오류들 모두 무시';
    if (isMobile) ignoreAllButton.classList.add('kga-mobile');
    if (isPhone) ignoreAllButton.classList.add('kga-mobile-phone');

    // CSS handles hover states, only need touch feedback for mobile
    if (Platform.isMobile) {
      ignoreAllButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if ('vibrate' in navigator) {
          navigator.vibrate(15); // 체크박스와 동일한 강도
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

    // 모든 수정 적용 버튼 - 녹색 체크로 변경
    const applyAllButton = actionButtons.createEl('button', {
      text: '✓',
      cls: 'kga-apply-all-button'
    });
    applyAllButton.title = '모든 수정 사항 적용';
    if (isMobile) applyAllButton.classList.add('kga-mobile');
    if (isPhone) applyAllButton.classList.add('kga-mobile-phone');

    // CSS handles hover states, only need touch feedback for mobile
    if (isMobile) {
      applyAllButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if ('vibrate' in navigator) {
          navigator.vibrate(15); // 좀 더 강한 피드백
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
        this.hide(true); // 강제 닫기
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
      
      this.hide(true); // 강제 닫기
    });



    // 호버 상태 관리 (병합된 오류용)
    this.setupHoverEvents(targetElement);
  }

  /**
   * 호버 이벤트 설정 (데스크톱 전용 - 모바일에서는 수동 닫기만)
   */
  private setupHoverEvents(targetElement: HTMLElement): void {
    // 🔧 모바일에서는 호버 이벤트 설정하지 않음 (수동 닫기만)
    if (Platform.isMobile) {
      Logger.debug('📱 모바일: 호버 이벤트 설정 생략 - 수동 닫기만 허용');
      return;
    }
    
    let hideTimeout: NodeJS.Timeout | undefined;
    let isHovering = false;
    
    const startHideTimer = () => {
      if (hideTimeout) clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => {
        if (!isHovering) {
          Logger.debug('🔍 툴팁 자동 숨김');
          this.hide(true); // 강제 닫기
        }
      }, 2000); // 2초로 매우 여유롭게
    };

    const cancelHideTimer = () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = undefined;
      }
    };

    const setHovering = (hovering: boolean) => {
      isHovering = hovering;
      if (hovering) {
        cancelHideTimer();
        Logger.debug('🔍 호버 시작 - 타이머 취소');
      } else {
        Logger.debug('🔍 호버 종료 - 타이머 시작');
        startHideTimer();
      }
    };

    // 🎯 통합된 마우스 이벤트 처리
    const handleMouseEvent = (e: MouseEvent) => {
      if (!this.tooltip) return;
      
      const target = e.target as HTMLElement;
      const isOnTarget = targetElement.contains(target) || targetElement === target;
      const isOnTooltip = this.tooltip.contains(target) || this.tooltip === target;
      
      setHovering(isOnTarget || isOnTooltip);
    };

    // 🔧 모든 마우스 이벤트를 document에서 캐치
    const onMouseMove = (e: MouseEvent) => handleMouseEvent(e);
    const onMouseOver = (e: MouseEvent) => handleMouseEvent(e);
    
    // 🔧 툴팁 외부 클릭 시 즉시 숨김
    const onMouseClick = (e: MouseEvent) => {
      if (!this.tooltip) return;
      
      const target = e.target as HTMLElement;
      const isOnTarget = targetElement.contains(target) || targetElement === target;
      const isOnTooltip = this.tooltip.contains(target) || this.tooltip === target;
      
      if (!isOnTarget && !isOnTooltip) {
        Logger.debug('🔍 외부 클릭 - 즉시 숨김');
        this.hide(true); // 강제 닫기
      }
    };

    // 이벤트 리스너 등록 (document 레벨)
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseover', onMouseOver, { passive: true });
    document.addEventListener('click', onMouseClick);

    // 초기 타이머 시작
    startHideTimer();

    // 정리 함수 저장
    (this.tooltip as ExtendedHTMLElement)._cleanup = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('click', onMouseClick);
      if (hideTimeout) clearTimeout(hideTimeout);
      Logger.debug('🔍 호버 이벤트 정리 완료');
    };
  }

  /**
   * 단일 오류용 툴팁 생성 (기존 로직 유지)
   */
  private createSingleErrorTooltip(error: InlineError, targetElement: HTMLElement, triggerType: 'hover' | 'click'): void {
    if (!this.tooltip) return;

    // 🤖 최신 AI 분석 결과가 포함된 오류 객체 가져오기
    const latestError = InlineModeService.getErrorWithAIData(error.uniqueId);
    if (latestError) {
      error = latestError;
      Logger.debug(`🤖 툴팁 오류 정보 업데이트: ${error.correction.original} - AI 상태: ${error.aiStatus || 'none'}`);
    } else {
      Logger.debug(`🤖 툴팁 생성: ${error.correction.original} - 기존 AI 상태: ${error.aiStatus || 'none'}`);
    }

    // 모바일 최적화를 위한 플랫폼 감지 (메서드 전체에서 사용)
    const isMobile = Platform.isMobile;
    const isPhone = (Platform as ExtendedPlatform).isPhone || (window.innerWidth <= 480);

    // 헤더 영역 - 컴팩트한 크기로 축소
    const header = this.tooltip.createEl('div', { cls: 'tooltip-header kga-single' });
    if (isMobile) header.classList.add('kga-mobile');
    if (isPhone) header.classList.add('kga-mobile-phone');

    // 헤더 텍스트 - 컴팩트
    const headerText = header.createEl('span', {
      text: '맞춤법 오류',
      cls: 'kga-header-text kga-single'
    });
    if (isMobile) headerText.classList.add('kga-mobile');
    if (isPhone) headerText.classList.add('kga-mobile-phone');

    // 우상단 닫기 버튼 (✕) - 더 작게
    const headerCloseButton = header.createEl('button', {
      text: '✕',
      cls: 'kga-header-close-button kga-single'
    });
    if (isMobile) headerCloseButton.classList.add('kga-mobile');
    if (isPhone) headerCloseButton.classList.add('kga-mobile-phone');

    // CSS handles hover states, only need touch feedback for mobile
    if (isMobile) {
      headerCloseButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if ('vibrate' in navigator) {
          navigator.vibrate(10);
        }
      }, { passive: false });

      headerCloseButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hide(true); // 강제 닫기
      }, { passive: false });
    }

    headerCloseButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide(true); // 강제 닫기
    });

    // 상단 메인 콘텐츠 영역 - 컴팩트한 패딩
    const mainContent = this.tooltip.createEl('div', { cls: 'kga-tooltip-main-content' });
    if (isMobile) mainContent.classList.add('kga-mobile');
    if (isPhone) mainContent.classList.add('kga-mobile-phone');

    // 오류 단어 표시 (간소화) - 모바일 최적화 + 형태소 정보
    const errorWordContainer = mainContent.createEl('div', { cls: 'kga-error-word-container' });

    const errorWord = errorWordContainer.createEl('span', {
      text: error.correction.original,
      cls: 'kga-error-word'
    });

    // 🎨 AI 상태에 따른 색상 및 스타일 설정 (CSS 클래스로 적용)
    if (error.aiStatus) {
      errorWord.classList.add(`kga-ai-${error.aiStatus}`);
    }
    if (isMobile) {
      errorWord.classList.add('kga-mobile');
    }
    if (isPhone) {
      errorWord.classList.add('kga-mobile-phone');
    }
    
    // 🖱️ 클릭 처리는 InlineModeService에서 담당 (중복 이벤트 방지)
    // errorWord에는 별도 클릭 이벤트를 등록하지 않음

    // 형태소 정보 표시 (중요한 품사만)
    if (error.morphemeInfo && this.isImportantPos(error.morphemeInfo.mainPos, error.morphemeInfo.tags)) {
      const posInfo = errorWordContainer.createEl('span', {
        text: error.morphemeInfo.mainPos,
        cls: 'kga-pos-info'
      });
      if (isMobile) {
        posInfo.classList.add('kga-mobile');
      }
    }

    // 화살표 - 모바일 최적화
    const arrow = mainContent.createEl('span', { text: '→', cls: 'kga-arrow' });
    if (isMobile) {
      arrow.classList.add('kga-mobile');
    }
    if (isPhone) {
      arrow.classList.add('kga-mobile-phone');
    }

    // 수정 제안들을 가로로 나열 - 모바일 최적화
    const suggestionsList = mainContent.createEl('div', { cls: 'kga-suggestions-list' });
    if (isMobile) {
      suggestionsList.classList.add('kga-mobile');
    }
    if (isPhone) {
      suggestionsList.classList.add('kga-mobile-phone');
    }

    // 🔧 수정 제안들 (중복 제거 강화)
    const uniqueSuggestions = [...new Set(error.correction.corrected)];
    Logger.debug(`🔧 툴팁 제안 중복 제거: ${error.correction.corrected.length}개 → ${uniqueSuggestions.length}개`);
    
    uniqueSuggestions.forEach((suggestion, index) => {
      const suggestionButton = suggestionsList.createEl('span', {
        text: suggestion,
        cls: 'kga-suggestion-button'
      });

      if (isMobile) {
        suggestionButton.classList.add('kga-mobile');
      }
      if (isPhone) {
        suggestionButton.classList.add('kga-mobile-phone');
      }

      // 모바일 터치 피드백 (진동만)
      if (isMobile) {
        suggestionButton.addEventListener('touchstart', (e) => {
          e.preventDefault();
          if ('vibrate' in navigator) {
            navigator.vibrate(10);
          }
        }, { passive: false });

        suggestionButton.addEventListener('touchend', (e) => {
          e.preventDefault();

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

    // 액션 영역 (아이폰 최적화) - 메인 콘텐츠 내부로 이동
    const actionsContainer = mainContent.createEl('div', { cls: 'kga-actions-container' });
    if (isMobile) {
      actionsContainer.classList.add('kga-mobile');
    }
    if (isPhone) {
      actionsContainer.classList.add('kga-mobile-phone');
    }

    // 📚 예외 단어 추가 버튼 (책 아이콘) - 모바일 최적화
    const exceptionButton = actionsContainer.createEl('button', { cls: 'kga-exception-button' });
    exceptionButton.textContent = '📚'; // 책 아이콘
    exceptionButton.title = '예외 단어로 추가';

    if (isMobile) {
      exceptionButton.classList.add('kga-mobile');
    }
    if (isPhone) {
      exceptionButton.classList.add('kga-mobile-phone');
    }

    // 모바일 터치 피드백 (진동만)
    if (isMobile) {
      exceptionButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if ('vibrate' in navigator) {
          navigator.vibrate(10);
        }
      }, { passive: false });

      exceptionButton.addEventListener('touchend', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.addToExceptionWords(error);
      }, { passive: false });
    }

    // 클릭 이벤트
    exceptionButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.addToExceptionWords(error);
    });

    // ❌ 오류 무시 버튼 (일시적 무시) - 모바일 최적화
    const ignoreButton = actionsContainer.createEl('button', { cls: 'kga-ignore-button' });
    ignoreButton.textContent = '❌'; // X 표시
    ignoreButton.title = '이 오류 무시 (일시적)';

    if (isMobile) {
      ignoreButton.classList.add('kga-mobile');
    }
    if (isPhone) {
      ignoreButton.classList.add('kga-mobile-phone');
    }

    // 모바일 터치 피드백 (진동만)
    if (isMobile) {
      ignoreButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
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
          helpArea = this.tooltip!.createEl('div', { cls: 'kga-tooltip-help-area' });
          if (isMobile) {
            helpArea.classList.add('kga-mobile');
          }
          if (isPhone) {
            helpArea.classList.add('kga-mobile-phone');
          }
          helpArea.textContent = error.correction.help;
        } else {
          // 도움말 영역 토글 (숨기기/보이기)
          const isHidden = helpArea.hasClass('kga-hidden');
          helpArea.toggleClass('kga-hidden', !isHidden);
        }
      });
    }

    // 🤖 AI 분석 결과 영역 (도움말 영역 아래)
    if (error.aiAnalysis) {
      const aiArea = this.tooltip!.createEl('div', { cls: 'kga-tooltip-ai-area' });
      if (isMobile) {
        aiArea.classList.add('kga-mobile');
      }
      if (isPhone) {
        aiArea.classList.add('kga-mobile-phone');
      }

      // 🤖 AI 아이콘
      const aiIcon = aiArea.createEl('span', { text: '🤖', cls: 'kga-ai-icon' });

      // AI 추천 이유 간단 표시
      const reasoningText = aiArea.createEl('span', { cls: 'kga-ai-reasoning' });

      // AI 분석 이유를 짧게 표시 (첫 번째 문장만)
      if (error.aiAnalysis.reasoning) {
        const shortReason = error.aiAnalysis.reasoning.split('.')[0] + '.';
        reasoningText.textContent = shortReason;
      } else {
        // 이유가 없으면 신뢰도만 표시
        reasoningText.textContent = `신뢰도 ${error.aiAnalysis.confidence}%`;
      }
    }

    // 클릭 모드가 아닌 경우 마우스 떠나면 자동 숨김 (개선된 로직)
    if (triggerType === 'hover') {
      this.setupHoverEvents(targetElement);
    } else {
      // 클릭 모드에서는 플랫폼별 닫기 방식
      if (Platform.isMobile) {
        // 🔧 모바일: 닫기 버튼이나 수정 제안 클릭으로만 닫기
        Logger.debug('📱 모바일 툴팁: 수동 닫기 모드 (닫기 버튼 또는 수정 적용으로만 닫힘)');
      } else {
        // 데스크톱: 바깥 클릭으로 닫기
        setTimeout(() => {
          document.addEventListener('click', this.handleOutsideClick.bind(this), { once: true });
        }, 0);
      }
    }
  }

  /**
   * 수정 제안 적용 (클릭 후 툴팁 유지)
   */
  private applySuggestionKeepOpen(mergedError: InlineError, suggestion: string, targetElement: HTMLElement): void {
    Logger.log(`인라인 모드: 수정 제안 적용 (클릭 후 툴팁 유지) - "${mergedError.correction.original}" → "${suggestion}"`);
    
    // 툴팁 유지 모드 플래그 설정
    this.keepOpenMode = true;

    // 🔧 직접 import한 InlineModeService 사용
    try {
      InlineModeService.applySuggestion(mergedError, suggestion);
      Logger.log(`✅ 병합된 오류 수정 적용 성공: "${mergedError.correction.original}" → "${suggestion}"`);
    } catch (error) {
      Logger.error('❌ 수정 제안 적용 중 오류:', error);
    }

    // 툴팁 유지 모드 해제 (약간의 지연 후)
    setTimeout(() => {
      this.keepOpenMode = false;
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
      this.hide(true); // 강제 닫기
    } catch (error) {
      Logger.error('❌ 수정 제안 적용 중 오류:', error);
    }
  }

  /**
   * 📚 예외 단어로 추가 (동일한 단어의 모든 오류 제거)
   */
  private async addToExceptionWords(error: InlineError): Promise<void> {
    const word = error.correction.original;
    
    try {
      // InlineModeService의 메서드로 동일 단어 모든 오류 제거
      const removedCount = await InlineModeService.addWordToIgnoreListAndRemoveErrors(word);

      if (removedCount > 0) {
        Logger.log(`📚 예외 단어 추가 및 ${removedCount}개 오류 제거: "${word}"`);
        new Notice(`"${word}"를 예외 단어로 추가했습니다. (${removedCount}개 오류 제거)`);
      } else {
        new Notice(`"${word}"는 이미 예외 단어로 등록되어 있습니다.`);
      }

      // 툴팁 숨김
      this.hide(true); // 강제 닫기
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
      InlineModeService.removeError(null, error.uniqueId);
      Logger.debug(`✅ 일시적 무시로 인한 오류 제거: ${error.uniqueId}`);
      
      // 툴팁 숨김
      this.hide(true); // 강제 닫기
      
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
      this.hide(true); // 강제 닫기
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
    const helpIcon = container.createEl('span', { text: '?', cls: 'kga-help-icon' });

    // 모바일 감지 (메서드 내에서 사용)
    const isMobile = Platform.isMobile;
    const isPhone = (Platform as ExtendedPlatform).isPhone || (window.innerWidth <= 480);

    if (isMobile) {
      helpIcon.classList.add('kga-mobile');
    }
    if (isPhone) {
      helpIcon.classList.add('kga-mobile-phone');
    }

    helpIcon.title = helpText;

    // 모바일 터치 피드백 (진동만)
    if (isMobile) {
      helpIcon.addEventListener('touchstart', (e) => {
        e.preventDefault();
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

    // 🔧 [필수] DOM 크기 측정을 위한 임시 CSS 클래스 적용
    // kga-tooltip-measuring 클래스가 !important로 측정에 필요한 스타일을 오버라이드:
    // position: absolute, visibility: hidden, display: block,
    // width: auto, --kga-width: auto, max-width: none, min-width: none
    // 클래스 제거 시 원래 스타일시트/인라인 값이 자동으로 복원됨
    this.tooltip.classList.add('kga-tooltip-measuring');
    
    // 📏 실제 내용 크기 측정
    const naturalWidth = this.tooltip.scrollWidth;
    const naturalHeight = this.tooltip.scrollHeight;
    
    Logger.debug(`📏 툴팁 자연 크기: ${naturalWidth}x${naturalHeight}`);
    
    // 🔧 플랫폼별 크기 범위 설정
    let minWidth: number, maxWidth: number, maxHeight: number, fontSize: string;
    
    if (Platform.isMobile) {
      fontSize = isPhone ? '13px' : '14px';
      minWidth = isPhone ? 240 : 280; // 최소 너비 증가
      maxWidth = Math.min(
        isPhone ? 340 : 400, // 최대 너비 증가
        Math.min(viewportWidth, editorWidth) - 24 // 더 안전한 여백
      );
      
      const availableHeight = Math.min(viewportHeight, editorHeight) - keyboardHeight - 80; // 더 안전한 여백
      maxHeight = Math.min(
        isPhone ? 240 : 280, // 최대 높이 증가 
        Math.max(160, availableHeight * 0.65) // 최소 160px 보장
      );
    } else {
      fontSize = '14px';
      minWidth = 180;
      maxWidth = Math.min(500, Math.min(viewportWidth, editorWidth) - 40);
      maxHeight = Math.min(300, Math.min(viewportHeight, editorHeight) - 40);
    }
    
    // 🔧 내용에 맞는 최적 너비 계산 (아이폰 최적화)
    let optimalWidth = naturalWidth + (Platform.isMobile ? (isPhone ? 32 : 28) : 24); // 모바일에서 더 넉넉한 패딩
    
    // 내용이 너무 짧으면 최소 너비 보장
    optimalWidth = Math.max(minWidth, optimalWidth);
    
    // 내용이 너무 길면 최대 너비로 제한
    optimalWidth = Math.min(maxWidth, optimalWidth);
    
    // 🔧 원래 스타일 복원 - 측정용 CSS 클래스 제거로 자동 복원
    this.tooltip.classList.remove('kga-tooltip-measuring');
    
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

  /**
   * 배경 커서 숨기기
   */
  private hideCursorInBackground(): void {
    // 에디터 영역의 커서를 숨기기 위한 CSS 클래스 추가
    const editorElements = document.querySelectorAll('.cm-editor');
    editorElements.forEach(editor => {
      editor.classList.add('korean-tooltip-cursor-hidden');
    });

    // CSS rules are defined in styles.css (.korean-tooltip-cursor-hidden)
  }

  /**
   * 배경 커서 다시 보이기
   */
  private showCursorInBackground(): void {
    // 에디터 영역의 커서 숨김 클래스 제거
    const editorElements = document.querySelectorAll('.cm-editor');
    editorElements.forEach(editor => {
      editor.classList.remove('korean-tooltip-cursor-hidden');
    });
  }

  /**
   * 에디터 포커스만 해제 (키보드는 유지) - 깜빡임 없는 대안
   */
  private blurEditorOnly(): void {
    try {
      // 옵시디언 API를 통한 에디터 포커스 해제만
      const obsidianApp = this.app;
      if (obsidianApp) {
        const activeView = obsidianApp.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.editor) {
          const extendedEditor = activeView.editor as ExtendedEditor;
          if (activeView.editor.hasFocus()) {
            Logger.log('📱 에디터 포커스만 해제 (키보드 유지)');
            activeView.editor.blur();

            // CodeMirror 에디터 직접 접근
            const cmEditor = extendedEditor.cm;
            if (cmEditor && cmEditor.dom) {
              cmEditor.dom.blur();
            }
          }
        }
      }

      // DOM 레벨에서 포커스 해제
      const focusedElement = document.activeElement as HTMLElement;
      if (focusedElement && focusedElement.blur) {
        focusedElement.blur();
        Logger.log('📱 DOM 포커스 해제 완료 (키보드는 유지)');
      }

    } catch (error) {
      Logger.warn('📱 에디터 포커스 해제 중 오류:', error);
    }
  }

  /**
   * 모바일에서 키보드 숨기기 및 에디터 포커스 해제
   */
  private hideKeyboardAndBlurEditor(): void {
    try {
      // 1. 옵시디언 API를 통한 에디터 포커스 해제
      const obsidianApp = this.app;
      if (obsidianApp) {
        const activeView = obsidianApp.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.editor) {
          // 에디터가 포커스되어 있는지 확인 후 포커스 해제
          const extendedEditor = activeView.editor as ExtendedEditor;
          if (activeView.editor.hasFocus()) {
            Logger.log('📱 모바일: 에디터 포커스 해제 시작');
            activeView.editor.blur();

            // CodeMirror 에디터 직접 접근
            const cmEditor = extendedEditor.cm;
            if (cmEditor && cmEditor.dom) {
              cmEditor.dom.blur();
            }
          }
        }
      }

      // 2. DOM 레벨에서 모든 포커스 가능한 요소 포커스 해제
      const focusedElement = document.activeElement as HTMLElement;
      if (focusedElement && focusedElement.blur) {
        focusedElement.blur();
        Logger.log('📱 모바일: DOM 포커스 해제 완료');
      }

      // 3. CodeMirror 에디터 포커스 해제 (추가 안전장치)
      const cmEditors = document.querySelectorAll('.cm-editor .cm-content');
      cmEditors.forEach(editor => {
        if (editor instanceof HTMLElement) {
          editor.blur();
        }
      });

      // 4. 키보드 숨기기 - 더 부드러운 방식 (깜빡임 최소화)
      const hiddenInput = document.createElement('input');
      hiddenInput.className = 'kga-hidden-input';
      document.body.appendChild(hiddenInput);
      
      // 더 짧은 지연시간으로 깜빡임 최소화
      setTimeout(() => {
        hiddenInput.focus();
        // 즉시 블러 처리로 깜빡임 시간 단축
        setTimeout(() => {
          hiddenInput.blur();
          setTimeout(() => {
            document.body.removeChild(hiddenInput);
            Logger.log('📱 모바일: 키보드 숨김 처리 완료 (최적화됨)');
          }, 10);
        }, 10);
      }, 50);

      // 5. 뷰포트 변경 시 툴팁 재배치 비활성화 (오프셋 변경 방지)
      // 키보드 숨김 후 자동 위치 재조정은 오프셋을 변경시키므로 비활성화
      Logger.debug('📱 뷰포트 변경 핸들러 비활성화 - 툴팁 위치 고정 유지');

    } catch (error) {
      Logger.warn('📱 모바일 키보드 숨김 중 오류:', error);
    }
  }

  /**
   * 중요한 품사인지 확인합니다.
   * 일반명사, 동사, 형용사 등은 숨기고 고유명사, 외국어 등만 표시합니다.
   */
  private isImportantPos(mainPos: string, tags: string[]): boolean {
    // 중요한 품사 목록 (사용자에게 유용한 정보)
    const importantPos = [
      '고유명사',    // 고유명사 (인명, 지명 등)
      '외국어',      // 외국어
      '한자',        // 한자어  
      '숫자',        // 숫자
      '의존명사',    // 의존명사 (특별한 용법)
    ];

    // 메인 품사가 중요한 품사인지 확인
    if (importantPos.includes(mainPos)) {
      return true;
    }

    // 형태소 태그로도 확인
    if (tags && tags.length > 0) {
      const importantTags = ['NNP', 'SL', 'SH', 'SN', 'NNB'];
      return tags.some(tag => importantTags.includes(tag));
    }

    return false;
  }

  /**
   * 🎨 AI 상태에 따른 오류 단어 스타일 반환
   */
  private getErrorWordStyle(error: InlineError): { color: string; backgroundColor: string; cursor: string } {
    const aiStatus = error.aiStatus;
    
    switch (aiStatus) {
      case 'corrected': // 🟢 녹색 (AI 교정)
        return {
          color: '#10b981', // 녹색
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          cursor: 'pointer'
        };
      
      case 'exception': // 🔵 파란색 (예외 처리)
        return {
          color: '#3b82f6', // 파란색
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          cursor: 'pointer'
        };
      
      case 'keep-original': // 🟠 주황색 (원본 유지)
        return {
          color: '#f59e0b', // 주황색
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          cursor: 'pointer'
        };
      
      default: // 🔴 빨간색 (기본)
        return {
          color: 'var(--text-error)', // 빨간색
          backgroundColor: 'rgba(255, 0, 0, 0.1)',
          cursor: 'pointer'
        };
    }
  }

  /**
   * 🖱️ 오류 단어 클릭 이벤트 처리
   */
  private handleErrorWordClick(error: InlineError, targetElement: HTMLElement): void {
    const aiStatus = error.aiStatus;
    
    Logger.log(`🖱️ 오류 단어 클릭: "${error.correction.original}" (AI 상태: ${aiStatus || 'none'})`);
    
    // 🔧 모바일에서는 AI 분석 후에도 클릭 시 툴팁만 표시 (적용하지 않음)
    if (Platform.isMobile && (aiStatus === 'corrected' || aiStatus === 'exception' || aiStatus === 'keep-original')) {
      Logger.log(`📱 모바일에서 AI 분석 후 터치 - 툴팁만 표시: "${error.correction.original}"`);
      // 툴팁이 이미 표시된 상태이므로 아무것도 하지 않음
      return;
    }
    
    switch (aiStatus) {
      case 'corrected': // 🟢 녹색: AI 선택값 적용
        this.applyAISelectedValue(error, targetElement);
        break;
      
      case 'exception': // 🔵 파란색: 예외 사전 등록
        this.addToExceptionWords(error);
        break;
      
      case 'keep-original': // 🟠 주황색: 원본 유지 (변경 없음)
        this.keepOriginalValue(error, targetElement);
        break;
      
      default: // 🔴 빨간색: 첫 번째 수정 제안 적용 (기존 동작)
        this.applyFirstSuggestion(error, targetElement);
        break;
    }
  }

  /**
   * 🟢 AI 선택값 적용
   */
  private applyAISelectedValue(error: InlineError, targetElement: HTMLElement): void {
    if (!error.aiSelectedValue) {
      Logger.warn('AI 선택값이 없습니다.');
      new Notice('AI 선택값이 없습니다.');
      return;
    }
    
    Logger.log(`🟢 AI 선택값 적용: "${error.correction.original}" → "${error.aiSelectedValue}"`);
    
    try {
      InlineModeService.applySuggestion(error, error.aiSelectedValue);
      new Notice(`✅ AI 교정 적용: "${error.aiSelectedValue}"`);
      this.hide();
    } catch (error) {
      Logger.error('AI 선택값 적용 실패:', error);
      new Notice('❌ AI 교정 적용에 실패했습니다.');
    }
  }


  /**
   * 🟠 원본 유지 (변경 없음)
   */
  private keepOriginalValue(error: InlineError, targetElement: HTMLElement): void {
    Logger.log(`🟠 원본 유지: "${error.correction.original}"`);
    new Notice(`🟠 원본 유지: "${error.correction.original}"`);
    this.hide();
  }

  /**
   * 🔴 첫 번째 수정 제안 적용 (기존 동작)
   */
  private applyFirstSuggestion(error: InlineError, targetElement: HTMLElement): void {
    if (!error.correction.corrected || error.correction.corrected.length === 0) {
      Logger.warn('수정 제안이 없습니다.');
      new Notice('수정 제안이 없습니다.');
      return;
    }
    
    const firstSuggestion = error.correction.corrected[0];
    Logger.log(`🔴 첫 번째 수정 제안 적용: "${error.correction.original}" → "${firstSuggestion}"`);
    
    try {
      InlineModeService.applySuggestion(error, firstSuggestion);
      new Notice(`✅ 수정 적용: "${firstSuggestion}"`);
      this.hide();
    } catch (error) {
      Logger.error('수정 제안 적용 실패:', error);
      new Notice('❌ 수정 적용에 실패했습니다.');
    }
  }
}

/**
 * 공유 툴팁 인스턴스 (모듈 싱글톤으로 관리)
 */
export const inlineTooltip = new InlineTooltip();
