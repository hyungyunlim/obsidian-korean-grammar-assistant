/**
 * AI 토큰 사용량 추정 유틸리티
 */

import { CorrectionContext } from '../types/interfaces';

/**
 * 텍스트의 대략적인 토큰 수를 추정합니다.
 * 한국어와 영어를 고려한 추정 공식 사용
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  
  // 한국어 문자는 일반적으로 1.5-2 토큰, 영어는 4글자당 1토큰 정도
  const koreanChars = (text.match(/[\u3131-\u3163\uac00-\ud7a3]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  const otherChars = text.length - koreanChars - englishChars;
  
  // 추정 공식 (보수적으로 계산)
  const estimatedTokens = Math.ceil(
    koreanChars * 1.8 +        // 한국어 문자
    englishChars * 0.25 +      // 영어 문자 (4글자당 1토큰)
    otherChars * 0.5           // 기타 문자 (공백, 구두점 등)
  );
  
  return estimatedTokens;
}

/**
 * AI 분석 요청의 예상 토큰 사용량을 계산합니다.
 */
export function estimateAnalysisTokenUsage(correctionContexts: CorrectionContext[]): {
  inputTokens: number;
  estimatedOutputTokens: number;
  totalEstimated: number;
} {
  // 시스템 프롬프트 토큰 (고정)
  const systemPromptTokens = 150;
  
  // 사용자 프롬프트 토큰 계산
  let userPromptTokens = 50; // 기본 텍스트
  userPromptTokens += correctionContexts.length * 20; // 오류당 기본 구조
  
  correctionContexts.forEach(ctx => {
    userPromptTokens += estimateTokenCount(ctx.fullContext);
    userPromptTokens += estimateTokenCount(ctx.original);
    userPromptTokens += estimateTokenCount(ctx.corrected.join(', '));
    userPromptTokens += estimateTokenCount(ctx.help);
  });
  
  const inputTokens = systemPromptTokens + userPromptTokens;
  
  // 출력 토큰 추정 (오류당 약 50-100 토큰)
  const estimatedOutputTokens = correctionContexts.length * 75;
  
  return {
    inputTokens,
    estimatedOutputTokens,
    totalEstimated: inputTokens + estimatedOutputTokens
  };
}

/**
 * 토큰 사용량에 따른 대략적인 비용을 추정합니다 (USD 및 KRW).
 */
export function estimateCost(tokens: number, provider: string): string {
  const costs = {
    openai: {
      'gpt-4o': { input: 2.5, output: 10.0 }, // per 1M tokens (USD)
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'gpt-4-turbo': { input: 10.0, output: 30.0 },
      'gpt-4': { input: 30.0, output: 60.0 }
    },
    anthropic: {
      'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
      'claude-3-5-haiku-20241022': { input: 0.25, output: 1.25 }
    },
    google: {
      'gemini-1.5-pro': { input: 1.25, output: 5.0 },
      'gemini-1.5-flash': { input: 0.075, output: 0.3 }
    }
  };
  
  // 간단한 평균 비용 반환
  const avgCostPer1M = 2.0; // USD per 1M tokens (average)
  const estimatedCostUSD = (tokens / 1000000) * avgCostPer1M;
  
  // USD-KRW 환율 (대략 1350원)
  const exchangeRate = 1350;
  const estimatedCostKRW = estimatedCostUSD * exchangeRate;
  
  if (estimatedCostUSD < 0.001) {
    return '< $0.001 (< ₩1)';
  } else if (estimatedCostUSD < 0.01) {
    return `~$${estimatedCostUSD.toFixed(4)} (~₩${estimatedCostKRW.toFixed(0)})`;
  } else {
    return `~$${estimatedCostUSD.toFixed(3)} (~₩${estimatedCostKRW.toFixed(0)})`;
  }
}