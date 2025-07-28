# 인라인 모드 리팩토링 계획 📋

## 1. 개요

인라인 모드는 현재 단일 파일(`inlineModeService.ts`)에 3,500+ 라인의 코드가 집중되어 있어 유지보수성과 확장성에 문제가 있습니다. 이를 모듈화하고 책임을 분리하여 더 나은 아키텍처로 개선합니다.

## 2. 현재 문제점 분석

### 2.1 단일 파일 집중도 문제
- **inlineModeService.ts**: 3,500+ 라인
- 모든 기능이 하나의 클래스에 집중
- 코드 탐색 및 수정이 어려움
- 테스트 작성 복잡성 증가

### 2.2 책임 분리 부족
- UI 렌더링, 상태 관리, 이벤트 처리, API 호출이 혼재
- 의존성 관계가 복잡하게 얽혀있음
- 단일 책임 원칙(SRP) 위반

### 2.3 코드 중복
- 유사한 로직이 여러 곳에 반복
- 텍스트 처리, 위치 계산 로직 중복
- AI 분석 관련 코드가 여러 메서드에 산재

## 3. 리팩토링 목표

### 3.1 모듈화
- 기능별로 독립적인 모듈 분리
- 각 모듈의 명확한 책임 정의
- 느슨한 결합, 강한 응집

### 3.2 테스트 가능성
- 각 모듈을 독립적으로 테스트 가능
- Mock 객체 사용 용이성
- 단위 테스트 커버리지 향상

### 3.3 확장성
- 새로운 기능 추가 시 기존 코드 영향 최소화
- 플러그인 아키텍처 적용 가능
- 다양한 에디터 타입 지원 확장 가능

## 4. 새로운 아키텍처 설계

### 4.1 디렉토리 구조
```
src/inline/
├── core/                     # 핵심 비즈니스 로직
│   ├── InlineModeCore.ts     # 메인 오케스트레이터
│   ├── ErrorProcessor.ts     # 오류 처리 로직
│   └── AIIntegration.ts      # AI 분석 통합
├── decorations/              # CodeMirror 데코레이션 관리
│   ├── DecorationManager.ts  # 데코레이션 생성/관리
│   ├── ErrorDecoration.ts    # 오류 데코레이션
│   ├── AIDecoration.ts       # AI 분석 결과 데코레이션
│   └── FocusDecoration.ts    # 포커스 데코레이션
├── events/                   # 이벤트 처리
│   ├── EventManager.ts       # 이벤트 관리자
│   ├── ClickHandler.ts       # 클릭 이벤트 처리
│   ├── HoverHandler.ts       # 호버 이벤트 처리
│   └── KeyboardHandler.ts    # 키보드 이벤트 처리
├── state/                    # 상태 관리
│   ├── InlineState.ts        # 인라인 모드 상태
│   ├── ErrorState.ts         # 오류 상태 관리
│   └── SelectionState.ts     # 선택 영역 상태
├── ui/                       # UI 컴포넌트
│   ├── ErrorTooltip.ts       # 오류 툴팁 (기존 분리)
│   ├── ErrorWidget.ts        # 오류 위젯
│   └── AIWidget.ts           # AI 위젯
├── utils/                    # 유틸리티
│   ├── TextUtils.ts          # 텍스트 처리 유틸리티
│   ├── PositionUtils.ts      # 위치 계산 유틸리티
│   └── MergeUtils.ts         # 오류 병합 유틸리티
└── types/                    # 타입 정의
    ├── InlineTypes.ts        # 인라인 모드 전용 타입
    └── EventTypes.ts         # 이벤트 관련 타입
```

### 4.2 핵심 클래스 설계

#### 4.2.1 InlineModeCore
```typescript
export class InlineModeCore {
  private decorationManager: DecorationManager;
  private eventManager: EventManager;
  private stateManager: InlineStateManager;
  private aiIntegration: AIIntegration;
  
  async analyzeText(text: string): Promise<void>
  async applyAIAnalysis(results: AIAnalysisResult[]): Promise<void>
  async handleUserEdit(errorId: string, newValue: string): Promise<void>
}
```

#### 4.2.2 DecorationManager
```typescript
export class DecorationManager {
  private errorDecorations: Map<string, Decoration>;
  private aiDecorations: Map<string, Decoration>;
  private focusDecorations: Map<string, Decoration>;
  
  createErrorDecoration(error: InlineError): Decoration
  createAIDecoration(error: InlineError): Decoration
  updateDecorations(view: EditorView): void
  clearAllDecorations(): void
}
```

#### 4.2.3 EventManager
```typescript
export class EventManager {
  private clickHandler: ClickHandler;
  private hoverHandler: HoverHandler;
  private keyboardHandler: KeyboardHandler;
  
  registerEvents(view: EditorView): void
  unregisterEvents(): void
  handleClick(event: MouseEvent): void
  handleHover(event: MouseEvent): void
  handleKeyboard(event: KeyboardEvent): void
}
```

## 5. 리팩토링 단계별 계획

