import { AISettings, AIAnalysisRequest, AIAnalysisResult, Correction, CorrectionContext } from '../types/interfaces';
import { AIClientFactory } from '../api/clientFactory';
import { AI_PROMPTS, MODEL_TOKEN_LIMITS } from '../constants/aiModels';
import { estimateAnalysisTokenUsage, estimateCost } from '../utils/tokenEstimator';
import { Logger } from '../utils/logger';

export class AIAnalysisService {
  constructor(private settings: AISettings) {}

  /**
   * 각 오류에 대한 컨텍스트를 추출합니다.
   */
  private extractCorrectionContexts(request: AIAnalysisRequest): CorrectionContext[] {
    const { originalText, corrections, contextWindow = 50, currentStates } = request;
    const contexts: CorrectionContext[] = [];

    corrections.forEach((correction, index) => {
      // 원본 텍스트에서 오류 위치 찾기
      const errorIndex = originalText.indexOf(correction.original);
      if (errorIndex === -1) {
        Logger.warn(`오류 텍스트를 찾을 수 없음: "${correction.original}"`);
        // 찾을 수 없는 경우 빈 컨텍스트로 처리
        contexts.push({
          correctionIndex: index,
          original: correction.original,
          corrected: correction.corrected,
          help: correction.help,
          contextBefore: '',
          contextAfter: '',
          fullContext: correction.original,
        });
        return;
      }

      // 앞뒤 컨텍스트 추출
      const startIndex = Math.max(0, errorIndex - contextWindow);
      const endIndex = Math.min(originalText.length, errorIndex + correction.original.length + contextWindow);
      
      const contextBefore = originalText.slice(startIndex, errorIndex);
      const contextAfter = originalText.slice(errorIndex + correction.original.length, endIndex);
      const fullContext = originalText.slice(startIndex, endIndex);

      const stateInfo = currentStates ? currentStates[index] : undefined;

      contexts.push({
        correctionIndex: index,
        original: correction.original,
        corrected: correction.corrected,
        help: correction.help,
        contextBefore: contextBefore.trim(),
        contextAfter: contextAfter.trim(),
        fullContext: fullContext.trim(),
        currentState: stateInfo?.state,
        currentValue: stateInfo?.value,
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
    
    Logger.debug(`배치 크기 계산: 평균 컨텍스트 ${avgContextLength}자 → ${optimalSize}개씩 처리`);
    
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
    Logger.debug(`배치 ${batchIndex + 1}/${totalBatches} 처리 중 (${batch.length}개 오류)`);

    const systemPrompt = AI_PROMPTS.analysisSystem;
    const userPrompt = AI_PROMPTS.analysisUserWithContext(batch);
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await client.chat(messages, adjustedMaxTokens, model);
    Logger.debug(`배치 ${batchIndex + 1} 응답 수신:`, response.substring(0, 100) + '...');

    return this.parseAIResponse(response, batch);
  }

  /**
   * AI를 사용하여 맞춤법 오류를 분석하고 최적의 수정사항을 제안합니다.
   */
  async analyzeCorrections(request: AIAnalysisRequest): Promise<AIAnalysisResult[]> {
    Logger.debug('analyzeCorrections 시작:', {
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
      const allContexts = this.extractCorrectionContexts(request);
      
      // 분석이 필요한 컨텍스트와 이미 처리된 컨텍스트 분리
      const contextsToAnalyze = allContexts.filter(
        ctx => ctx.currentState !== 'original-kept' && ctx.currentState !== 'exception-processed'
      );
      const alreadyResolvedContexts = allContexts.filter(
        ctx => ctx.currentState === 'original-kept' || ctx.currentState === 'exception-processed'
      );

      Logger.debug(`분석 대상: ${contextsToAnalyze.length}개, 이미 처리됨: ${alreadyResolvedContexts.length}개`);

      let aiResults: AIAnalysisResult[] = [];

      if (contextsToAnalyze.length > 0) {
        // 배치 크기 결정
        const maxBatchSize = this.calculateOptimalBatchSize(contextsToAnalyze);
        
        Logger.debug('분석 요청 전송 중...', {
          provider: this.settings.provider,
          model: this.settings.model,
          totalCorrections: contextsToAnalyze.length,
          batchSize: maxBatchSize,
          estimatedBatches: Math.ceil(contextsToAnalyze.length / maxBatchSize),
          contextWindow: request.contextWindow || 50,
          maxTokens: this.settings.maxTokens,
          apiKeySet: !!this.getApiKey()
        });

        // 배치 생성
        const batches = this.createBatches(contextsToAnalyze, maxBatchSize);
        Logger.debug(`${batches.length}개 배치로 분할하여 처리합니다.`);

        // 모델별 토큰 제한에 맞게 조정
        const adjustedMaxTokens = this.adjustTokensForModel(this.settings.maxTokens, this.settings.model);
        
        // 모든 배치 처리
        for (let i = 0; i < batches.length; i++) {
          try {
            if (request.onProgress) {
              const progress = Math.round(((i + 1) / batches.length) * 100);
              request.onProgress(i + 1, batches.length, `AI 분석 중... (${progress}%)`);
            }
            
            const batchResults = await this.processBatch(
              batches[i], 
              i, 
              batches.length, 
              client, 
              adjustedMaxTokens, 
              this.settings.model
            );
            
            aiResults.push(...batchResults);
            
            if (i < batches.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (error) {
            Logger.error(`배치 ${i + 1} 처리 실패:`, error);
          }
        }
        Logger.debug(`AI 분석 완료: ${aiResults.length}개 결과 수집됨`);
      }

      // 이미 처리된 컨텍스트를 결과에 추가
      const resolvedResults: AIAnalysisResult[] = alreadyResolvedContexts.map(ctx => ({
        correctionIndex: ctx.correctionIndex,
        selectedValue: ctx.currentValue || ctx.original,
        isExceptionProcessed: ctx.currentState === 'exception-processed',
        isOriginalKept: ctx.currentState === 'original-kept',
        confidence: 100,
        reasoning: '사용자가 직접 선택한 항목입니다.'
      }));

      // AI 결과와 처리된 결과를 합치고 정렬
      const allResults = [...aiResults, ...resolvedResults];
      allResults.sort((a, b) => a.correctionIndex - b.correctionIndex);
      
      Logger.debug(`최종 처리 완료: ${allResults.length}개 결과 반환`);
      
      return allResults;
    } catch (error) {
      Logger.error('분석 중 오류 발생:', error);
      throw new Error(`AI 분석 실패: ${error.message}`);
    }
  }

  /**
   * AI 응답을 파싱하여 구조화된 결과로 변환합니다.
   */
  private parseAIResponse(response: string, correctionContexts: CorrectionContext[]): AIAnalysisResult[] {
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
        Logger.warn('JSON이 잘린 것으로 보임, 복구 시도');
        // 마지막 완전한 객체까지만 취하고 배열을 닫기
        const lastCompleteObjectIndex = jsonString.lastIndexOf('}');
        if (lastCompleteObjectIndex > 0) {
          jsonString = jsonString.substring(0, lastCompleteObjectIndex + 1) + ']';
          Logger.debug('JSON 복구 완료');
        }
      }
      
      Logger.debug('파싱할 JSON (첫 200자):', jsonString.substring(0, 200) + (jsonString.length > 200 ? '...' : ''));
      parsedResponse = JSON.parse(jsonString);

      const results: AIAnalysisResult[] = [];

      for (const item of parsedResponse) {
        const batchIndex = parseInt(item.correctionIndex);
        
        if (isNaN(batchIndex) || batchIndex < 0 || batchIndex >= correctionContexts.length) {
          Logger.warn('유효하지 않은 batchIndex:', batchIndex);
          continue;
        }

        const context = correctionContexts[batchIndex];
        const originalCorrectionIndex = context.correctionIndex;

        let selectedValue = item.selectedValue || '';
        
        const validOptions = [...context.corrected, context.original];
        if (!validOptions.includes(selectedValue)) {
          if (selectedValue === '원본유지' || selectedValue === '예외처리' || !selectedValue) {
            selectedValue = context.original;
            Logger.debug(`"${item.selectedValue}"를 원본 "${context.original}"로 변경`);
          } else {
            const matchedOption = this.findBestMatch(selectedValue, validOptions);
            if (matchedOption) {
              Logger.debug(`"${selectedValue}"를 가장 유사한 옵션 "${matchedOption}"로 매칭`);
              selectedValue = matchedOption;
            } else {
              Logger.warn('유효하지 않은 선택값:', selectedValue, '가능한 옵션:', validOptions);
              selectedValue = context.original;
            }
          }
        }

        const isOriginalSelected = selectedValue === context.original;
        const isOriginalKept = isOriginalSelected && !item.isExceptionProcessed;

        results.push({
          correctionIndex: originalCorrectionIndex,
          selectedValue,
          isExceptionProcessed: item.isExceptionProcessed || false,
          isOriginalKept: isOriginalKept,
          confidence: Math.max(0, Math.min(100, parseInt(item.confidence) || 0)),
          reasoning: item.reasoning || '이유가 제공되지 않았습니다.'
        });
      }

      Logger.debug(`파싱 완료: ${results.length}개의 결과 추출됨`);
      
      const processedIndexes = new Set(results.map(r => r.correctionIndex));
      const missingContexts = correctionContexts.filter(ctx => !processedIndexes.has(ctx.correctionIndex));
      
      if (missingContexts.length > 0) {
        Logger.warn(`누락된 오류들 (원본 인덱스): ${missingContexts.map(c => c.correctionIndex).join(', ')}`);
        
        missingContexts.forEach(context => {
          const defaultValue = context.corrected[0] || context.original;
          const isDefaultOriginal = defaultValue === context.original;
          
          results.push({
            correctionIndex: context.correctionIndex,
            selectedValue: defaultValue,
            isExceptionProcessed: false,
            isOriginalKept: isDefaultOriginal,
            confidence: 50,
            reasoning: 'AI 분석에서 누락되어 기본값으로 설정됨'
          });
        });
        
        results.sort((a, b) => a.correctionIndex - b.correctionIndex);
      }
      
      return results;
    } catch (error) {
      Logger.error('응답 파싱 오류:', error);
      Logger.error('원본 응답 (첫 500자):', response.substring(0, 500));
      
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
      Logger.error('모델 목록 가져오기 실패:', error);
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
      Logger.warn(`요청된 토큰 수(${requestedTokens})가 모델 제한(${modelLimit})을 초과합니다. ${modelLimit}로 조정합니다.`);
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

  /**
   * AI가 반환한 값과 가장 유사한 유효한 옵션을 찾습니다.
   */
  private findBestMatch(aiValue: string, validOptions: string[]): string | null {
    // 1. 정확히 일치하는 것이 있는지 확인 (이미 체크됨)
    if (validOptions.includes(aiValue)) {
      return aiValue;
    }

    // 2. 공백과 특수문자를 제거한 핵심 텍스트로 비교
    const cleanAiValue = aiValue.replace(/[\s\*\~\-\+\[\]]/g, '');
    
    for (const option of validOptions) {
      const cleanOption = option.replace(/[\s\*\~\-\+\[\]]/g, '');
      
      // 핵심 텍스트가 정확히 일치하는 경우
      if (cleanAiValue === cleanOption) {
        return option;
      }
      
      // AI 값이 옵션에 포함되거나 그 반대인 경우
      if (cleanAiValue.includes(cleanOption) || cleanOption.includes(cleanAiValue)) {
        return option;
      }
    }

    // 3. 편집 거리 기반 유사도 검사 (매우 유사한 경우만)
    let bestMatch = null;
    let bestScore = Infinity;
    
    for (const option of validOptions) {
      const distance = this.levenshteinDistance(aiValue, option);
      const similarity = 1 - distance / Math.max(aiValue.length, option.length);
      
      // 70% 이상 유사한 경우만 고려
      if (similarity >= 0.7 && distance < bestScore) {
        bestMatch = option;
        bestScore = distance;
      }
    }

    return bestMatch;
  }

  /**
   * 두 문자열 간의 편집 거리를 계산합니다.
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];
    const n = str2.length;
    const m = str1.length;

    if (n === 0) return m;
    if (m === 0) return n;

    for (let i = 0; i <= n; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= m; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[n][m];
  }
}