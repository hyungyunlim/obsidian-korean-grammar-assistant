/**
 * CorrectionPopup 관련 타입 정의
 * 팝업, 페이지네이션, 키보드 네비게이션을 위한 통합 타입 시스템
 */

import { App, Scope, Editor, EditorPosition } from 'obsidian';
import { Correction, PopupConfig, AIAnalysisResult, PageCorrection } from '../../types/interfaces';
import { CorrectionStateManager } from '../../state/correctionState';
import { AIAnalysisService } from '../../services/aiAnalysisService';

// =============================================================================
// 1. 기본 팝업 관련 타입
// =============================================================================

/**
 * 팝업 상태 인터페이스
 */
export interface PopupState {
  /** 팝업 표시 여부 */
  isVisible: boolean;
  /** AI 분석 진행 중 여부 */
  isAiAnalyzing: boolean;
  /** 현재 미리보기 페이지 */
  currentPreviewPage: number;
  /** 전체 미리보기 페이지 수 */
  totalPreviewPages: number;
  /** 긴 텍스트 여부 */
  isLongText: boolean;
  /** 오류 요약 영역 펼침 여부 */
  isErrorSummaryExpanded: boolean;
  /** 현재 포커스된 오류 인덱스 */
  currentFocusIndex: number;
  /** 마지막 업데이트 시간 */
  lastUpdate: number;
}

/**
 * 팝업 설정 확장 인터페이스
 */
export interface PopupConfiguration extends PopupConfig {
  /** 키보드 네비게이션 활성화 여부 */
  keyboardNavigationEnabled?: boolean;
  /** 페이지네이션 비활성화 임계값 */
  paginationThreshold?: number;
  /** AI 분석 자동 실행 여부 */
  autoAnalyzeEnabled?: boolean;
  /** 모바일 최적화 활성화 여부 */
  mobileOptimized?: boolean;
}

// =============================================================================
// 2. 페이지네이션 관련 타입
// =============================================================================

/**
 * 페이지 정보 인터페이스
 */
export interface PageInfo {
  /** 페이지 인덱스 */
  index: number;
  /** 시작 문자 위치 */
  startPos: number;
  /** 종료 문자 위치 */
  endPos: number;
  /** 페이지 텍스트 */
  text: string;
  /** 페이지 내 오류 개수 */
  errorCount: number;
  /** 페이지 크기 (문자 수) */
  size: number;
}

/**
 * 페이지네이션 상태 인터페이스
 */
export interface PaginationState {
  /** 페이지별 분할점 */
  pageBreaks: number[];
  /** 페이지당 문자 수 */
  charsPerPage: number;
  /** 현재 페이지 인덱스 */
  currentPage: number;
  /** 전체 페이지 수 */
  totalPages: number;
  /** 동적 페이지 크기 계산 활성화 */
  dynamicSizing: boolean;
  /** 마지막 페이지 크기 업데이트 시간 */
  lastSizeUpdate: number;
  /** 긴 텍스트 여부 (1페이지 초과) */
  isLongText?: boolean;
}

/**
 * 페이지 분할 옵션
 */
export interface PageSplitOptions {
  /** 기본 페이지 크기 */
  defaultPageSize: number;
  /** 최소 페이지 크기 */
  minPageSize: number;
  /** 최대 페이지 크기 */
  maxPageSize: number;
  /** 문장 경계 우선 여부 */
  preferSentenceBoundary: boolean;
  /** 오류 영역 확장 상태 고려 여부 */
  considerErrorExpansion: boolean;
}

// =============================================================================
// 3. 키보드 네비게이션 관련 타입
// =============================================================================

/**
 * 키보드 단축키 정의 인터페이스
 */
export interface KeyboardShortcut {
  /** 키 조합 */
  keys: string[];
  /** 수정자 키 */
  modifiers?: ('Cmd' | 'Ctrl' | 'Shift' | 'Alt')[];
  /** 액션 타입 */
  action: KeyboardAction;
  /** 설명 */
  description: string;
  /** 조건부 활성화 */
  condition?: (state: PopupState) => boolean;
}

/**
 * 포커스 상태 인터페이스
 */
export interface FocusState {
  /** 현재 포커스된 오류 인덱스 */
  currentIndex: number;
  /** 포커스 가능한 오류 개수 */
  totalCount: number;
  /** 포커스 순환 여부 */
  wrapAround: boolean;
  /** 포커스 하이라이트 활성화 여부 */
  highlightEnabled: boolean;
  /** 마지막 포커스 변경 시간 */
  lastFocusChange: number;
}

