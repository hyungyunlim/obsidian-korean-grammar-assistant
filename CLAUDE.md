# Obsidian Korean Spell Checker Plugin

## 프로젝트 개요

한국어 맞춤법 검사를 위한 Obsidian 플러그인입니다. Bareun.ai API를 활용하여 정확한 한국어 맞춤법 검사를 제공하며, 사용자 친화적인 인터페이스를 통해 오류 수정을 지원합니다.

## 주요 기능

### 1. 스마트 맞춤법 검사
- **Bareun.ai API 통합**: 정확한 한국어 맞춤법 검사 서비스 활용
- **다중 수정 제안**: 각 오류에 대해 여러 개의 수정 제안 제공
- **상황별 도움말**: 각 오류에 대한 상세한 설명 제공

### 2. 대화형 수정 시스템
- **5단계 토글 시스템**: 오류 → 수정 → 예외처리 → 원본유지 → 사용자편집 → 오류 순환
- **3가지 편집 방법**: ⌨️ CMD+E 키보드 단축키, 🖱️ 미리보기 우클릭, 📝 오류 카드 좌클릭
- **클릭 기반 수정**: 미리보기에서 오류 텍스트를 직접 클릭하여 수정
- **실시간 미리보기**: 수정사항이 즉시 미리보기에 반영

### 3. 동적 페이지네이션
- **창 크기 기반 자동 조정**: 미리보기 영역 크기에 따라 페이지당 문자 수 동적 계산
- **스마트 문장 경계 감지**: 문장 중간에서 끊어지지 않도록 자연스러운 페이지 분할
- **오류 영역 상태 반영**: 오류 영역이 펼쳐지면 더 작은 페이지, 접히면 더 큰 페이지

### 4. 사용자 경험 개선
- **대형 팝업**: 1200x1000px 크기의 넓은 작업 공간 제공
- **컴팩트 오류 카드**: 공간 효율적인 오류 표시 및 수정 인터페이스
- **동적 레이아웃**: 오류 영역 토글에 따른 미리보기 영역 자동 크기 조정
- **모바일 최적화**: 터치 기반 인터페이스와 모바일 디바이스 지원

### 5. 스마트 포커스 관리 (모바일 특화)
- **editor.hasFocus() API 활용**: 정확한 포커스 상태 감지 및 관리
- **조건부 blur 처리**: 실제 포커스가 있을 때만 키보드 숨김 작업 수행
- **백그라운드 에디터 관리**: 팝업 뒤의 에디터 커서 및 키보드 상태 제어
- **임시 포커스 스틸링**: 모바일 최적화된 키보드 숨김 기법

### 6. 전체 문서 자동 검사
- **선택 없이 실행**: 텍스트 선택 없이 리본 아이콘 클릭 시 전체 문서 자동 검사
- **3단계 API 폴백**: `lineCount()` → `lastLine()` → 텍스트 기반 계산
- **시각적 피드백**: 전체 문서 선택 표시 및 상세한 로깅

### 7. AI 자동 교정 기능 ⭐ NEW
- **다중 AI 제공자 지원**: OpenAI, Anthropic (Claude), Google (Gemini), Ollama (로컬)
- **지능형 분석**: 문맥을 고려한 최적의 수정 제안 자동 선택
- **사용자 편집 인식**: AI가 사용자의 직접 편집 내용을 실시간으로 이해하고 존중
- **신뢰도 점수**: AI의 각 선택에 대한 0-100% 신뢰도 표시
- **상세한 추론**: AI가 특정 교정을 선택한 이유 이해
- **자동 예외 처리**: AI가 고유명사, URL, 기술 용어를 식별하고 보존
- **형태소 정보 통합**: 품사 정보를 AI 분석에 제공하여 더 정확한 문법 교정
- **토큰 효율성**: 스마트 컨텍스트 축소로 비용 절감 (최대 70% 토큰 절약)
- **원클릭 적용**: AI 분석 후 검토만 하고 바로 적용 가능

## 기술 아키텍처

