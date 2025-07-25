# Korean Grammar Assistant - 인라인 모드 전환 분석

## 📋 개요

현재 모달창 기반 구조를 에디터 자체에서 동작하는 인라인 모드로 전환하는 기능에 대한 기술적 분석 및 구현 계획서입니다.

---

## 🏗️ 현재 아키텍처 분석

### 모달 기반 구조
```typescript
// 현재 구현
export class CorrectionPopup extends BaseComponent {
  private config: PopupConfig;
  private app: App;
  private stateManager: CorrectionStateManager;
  // 1200x1000px 독립 팝업 창
  // 독립적인 UI 컨테이너 방식
}
```

**특징:**
- 1200x1000px 크기의 별도 팝업 창
- 완전한 UI 컨트롤 (5단계 토글, AI 분석, 페이지네이션)
- 에디터와 분리된 작업 환경
- 모바일 최적화 완료 (전체 화면 모드)

---

## 🎯 인라인 모드 기술적 실현 가능성

### ✅ Obsidian Editor API 지원 기능

#### 1. CodeMirror 6 Extensions
```typescript
// 에디터 확장 등록
onload() {
  this.registerEditorExtension([
    koreanGrammarField,
    inlineErrorPlugin,
    keyboardNavigationExtension
  ]);
}
```

#### 2. Widget Decorations
```typescript
class ErrorWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'korean-grammar-error-inline';
    span.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
    span.style.borderBottom = '2px wavy red';
    span.textContent = this.originalText;
    
    // 클릭 시 수정 제안 표시
    span.addEventListener('click', () => this.showInlineSuggestions());
    return span;
  }
}
```

#### 3. State Fields for Document-wide Management
```typescript
const koreanGrammarField = StateField.define<DecorationSet>({
  create(state): DecorationSet {
    return Decoration.none;
  },
  
  update(oldState: DecorationSet, transaction: Transaction): DecorationSet {
    if (transaction.docChanged) {
      return this.buildGrammarDecorations(transaction.state);
    }
    return oldState;
  },
  
  provide(field): Extension {
    return EditorView.decorations.from(field);
  }
});
```

---

## 🎨 인라인 모드 UI/UX 설계

### 핵심 인터페이스 요소

#### 1. 오류 하이라이트
- **시각적 표시**: 빨간색 물결 밑줄
- **호버 효과**: 간단한 툴팁 표시
- **클릭 인터랙션**: 수정 제안 컨텍스트 메뉴

#### 2. 인라인 수정 제안
```typescript
interface InlineSuggestion {
  position: EditorPosition;
  original: string;
  suggestions: string[];
  reasoning?: string;  // AI 분석 결과
  confidence?: number; // AI 신뢰도
}
```

#### 3. 컨텍스트 메뉴
- 수정 제안 리스트
- 예외처리 옵션
- 원본유지 옵션
- AI 분석 보기

### 기존 모달 vs 인라인 모드 비교

| 기능 | 모달 모드 | 인라인 모드 | 비고 |
|------|-----------|-------------|------|
| **컨텍스트 유지** | ❌ 별도 창 | ✅ 에디터 내 | 인라인 우세 |
| **전체 문서 보기** | ✅ 1200x1000px | ❌ 제한적 | 모달 우세 |
| **실시간 검사** | ❌ 검사 후 | ✅ 타이핑 중 | 인라인 우세 |
| **AI 분석 UI** | ✅ 풀 인터페이스 | 🔄 간소화 필요 | 모달 우세 |
| **모바일 최적화** | ✅ 완전 최적화 | ⚠️ 도전적 | 모달 우세 |
| **키보드 네비게이션** | ✅ 18개 단축키 | 🔄 재설계 필요 | 모달 우세 |
| **5단계 토글** | ✅ 완전 지원 | 🔄 간소화 필요 | 모달 우세 |
| **동적 페이지네이션** | ✅ 지원 | ❌ 불필요 | 모달 우세 |

---

## 🚀 구현 로드맵

### Phase 1: 기본 인라인 표시 (2-3일)
```typescript
// 1단계 목표
class BasicInlineMode {
  features = [
    '오류 하이라이트 표시',
    '클릭 시 간단한 수정 제안',
    '모드 전환 토글 버튼',
    '기본 키보드 네비게이션'
  ];
}
```