/**
 * 키보드 액션 타입
 */
export type KeyboardAction = 
  | 'next-error'
  | 'prev-error'
  | 'next-suggestion'
  | 'prev-suggestion'
  | 'apply-current'
  | 'apply-all'
  | 'close-popup'
  | 'edit-current'
  | 'ai-analyze'
  | 'toggle-error-summary'
  | 'bulk-next-suggestion'
  | 'bulk-prev-suggestion'
  | 'next-page'
  | 'prev-page'
  | 'toggle-keyboard-hints'
  | 'refresh-analysis'
  | 'save-settings'
  | 'undo-last-change';

/**
 * 키보드 네비게이션 상태 인터페이스
 */
export interface KeyboardNavigationState {
  /** 현재 포커스된 항목 인덱스 */
  currentFocusIndex: number;
  /** 포커스 가능한 전체 항목 수 */
  totalFocusableItems: number;
  /** 편집 모드 여부 */
  isEditMode: boolean;
  /** 키보드 힌트 표시 여부 */
  keyboardHintsVisible: boolean;
  /** 마지막 네비게이션 시간 */
  lastNavigationTime: number;
}

// =============================================================================
// 4. 레이아웃 관련 타입
// =============================================================================

/**
 * 레이아웃 영역 타입
 */
export type LayoutArea = 'header' | 'preview' | 'summary' | 'footer';

/**
 * 레이아웃 상태 인터페이스
 */
export interface LayoutState {
  /** 각 영역의 가시성 */
  areaVisibility: Record<LayoutArea, boolean>;
  /** 각 영역의 크기 */
  areaSizes: Record<LayoutArea, { width: number; height: number }>;
  /** 반응형 레이아웃 활성화 */
  responsiveEnabled: boolean;
  /** 현재 브레이크포인트 */
  currentBreakpoint: 'mobile' | 'tablet' | 'desktop';
  /** 커스텀 CSS 클래스 */
  customClasses: string[];
}

/**
 * 렌더링 컨텍스트 인터페이스
 */
export interface RenderContext {
  /** DOM 컨테이너 요소 */
  container: HTMLElement;
  /** 현재 팝업 상태 */
  state: PopupState;
  /** 페이지네이션 상태 */
  pagination: PaginationState;
  /** 레이아웃 상태 */
  layout: LayoutState;
  /** 포커스 컨텍스트 */
  focus?: {
    currentIndex: number;
    totalItems: number;
    isEditMode: boolean;
  };
  /** 키보드 컨텍스트 */
  keyboard?: {
    showHints: boolean;
  };
  /** 렌더링 최적화 플래그 */
  optimized: boolean;
}

// =============================================================================
// 5. 이벤트 관련 타입
// =============================================================================

/**
 * 팝업 이벤트 타입
 */
export type PopupEventType = 
  | 'popup-show'
  | 'popup-hide'
  | 'page-change'
  | 'focus-change'
  | 'correction-apply'
  | 'ai-analysis-start'
  | 'ai-analysis-complete'
  | 'state-change'
  | 'layout-change'
  | 'error';

/**
 * 팝업 이벤트 데이터 인터페이스
 */
export interface PopupEventData {
  /** 이벤트 타입 */
  type: PopupEventType;
  /** 이벤트 발생 시간 */
  timestamp: number;
  /** 이벤트 페이로드 */
  payload?: any;
  /** 이벤트 대상 */
  target?: HTMLElement;
  /** 이전 상태 (상태 변경 이벤트 시) */
  previousState?: any;
}

/**
 * 이벤트 리스너 타입
 */
export type PopupEventListener = (data: PopupEventData) => void | Promise<void>;

// =============================================================================
// 6. AI 통합 관련 타입
// =============================================================================

/**
 * AI 분석 상태 인터페이스
 */
export interface AIIntegrationState {
  /** 분석 진행 중 여부 */
  isAnalyzing: boolean;
  /** 분석 결과 */
  results: AIAnalysisResult[];
  /** 토큰 사용량 정보 */
  tokenUsage: {
    estimated: number;
    actual?: number;
    threshold: number;
  };
  /** 마지막 분석 시간 */
  lastAnalysisTime: number;
  /** 분석 오류 정보 */
  lastError?: string;
}