### 핵심 파일 구조
```
obsidian-korean-spellchecker/
├── main.ts                    # 메인 플러그인 코드
├── styles.css                 # 메인 UI 스타일링 
├── manifest.json              # 플러그인 매니페스트
├── esbuild.config.mjs         # 빌드 설정
├── package.json               # 의존성 관리
├── CLAUDE.md                  # 프로젝트 문서 (이 파일)
├── api-config.example.json    # API 설정 템플릿
├── api-config.json            # 로컬 API 설정 (git ignored)
├── log/                       # 개발용 로그 파일들 (git ignored)
├── docs-reference/            # Obsidian 개발자 문서 (git ignored)
│   └── en/Reference/TypeScript API/  # API 참조 문서
├── styles/                    # 모듈화된 CSS 파일들 ⭐ NEW
│   ├── ai.css                 # AI 분석 관련 스타일
│   ├── base.css               # 기본 스타일 및 변수
│   ├── error-highlight.css    # 오류 하이라이트 스타일
│   ├── error-summary.css      # 오류 요약 영역 스타일
│   ├── header.css             # 팝업 헤더 스타일
│   ├── keyboard.css           # 키보드 네비게이션 스타일
│   ├── main.css               # 메인 팝업 스타일
│   ├── modals.css             # 모달 및 다이얼로그 스타일
│   ├── preview.css            # 미리보기 영역 스타일
│   ├── responsive.css         # 반응형 디자인 스타일
│   └── settings.css           # 설정 탭 스타일
└── src/                       # 모듈화된 소스 코드
    ├── types/interfaces.ts    # 타입 정의 (AI 관련 포함)
    ├── constants/             # 상수 및 설정
    │   ├── aiModels.ts        # AI 모델 정의 및 설정
    │   └── aiPrompts.ts       # AI 프롬프트 템플릿
    ├── api/                   # AI API 클라이언트들
    │   ├── openai-client.ts   # OpenAI API 클라이언트
    │   ├── anthropic-client.ts # Anthropic API 클라이언트
    │   ├── google-client.ts   # Google AI API 클라이언트
    │   ├── ollama-client.ts   # Ollama API 클라이언트
    │   └── clientFactory.ts   # AI 클라이언트 팩토리
    ├── services/              # 비즈니스 로직 서비스
    │   ├── api.ts             # Bareun.ai API 서비스
    │   ├── settings.ts        # 설정 관리 서비스
    │   ├── ignoredWords.ts    # 예외 단어 관리 서비스
    │   ├── aiAnalysisService.ts # AI 분석 서비스
    │   ├── advancedSettingsService.ts # 고급 설정 서비스
    │   ├── cacheService.ts    # 캐싱 서비스
    │   ├── errorHandler.ts    # 오류 처리 서비스
    │   └── optimizedApiService.ts # 최적화된 API 서비스
    ├── ui/                    # UI 컴포넌트
    │   ├── baseComponent.ts   # 기본 컴포넌트 클래스
    │   ├── correctionPopup.ts # 교정 팝업 (AI 통합)
    │   ├── loadingManager.ts  # 로딩 상태 관리
    │   ├── settingsTab.ts     # 설정 탭 UI
    │   └── virtualScroller.ts # 가상 스크롤러
    ├── state/                 # 상태 관리
    │   └── correctionState.ts # 교정 상태 관리자
    ├── utils/                 # 유틸리티 함수들
    │   ├── domOptimizer.ts    # DOM 최적화 유틸리티
    │   ├── domUtils.ts        # DOM 조작 유틸리티
    │   ├── htmlUtils.ts       # HTML 처리 유틸리티
    │   ├── logger.ts          # 로깅 시스템
    │   ├── memoryOptimizer.ts # 메모리 최적화 유틸리티
    │   ├── textUtils.ts       # 텍스트 처리 유틸리티
    │   └── tokenEstimator.ts  # 토큰 사용량 추정
    └── orchestrator.ts        # 워크플로우 오케스트레이터 (AI 통합)
```

### 주요 기술 스택
- **TypeScript**: 타입 안전한 개발
- **Obsidian API**: 플러그인 인터페이스
- **Bareun.ai API**: 한국어 맞춤법 검사 서비스
- **AI APIs**: OpenAI, Anthropic, Google, Ollama 통합 ⭐ NEW
- **CSS3**: 모던 스타일링 및 애니메이션
- **ESBuild**: 빌드 도구

## 주요 구현 상세

### 1. 동적 페이지네이션 시스템

#### 페이지 크기 계산 로직
```typescript
function calculateDynamicCharsPerPage() {
  const previewElement = document.getElementById("resultPreview");
  const errorSummary = document.getElementById("errorSummary");
  
  if (previewElement && errorSummary) {
    const previewRect = previewElement.getBoundingClientRect();
    const isErrorExpanded = !errorSummary.classList.contains("collapsed");
    
    const availableHeight = previewRect.height;
    const avgCharsPerLine = 75;
    const lineHeight = 15 * 1.7;
    const linesPerPage = Math.floor(availableHeight / lineHeight);
    
    let calculatedChars;
    if (isErrorExpanded) {
      calculatedChars = Math.max(500, Math.min(1000, linesPerPage * avgCharsPerLine));
    } else {
      calculatedChars = Math.max(800, Math.min(1800, linesPerPage * avgCharsPerLine));
    }
    
    return calculatedChars;
  }
  return 800;
}
```

#### 스마트 문장 경계 감지
- **점수 기반 평가**: 각 끊는 지점에 점수를 매겨 최적 위치 선택
- **한국어 특화 패턴**: 다양한 한국어 문장 끝 패턴 인식
- **거리 기반 보정**: 목표 지점 근처의 자연스러운 끊는 지점 선호
- **폴백 시스템**: 최적 지점을 찾지 못할 경우 공백이나 구두점에서 분할

