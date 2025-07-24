/**
 * AI 프롬프트 템플릿
 * 성능 최적화를 위해 별도 파일로 분리
 */

// AI 프롬프트 템플릿
export const AI_PROMPTS = {
  analysisSystem: `당신은 한국어 맞춤법 검사 전문가입니다. 주어진 텍스트와 맞춤법 오류들을 분석하여 가장 적절한 수정사항을 선택해주세요.

다음 규칙을 따라주세요:
1. 문맥에 가장 적합한 수정안을 선택하세요
2. 고유명사, URL, 이메일, 전문용어는 예외처리를 고려하세요
3. 애매한 경우나 원문이 적절한 경우 원본유지를 선택하세요
4. 각 선택에 대한 신뢰도(0-100)와 간단한 이유를 제공하세요

🎨 UI 상태 색상 가이드:
- 🔴 빨간색: 오류 상태 (원본 오류 텍스트)
- 🟢 초록색: 수정 제안 상태 (AI/시스템 제안 수정안)
- 🔵 파란색: 예외처리 상태 (향후 검사 제외)
- 🟠 주황색: 원본유지 상태 (이번만 유지, 다음에 다시 검사)
- 🟣 보라색: 사용자편집 상태 (사용자가 CMD+E/우클릭/카드클릭으로 직접 편집한 텍스트)

📋 예외처리 vs 원본유지 가이드라인:

🔵 예외처리 (isExceptionProcessed: true) - 향후 맞춤법 검사에서 제외
✅ 적용 대상:
- 전문용어/브랜드명: React, GitHub, Instagram, 카카오톡, 슬랙
- 프로그래밍 용어: API, URL, JSON, TypeScript
- 고유한 서비스명: 네이버웹툰, 유튜브, 아마존웹서비스
- 외국어 표기: JavaScript, Kubernetes, Docker
- 인명/지명: 김철수, 뉴욕, 파리

🟡 원본유지 (isExceptionProcessed: false) - 이번에만 유지, 다음에 다시 검사
✅ 적용 대상:
- 일반 명사의 자연스러운 표현: "시간", "사람", "음식"
- 문맥상 적절한 표현이지만 확신이 없는 경우
- 맞춤법 규칙이 애매한 경우
- 작성자의 의도가 명확해 보이는 표현

🟣 사용자편집 상태 처리 가이드:
- **사용자가 이미 직접 편집한 텍스트는 사용자의 의도를 최대한 존중하세요**
- 사용자 편집 텍스트가 문법적으로 올바르다면 그대로 유지 권장
- 명백한 오타가 있더라도 사용자 의도를 고려하여 신중하게 판단
- 사용자 편집이 불완전해 보이면 비슷한 방향의 수정안 제안 고려

❌ 구분 원칙:
- 고유명사이면서 재사용 가능한 용어 → 예외처리
- 일반적인 단어나 표현 → 원본유지

⚠️ 중요한 응답 규칙:
- selectedValue에는 반드시 제공된 수정안 중 하나 또는 원본 텍스트만 입력하세요
- "원본유지", "예외처리" 같은 명령어를 사용하지 마세요
- 원본을 유지하려면 원본 텍스트를 selectedValue에 입력하세요
- 예외처리하려면 원본 텍스트를 selectedValue에 입력하고 isExceptionProcessed를 true로 설정하세요

🔴 정확한 텍스트 매칭 주의사항:
- "지킬"과 "지 킬"은 완전히 다른 단어입니다
- 원본을 유지하려면 정확히 "지킬"을 선택하세요 (띄어쓰기 없음)
- 괄호나 설명을 추가하지 마세요: "휴고" (○) vs "휴고(Hugo)" (✗)
- 공백 하나의 차이도 의미가 완전히 달라질 수 있습니다

선택 방법:
1. 수정이 필요한 경우: 제공된 수정안 중 하나를 selectedValue에 입력
2. 원본을 유지하는 경우: 원본 텍스트를 정확히 selectedValue에 입력, isExceptionProcessed: false
3. 예외처리하는 경우: 원본 텍스트를 정확히 selectedValue에 입력, isExceptionProcessed: true

⚠️ 응답 형식: 
- 오직 JSON 배열만 응답하세요. 다른 텍스트나 설명은 포함하지 마세요.
- 마크다운 코드 블록을 사용하지 마세요.

응답 형식 예시:
[
  {
    "correctionIndex": 0,
    "selectedValue": "따라",
    "isExceptionProcessed": false,
    "confidence": 90,
    "reasoning": "문맥상 원본이 적절한 표현"
  },
  {
    "correctionIndex": 1,
    "selectedValue": "슬랙",
    "isExceptionProcessed": true,
    "confidence": 100,
    "reasoning": "브랜드명으로 예외처리하여 향후 검사 제외"
  },
  {
    "correctionIndex": 2,
    "selectedValue": "시간",
    "isExceptionProcessed": false,
    "confidence": 85,
    "reasoning": "일반 명사로 원본유지, 다음에 다시 검사"
  }
]`,
  
  analysisUser: (originalText: string, corrections: any[]) => 
    `원문: "${originalText}"

발견된 맞춤법 오류들:
${corrections.map((correction, index) => 
  `${index}. "${correction.original}" → 수정안: [${correction.corrected.join(', ')}] (설명: ${correction.help})`
).join('\n')}

위 오류들에 대해 문맥을 고려하여 가장 적절한 선택을 해주세요.`,

  analysisUserWithContext: (correctionContexts: any[]) => 
    `총 ${correctionContexts.length}개의 맞춤법 오류들과 주변 문맥:

${correctionContexts.map((ctx, index) => {
  let contextInfo = `${index}. 오류: "${ctx.original}"
   문맥: "${ctx.fullContext}"
   수정안: [${ctx.corrected.join(', ')}]
   설명: ${ctx.help}`;
   
  // 🎨 현재 UI 상태 정보 추가
  if (ctx.currentState && ctx.currentValue) {
    const stateNames = {
      'error': '🔴 오류',
      'corrected': '🟢 수정',
      'exception-processed': '🔵 예외처리',
      'original-kept': '🟠 원본유지',
      'user-edited': '🟣 사용자편집'
    };
    const stateName = stateNames[ctx.currentState as keyof typeof stateNames] || `🔘 ${ctx.currentState}`;
    contextInfo += `
   현재 상태: ${stateName} (값: "${ctx.currentValue}")`;
  }
  
  return contextInfo + '\n   \n';
}).join('')}⚠️ 중요 응답 규칙:
1. 위의 모든 ${correctionContexts.length}개 오류에 대해 반드시 분석 결과를 제공해주세요.
2. correctionIndex는 반드시 0부터 ${correctionContexts.length - 1}까지의 순서를 사용하세요.
3. selectedValue는 반드시 제공된 수정안 중 하나 또는 원본 텍스트와 정확히 일치해야 합니다.
4. 특수문자(**, ~, - 등)와 공백/띄어쓰기를 정확히 복사해서 사용하세요.
5. 원본 유지 시에는 반드시 원본 텍스트를 정확히 입력하세요.
6. 누락된 오류가 있으면 안 됩니다.

⚠️ 정확한 매칭 예시:
- 오류: "지킬" → 수정안: ["지 킬", "지킨"] → 원본 유지 시 selectedValue: "지킬" (원본 그대로)
- 오류: "어" → 수정안: ["**어", "**아"] → selectedValue: "**어" (특수문자 포함 정확히)
- 오류: "총" → 수정안: ["** 총", "**총"] → selectedValue: "** 총" (공백 포함 정확히)`,

  // 새로운 형태소 기반 프롬프트 ⭐ NEW
  analysisUserWithMorphemes: (correctionContexts: any[], morphemeInfo?: any) => {
    let prompt = `총 ${correctionContexts.length}개의 맞춤법 오류 분석:

${correctionContexts.map((ctx, index) => {
  let contextInfo = `${index}. 오류: "${ctx.original}"
   수정안: [${ctx.corrected.join(', ')}]
   설명: ${ctx.help}
   문맥: "${ctx.fullContext}"`;
   
  // 🎨 현재 UI 상태 정보 추가
  if (ctx.currentState && ctx.currentValue) {
    const stateNames = {
      'error': '🔴 오류',
      'corrected': '🟢 수정',
      'exception-processed': '🔵 예외처리',
      'original-kept': '🟠 원본유지',
      'user-edited': '🟣 사용자편집'
    };
    const stateName = stateNames[ctx.currentState as keyof typeof stateNames] || `🔘 ${ctx.currentState}`;
    contextInfo += `
   현재 상태: ${stateName} (값: "${ctx.currentValue}")`;
  }
   
  // 🔧 고유명사인 경우 문장 컨텍스트 추가 (선별적 확장)
  if (ctx.isLikelyProperNoun && ctx.sentenceContext) {
    contextInfo += `
   📍 고유명사 가능성 높음 - 전체 문장: "${ctx.sentenceContext}"`;
  }
  
  return contextInfo;
}).join('\n\n')}`;

    // 형태소 정보가 있으면 추가 (간소화된 버전)
    if (morphemeInfo && morphemeInfo.tokens && morphemeInfo.tokens.length > 0) {
      // 🔧 핵심 품사 정보만 추출 (토큰 절약)
      const coreTokens = morphemeInfo.tokens.slice(0, 10); // 최대 10개 토큰만
      const morphemeData = coreTokens.map((token: any) => {
        const mainTag = token.morphemes[0]?.tag || 'UNK';
        return `${token.text.content}(${mainTag})`;
      }).join(', ');
      
      prompt += `\n\n📋 품사 정보: ${morphemeData}
💡 품사를 고려한 문법적 교정을 선택하세요.`;
    }

    // 고유명사가 있는 경우 특별 안내 추가
    const hasProperNouns = correctionContexts.some((ctx: any) => ctx.isLikelyProperNoun);
    if (hasProperNouns) {
      prompt += `\n\n🏷️ 고유명사 처리 가이드:

🔵 예외처리 권장 (isExceptionProcessed: true):
- 브랜드명/서비스명: 슬랙, 인스타그램, 카카오톡, 네이버웹툰
- 프로그래밍 용어: 리액트, 깃허브, 타입스크립트, 쿠버네티스  
- 소프트웨어 도구: 도커, 젠킨스, 주피터, 셀레니움
- 전문 용어: 데이터베이스, 웹사이트, 마크다운, 엔드포인트

🟡 원본유지 권장 (isExceptionProcessed: false):
- 일반 시간 명사: "시간", "날짜", "월요일", "오전"
- 일반 위치 명사: "건물", "사무실", "회의실", "집"
- 일반 사람 명사: "개발자", "디자이너", "사용자", "고객"
- 일반 객체 명사: "파일", "폴더", "문서", "이미지"

💡 판단 기준:
- 재사용 가능한 고유한 용어 → 예외처리
- 일반적인 명사나 표현 → 원본유지
- 문장 맥락을 고려하여 신중하게 선택하세요.`;
    }

    prompt += `

⚠️ 중요 응답 규칙:
1. 위의 모든 ${correctionContexts.length}개 오류에 대해 반드시 분석 결과를 제공해주세요.
2. correctionIndex는 반드시 0부터 ${correctionContexts.length - 1}까지의 순서를 사용하세요.
3. selectedValue는 반드시 제공된 수정안 중 하나 또는 원본 텍스트와 정확히 일치해야 합니다.
4. 🔴 정확한 텍스트 매칭: "지킬"≠"지 킬", 괄호 추가 금지 ("휴고"≠"휴고(Hugo)"), 원본 유지 시 정확한 원본 텍스트만 사용
5. 형태소 정보와 문장 맥락을 종합적으로 고려하여 판단하세요.
6. 고유명사는 예외처리(isExceptionProcessed: true) 우선 고려하세요.
7. 누락된 오류가 있으면 안 됩니다.`;

    return prompt;
  }
} as const;