// =============================================================================
// 7. 구성 요소 인터페이스
// =============================================================================

/**
 * 팝업 컴포넌트 기본 인터페이스
 */
export interface IPopupComponent {
  /** 컴포넌트 초기화 */
  initialize(context: RenderContext): Promise<void>;
  /** 컴포넌트 렌더링 */
  render(): HTMLElement;
  /** 컴포넌트 업데이트 */
  update(state: Partial<PopupState>): void;
  /** 컴포넌트 정리 */
  dispose(): void;
  /** 컴포넌트 가시성 */
  isVisible(): boolean;
}

/**
 * Phase 5: 서비스 관리자 인터페이스 (렌더링이 불필요한 백그라운드 서비스)
 */
export interface IPopupServiceManager {
  /** 서비스 초기화 */
  initialize(context: RenderContext): Promise<void>;
  /** 서비스 정리 */
  destroy(): void;
}

/**
 * 상태 관리자 인터페이스
 */
export interface IPopupStateManager {
  /** 현재 상태 조회 */
  getState(): PopupState;
  /** 상태 업데이트 */
  updateState(updates: Partial<PopupState>): void;
  /** 상태 리스너 등록 */
  addStateListener(listener: (state: PopupState) => void): void;
  /** 상태 리스너 제거 */
  removeStateListener(listener: (state: PopupState) => void): void;
  /** 상태 초기화 */
  resetState(): void;
}

/**
 * 이벤트 관리자 인터페이스
 */
export interface IPopupEventManager {
  /** 이벤트 리스너 등록 */
  addEventListener(type: PopupEventType, listener: PopupEventListener): void;
  /** 이벤트 리스너 제거 */
  removeEventListener(type: PopupEventType, listener: PopupEventListener): void;
  /** 이벤트 발생 */
  emit(type: PopupEventType, data?: any): void;
  /** 모든 리스너 제거 */
  removeAllListeners(): void;
}

// =============================================================================
// 8. 핵심 오케스트레이터 인터페이스
// =============================================================================

/**
 * CorrectionPopupCore 설정 인터페이스
 */
export interface PopupCoreConfig {
  /** Obsidian 앱 인스턴스 */
  app: App;
  /** 팝업 설정 */
  config: PopupConfiguration;
  /** AI 서비스 */
  aiService?: AIAnalysisService;
  /** 설정 업데이트 콜백 */
  onSettingsUpdate?: (newMaxTokens: number) => void;
}

/**
 * CorrectionPopupCore에서 사용하는 초기화 데이터
 */
export interface PopupInitializationData {
  /** 교정 대상 텍스트 */
  selectedText: string;
  /** 에디터 인스턴스 */
  editor: Editor;
  /** 선택 시작 위치 */
  selectionStart: EditorPosition;
  /** 선택 종료 위치 */
  selectionEnd: EditorPosition;
  /** 교정 결과 목록 */
  corrections: Correction[];
  /** 무시된 단어 목록 */
  ignoredWords: string[];
}

// =============================================================================
// 9. 백워드 호환성을 위한 타입
// =============================================================================

/**
 * 기존 CorrectionPopup의 public API 호환성을 위한 인터페이스
 */
export interface LegacyPopupInterface {
  /** 설정 객체 */
  config: PopupConfig;
  /** AI 분석 진행 여부 */
  isAiAnalyzing: boolean;
  /** AI 분석 결과 */
  aiAnalysisResults: AIAnalysisResult[];
  /** 키보드 스코프 */
  keyboardScope: Scope;
  /** 현재 포커스 인덱스 */
  currentFocusIndex: number;
  /** 현재 페이지 교정 목록 */
  currentCorrections: PageCorrection[];
  
  /** 팝업 표시 */
  show(): Promise<void>;
  /** 팝업 숨김 */
  hide(): void;
  /** 변경사항 적용 */
  applyChanges(): Promise<string>;
  /** AI 분석 실행 */
  performAIAnalysis(): Promise<void>;
}

// =============================================================================
// 10. 유틸리티 타입
// =============================================================================

/**
 * 깊은 부분 타입 (Deep Partial)
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * 필수 필드 타입
 */
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * 옵셔널 필드 타입
 */
export type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * 읽기 전용 상태 타입
 */
export type ReadonlyState<T> = {
  readonly [P in keyof T]: T[P] extends object ? ReadonlyState<T[P]> : T[P];
};