### 2. 5단계 토글 시스템

#### 상태 관리
```typescript
// 상태 추적을 위한 데이터 구조
selectedCorrections: Record<string, any> = {};

// 5가지 상태 추적
const states = ['error', 'corrected', 'exception-processed', 'original-kept', 'user-edited'];
```

#### 순환 로직
1. **🔴 빨간색 (오류)**: 초기 상태, 오류 텍스트 표시
2. **🟢 초록색 (수정)**: 수정 제안 적용된 상태
3. **🔵 파란색 (예외처리)**: 향후 맞춤법 검사에서 제외될 텍스트
4. **🟠 주황색 (원본유지)**: 이번에만 유지, 다음 검사 시 다시 확인될 텍스트
5. **🟣 보라색 (사용자편집)**: 사용자가 CMD+E/우클릭/카드클릭으로 직접 편집한 텍스트

### 3. 오류 표시 시스템

#### 페이지별 오류 필터링
```typescript
function getCurrentCorrections() {
  if (!isLongText) return corrections;
  
  const previewStartIndex = currentPreviewPage === 0 ? 0 : pageBreaks[currentPreviewPage - 1];
  const previewEndIndex = pageBreaks[currentPreviewPage];
  const currentPreviewText = selectedText.slice(previewStartIndex, previewEndIndex);
  
  return corrections.filter((correction, index) => {
    return currentPreviewText.includes(correction.original);
  });
}
```

#### 오류 없는 페이지 플레이스홀더
- **조건부 렌더링**: 현재 페이지에 오류가 없으면 플레이스홀더 표시
- **동적 배지**: 현재 페이지의 오류 개수에 따라 배지 숫자 업데이트
- **사용자 안내**: 명확한 메시지로 페이지 상태 표시

### 4. 시각적 피드백 시스템

#### 동적 계산 알림
- **변화 감지**: 페이지 크기 변화 감지 (100자 이상 차이)
- **시각적 하이라이트**: 페이지 정보 영역 일시적 강조
- **팝업 알림**: 중앙 오버레이로 변화량 표시

#### 스타일링 특징
- **CSS 변수 활용**: Obsidian 테마 변수 사용으로 일관된 디자인
- **!important 선언**: 기본 스타일 오버라이드 확실히 보장
- **애니메이션**: 부드러운 전환 효과 (0.3초 ease)

## API 통합

### Bareun.ai API 설정
```typescript
const DEFAULT_SETTINGS: PluginSettings = {
  apiKey: 'koba-UFZFDYA-KWREC5Q-QE44PDQ-HANYC2A',
  apiHost: 'bareun-api.junlim.org',
  apiPort: 443,
  ignoredWords: []
};
```

### 응답 파싱 로직
- **중복 제거**: 동일한 오류에 대한 여러 제안 통합
- **위치 기반 필터링**: 원본 텍스트에서 실제 찾을 수 있는 오류만 처리
- **품질 검증**: 깨진 문자나 빈 제안 필터링

## AI 자동 교정 기능 구현 상세 ⭐ NEW

### 1. AI 아키텍처 개요

#### 클라이언트 팩토리 패턴
```typescript
// AI 제공자별 클라이언트 생성
export class AIClientFactory {
  static createClient(settings: AISettings): AIClient {
    switch (settings.provider) {
      case 'openai': return new OpenAIClient(settings.openaiApiKey);
      case 'anthropic': return new AnthropicClient(settings.anthropicApiKey);
      case 'google': return new GoogleClient(settings.googleApiKey);
      case 'ollama': return new OllamaClient(settings.ollamaEndpoint);
    }
  }
}
```

#### AI 분석 서비스
```typescript
export class AIAnalysisService {
  async analyzeCorrections(request: AIAnalysisRequest): Promise<AIAnalysisResult[]> {
    // 1. 프롬프트 생성 (시스템 + 사용자 메시지)
    // 2. AI API 호출
    // 3. JSON 응답 파싱
    // 4. 결과 검증 및 반환
  }
}
```

### 2. 지원되는 AI 제공자

#### OpenAI Integration
- **모델**: GPT-4o, GPT-4o-mini, GPT-4-turbo 등
- **API**: Chat Completions API 사용
- **특징**: 빠른 응답, 높은 정확도
- **토큰 제한**: 모델별 최대 토큰 지원

#### Anthropic (Claude) Integration  
- **모델**: Claude 3.5 Sonnet, Claude 3.5 Haiku 등
- **API**: Messages API 사용
- **특징**: 한국어 이해력 우수, 상세한 설명
- **시스템 프롬프트**: 별도 시스템 필드로 처리

#### Google (Gemini) Integration
- **모델**: Gemini 1.5 Pro, Gemini 1.5 Flash 등  
- **API**: Generate Content API 사용
- **특징**: 빠른 처리 속도, 멀티모달 지원
- **메시지 변환**: OpenAI 형식 → Google 형식 자동 변환

