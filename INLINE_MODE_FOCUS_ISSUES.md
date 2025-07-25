# Korean Grammar Assistant - 인라인 모드 포커스 하이라이트 이슈 해결 기록

## 📋 개요

Korean Grammar Assistant 플러그인의 인라인 모드에서 키보드 네비게이션(F9/F10) 시 포커스 하이라이트가 제대로 작동하지 않는 문제들을 해결한 과정을 기록합니다.

## 🚨 발견된 주요 이슈들

### 1. 키보드 단축키 미작동 문제
- **증상**: F9, F10 키가 작동하지 않음
- **원인**: Obsidian Scope API 미사용으로 키보드 이벤트 충돌
- **해결**: Obsidian의 공식 키보드 스코프 시스템 적용

### 2. 포커스 하이라이트 표시 누락
- **증상**: F9/F10으로 이동은 되지만 시각적 포커스 표시가 없음
- **원인**: DOM 직접 조작 방식이 CodeMirror 6에서 작동하지 않음
- **해결**: CodeMirror 6 decoration 시스템으로 전환

### 3. CodeMirror 6 Decoration 정렬 오류
- **증상**: `Ranges must be added sorted by from position and startSide` 오류 발생
- **원인**: decoration 배열이 위치 기준으로 정렬되지 않음
- **해결**: `newDecorations.sort((a, b) => a.from - b.from)` 추가

### 4. 포커스 하이라이트 색상 문제
- **증상**: 과도한 빨간색으로 사용자 부담감 증가
- **원인**: 인라인 스타일의 강한 색상 적용
- **해결**: CSS 클래스 기반 부드러운 색상으로 변경

### 5. 키보드 네비게이션 순서 문제
- **증상**: 중복/겹친 단어에서 이동 순서가 부정확
- **원인**: Map 순서에 의존한 네비게이션 로직
- **해결**: 위치 기준 정렬된 배열 사용

### 6. 기본 오류 표시 누락
- **증상**: 맞춤법 검사 후 밑줄 등 기본 표시가 사라짐
- **원인**: 포커스 스타일 개선 시 인라인 스타일 과도하게 제거
- **해결**: 기본 밑줄 스타일 복원, 포커스만 CSS 클래스 사용

### 7. 겹친 오류 포커스 부정확성
- **증상**: 겹친 단어에서 포커스가 실제 단어와 다른 위치에 표시, 오류로 탐지된 문구가 분절되어 하이라이팅됨
- **원인**: uniqueId 생성 시 위치 정보 부족으로 인한 매칭 오류, 같은 텍스트의 중복 발견으로 인한 분절된 하이라이팅
- **해결**: 위치 정보 포함한 고유 식별자 생성 + 겹치는 오류 범위 병합 로직 추가

## 🛠️ 주요 해결 방법들

### 1. Obsidian Scope API 활용
```typescript
// 키보드 스코프 생성 및 단축키 등록
this.keyboardScope = new Scope(this.app.scope);
this.keyboardScope.register([], 'F9', (evt) => {
  // 이전 오류로 이동 로직
});
this.keyboardScope.register([], 'F10', (evt) => {
  // 다음 오류로 이동 로직
});
this.app.keymap.pushScope(this.keyboardScope);
```

### 2. CodeMirror 6 Decoration 시스템
```typescript
// StateEffect 정의
export const setFocusedErrorDecoration = StateEffect.define<string | null>();

// StateField로 decoration 관리
export const errorDecorationField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(decorations, tr) {
    // decoration 업데이트 로직
    if (effect.is(setFocusedErrorDecoration)) {
      // 포커스된 오류에 따라 decoration 재생성
    }
  }
});
```

### 3. 위치 기준 정렬 시스템
```typescript
// 오류 목록을 위치 기준으로 정렬
static getActiveErrors(): InlineError[] {
  const errors = Array.from(this.activeErrors.values());
  return errors.sort((a, b) => {
    // 1차: 시작 위치 기준 정렬
    if (a.start !== b.start) return a.start - b.start;
    // 2차: 끝 위치 기준 정렬 (겹치는 경우 짧은 것 우선)
    if (a.end !== b.end) return a.end - b.end;
    // 3차: uniqueId 기준 정렬 (안정적인 순서 보장)
    return a.uniqueId.localeCompare(b.uniqueId);
  });
}
```

### 4. 정확한 uniqueId 생성
```typescript
// 위치 정보를 포함한 고유 식별자
const uniqueId = `${index}_${occurrence}_${foundIndex}`;
```

### 5. 하이브리드 스타일링 시스템
```typescript
// 일반 오류: 인라인 스타일로 기본 밑줄 표시
'style': isFocused ? '' : `
  text-decoration-line: underline !important;
  text-decoration-style: wavy !important;
  text-decoration-color: #ff0000 !important;
  text-decoration-thickness: 2px !important;
  background-color: rgba(255, 0, 0, 0.05) !important;
  cursor: pointer !important;
`

// 포커스된 오류: CSS 클래스로 부드러운 하이라이트
class: `korean-grammar-error-inline ${isFocused ? 'korean-grammar-focused' : ''}`
```

