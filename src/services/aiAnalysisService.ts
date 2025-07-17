import { AISettings, AIAnalysisRequest, AIAnalysisResult, Correction, CorrectionContext } from '../types/interfaces';
import { AIClientFactory } from '../api/clientFactory';
import { AI_PROMPTS, MODEL_TOKEN_LIMITS } from '../constants/aiModels';
import { estimateAnalysisTokenUsage, estimateCost } from '../utils/tokenEstimator';

export class AIAnalysisService {
  constructor(private settings: AISettings) {}

  /**
   * 각 오류에 대한 컨텍스트를 추출합니다.
   */
  private extractCorrectionContexts(request: AIAnalysisRequest): CorrectionContext[] {
    const { originalText, corrections, contextWindow = 50 } = request;
    const contexts: CorrectionContext[] = [];

    corrections.forEach((correction, index) => {
      // 원본 텍스트에서 오류 위치 찾기
      const errorIndex = originalText.indexOf(correction.original);
      if (errorIndex === -1) {
        console.warn(`[AI] 오류 텍스트를 찾을 수 없음: "${correction.original}"`);
        // 찾을 수 없는 경우 빈 컨텍스트로 처리
        contexts.push({
          correctionIndex: index,
          original: correction.original,
          corrected: correction.corrected,
          help: correction.help,
          contextBefore: '',
          contextAfter: '',
          fullContext: correction.original
        });
        return;
      }

      // 앞뒤 컨텍스트 추출
      const startIndex = Math.max(0, errorIndex - contextWindow);
      const endIndex = Math.min(originalText.length, errorIndex + correction.original.length + contextWindow);
      
      const contextBefore = originalText.slice(startIndex, errorIndex);
      const contextAfter = originalText.slice(errorIndex + correction.original.length, endIndex);
      const fullContext = originalText.slice(startIndex, endIndex);

      contexts.push({
        correctionIndex: index,
        original: correction.original,
        corrected: correction.corrected,
        help: correction.help,
        contextBefore: contextBefore.trim(),
        contextAfter: contextAfter.trim(),
        fullContext: fullContext.trim()
      });
    });

    return contexts;
  }

  /**
   * AI 분석에 필요한 토큰 사용량을 추정합니다.
   */
  estimateTokenUsage(request: AIAnalysisRequest): {
    inputTokens: number;
    estimatedOutputTokens: number;
    totalEstimated: number;
    estimatedCost: string;
  } {
    const correctionContexts = this.extractCorrectionContexts(request);
    const tokenUsage = estimateAnalysisTokenUsage(correctionContexts);
    const cost = estimateCost(tokenUsage.totalEstimated, this.settings.provider);
    
    return {
      ...tokenUsage,
      estimatedCost: cost
    };
  }

  /**
   * 최적의 배치 크기를 계산합니다.
   */
  private calculateOptimalBatchSize(correctionContexts: CorrectionContext[]): number {
    if (correctionContexts.length === 0) return 10;
    
    // 평균 컨텍스트 길이 계산
    const avgContextLength = correctionContexts.reduce((sum, ctx) => sum + ctx.fullContext.length, 0) / correctionContexts.length;
    const systemPromptLength = AI_PROMPTS.analysisSystem.length;
    
    // 모델별 입력 토큰 제한 (대략적으로 계산)
    const maxInputTokens = this.getModelMaxInputTokens(this.settings.model);
    
    // 안전 마진을 고려한 배치 크기 계산
    let optimalSize = 10; // 기본값
    
    if (avgContextLength < 100) {
      optimalSize = 15; // 짧은 컨텍스트면 더 많이
    } else if (avgContextLength < 200) {
      optimalSize = 10; // 보통
    } else if (avgContextLength < 400) {
      optimalSize = 7; // 긴 컨텍스트면 적게
    } else {
      optimalSize = 5; // 매우 긴 컨텍스트
    }
    
    console.log(`[AI] 배치 크기 계산: 평균 컨텍스트 ${avgContextLength}자 → ${optimalSize}개씩 처리`);
    
    return Math.min(optimalSize, 15); // 최대 15개로 제한
  }

  /**
   * 모델별 최대 입력 토큰을 가져옵니다 (대략적).
   */
  private getModelMaxInputTokens(model: string): number {
    // 대부분의 모델은 입력 토큰이 출력 토큰보다 훨씬 많음
    const outputLimit = this.getModelMaxTokens(model);
    return outputLimit * 10; // 보수적으로 계산
  }

