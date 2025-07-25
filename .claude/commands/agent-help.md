# Korean Grammar Assistant - Subagent Directory

한국어 문법 검사 플러그인 개발을 위한 전문화된 subagent들입니다.

## 🤖 Available Subagents

### 1. `/mobile-debug` - 모바일 디버깅 전문가
**전문 분야**: 모바일 UI/UX 이슈 해결
- 터치 이벤트 처리
- 반응형 레이아웃 문제
- Platform.isMobile 조건부 로직
- 전체 화면 모달 최적화

### 2. `/ai-feature` - AI 기능 개발 전문가  
**전문 분야**: AI 자동 교정 시스템
- 다중 AI 제공자 관리 (OpenAI, Anthropic, Google, Ollama)
- 프롬프트 엔지니어링
- 토큰 최적화 및 비용 관리
- 신뢰도 시스템 구축

### 3. `/ui-optimizer` - UI/UX 최적화 전문가
**전문 분야**: 사용자 인터페이스 개선
- 키보드 네비게이션 (18개 단축키)
- 5단계 토글 시스템 (🔴🟢🔵🟠🟣)
- 동적 페이지네이션
- 반응형 디자인

### 4. `/korean-nlp` - 한국어 NLP 전문가
**전문 분야**: 한국어 처리 로직
- Bareun.ai API 최적화
- 형태소 분석 활용
- 문장 경계 감지
- 맞춤법 검사 정확도 개선

### 5. `/performance-audit` - 성능 최적화 전문가
**전문 분야**: 성능 분석 및 최적화
- 메모리 관리 및 누수 방지
- DOM 최적화 및 가상 스크롤링
- 캐싱 시스템 (LRU)
- 번들 크기 최적화

### 6. `/release-manager` - 릴리즈 관리 전문가
**전문 분야**: 배포 및 버전 관리
- GitHub Actions 워크플로우
- 한국어 릴리즈 노트 작성
- Obsidian Plugin Store 준비
- 품질 관리 체크리스트

### 7. `/obsidian-integration` - Obsidian 통합 전문가
**전문 분야**: Obsidian API 및 생태계
- Obsidian API 최적화 활용
- 플러그인 가이드라인 준수
- 크로스 플랫폼 호환성
- 테마 및 다른 플러그인과의 호환성

## 🚀 사용 방법

각 subagent는 특정 도메인에 특화되어 있습니다:

```
/mobile-debug 터치홀드 이벤트가 작동하지 않는 문제
/ai-feature OpenAI API 토큰 사용량 최적화 필요
/ui-optimizer 키보드 네비게이션 개선
/korean-nlp 형태소 분석 결과 활용도 개선
/performance-audit 메모리 사용량 분석
/release-manager v0.2.6 릴리즈 준비
/obsidian-integration 새로운 Obsidian API 활용
```

## 📁 프로젝트 구조 이해

```
korean-grammar-assistant/
├── src/
│   ├── ui/           # UI 컴포넌트 (/ui-optimizer)
│   ├── services/     # API 및 비즈니스 로직 (/korean-nlp, /ai-feature)
│   ├── utils/        # 유틸리티 (/performance-audit)
│   └── types/        # 타입 정의
├── styles/           # CSS 모듈 (/mobile-debug, /ui-optimizer)
├── .claude/commands/ # Subagent 정의
└── docs-reference/   # Obsidian API 문서 (/obsidian-integration)
```

## 🤝 Subagent 협업

복합적인 문제는 여러 subagent가 협업할 수 있습니다:
- 모바일 성능 이슈: `/mobile-debug` + `/performance-audit`
- AI 기능 UI 개선: `/ai-feature` + `/ui-optimizer`
- 릴리즈 전 최적화: `/performance-audit` + `/release-manager`