### 5.1 Phase 1: 기반 구조 구축 (1주)
- [ ] 새로운 디렉토리 구조 생성
- [ ] 기본 인터페이스 및 타입 정의
- [ ] InlineModeCore 뼈대 구현
- [ ] 기존 코드와의 호환성 유지

### 5.2 Phase 2: 데코레이션 시스템 분리 (1주)
- [ ] DecorationManager 구현
- [ ] ErrorDecoration, AIDecoration 분리
- [ ] 기존 데코레이션 로직을 새 시스템으로 마이그레이션
- [ ] 테스트 코드 작성

### 5.3 Phase 3: 이벤트 시스템 분리 (1주)
- [ ] EventManager 및 핸들러 클래스 구현
- [ ] 클릭, 호버, 키보드 이벤트 로직 분리
- [ ] 이벤트 위임 최적화
- [ ] 모바일/데스크톱 이벤트 처리 통합

### 5.4 Phase 4: 상태 관리 시스템 (1주)
- [ ] InlineState, ErrorState 구현
- [ ] 상태 변경 이벤트 시스템 구축
- [ ] 기존 activeErrors Map을 새 상태 시스템으로 전환
- [ ] 상태 동기화 로직 구현

### 5.5 Phase 5: AI 통합 모듈 분리 (1주)
- [ ] AIIntegration 클래스 구현
- [ ] AI 분석 워크플로우 독립화
- [ ] AI 결과 적용 로직 분리
- [ ] AI 상태 관리 개선

### 5.6 Phase 6: 유틸리티 및 최적화 (1주)
- [ ] TextUtils, PositionUtils 구현
- [ ] 오류 병합 로직 개선 및 분리
- [ ] 성능 최적화 적용
- [ ] 메모리 누수 방지 강화

### 5.7 Phase 7: 테스트 및 문서화 (1주)
- [ ] 각 모듈별 단위 테스트 작성
- [ ] 통합 테스트 시나리오 구성
- [ ] 성능 테스트 실행
- [ ] API 문서 작성

### 5.8 Phase 8: 기존 코드 제거 및 마무리 (1주)
- [ ] 기존 inlineModeService.ts 단계적 제거
- [ ] 호환성 검증
- [ ] 최종 성능 테스트
- [ ] 리팩토링 결과 문서화

## 6. 마이그레이션 전략

### 6.1 점진적 마이그레이션
- 기존 시스템과 새 시스템을 병행 운영
- 기능별로 단계적 전환
- 각 단계마다 테스트 및 검증

### 6.2 호환성 유지
- 기존 API 인터페이스 유지
- 사용자 설정 및 데이터 보존
- 플러그인 외부 인터페이스 불변

### 6.3 롤백 계획
- 각 Phase별 브랜치 관리
- 문제 발생 시 이전 단계로 롤백 가능
- 중요 마일스톤마다 백업 생성

## 7. 예상 효과

### 7.1 개발 생산성
- **코드 가독성**: 50% 향상 (라인 수 1/3 감소)
- **버그 수정 시간**: 40% 단축
- **새 기능 개발**: 60% 빨라짐

### 7.2 성능 개선
- **메모리 사용량**: 20% 감소
- **렌더링 성능**: 30% 향상
- **이벤트 처리**: 25% 빨라짐

### 7.3 테스트 커버리지
- **단위 테스트**: 0% → 80%
- **통합 테스트**: 제한적 → 포괄적
- **회귀 테스트**: 수동 → 자동화

## 8. 리스크 관리

### 8.1 기술적 리스크
- **복잡성 증가**: 모듈 간 인터페이스 설계 중요
- **성능 오버헤드**: 과도한 추상화 방지
- **호환성 문제**: 기존 기능 동작 보장

### 8.2 일정 리스크
- **예상 기간**: 8주 (2개월)
- **버퍼 시간**: 2주 추가 고려
- **병렬 작업**: 독립적 모듈은 동시 개발 가능

### 8.3 품질 리스크
- **테스트 부족**: 각 Phase별 테스트 필수
- **문서화 부족**: 개발과 동시에 문서 작성
- **사용자 영향**: 베타 테스트 단계 운영

## 9. 성공 지표

### 9.1 정량적 지표
- [ ] 라인 수: 3,500+ → 1,000- (메인 파일)
- [ ] 파일 수: 1개 → 15+개 모듈
- [ ] 테스트 커버리지: 80% 이상
- [ ] 성능 개선: 30% 이상

### 9.2 정성적 지표
- [ ] 코드 리뷰 시간 단축
- [ ] 신규 개발자 온보딩 시간 단축
- [ ] 버그 재현 및 수정 용이성
- [ ] 기능 확장 시 기존 코드 영향도 최소화

## 10. 다음 단계

1. **이해관계자 승인**: 리팩토링 계획 검토 및 승인
2. **개발 환경 준비**: 브랜치 전략 및 CI/CD 파이프라인 설정
3. **Phase 1 시작**: 기반 구조 구축 착수
4. **주간 리뷰**: 매주 진행상황 점검 및 조정

---

*이 리팩토링을 통해 인라인 모드는 더욱 견고하고 확장 가능한 아키텍처를 갖게 되며, 향후 새로운 기능 추가와 유지보수가 훨씬 수월해질 것입니다.*