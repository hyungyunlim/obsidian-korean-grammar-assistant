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

// AI 프롬프트 템플릿은 별도 파일로 분리 (성능 최적화)
export { AI_PROMPTS } from './aiPrompts';

// 타입 정의
export type OpenAIModel = typeof OPENAI_MODELS[number];
export type AnthropicModel = typeof ANTHROPIC_MODELS[number];
export type GoogleModel = typeof GOOGLE_MODELS[number];
export type OllamaModel = typeof OLLAMA_MODELS[number];
export type RecommendedModel = typeof RECOMMENDED_MODELS_FOR_KOREAN[number];