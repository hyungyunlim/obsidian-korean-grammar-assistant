import { EditorPosition, Editor, App } from "obsidian";

/**
 * 맞춤법 교정 정보를 나타내는 인터페이스
 */
export interface Correction {
  original: string;
  corrected: string[];
  help: string;
}

/**
 * 플러그인 설정 인터페이스
 */
export interface PluginSettings {
  apiKey: string;
  apiHost: string;
  apiPort: number;
  ignoredWords: string[]; // 예외 처리할 단어들
}

/**
 * 맞춤법 검사 결과 인터페이스
 */
export interface SpellCheckResult {
  resultOutput: string;
  corrections: Correction[];
}

/**
 * 팝업 설정 인터페이스
 */
export interface PopupConfig {
  corrections: Correction[];
  selectedText: string;
  start: EditorPosition;
  end: EditorPosition;
  editor: Editor;
}

/**
 * 교정 상태 관리 인터페이스
 */
export interface CorrectionState {
  correctionIndex: number;
  currentState: 'error' | 'corrected' | 'original-selected';
  selectedValue: string;
  isBlueState?: boolean;
}

/**
 * 페이지네이션 설정 인터페이스
 */
export interface PaginationConfig {
  isLongText: boolean;
  currentPage: number;
  totalPages: number;
  charsPerPage: number;
  pageBreaks: number[];
}

/**
 * UI 컴포넌트 기본 인터페이스
 */
export interface UIComponent {
  element: HTMLElement;
  render(): HTMLElement;
  destroy(): void;
}

/**
 * 텍스트 세그먼트 인터페이스 (미리보기 렌더링용)
 */
export interface TextSegment {
  text: string;
  type: 'normal' | 'error' | 'corrected' | 'original-selected';
  suggestion?: string;
  correctionIndex?: number;
}

/**
 * 레이아웃 설정 인터페이스
 */
export interface LayoutConfig {
  popupWidth: number;
  popupHeight: number;
  isMobile: boolean;
  errorSummaryExpanded: boolean;
}