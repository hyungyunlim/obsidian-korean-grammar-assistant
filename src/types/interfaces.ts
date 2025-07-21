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
 * 페이지별 교정 정보 (원본 인덱스 포함)
 */
export interface PageCorrection {
  correction: Correction;
  originalIndex: number;
  positionInPage: number;
  absolutePosition: number;  // 전체 텍스트에서의 절대 위치
  uniqueId: string;          // 고유 식별자 (originalIndex_occurrenceCount)
}

/**
 * 플러그인 설정 인터페이스
 */
export interface PluginSettings {
  apiKey: string;
  apiHost: string;
  apiPort: number;
  ignoredWords: string[]; // 예외 처리된 단어들
  ai: AISettings; // AI 설정 추가
  filterSingleCharErrors: boolean; // 한 글자 오류 필터링 옵션
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
  file?: any; // TFile 인스턴스 (메타데이터 및 파일 정보용)
  morphemeInfo?: any; // 형태소 분석 정보 (AI 분석용)
  ignoredWords: string[];
  onExceptionWordsAdded?: (words: string[]) => void;
}

/**
 * 교정 상태 관리 인터페이스
 */
export interface CorrectionState {
  correctionIndex: number;
  currentState: 'error' | 'corrected' | 'exception-processed' | 'original-kept';
  selectedValue: string;
  isExceptionState?: boolean;
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
  render(): HTMLElement;
  destroy(): void;
}

/**
 * 텍스트 세그먼트 인터페이스 (미리보기 렌더링용)
 */
export interface TextSegment {
  text: string;
  type: 'normal' | 'error' | 'corrected' | 'exception-processed' | 'original-kept';
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

/**
 * AI 제공자 타입
 */
export type AIProvider = 'openai' | 'anthropic' | 'google' | 'ollama';

/**
 * AI 분석 결과 인터페이스
 */
export interface AIAnalysisResult {
  correctionIndex: number;
  selectedValue: string;
  isExceptionProcessed: boolean;
  isOriginalKept: boolean; // 원본유지 상태 (AI가 원본을 선택했을 때)
  confidence: number; // 0-100 사이의 신뢰도 점수
  reasoning: string; // AI 선택 이유 설명
}

/**
 * AI 설정 인터페이스
 */
export interface AISettings {
  enabled: boolean;
  provider: AIProvider;
  openaiApiKey: string;
  anthropicApiKey: string;
  googleApiKey: string;
  ollamaEndpoint: string;
  model: string;
  maxTokens: number;
  temperature: number;
  showTokenWarning: boolean; // 토큰 사용량 경고 표시 여부
  tokenWarningThreshold: number; // 경고를 표시할 토큰 임계값
}

/**
 * 오류별 컨텍스트 정보
 */
export interface CorrectionContext {
  correctionIndex: number;
  original: string;
  corrected: string[];
  help: string;
  contextBefore: string; // 오류 앞 컨텍스트
  contextAfter: string;  // 오류 뒤 컨텍스트
  fullContext: string;   // 전체 컨텍스트 (앞 + 오류 + 뒤)
  currentState?: 'error' | 'corrected' | 'exception-processed' | 'original-kept'; // 현재 상태 정보
  currentValue?: string; // 현재 선택된 값
  sentenceContext?: string; // 현재 문장 전체 (고유명사 판단용)
  paragraphContext?: string; // 현재 문단 전체 (문맥 파악용)
  isLikelyProperNoun?: boolean; // 고유명사 가능성
  documentType?: string; // 문서 유형 (마크다운, 일반 텍스트 등)
}

/**
 * AI 분석 요청 인터페이스
 */
export interface AIAnalysisRequest {
  originalText: string;
  corrections: Correction[];
  contextWindow?: number; // 앞뒤 몇 글자를 컨텍스트로 포함할지
  correctionContexts?: CorrectionContext[]; // 오류별 컨텍스트 정보
  onProgress?: (current: number, total: number, status: string) => void; // 배치 진행 상황 콜백
  currentStates?: {[correctionIndex: number]: {state: 'error' | 'corrected' | 'exception-processed' | 'original-kept', value: string}}; // 현재 상태 정보
  editor?: any; // Obsidian Editor 인스턴스 (구조화된 컨텍스트 추출용)
  file?: any; // TFile 인스턴스 (메타데이터 정보용)
  enhancedContext?: boolean; // 향상된 컨텍스트 추출 활성화 여부
}

/**
 * AI API 클라이언트 인터페이스
 */
export interface AIClient {
  chat(messages: Array<{role: string, content: string}>, maxTokens: number, model: string): Promise<string>;
  fetchModels?(): Promise<string[]>;
}