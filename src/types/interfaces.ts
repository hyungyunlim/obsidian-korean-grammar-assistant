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
  inlineMode: InlineModeSettings; // 인라인 모드 설정 추가
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
  currentState: 'error' | 'corrected' | 'exception-processed' | 'original-kept' | 'user-edited';
  selectedValue: string;
  isExceptionState?: boolean;
  isUserEdited?: boolean;
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
  type: 'normal' | 'error' | 'corrected' | 'exception-processed' | 'original-kept' | 'user-edited';
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
  currentState?: 'error' | 'corrected' | 'exception-processed' | 'original-kept' | 'user-edited'; // 현재 상태 정보
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
  currentStates?: {[correctionIndex: number]: {state: 'error' | 'corrected' | 'exception-processed' | 'original-kept' | 'user-edited', value: string}}; // 현재 상태 정보
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

/**
 * 인라인 모드 설정 인터페이스
 */
export interface InlineModeSettings {
  enabled: boolean; // 인라인 모드 활성화 여부
  underlineStyle: 'wavy' | 'solid' | 'dotted' | 'dashed'; // 밑줄 스타일
  underlineColor: string; // 밑줄 색상
  // 🔧 개선: 상충되는 옵션들을 통합된 방식으로 변경
  tooltipTrigger: 'auto' | 'hover' | 'click' | 'disabled'; // 툴팁 표시 방식
  // auto: 플랫폼에 따라 자동 (데스크톱=hover, 모바일=click)
  // hover: 마우스 호버 시 (데스크톱 전용)
  // click: 클릭 시 (모바일 친화적)
  // disabled: 툴팁 비활성화
  
  // 🔧 레거시 설정 (하위 호환성을 위해 유지, 추후 제거 예정)
  showTooltipOnHover: boolean; // 호버 시 툴팁 표시 여부
  showTooltipOnClick: boolean; // 클릭 시 툴팁 표시 여부
}

/**
 * 인라인 오류 정보 인터페이스
 */
export interface InlineError {
  correction: Correction;
  start: number; // 에디터 내 시작 위치
  end: number; // 에디터 내 끝 위치
  line: number; // 라인 번호
  ch: number; // 라인 내 문자 위치
  uniqueId: string; // 고유 식별자
  isActive: boolean; // 활성 상태 (수정되면 false)
  originalErrors?: InlineError[]; // 병합된 경우 원본 오류들 (개별 적용용)
  isMerged?: boolean; // 병합된 오류인지 여부
  morphemeInfo?: { // 형태소 분석 정보
    mainPos: string; // 주요 품사 (명사, 동사, 형용사 등)
    tags: string[]; // 세부 형태소 태그들
    confidence: number; // 분석 신뢰도 (0-1)
  };
  // 🤖 AI 분석 관련 필드
  aiAnalysis?: {
    selectedValue: string;
    isExceptionProcessed: boolean;
    confidence: number; // 0-100
    reasoning: string;
  };
  aiColor?: string; // AI 분석 결과에 따른 색상
  aiBackgroundColor?: string; // AI 분석 결과에 따른 배경색
  aiStatus?: 'exception' | 'keep-original' | 'corrected'; // AI 분석 상태
  aiSelectedValue?: string; // AI가 선택한 수정값
  aiConfidence?: number; // AI 신뢰도 (0-100)
  aiReasoning?: string; // AI 추론 이유
}