---
name: obsidian-review
description: "Obsidian 플러그인 심사 리뷰 봇(eslint-plugin-obsidianmd)과 동일한 규칙으로 코드를 로컬 스캔하여 Required 이슈를 사전에 발견하고 수정합니다. 플러그인 심사 대응, ESLint 검사, sentence-case 수정 시 사용합니다."
argument-hint: "[fix|setup|check]"
disable-model-invocation: true
allowed-tools:
  - "Bash(npx:*)"
  - "Bash(npm install:*)"
  - "Bash(npm run build:*)"
  - "Bash(git checkout:*)"
  - Read
  - Edit
  - Write
  - Glob
  - Grep
---

# Obsidian 플러그인 심사 봇 로컬 검증

인자: $ARGUMENTS
- 인자 없음: 전체 스캔 + 이슈 리포트만 출력
- `fix`: 전체 스캔 + 발견된 Required 이슈 자동 수정
- `setup`: ESLint 환경 세팅만 수행
- `check`: 환경이 준비되었는지만 확인

이슈 유형별 상세 해결법은 [obsidian-plugin-review-guide.md](../../../.taskmaster/docs/obsidian-plugin-review-guide.md)를 참조한다.

## 1단계: 환경 확인

다음 3가지를 확인한다:

1. `node_modules/eslint-plugin-obsidianmd` 디렉토리 존재 여부
2. `node_modules/eslint` 디렉토리 존재 여부
3. 프로젝트 루트에 `eslint.config.mjs` 파일 존재 여부

하나라도 없으면 2단계로, 모두 있으면 3단계로 진행한다.
인자가 `check`이면 환경 상태만 보고하고 종료한다.

## 2단계: 환경 세팅 (필요 시)

누락된 항목만 설치/생성한다:

- `eslint-plugin-obsidianmd` 미설치 시:
  ```bash
  npm install --save-dev eslint-plugin-obsidianmd --legacy-peer-deps
  ```

- `eslint` 미설치 시:
  ```bash
  npm install --save-dev eslint --legacy-peer-deps
  ```

- `eslint.config.mjs` 미존재 시, 다음 내용으로 생성:
  ```javascript
  import obsidianmd from 'eslint-plugin-obsidianmd';
  export default [...obsidianmd.configs.recommended];
  ```

설치 후 `package.json`과 `package-lock.json` 변경을 되돌린다:
```bash
git checkout -- package.json package-lock.json
```

인자가 `setup`이면 세팅 완료 후 종료한다.

## 3단계: ESLint 실행

```bash
npx eslint main.ts 'src/**/*.ts' 2>&1
```

## 4단계: 결과 분석

ESLint 출력을 분석하여 다음 형태로 요약 보고한다:

```
## 스캔 결과

- Required 이슈: N개
- Optional 이슈: N개

### Required 이슈 목록
| # | 파일 | 행 | 규칙 | 내용 |
|---|------|-----|------|------|
| 1 | src/ui/settings-tab.ts | 371 | sentence-case | "Copy the NID_AUT cookie value" |
```

에러 0개이면 "Required 이슈 없음 — 심사 봇 통과 예상"을 출력하고 종료한다.

## 5단계: 이슈 수정 (인자가 `fix`인 경우만)

발견된 Required 이슈를 하나씩 수정한다. 수정 전략:

- **sentence-case**: 기본 브랜드 목록(iOS, Obsidian, GitHub 등 57개)에 없는 고유명사는 소문자화하거나 제거. 첫 단어 위치면 대문자 허용. `enforceCamelCaseLower: true` 설정이므로 CamelCase도 변환 대상.
- **empty catch**: `catch {` 또는 주석 추가
- **as any**: 구체적 타입 또는 `as unknown as Type`
- **no-explicit-any**: `unknown` 또는 구체적 타입으로 대체
- **template literal never**: `String()` 래핑
- **regex escape**: `new RegExp()` 사용
- **async without await**: `async` 키워드 제거
- **unused catch param**: `catch (error)` → `catch`

수정 후 ESLint를 다시 실행하여 에러 0개 확인. 남아있으면 반복.

## 6단계: 빌드 확인

```bash
npm run build
```

빌드 실패 시 타입 에러 수정 후 재빌드.

## 7단계: 최종 보고

```
## 최종 결과

- 발견된 Required 이슈: N개
- 수정된 이슈: N개 (fix 모드인 경우)
- 남은 이슈: N개
- 빌드 상태: 성공/실패

### 수정된 파일 목록 (fix 모드인 경우)
- src/ui/settings-tab.ts (2건 수정)
- main.ts (1건 수정)
```