### Phase 2: 기능 확장 (1주)
```typescript
// 2단계 목표  
class ExtendedInlineMode {
  features = [
    '완전한 키보드 네비게이션',
    'AI 분석 결과 간소 표시',
    '설정에서 모드 선택 저장',
    '컨텍스트 메뉴 완성'
  ];
}
```

### Phase 3: 완성도 향상 (1주)
```typescript
// 3단계 목표
class PolishedInlineMode {
  features = [
    '성능 최적화 (대용량 문서)',
    '모바일 최적화',
    '기존 모달과 매끄러운 전환',
    '사이드바 패널 연동'
  ];
}
```

---

## ⚠️ 주요 도전 과제

### 1. 복잡한 UI 요소 처리
**문제**: 현재 5단계 토글, AI 분석, 페이지네이션 등 복잡한 UI
**해결방안**: 
- 간소화된 인라인 버전 개발
- 고급 기능은 확장 패널로 분리
- 계층적 UI 구조 (기본 → 고급)

### 2. 성능 최적화
**문제**: 긴 문서에서 모든 오류 실시간 표시 시 성능 이슈
**해결방안**:
- 뷰포트 기반 렌더링 (View Plugin 활용)
- 가상 스크롤링 적용
- 디바운싱된 오류 검사

### 3. 모바일 호환성
**문제**: 터치 인터페이스에서 인라인 요소 조작의 복잡성
**해결방안**:
- 터치 친화적 인라인 UI 설계
- 긴 텍스트 터치 시 자동 모달 모드 전환
- 햅틱 피드백 활용

---

## 🎯 권장 구현 전략

### 하이브리드 모드 접근법
```typescript
interface SpellCheckMode {
  modal: CorrectionPopup;      // 기존 모달 방식 (복잡한 작업용)
  inline: InlineCorrector;     // 새로운 인라인 방식 (빠른 수정용)
  settings: ModeSettings;      // 사용자 선택 저장
}

class KoreanGrammarPlugin {
  private currentMode: 'modal' | 'inline' = 'modal';
  
  toggleMode() {
    this.currentMode = this.currentMode === 'modal' ? 'inline' : 'modal';
    this.saveSettings();
  }
}
```

### 사용자 시나리오별 모드 선택
- **빠른 수정**: 인라인 모드 (몇 개 오류, 간단한 수정)
- **전체 검토**: 모달 모드 (많은 오류, AI 분석, 복합적 수정)
- **실시간 작성**: 인라인 모드 (타이핑 중 즉시 피드백)

---

## 📊 예상 효과

### 긍정적 효과
1. **컨텍스트 유지**: 에디터에서 벗어나지 않고 수정 가능
2. **실시간성**: 타이핑 중 즉시 오류 감지 및 표시
3. **자연스러운 워크플로우**: 기존 텍스트 편집과 일관된 경험
4. **차별화**: 세계 최초 완전 인라인 한국어 맞춤법 검사

### 고려사항
1. **기능 제약**: 복잡한 AI 분석 UI는 제한적
2. **개발 복잡성**: 두 가지 모드 동시 유지 관리
3. **성능 영향**: 실시간 검사로 인한 잠재적 성능 저하

---

## ✅ 결론 및 최종 권장사항

### 실현 가능성: ⭐⭐⭐⭐⭐ (매우 높음)
Obsidian의 CodeMirror 6 기반 아키텍처는 인라인 모드를 완벽하게 지원합니다.

### 권장사항: 하이브리드 접근법
1. **기존 모달 모드 유지** - 복잡한 작업과 모바일 최적화
2. **새로운 인라인 모드 추가** - 빠른 수정과 실시간 피드백
3. **사용자 선택권 제공** - 상황과 선호에 따른 모드 전환

### 구현 우선순위
1. **Phase 1**: 기본 인라인 표시 (즉시 효과)
2. **Phase 2**: 기능 확장 (완성도 향상)  
3. **Phase 3**: 최적화 및 통합 (안정성 확보)

이 기능이 구현되면 **Obsidian 생태계에서 가장 혁신적인 한국어 지원 플러그인**이 될 것입니다.

---

*문서 작성일: 2025년 7월 25일*  
*작성자: Obsidian Integration Specialist*  
*상태: 초안 - Subagent 리뷰 대기*