#### Ollama (Local) Integration
- **모델**: Llama 3.2, Mistral, Qwen 등 로컬 모델
- **API**: 로컬 서버 API 사용
- **특징**: 완전한 프라이버시, 오프라인 작동
- **프롬프트**: 단순 텍스트 형식으로 변환

### 3. AI 프롬프트 엔지니어링

#### 시스템 프롬프트
```
당신은 한국어 맞춤법 검사 전문가입니다. 주어진 텍스트와 맞춤법 오류들을 분석하여 가장 적절한 수정사항을 선택해주세요.

다음 규칙을 따라주세요:
1. 문맥에 가장 적합한 수정안을 선택하세요
2. 고유명사, URL, 이메일, 전문용어는 예외처리를 고려하세요  
3. 애매한 경우 원문을 유지하는 것을 고려하세요
4. 각 선택에 대한 신뢰도(0-100)와 간단한 이유를 제공하세요
```

#### 응답 형식 (JSON)
```json
[
  {
    "correctionIndex": 0,
    "selectedValue": "선택된 값",
    "isExceptionProcessed": false,
    "confidence": 85,
    "reasoning": "문맥상 이 단어가 가장 적절함"
  }
]
```

### 4. UI/UX 통합

#### 팝업 헤더 통합
- **AI 분석 버튼**: 조건부 렌더링 (AI 사용 가능할 때만)
- **상태 표시**: 분석 중 버튼 비활성화 및 텍스트 변경
- **시각적 피드백**: 성공/실패 알림 오버레이

#### 결과 표시 시스템
- **신뢰도 배지**: 파란색 배경의 퍼센트 표시
- **추천 이유**: 이탤릭 텍스트로 AI 설명 표시  
- **색상 구분**: 파란색 테마로 AI 결과와 일반 오류 구분

#### 자동 적용 워크플로우
```typescript
// AI 분석 → 상태 관리자에 자동 적용 → UI 업데이트
private applyAIAnalysisResults(): void {
  for (const result of this.aiAnalysisResults) {
    this.stateManager.setState(
      result.correctionIndex,
      result.selectedValue, 
      result.isExceptionProcessed
    );
  }
}
```

### 5. 오류 처리 및 폴백

#### API 오류 처리
- **네트워크 오류**: 타임아웃 및 재시도 로직
- **인증 오류**: API 키 유효성 검사
- **모델 오류**: 지원되지 않는 모델 감지
- **파싱 오류**: JSON 응답 검증 및 폴백

#### 사용자 경험 개선
- **상세한 오류 메시지**: 문제 원인 명확히 표시
- **설정 가이드**: API 키 설정 방법 안내
- **점진적 기능 제공**: AI 없이도 기본 기능 사용 가능

### 6. 성능 최적화

#### 요청 최적화
- **컨텍스트 윈도우**: 앞뒤 50자로 제한하여 토큰 절약
- **배치 처리**: 여러 오류를 한 번의 API 호출로 처리
- **캐싱**: 동일한 요청 결과 메모리 캐싱 (향후 구현 예정)

#### 응답 최적화  
- **스트리밍**: 실시간 응답 처리 (향후 구선 예정)
- **압축**: JSON 응답 최소화
- **지연 로딩**: 필요할 때만 AI 서비스 초기화

## 사용자 워크플로우

### 1. 기본 사용법
1. **텍스트 선택**: 검사할 한국어 텍스트 선택
2. **플러그인 실행**: 리본 아이콘 클릭 또는 명령 팔레트 사용
3. **오류 검토**: 미리보기에서 빨간색으로 표시된 오류 확인
4. **수정 적용**: 오류 텍스트 클릭하여 수정 제안 순환 확인
5. **최종 적용**: "적용" 버튼 클릭하여 변경사항 에디터에 반영

### 2. 페이지네이션 활용
- **자동 페이지 분할**: 긴 텍스트는 자동으로 읽기 좋은 크기로 분할
- **페이지 이동**: 이전/다음 버튼으로 페이지 간 이동
- **동적 크기**: 창 크기나 오류 영역 상태에 따라 페이지 크기 자동 조정

### 3. 오류 관리
- **오류 영역 토글**: 하단 오류 영역 펼침/접힘으로 공간 효율적 사용
- **실시간 배지**: 현재 페이지의 오류 개수 실시간 표시
- **5가지 색상 상태**: 오류(빨강), 교정(초록), 예외처리(파랑), 원본유지(주황), 사용자편집(보라) 구분

### 4. AI 자동 교정 사용법 ⭐ NEW
1. **AI 설정**: 플러그인 설정에서 AI 제공자 선택 및 API 키 입력
2. **맞춤법 검사**: 일반적인 방법으로 맞춤법 검사 실행
3. **사용자 편집** (선택사항): 원하는 오류를 직접 편집하여 AI에게 의도를 전달
4. **AI 분석**: 팝업 상단의 "🤖 AI 분석" 버튼 클릭
5. **결과 확인**: 
   - AI가 사용자 편집 내용을 고려하여 최적의 교정을 자동 선택
   - 각 오류에 신뢰도 점수(0-100%)와 상세한 추론 표시