  /**
   * 오류들을 배치로 나누어 처리합니다.
   */
  private createBatches(correctionContexts: CorrectionContext[], maxBatchSize: number = 10): CorrectionContext[][] {
    const batches: CorrectionContext[][] = [];
    for (let i = 0; i < correctionContexts.length; i += maxBatchSize) {
      batches.push(correctionContexts.slice(i, i + maxBatchSize));
    }
    return batches;
  }

  /**
   * 단일 배치를 처리합니다.
   */
  private async processBatch(
    batch: CorrectionContext[], 
    batchIndex: number, 
    totalBatches: number,
    client: any,
    adjustedMaxTokens: number,
    model: string
  ): Promise<AIAnalysisResult[]> {
    console.log(`[AI] 배치 ${batchIndex + 1}/${totalBatches} 처리 중 (${batch.length}개 오류)`);

    const systemPrompt = AI_PROMPTS.analysisSystem;
    const userPrompt = AI_PROMPTS.analysisUserWithContext(batch);
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await client.chat(messages, adjustedMaxTokens, model);
    console.log(`[AI] 배치 ${batchIndex + 1} 응답 수신:`, response.substring(0, 100) + '...');

    // 배치용 corrections 생성 (원본 corrections에서 해당 batch의 corrections만 추출)
    const batchCorrections = batch.map(ctx => ({
      original: ctx.original,
      corrected: ctx.corrected,
      help: ctx.help
    }));

    return this.parseAIResponse(response, batchCorrections);
  }

  /**
   * AI를 사용하여 맞춤법 오류를 분석하고 최적의 수정사항을 제안합니다.
   */
  async analyzeCorrections(request: AIAnalysisRequest): Promise<AIAnalysisResult[]> {
    console.log('[AI] analyzeCorrections 시작:', {
      enabled: this.settings.enabled,
      provider: this.settings.provider,
      model: this.settings.model,
      correctionsCount: request.corrections.length
    });

    if (!this.settings.enabled) {
      throw new Error('AI 기능이 비활성화되어 있습니다.');
    }

    if (!AIClientFactory.hasValidApiKey(this.settings)) {
      const provider = this.settings.provider;
      const keyName = provider === 'openai' ? 'OpenAI API 키' :
                     provider === 'anthropic' ? 'Anthropic API 키' :
                     provider === 'google' ? 'Google API 키' :
                     provider === 'ollama' ? 'Ollama 엔드포인트' : 'API 키';
      throw new Error(`${keyName}가 설정되지 않았습니다. 플러그인 설정에서 ${provider} 제공자의 ${keyName}를 입력해주세요.`);
    }

    // 모델명 유효성 검사
    if (!this.settings.model || this.settings.model.trim() === '') {
      throw new Error(`모델이 설정되지 않았습니다. 플러그인 설정에서 ${this.settings.provider} 모델을 선택해주세요.`);
    }

    const client = AIClientFactory.createClient(this.settings);
    
    try {
      // 컨텍스트 추출
      const correctionContexts = this.extractCorrectionContexts(request);
      
      // 배치 크기 결정 (토큰 제한 및 프롬프트 길이 기반)
      const maxBatchSize = this.calculateOptimalBatchSize(correctionContexts);
      
      console.log('[AI] 분석 요청 전송 중...', {
        provider: this.settings.provider,
        model: this.settings.model,
        totalCorrections: request.corrections.length,
        batchSize: maxBatchSize,
        estimatedBatches: Math.ceil(correctionContexts.length / maxBatchSize),
        contextWindow: request.contextWindow || 50,
        maxTokens: this.settings.maxTokens,
        apiKeySet: !!this.getApiKey()
      });

      // 배치 생성
      const batches = this.createBatches(correctionContexts, maxBatchSize);
      console.log(`[AI] ${batches.length}개 배치로 분할하여 처리합니다.`);

      // 모델별 토큰 제한에 맞게 조정
      const adjustedMaxTokens = this.adjustTokensForModel(this.settings.maxTokens, this.settings.model);
      
      // 모든 배치 병렬 또는 순차 처리
      const allResults: AIAnalysisResult[] = [];
      
      for (let i = 0; i < batches.length; i++) {
        try {
          // 진행 상황 콜백 호출
          if (request.onProgress) {
            request.onProgress(i + 1, batches.length, `배치 ${i + 1}/${batches.length} 처리 중...`);
          }
          
          const batchResults = await this.processBatch(
            batches[i], 
            i, 
            batches.length, 
            client, 
            adjustedMaxTokens, 
            this.settings.model
          );
          
          // correctionIndex를 전체 범위로 조정
          const adjustedResults = batchResults.map(result => ({
            ...result,
            correctionIndex: result.correctionIndex + (i * maxBatchSize)
          }));
          
          allResults.push(...adjustedResults);
          
          // 배치 간 잠시 대기 (API 제한 고려)
          if (i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`[AI] 배치 ${i + 1} 처리 실패:`, error);
          // 이 배치는 건너뛰고 다음 배치 처리 계속
        }
      }
      
      console.log(`[AI] 배치 처리 완료: ${allResults.length}개 결과 수집됨`);
      
      return allResults;
    } catch (error) {
      console.error('[AI] 분석 중 오류 발생:', error);
      throw new Error(`AI 분석 실패: ${error.message}`);
    }
  }