### 6. 겹치는 오류 범위 병합 시스템
```typescript
// 겹치거나 인접한 오류들을 하나로 병합하여 분절된 하이라이팅 방지
private static mergeOverlappingErrors(errors: InlineError[]): InlineError[] {
  // 위치 기준 정렬
  const sortedErrors = [...errors].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });

  // 겹치거나 매우 가까운 경우 병합 (1글자 이내 간격)
  const isOverlapping = current.end > next.start;
  const isAdjacent = current.end >= next.start - 1;
  
  if (isOverlapping || isAdjacent) {
    // 병합된 범위와 교정 제안 생성
    const mergedError = {
      start: Math.min(current.start, next.start),
      end: Math.max(current.end, next.end),
      correction: {
        original: mergedText,
        corrected: [...new Set([...current.correction.corrected, ...next.correction.corrected])],
        help: current.correction.help || next.correction.help
      }
    };
  }
}
```

## 🎯 최종 구현된 기능들

### 키보드 단축키
- **F9**: 이전 오류로 이동
- **F10**: 다음 오류로 이동
- **Ctrl+Shift+J**: 다음 오류로 이동 (충돌 방지용)
- **Ctrl+Shift+K**: 이전 오류로 이동 (충돌 방지용)

### 시각적 피드백
- **일반 오류**: 빨간 물결 밑줄 + 연한 빨간 배경
- **포커스된 오류**: 부드러운 주황색 아웃라인 + 펄스 애니메이션
- **위치 기준 순차적 이동**: 텍스트 상에서 자연스러운 순서로 이동
- **통합된 하이라이팅**: 겹치거나 인접한 오류들을 병합하여 분절 방지

### 오류 처리 시스템
- **범위 병합**: 겹치거나 1글자 이내 간격의 오류들을 자동으로 병합
- **교정 제안 통합**: 병합된 오류에 대해 모든 교정 제안을 중복 제거하여 제공
- **정확한 매칭**: 위치 정보 기반 고유 식별자로 정확한 오류 추적

### 디버깅 시스템
- **상세한 로그**: 각 오류의 uniqueId, 위치, 텍스트 정보 출력
- **매칭 확인**: 포커스 설정과 실제 적용 상태 검증
- **실시간 모니터링**: decoration 업데이트 과정 추적

## 📈 성능 최적화

### 1. Decoration 정렬
- CodeMirror 6 요구사항에 맞춘 위치 기준 정렬
- 정렬 오류로 인한 크래시 방지

### 2. 효율적인 상태 관리
- StateEffect를 통한 최적화된 decoration 업데이트
- 불필요한 DOM 조작 제거

### 3. 메모리 관리
- 정렬된 배열 캐싱으로 반복 계산 방지
- 적절한 로그 레벨로 성능 영향 최소화

## 🔧 기술적 세부사항

### 사용된 Obsidian API
- `Scope`: 키보드 단축키 관리
- `EditorView`: CodeMirror 6 에디터 접근
- `StateEffect`: decoration 상태 변경
- `StateField`: decoration 상태 관리
- `Decoration.mark()`: 텍스트 마킹

### CSS 클래스 구조
```css
.korean-grammar-error-inline {
  /* 기본 오류 스타일 */
  display: inline !important;
  position: relative !important;
  cursor: pointer !important;
}

.korean-grammar-focused {
  /* 포커스된 오류 스타일 */
  outline: 3px solid #ff6b6b !important;
  outline-offset: 2px !important;
  border-radius: 4px !important;
  background-color: rgba(255, 107, 107, 0.15) !important;
  animation: focusPulse 2s ease-in-out infinite !important;
}
```

## 🐛 남은 잠재적 이슈들

### 1. 매우 긴 텍스트에서의 성능
- 대량의 오류가 있을 때 decoration 업데이트 성능
- 가상 스크롤링이나 페이지네이션 필요할 수 있음

### 2. 다른 플러그인과의 호환성
- 다른 에디터 확장과의 키보드 단축키 충돌 가능성
- decoration 스타일 충돌 가능성

### 3. 접근성
- 스크린 리더 지원 개선 필요
- 고대비 모드 지원 확인 필요

## 📝 향후 개선 방향

### 1. 사용자 설정
- 키보드 단축키 커스터마이징
- 포커스 하이라이트 색상/스타일 설정

### 2. 성능 개선
- 대용량 텍스트 처리 최적화
- 지연 로딩 및 가상화 고려

### 3. 기능 확장
- 마우스 휠 네비게이션 지원
- 미니맵에서 오류 위치 표시

## 🎉 결론

모든 주요 이슈들이 해결되어 안정적인 키보드 네비게이션과 시각적 포커스 하이라이팅이 구현되었습니다. 특히 CodeMirror 6의 decoration 시스템을 올바르게 활용함으로써 Obsidian 에디터와 완벽하게 통합된 사용자 경험을 제공할 수 있게 되었습니다. 

**2025년 1월 25일 업데이트**: 겹치는 오류 범위 병합 로직을 추가하여 분절된 하이라이팅 문제까지 완전히 해결되었습니다. 이제 연속된 텍스트에서 발생하는 오류들이 하나의 통합된 하이라이팅으로 표시되어 더욱 직관적인 사용자 경험을 제공합니다.

---

**작성일**: 2025년 1월 25일  
**플러그인 버전**: v0.2.5  
**주요 기여**: CodeMirror 6 decoration 시스템 적용, 키보드 네비게이션 완전 구현