6. **검토 및 적용**: AI 선택사항 검토 후 "적용" 버튼 클릭

#### AI 활용 팁
- **고유명사/전문용어**: AI가 자동으로 예외처리 추천
- **문맥 이해**: 문장의 의미를 고려한 정확한 수정 제안
- **사용자 의도 인식**: 보라색으로 표시된 사용자 편집 내용을 우선적으로 존중
- **신뢰도 확인**: 낮은 신뢰도(70% 이하)는 수동 검토 권장

## ⌨️ 키보드 네비게이션

플러그인은 완전한 키보드 지원을 제공하여 마우스 없이도 효율적으로 작업할 수 있습니다:

### 기본 네비게이션
- **Tab**: 다음 오류로 이동
- **Shift+Tab**: 이전 오류로 이동
- **←/→**: 현재 오류의 수정 제안 순환 (앞/뒤)
- **Enter**: 현재 선택된 수정사항 적용
- **Escape**: 팝업 닫기

### 편집 및 AI 기능
- **CMD+E**: 현재 포커스된 오류 편집 모드 진입
- **Shift+CMD+A**: AI 분석 실행
- **CMD+Shift+E**: 오류 상세 영역 펼침/접힘

### 일괄 작업
- **CMD+Shift+→**: 모든 오류를 다음 제안으로 일괄 변경
- **CMD+Shift+←**: 모든 오류를 이전 제안으로 일괄 변경

### 페이지 네비게이션 (긴 텍스트)
- **↑**: 이전 페이지
- **↓**: 다음 페이지

💡 **키보드 힌트**: 데스크톱에서 팝업 열 때 자동으로 키보드 단축키 가이드가 표시됩니다.

## 🔬 고급 분석 시스템

### 맞춤법 검사 플로우
```
텍스트 입력 → Bareun.ai 맞춤법 분석 → 형태소 분석 → 오류 개선 → AI 분석 → 최종 제안
```

### 형태소 분석의 역할
- **정확한 품사 구분**: 명사/동사/형용사별 맞춤형 교정 제안
- **중복 오류 제거**: 동일 형태소 내 겹치는 오류 통합
- **문법적 컨텍스트**: 단어 경계와 품사 정보로 더 정확한 분석
- **오류 위치 최적화**: 형태소 경계 기반 정확한 오류 범위 지정

### AI 토큰 최적화 전략
#### 스마트 컨텍스트 윈도우
- **기본 모드**: 앞뒤 100자 컨텍스트 제공
- **형태소 모드**: 앞뒤 30자로 축소 (품사 정보로 보완)
- **토큰 절감**: 평균 70토큰 절약 (복수 오류 시)

#### 배치 처리
- **단일 API 호출**: 여러 오류를 한 번에 분석
- **비용 효율성**: API 호출 수 최소화
- **병렬 처리**: 대용량 텍스트 동시 분석

#### 토큰 사용량 모니터링
- **실시간 추정**: 실제 프롬프트 기반 정확한 토큰 계산
- **사용자 제어**: 설정 가능한 토큰 임계값
- **투명한 비용**: 예상 API 비용 사전 표시

## 성능 최적화

### 1. 메모리 효율성
- **페이지별 렌더링**: 전체 텍스트를 한 번에 렌더링하지 않고 페이지별로 처리
- **이벤트 위임**: 단일 이벤트 리스너로 모든 클릭 이벤트 처리
- **조건부 계산**: 필요할 때만 동적 계산 실행

### 2. 사용자 경험
- **즉시 피드백**: 클릭 즉시 상태 변경 표시
- **부드러운 전환**: CSS 트랜지션으로 자연스러운 애니메이션
- **디버깅 지원**: 콘솔 로그를 통한 상세한 동작 추적

## 개발 환경 설정

### 초기 설정
```bash
# 프로젝트 클론
git clone https://github.com/hyungyunlim/obsidian-korean-grammar-assistant.git
cd obsidian-korean-grammar-assistant

# 의존성 설치
npm install

# API 설정 파일 생성 (로컬 개발용)
cp api-config.example.json api-config.json
# api-config.json에 본인의 Bareun.ai API 키 입력
```

### Obsidian 개발자 문서 참조
로컬에서 Obsidian API 문서를 참조할 수 있습니다:
```bash
# 문서는 이미 docs-reference/ 폴더에 클론되어 있음
# 주요 API 참조 경로:
# docs-reference/en/Reference/TypeScript API/Editor/
# docs-reference/en/Reference/TypeScript API/Plugin/
# docs-reference/en/Reference/TypeScript API/App/
```

### 빌드 명령어
```bash
npm run build        # 프로덕션 빌드
npm run dev         # 개발 모드 (파일 변경 감지)
```

