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

// 기본 AI 설정 값
export const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: 'openai' as AIProvider,
  openaiApiKey: '',
  anthropicApiKey: '',
  googleApiKey: '',
  ollamaEndpoint: 'http://localhost:11434',
  model: 'gpt-4o-mini',
  maxTokens: 1000,
  temperature: 0.1 // 낮은 값으로 설정하여 일관된 결과 도출
} as const;

// AI 프롬프트 템플릿
export const AI_PROMPTS = {
  analysisSystem: `당신은 한국어 맞춤법 검사 전문가입니다. 주어진 텍스트와 맞춤법 오류들을 분석하여 가장 적절한 수정사항을 선택해주세요.

다음 규칙을 따라주세요:
1. 문맥에 가장 적합한 수정안을 선택하세요
2. 고유명사, URL, 이메일, 전문용어는 예외처리를 고려하세요
3. 애매한 경우 원문을 유지하는 것을 고려하세요
4. 각 선택에 대한 신뢰도(0-100)와 간단한 이유를 제공하세요

⚠️ 중요: 
- 오직 JSON 배열만 응답하세요. 다른 텍스트나 설명은 포함하지 마세요.
- 마크다운 코드 블록을 사용하지 마세요.
- 응답이 잘리지 않도록 주의하세요.

응답 형식 (이 JSON 배열만 응답):
[
  {
    "correctionIndex": 0,
    "selectedValue": "선택된 값",
    "isExceptionProcessed": false,
    "confidence": 85,
    "reasoning": "간단한 이유"
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
    `발견된 맞춤법 오류들과 주변 문맥:

${correctionContexts.map((ctx) => 
  `${ctx.correctionIndex}. 오류: "${ctx.original}"
   문맥: "${ctx.fullContext}"
   수정안: [${ctx.corrected.join(', ')}]
   설명: ${ctx.help}
   
`).join('')}위 오류들에 대해 각각의 문맥을 고려하여 가장 적절한 선택을 해주세요.`
} as const;

// 타입 정의
export type OpenAIModel = typeof OPENAI_MODELS[number];
export type AnthropicModel = typeof ANTHROPIC_MODELS[number];
export type GoogleModel = typeof GOOGLE_MODELS[number];
export type OllamaModel = typeof OLLAMA_MODELS[number];
export type RecommendedModel = typeof RECOMMENDED_MODELS_FOR_KOREAN[number];