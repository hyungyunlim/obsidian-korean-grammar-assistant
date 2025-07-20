/**
 * AI 모델 정의 및 제공자 설정
 */

import { AIProvider } from '../types/interfaces';

// 기본 모델 설정
export const AI_PROVIDER_DEFAULTS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-haiku-20240307',
  google: 'gemini-1.5-flash',
  ollama: 'llama3.2:3b'
} as const;

// OpenAI 모델 목록
export const OPENAI_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
  'gpt-3.5-turbo-16k',
  'o1-preview',
  'o1-mini'
] as const;

// Anthropic 모델 목록
export const ANTHROPIC_MODELS = [
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307'
] as const;

// Google 모델 목록
export const GOOGLE_MODELS = [
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.0-pro'
] as const;

// Ollama 모델 목록 (로컬)
export const OLLAMA_MODELS = [
  'llama3.2:3b',
  'llama3.2:1b',
  'llama3.1:8b',
  'mistral:7b',
  'qwen2:7b'
] as const;

// API 엔드포인트
export const API_ENDPOINTS = {
  openai: {
    base: 'https://api.openai.com/v1',
    chat: 'https://api.openai.com/v1/chat/completions',
    models: 'https://api.openai.com/v1/models'
  },
  anthropic: {
    base: 'https://api.anthropic.com',
    messages: 'https://api.anthropic.com/v1/messages'
  },
  google: {
    base: 'https://generativelanguage.googleapis.com/v1',
    generateContent: (model: string) => `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`
  }
} as const;

// 모델 검증 접두사
export const MODEL_PREFIXES = {
  openai: ['gpt-', 'o1-', 'text-', 'davinci-', 'curie-', 'babbage-', 'ada-'],
  anthropic: ['claude-'],
  google: ['gemini-', 'palm-', 'chat-bison', 'text-bison']
} as const;

// 한국어 맞춤법 검사에 권장되는 모델들
export const RECOMMENDED_MODELS_FOR_KOREAN = [
  'gpt-4o',
  'gpt-4o-mini',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'gemini-1.5-pro',
  'gemini-1.5-flash'
] as const;

// 모델별 최대 출력 토큰 제한
export const MODEL_TOKEN_LIMITS = {
  // OpenAI 모델들
  'gpt-4o': 4096,
  'gpt-4o-mini': 16384,
  'gpt-4-turbo': 4096,
  'gpt-4': 4096,
  'gpt-3.5-turbo': 4096,
  'gpt-3.5-turbo-16k': 4096,
  'o1-preview': 32768,
  'o1-mini': 65536,
  
  // Anthropic 모델들 (매우 높은 한계)
  'claude-3-5-sonnet-20241022': 8192,
  'claude-3-5-haiku-20241022': 8192,
  'claude-3-opus-20240229': 4096,
  'claude-3-sonnet-20240229': 4096,
  'claude-3-haiku-20240307': 4096,
  
  // Google 모델들
  'gemini-1.5-pro': 8192,
  'gemini-1.5-flash': 8192,
  'gemini-1.5-flash-8b': 8192,
  'gemini-1.0-pro': 2048,
  
  // Ollama 모델들 (설정 가능하지만 보수적으로)
  'llama3.2:3b': 2048,
  'llama3.2:1b': 2048,
  'llama3.1:8b': 2048,
  'mistral:7b': 2048,
  'qwen2:7b': 2048
} as const;

// 기본 AI 설정 값
export const DEFAULT_AI_SETTINGS = {
  enabled: false, // 기본적으로 비활성화
  provider: 'openai' as AIProvider,
  openaiApiKey: '',
  anthropicApiKey: '',
  googleApiKey: '',
  ollamaEndpoint: 'http://localhost:11434',
  model: 'gpt-4o-mini',
  maxTokens: 2000, // 기본값 (모델별 제한 내에서 자동 조정됨)
  temperature: 0.1, // 낮은 값으로 설정하여 일관된 결과 도출
  showTokenWarning: true, // 기본적으로 토큰 경고 활성화
  tokenWarningThreshold: 3000 // 3000 토큰 이상일 때 경고
} as const;