### 개발 워크플로우
1. **코드 수정**: TypeScript/CSS 파일 편집
2. **API 참조**: `docs-reference/` 폴더에서 Obsidian API 확인
3. **빌드 실행**: `npm run build`로 컴파일
4. **플러그인 테스트**: Obsidian에서 플러그인 재로드
5. **디버깅**: 개발자 도구 콘솔에서 상세 로그 확인

### 주요 개발 도구
- **ESBuild**: 빠른 번들링 및 TypeScript 컴파일
- **TypeScript**: 타입 안전성 및 IDE 지원
- **CSS3**: 모던 스타일링 기능
- **로컬 API 문서**: 오프라인 Obsidian API 참조

## 확장 가능성

### 1. 추가 기능 아이디어
- **사용자 사전**: 개인화된 단어 사전 관리
- **검사 룰 설정**: 맞춤법 검사 강도 조절
- **통계 기능**: 자주 틀리는 단어 분석
- **일괄 처리**: 여러 파일 동시 검사

### 2. 기술적 개선
- **캐싱 시스템**: API 호출 결과 캐싱으로 성능 향상
- **오프라인 모드**: 로컬 검사 엔진 통합
- **플러그인 호환성**: 다른 Obsidian 플러그인과의 연동

## 문제 해결 가이드

### 1. 빌드 오류
- **타입 에러**: TypeScript 컴파일 오류 확인
- **의존성 문제**: `npm install` 재실행
- **설정 파일**: `tsconfig.json` 및 `esbuild.config.mjs` 확인

### 2. 런타임 오류
- **API 연결**: Bareun.ai API 키 및 엔드포인트 확인
- **DOM 요소**: 팝업 렌더링 타이밍 문제 확인
- **메모리 누수**: 이벤트 리스너 정리 확인

### 3. 모바일 관련 문제
- **키보드 숨김 실패**: 
  - 개발자 콘솔에서 `editor.hasFocus()` 로그 확인
  - `"Editor has focus before/after popup"` 메시지 확인
  - 여러 blur 방법 중 어떤 것이 작동하는지 로그 확인
- **백그라운드 커서 보임**: 
  - CSS `pointer-events: none` 적용 확인
  - `spell-popup-open` 클래스 적용 상태 확인
- **전체 문서 선택 실패**:
  - 콘솔에서 API 사용 방법 확인 (`lineCount()` vs `lastLine()` vs fallback)
  - `"전체 문서 텍스트 선택됨"` 로그 메시지 확인

### 4. 사용자 경험
- **응답 속도**: API 호출 최적화
- **UI 반응성**: CSS 애니메이션 성능 확인
- **접근성**: 키보드 네비게이션 지원

## 버전 히스토리

### v0.1.1
- ✅ 동적 페이지네이션 시스템 구현
- ✅ 3단계 토글 시스템 완성
- ✅ 스마트 문장 경계 감지 개선
- ✅ 오류 없는 페이지 플레이스홀더 추가
- ✅ 시각적 피드백 시스템 구현
- ✅ 모바일 최적화 완료

### v0.1.2 (2025.07 업데이트)
- ✅ **스마트 포커스 관리**: `editor.hasFocus()` API 활용한 정확한 모바일 키보드 제어
- ✅ **전체 문서 자동 검사**: 텍스트 선택 없이 전체 문서 맞춤법 검사 지원
- ✅ **3단계 API 폴백**: `lineCount()` → `lastLine()` → 텍스트 기반 계산
- ✅ **API 키 보안 강화**: Git ignored 설정 파일 시스템으로 개인 API 키 보호
- ✅ **로컬 개발자 문서**: Obsidian API 참조를 위한 오프라인 문서 환경 구축
- ✅ **모바일 UX 개선**: 조건부 blur 처리 및 백그라운드 에디터 상태 관리

### v0.2.0 (2025.07 업데이트) ⭐ NEW
- ✅ **AI 자동 교정 기능**: OpenAI, Anthropic, Google, Ollama 지원
- ✅ **다중 AI 제공자**: 4개 주요 AI 서비스 완전 통합
- ✅ **지능형 분석**: 문맥 기반 최적 수정 제안 자동 선택
- ✅ **신뢰도 시스템**: 0-100% AI 신뢰도 점수 및 상세 추천 이유 
- ✅ **고유명사 감지**: 전문용어, 고유명사, URL 자동 예외처리
- ✅ **완전한 설정 UI**: 제공자별 API 키 설정 및 모델 선택
- ✅ **원클릭 워크플로우**: AI 분석 → 검토 → 적용 간소화
- ✅ **타입 안전성**: TypeScript 기반 AI 클라이언트 아키텍처
- ✅ **오류 처리**: 네트워크/인증/파싱 오류 완벽 대응
- ✅ **성능 최적화**: 컨텍스트 윈도우 제한 및 배치 처리

