# Obsidian Korean Spell Checker Plugin

## 프로젝트 개요

한국어 맞춤법 검사를 위한 Obsidian 플러그인입니다. Bareun.ai API를 활용하여 정확한 한국어 맞춤법 검사를 제공하며, 사용자 친화적인 인터페이스를 통해 오류 수정을 지원합니다.

## 주요 기능

### 1. 스마트 맞춤법 검사
- **Bareun.ai API 통합**: 정확한 한국어 맞춤법 검사 서비스 활용
- **다중 수정 제안**: 각 오류에 대해 여러 개의 수정 제안 제공
- **상황별 도움말**: 각 오류에 대한 상세한 설명 제공

### 2. 대화형 수정 시스템
- **3단계 토글 시스템**: 빨간색(오류) → 초록색(수정) → 파란색(원본 선택) → 빨간색(오류) 순환
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

## 기술 아키텍처

### 핵심 파일 구조
```
obsidian-korean-spellchecker/
├── main.ts                    # 메인 플러그인 코드
├── styles.css                 # UI 스타일링 
├── manifest.json              # 플러그인 매니페스트
├── esbuild.config.mjs         # 빌드 설정
├── package.json               # 의존성 관리
├── CLAUDE.md                  # 프로젝트 문서 (이 파일)
├── api-config.example.json    # API 설정 템플릿
├── api-config.json            # 로컬 API 설정 (git ignored)
└── docs-reference/            # Obsidian 개발자 문서 (git ignored)
    └── en/Reference/TypeScript API/  # API 참조 문서
```

### 주요 기술 스택
- **TypeScript**: 타입 안전한 개발
- **Obsidian API**: 플러그인 인터페이스
- **Bareun.ai API**: 한국어 맞춤법 검사 서비스
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

### 2. 3단계 토글 시스템

#### 상태 관리
```typescript
// 상태 추적을 위한 데이터 구조
selectedCorrections: Record<string, any> = {};

// 파란색 상태 추적을 위한 플래그
selectedCorrections[`${correctionIndex}_blue`] = true;
```

#### 순환 로직
1. **빨간색 (오류)**: 초기 상태, 오류 텍스트 표시
2. **초록색 (수정)**: 수정 제안 적용된 상태
3. **파란색 (원본 선택)**: 사용자가 의도적으로 원본을 선택한 상태
4. **다시 빨간색**: 순환 완료, 초기 상태로 복귀

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
- **상태별 표시**: 오류/수정/원본선택 상태를 색상으로 구분

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

### v0.1.1 (현재)
- ✅ 동적 페이지네이션 시스템 구현
- ✅ 3단계 토글 시스템 완성
- ✅ 스마트 문장 경계 감지 개선
- ✅ 오류 없는 페이지 플레이스홀더 추가
- ✅ 시각적 피드백 시스템 구현
- ✅ 모바일 최적화 완료

### v0.1.2 (2024.07 업데이트)
- ✅ **스마트 포커스 관리**: `editor.hasFocus()` API 활용한 정확한 모바일 키보드 제어
- ✅ **전체 문서 자동 검사**: 텍스트 선택 없이 전체 문서 맞춤법 검사 지원
- ✅ **3단계 API 폴백**: `lineCount()` → `lastLine()` → 텍스트 기반 계산
- ✅ **API 키 보안 강화**: Git ignored 설정 파일 시스템으로 개인 API 키 보호
- ✅ **로컬 개발자 문서**: Obsidian API 참조를 위한 오프라인 문서 환경 구축
- ✅ **모바일 UX 개선**: 조건부 blur 처리 및 백그라운드 에디터 상태 관리

### 향후 계획
- 🔄 사용자 설정 확장
- 🔄 성능 최적화 강화
- 🔄 접근성 개선
- 🔄 다국어 지원 검토
- 🔄 오프라인 모드 지원

---

이 프로젝트는 한국어 사용자를 위한 직관적이고 효율적인 맞춤법 검사 도구를 목표로 하며, 지속적인 개선과 사용자 피드백을 통해 발전시켜 나가고 있습니다.