// AI 프롬프트 템플릿
export const AI_PROMPTS = {
  analysisSystem: `당신은 한국어 맞춤법 검사 전문가입니다. 주어진 텍스트와 맞춤법 오류들을 분석하여 가장 적절한 수정사항을 선택해주세요.

다음 규칙을 따라주세요:
1. 문맥에 가장 적합한 수정안을 선택하세요
2. 고유명사, URL, 이메일, 전문용어는 예외처리를 고려하세요
3. 애매한 경우나 원문이 적절한 경우 원본유지를 선택하세요
4. 각 선택에 대한 신뢰도(0-100)와 간단한 이유를 제공하세요

⚠️ 중요한 응답 규칙:
- selectedValue에는 반드시 제공된 수정안 중 하나 또는 원본 텍스트만 입력하세요
- "원본유지", "예외처리" 같은 명령어를 사용하지 마세요
- 원본을 유지하려면 원본 텍스트를 selectedValue에 입력하세요
- 예외처리하려면 원본 텍스트를 selectedValue에 입력하고 isExceptionProcessed를 true로 설정하세요

선택 방법:
1. 수정이 필요한 경우: 제공된 수정안 중 하나를 selectedValue에 입력
2. 원본을 유지하는 경우: 원본 텍스트를 selectedValue에 입력, isExceptionProcessed: false
3. 예외처리하는 경우: 원본 텍스트를 selectedValue에 입력, isExceptionProcessed: true

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
    "reasoning": "원본이 적절함"
  },
  {
    "correctionIndex": 1,
    "selectedValue": "슬랙",
    "isExceptionProcessed": true,
    "confidence": 100,
    "reasoning": "고유명사로 예외처리"
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

${correctionContexts.map((ctx, index) => 
  `${index}. 오류: "${ctx.original}"
   문맥: "${ctx.fullContext}"
   수정안: [${ctx.corrected.join(', ')}]
   설명: ${ctx.help}
   
`).join('')}⚠️ 중요 응답 규칙:
1. 위의 모든 ${correctionContexts.length}개 오류에 대해 반드시 분석 결과를 제공해주세요.
2. correctionIndex는 반드시 0부터 ${correctionContexts.length - 1}까지의 순서를 사용하세요.
3. selectedValue는 반드시 제공된 수정안 중 하나 또는 원본 텍스트와 정확히 일치해야 합니다.
4. 특수문자(**, ~, - 등)가 포함된 수정안은 그대로 복사해서 사용하세요.
5. 누락된 오류가 있으면 안 됩니다.

예시:
- 오류: "어" → 수정안: ["**어", "**아"] → selectedValue: "**어" (정확한 형태 사용)
- 오류: "총" → 수정안: ["** 총", "**총"] → selectedValue: "** 총" (공백 포함 정확히 사용)`,

  // 새로운 형태소 기반 프롬프트 ⭐ NEW
  analysisUserWithMorphemes: (correctionContexts: any[], morphemeInfo?: any) => {
    let prompt = `총 ${correctionContexts.length}개의 맞춤법 오류 분석:

${correctionContexts.map((ctx, index) => 
  `${index}. 오류: "${ctx.original}"
   수정안: [${ctx.corrected.join(', ')}]
   설명: ${ctx.help}
   문맥: "${ctx.fullContext}"
`).join('\n')}`;

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

    prompt += `

⚠️ 중요 응답 규칙:
1. 위의 모든 ${correctionContexts.length}개 오류에 대해 반드시 분석 결과를 제공해주세요.
2. correctionIndex는 반드시 0부터 ${correctionContexts.length - 1}까지의 순서를 사용하세요.
3. selectedValue는 반드시 제공된 수정안 중 하나 또는 원본 텍스트와 정확히 일치해야 합니다.
4. 형태소 정보를 고려하여 문법적으로 올바른 선택을 하세요.
5. 누락된 오류가 있으면 안 됩니다.`;

    return prompt;
  }
} as const;

// 타입 정의
export type OpenAIModel = typeof OPENAI_MODELS[number];
export type AnthropicModel = typeof ANTHROPIC_MODELS[number];
export type GoogleModel = typeof GOOGLE_MODELS[number];
export type OllamaModel = typeof OLLAMA_MODELS[number];
export type RecommendedModel = typeof RECOMMENDED_MODELS_FOR_KOREAN[number];