### v0.2.1 (2025.07.20 업데이트)
- ✅ **Obsidian 가이드라인 완전 준수**: 플러그인 스토어 제출 준비 완료
  - ✅ **innerHTML 완전 제거**: 모든 DOM 조작을 `createEl()` API로 변경
  - ✅ **setHeading() 적용**: 모든 섹션 헤더를 표준 API로 변경
  - ✅ **매니페스트 최적화**: 빈 `fundingUrl` 제거, 설명 문구 개선
  - ✅ **로깅 시스템 통합**: 모든 `console.*` 호출을 커스텀 Logger로 교체
  - ✅ **CSS 클래스 체계**: 하드코딩된 인라인 스타일을 CSS 클래스로 이동
- ✅ **설정 검증 UI 대폭 개선**: 더 직관적이고 유용한 검증 결과 디스플레이
  - ✅ **카드 기반 레이아웃**: 정보를 구조화된 섹션으로 분리
  - ✅ **상태별 색상 시스템**: 정상(초록), 오류(빨강), 경고(주황), 비활성화(회색)
  - ✅ **실용적인 요약 정보**: API 상태, AI 기능, 예외 단어 현황을 그리드로 표시
  - ✅ **조건부 섹션 표시**: 문제가 없으면 간단한 성공 메시지만 표시
  - ✅ **반응형 디자인**: Obsidian 테마 변수 사용으로 다크/라이트 모드 자동 대응
- ✅ **키보드 네비게이션 시스템 완전 구현**: 접근성 및 사용성 대폭 개선
  - ✅ **키보드 단축키 최적화**: A/E키 → Space/Cmd+E키로 변경하여 타이핑 충돌 방지
  - ✅ **토큰 경고 모달 키보드 지원**: Enter(진행), Esc(취소) 키보드 단축키 완전 지원
  - ✅ **Tab 네비게이션 개선**: 오류 상세 펼침 상태에서만 스크롤, 접힌 상태에서는 상태 보존
  - ✅ **5단계 순환 시스템**: 오류 → 수정 → 예외처리 → 원본유지 → 사용자편집 완전한 순환 구현
  - ✅ **포커스 하이라이트**: 키보드 네비게이션 시 현재 선택된 오류 시각적 강조
  - ✅ **제목 라인 오류 처리**: ###로 시작하는 제목 라인 오류 시 올바른 순서로 첫 번째 항목 선택
- ✅ **알림 시스템 통일**: 모든 알림을 Obsidian Notice 시스템으로 일관성 확보
  - ✅ **AI 분석 완료 알림**: 커스텀 토스트 → Notice 시스템으로 변경
  - ✅ **토큰 업데이트 알림**: 커스텀 토스트 → Notice 시스템으로 변경
  - ✅ **일괄 변경 알림**: 커스텀 토스트 → Notice 시스템으로 변경
  - ✅ **오류 알림**: 커스텀 토스트 → Notice 시스템으로 변경
  - ✅ **위치 일관성**: 모든 알림이 오른쪽 하단에 일관되게 표시
  - ✅ **CSS 정리**: 사용하지 않는 커스텀 토스트 CSS 클래스 제거

### v0.2.2 (2025.07.22 업데이트)
- ✅ **형태소 분석 API 최적화**: 중복 호출 문제 해결 및 성능 개선
  - ✅ **중복 호출 제거**: orchestrator에서 1회 호출 후 데이터 재사용으로 API 효율성 극대화
  - ✅ **새로운 메서드 추가**: `improveCorrectionsWithMorphemeData()`로 기존 형태소 데이터 재활용
  - ✅ **통합된 호출 로직**: 형태소 분석 → 교정 개선 → AI 분석용 재사용의 일관된 플로우 구현
  - ✅ **캐싱 시스템 강화**: 메모리 캐시 100개 항목, LRU 방식 자동 정리로 성능 최적화
- ✅ **토큰 계산 시스템 정확성 개선**: 실제 사용 프롬프트 기반 정밀한 토큰 추정
  - ✅ **형태소 최적화 반영**: 복수 오류 시 컨텍스트 윈도우 축소 (100→30토큰) 효과 정확히 계산
  - ✅ **임계값 설정 완전 보존**: 기존 사용자 설정 및 경고 시스템 그대로 유지
  - ✅ **순 절약 효과 계산**: 컨텍스트 축소(-70토큰) + 메타데이터(+50토큰) = 순 -20토큰 절약
  - ✅ **상세한 로깅 시스템**: 토큰 변화량, 최적화 효과, 순 절약량 등 디버깅 정보 완비