  /**
   * AI 응답을 파싱하여 구조화된 결과로 변환합니다.
   */
  private parseAIResponse(response: string, corrections: Correction[]): AIAnalysisResult[] {
    try {
      // JSON 응답 파싱 시도
      let parsedResponse: any[];
      
      // 1. 먼저 마크다운 코드 블록 제거
      let cleanedResponse = response.trim();
      
      // ```json ... ``` 패턴 제거
      const codeBlockMatch = cleanedResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        cleanedResponse = codeBlockMatch[1].trim();
      }
      
      // 2. JSON 배열 패턴 찾기 (더 관대한 매칭)
      let jsonString = '';
      const jsonArrayMatch = cleanedResponse.match(/\[[\s\S]*\]/);
      if (jsonArrayMatch) {
        jsonString = jsonArrayMatch[0];
      } else {
        jsonString = cleanedResponse;
      }
      
      // 3. 잘린 JSON 복구 시도
      if (!jsonString.endsWith(']') && jsonString.includes('[')) {
        console.warn('[AI] JSON이 잘린 것으로 보임, 복구 시도');
        // 마지막 완전한 객체까지만 취하고 배열을 닫기
        const lastCompleteObjectIndex = jsonString.lastIndexOf('}');
        if (lastCompleteObjectIndex > 0) {
          jsonString = jsonString.substring(0, lastCompleteObjectIndex + 1) + ']';
          console.log('[AI] JSON 복구 완료');
        }
      }
      
      console.log('[AI] 파싱할 JSON (첫 200자):', jsonString.substring(0, 200) + (jsonString.length > 200 ? '...' : ''));
      parsedResponse = JSON.parse(jsonString);

      const results: AIAnalysisResult[] = [];

      for (const item of parsedResponse) {
        const correctionIndex = parseInt(item.correctionIndex);
        
        // 유효성 검사
        if (isNaN(correctionIndex) || correctionIndex < 0 || correctionIndex >= corrections.length) {
          console.warn('[AI] 유효하지 않은 correctionIndex:', correctionIndex);
          continue;
        }

        const correction = corrections[correctionIndex];
        let selectedValue = item.selectedValue || '';
        
        // AI가 "원본유지", "예외처리" 같은 명령어를 보낸 경우 원본으로 변경
        const validOptions = [...correction.corrected, correction.original];
        if (!validOptions.includes(selectedValue)) {
          if (selectedValue === '원본유지' || selectedValue === '예외처리' || !selectedValue) {
            selectedValue = correction.original;
            console.log(`[AI] "${item.selectedValue}"를 원본 "${correction.original}"로 변경`);
          } else {
            console.warn('[AI] 유효하지 않은 선택값:', selectedValue, '가능한 옵션:', validOptions);
            // 유효하지 않은 값이면 원본으로 폴백
            selectedValue = correction.original;
          }
        }

        // AI가 원본을 선택했을 때는 원본유지 상태로 설정 (검토해서 그대로 두기로 함)
        const isOriginalSelected = selectedValue === correction.original;
        const isOriginalKept = isOriginalSelected && !item.isExceptionProcessed;

        results.push({
          correctionIndex,
          selectedValue,
          isExceptionProcessed: item.isExceptionProcessed || false,
          isOriginalKept: isOriginalKept,
          confidence: Math.max(0, Math.min(100, parseInt(item.confidence) || 0)),
          reasoning: item.reasoning || '이유가 제공되지 않았습니다.'
        });
      }

      console.log(`[AI] 파싱 완료: ${results.length}개의 결과 추출됨`);
      
      // 누락된 오류 확인
      const processedIndexes = new Set(results.map(r => r.correctionIndex));
      const missingIndexes = corrections.map((_, index) => index).filter(index => !processedIndexes.has(index));
      
      if (missingIndexes.length > 0) {
        console.warn(`[AI] 누락된 오류들 (인덱스): ${missingIndexes.join(', ')}`);
        console.warn(`[AI] 전체 오류 수: ${corrections.length}, 처리된 오류 수: ${results.length}`);
        
        // 누락된 오류들에 대해 기본값 추가
        missingIndexes.forEach(index => {
          const correction = corrections[index];
          if (correction) {
            const defaultValue = correction.corrected[0] || correction.original;
            const isDefaultOriginal = defaultValue === correction.original;
            
            results.push({
              correctionIndex: index,
              selectedValue: defaultValue,
              isExceptionProcessed: false,
              isOriginalKept: isDefaultOriginal, // 원본이 기본값이면 원본유지 상태
              confidence: 50, // 낮은 신뢰도로 표시
              reasoning: 'AI 분석에서 누락되어 기본값으로 설정됨'
            });
          }
        });
        
        // 인덱스 순으로 정렬
        results.sort((a, b) => a.correctionIndex - b.correctionIndex);
      }
      
      return results;
    } catch (error) {
      console.error('[AI] 응답 파싱 오류:', error);
      console.error('[AI] 원본 응답 (첫 500자):', response.substring(0, 500));
      
      // 더 구체적인 오류 메시지 제공
      if (error instanceof SyntaxError) {
        throw new Error(`JSON 형식 오류: ${error.message}. AI 응답이 올바른 JSON 형식이 아닙니다.`);
      } else {
        throw new Error(`AI 응답 파싱 실패: ${error.message}`);
      }
    }
  }

  /**
   * 사용 가능한 모델 목록을 가져옵니다.
   */
  async fetchAvailableModels(): Promise<string[]> {
    try {
      return await AIClientFactory.fetchModels(this.settings);
    } catch (error) {
      console.error('[AI] 모델 목록 가져오기 실패:', error);
      return [];
    }
  }

  /**
   * AI 설정을 업데이트합니다.
   */
  updateSettings(newSettings: AISettings): void {
    this.settings = newSettings;
  }

  /**
   * AI 서비스가 사용 가능한지 확인합니다.
   */
  isAvailable(): boolean {
    return this.settings.enabled && AIClientFactory.hasValidApiKey(this.settings);
  }

  /**
   * 현재 설정된 제공자 및 모델 정보를 반환합니다.
   */
  getProviderInfo(): { provider: string; model: string; available: boolean } {
    return {
      provider: this.settings.provider,
      model: this.settings.model,
      available: this.isAvailable()
    };
  }

  /**
   * 현재 AI 설정을 반환합니다.
   */
  getSettings(): AISettings {
    return this.settings;
  }

  /**
   * 모델별 최대 출력 토큰을 가져옵니다.
   */
  private getModelMaxTokens(model: string): number {
    return MODEL_TOKEN_LIMITS[model as keyof typeof MODEL_TOKEN_LIMITS] || 2048; // 기본값
  }

  /**
   * 요청할 토큰 수를 모델 제한에 맞게 조정합니다.
   */
  private adjustTokensForModel(requestedTokens: number, model: string): number {
    const modelLimit = this.getModelMaxTokens(model);
    if (requestedTokens > modelLimit) {
      console.warn(`[AI] 요청된 토큰 수(${requestedTokens})가 모델 제한(${modelLimit})을 초과합니다. ${modelLimit}로 조정합니다.`);
      return modelLimit;
    }
    return requestedTokens;
  }

  /**
   * 현재 제공자의 API 키를 반환합니다.
   */
  private getApiKey(): string {
    switch (this.settings.provider) {
      case 'openai':
        return this.settings.openaiApiKey;
      case 'anthropic':
        return this.settings.anthropicApiKey;
      case 'google':
        return this.settings.googleApiKey;
      case 'ollama':
        return this.settings.ollamaEndpoint;
      default:
        return '';
    }
  }
}