- ✅ **AI 프롬프트 가이드라인 대폭 개선**: 예외처리 vs 원본유지 명확한 구분 기준 제공
  - ✅ **예외처리 기준 명시**: 브랜드명, 프로그래밍 용어, 전문용어 등 재사용 가능한 고유 용어
  - ✅ **원본유지 기준 명시**: 일반 명사(시간, 장소, 사람, 객체) 등 일반적인 표현
  - ✅ **구체적인 예시 제공**: "슬랙"(예외처리) vs "시간"(원본유지) 등 실제 사용 사례
  - ✅ **판단 기준 체계화**: "재사용 가능한 고유한 용어 → 예외처리, 일반적인 명사 → 원본유지"
  - ✅ **개선된 응답 예시**: reasoning 필드에 구체적인 처리 이유 명시

### v0.2.3 (2025.07.22 업데이트)
- ✅ **사용자 편집 토글 로직 개선**: 편집값 없는 경우 자동 건너뛰기
  - ✅ **빈 편집값 자동 스킵**: 사용자가 편집 모드에서 빈 값 입력 시 자동으로 다음 수정 제안으로 이동
  - ✅ **자연스러운 UX**: 실수로 편집 모드 진입 시 간편하게 빠져나올 수 있는 사용자 친화적인 워크플로우
  - ✅ **일관된 상태 관리**: 빈 편집값 처리 시에도 5단계 토글 순환 로직과 완벽하게 호환

### v0.2.4 (2025.07.24 업데이트) - 현재
- ✅ **로그 레벨 시스템 완전 정리**: 프로덕션 환경 최적화
  - ✅ **지능형 로그 레벨 재분류**: Gemini가 일괄 변경한 debug 레벨을 적절히 재분류
    - 사용자 액션, 시스템 상태 변경: INFO 레벨로 분류
    - 상세 디버깅 정보: DEBUG 레벨 유지  
    - 잠재적 문제, 폴백 동작: WARN 레벨로 분류
    - 실제 오류: ERROR 레벨 유지
  - ✅ **console.log 완전 제거**: 모든 콘솔 출력을 통합 Logger 시스템으로 교체
  - ✅ **프로덕션 로그 정리**: 불필요한 디버깅 메시지 제거 및 중요한 시스템 상태 로그만 유지
  - ✅ **로그 파일 관리 개선**: .gitignore에 log/ 폴더 추가로 개발용 로그 파일 제외
- ✅ **AI 프롬프트 사용자 편집 상태 인식 강화**: 보라색(사용자편집) 상태 완전 지원
  - ✅ **5단계 색상 가이드 추가**: AI 프롬프트에 🔴🟢🔵🟠🟣 5가지 상태에 대한 명확한 설명 제공
  - ✅ **사용자편집 상태 처리 가이드**: AI가 사용자 직접 편집 내용을 우선적으로 존중하도록 지침 추가
  - ✅ **현재 상태 정보 전달**: 각 오류의 현재 UI 상태를 AI에게 실시간 전달하여 더 정확한 분석 지원
  - ✅ **3가지 편집 방법 인식**: CMD+E/우클릭/카드클릭으로 편집한 텍스트를 AI가 모두 고려
- ✅ **문서화 시스템 대폭 확장**: 기술 아키텍처 및 사용성 가이드 완성
  - ✅ **17개 키보드 단축키 완전 문서화**: 마우스 없이 완전한 워크플로우 가능
  - ✅ **3단계 분석 파이프라인 공개**: 맞춤법→형태소→AI 분석 과정 상세 설명
  - ✅ **토큰 최적화 전략 완전 공개**: 최대 70% 토큰 절약 효과 정량적 표시
  - ✅ **성능 최적화 기법 문서화**: LRU 캐싱, API 재사용, 비동기 처리 등
- ✅ **개발 워크플로우 개선**: GitHub Actions 및 릴리즈 프로세스 최적화
  - ✅ **GitHub Actions 권한 개선**: contents: write 권한 추가로 HTTP 403 오류 해결
  - ✅ **한글 릴리즈 노트**: 한국어 사용자 친화적 릴리즈 노트로 변경
  - ✅ **YAML 구문 안전성**: Here document 방식으로 YAML 구문 안전성 개선
  - ✅ **자동 릴리즈 프로세스**: 상세한 변경사항 설명으로 사용자 이해도 향상

### 향후 계획
- 🔄 **AI 성능 개선**: 응답 캐싱, 스트리밍, 모델 파인튜닝
- 🔄 **추가 AI 제공자**: OpenRouter, Cohere, Hugging Face 지원
- 🔄 **사용자 커스터마이징**: AI 프롬프트 편집, 신뢰도 임계값 설정  
- 🔄 **일괄 처리**: 여러 파일 동시 AI 분석 및 교정
- 🔄 **성능 최적화 강화**: 메모리 사용량 감소, 응답 속도 개선
- 🔄 **접근성 개선**: 키보드 네비게이션, 스크린 리더 지원
- 🔄 **다국어 지원 검토**: 영어, 일본어 등 추가 언어 지원

---

이 프로젝트는 한국어 사용자를 위한 직관적이고 효율적인 맞춤법 검사 도구를 목표로 하며, 지속적인 개선과 사용자 피드백을 통해 발전시켜 나가고 있습니다.