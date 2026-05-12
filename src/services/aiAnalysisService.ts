import { AISettings, AIAnalysisRequest, AIAnalysisResult, Correction, CorrectionContext, MorphemeInfo, MorphemeSentence, MorphemeToken } from '../types/interfaces';
import { Editor } from 'obsidian';
import { AI_PROMPTS, MODEL_TOKEN_LIMITS } from '../constants/aiModels';
import { estimateAnalysisTokenUsage, estimateCost } from '../utils/tokenEstimator';
import { Logger } from '../utils/logger';

export class AIAnalysisService {
  constructor(private settings: AISettings) {}

  /**
   * AI 클라이언트 팩토리를 지연 로딩합니다 (성능 최적화)
   * @private
   */
  private async getClientFactory() {
    const { AIClientFactory } = await import('../api/clientFactory');
    return AIClientFactory;
  }

  /**
   * API 키 유효성을 확인합니다 (lazy loading 팩토리 사용)
   * @private
   */
  private async hasValidApiKey(settings: AISettings): Promise<boolean> {
    const ClientFactory = await this.getClientFactory();
    return ClientFactory.hasValidApiKey(settings);
  }

  /**
   * 각 오류에 대한 컨텍스트를 추출합니다.
   */
  private extractCorrectionContexts(request: AIAnalysisRequest, morphemeInfo?: MorphemeInfo): CorrectionContext[] {
    const { originalText, corrections, contextWindow = 50, currentStates, editor, file, enhancedContext = true } = request;
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

      // 기본 앞뒤 컨텍스트 추출
      const startIndex = Math.max(0, errorIndex - contextWindow);
      const endIndex = Math.min(originalText.length, errorIndex + correction.original.length + contextWindow);
      
      const contextBefore = originalText.slice(startIndex, errorIndex);
      const contextAfter = originalText.slice(errorIndex + correction.original.length, endIndex);
      const fullContext = originalText.slice(startIndex, endIndex);

      const stateInfo = currentStates ? currentStates[index] : undefined;

      // 기본 컨텍스트 정보
      const context: CorrectionContext = {
        correctionIndex: index,
        original: correction.original,
        corrected: correction.corrected,
        help: correction.help,
        contextBefore: contextBefore.trim(),
        contextAfter: contextAfter.trim(),
        fullContext: fullContext.trim(),
        currentState: stateInfo?.state,
        currentValue: stateInfo?.value,
      };

      // 향상된 컨텍스트 추출 (Editor API 활용)
      if (enhancedContext && editor) {
        try {
          const enhancedInfo = this.extractEnhancedContext(
            editor, 
            file, 
            originalText, 
            correction, 
            errorIndex,
            morphemeInfo
          );
          
          // 고유명사 등 특별한 경우에만 확장된 컨텍스트 추가
          if (enhancedInfo.isLikelyProperNoun) {
            context.sentenceContext = enhancedInfo.sentenceContext;
            context.isLikelyProperNoun = true;
            context.documentType = enhancedInfo.documentType;
            
            Logger.debug(`🔍 고유명사 감지: "${correction.original}" - 감지 방법: ${enhancedInfo.detectionMethod} - 문장 컨텍스트 추가`);
          }
        } catch (error) {
          Logger.warn('향상된 컨텍스트 추출 실패:', error);
        }
      }

      contexts.push(context);
    });

    return contexts;
  }

  /**
   * 형태소 분석 결과 전체를 로깅합니다.
   */
  private logMorphemeAnalysis(morphemeInfo: MorphemeInfo, corrections: Correction[]): void {
    Logger.debug('📋 형태소 분석 결과 요약:');

    if (!morphemeInfo || !morphemeInfo.sentences) {
      Logger.warn('형태소 분석 데이터가 유효하지 않음');
      return;
    }

    // 전체 토큰 수와 문장 수
    const totalSentences = morphemeInfo.sentences.length;
    const totalTokens = morphemeInfo.sentences.reduce((sum: number, sentence: MorphemeSentence) =>
      sum + (sentence.tokens ? sentence.tokens.length : 0), 0);
    
    Logger.debug(`  총 ${totalSentences}개 문장, ${totalTokens}개 토큰 분석됨`);

    // 고유명사 및 특수 품사 추출
    const properNouns: string[] = [];
    const foreignWords: string[] = [];
    const allTokens: {text: string, tags: string[]}[] = [];

    morphemeInfo.sentences.forEach((sentence: MorphemeSentence, sentenceIdx: number) => {
      if (!sentence.tokens) return;

      sentence.tokens.forEach((token: MorphemeToken) => {
        const tokenText = token.text?.content || '';
        const tags = token.morphemes?.map(m => m.tag) || [];
        
        allTokens.push({text: tokenText, tags});
        
        // 고유명사 분류
        if (tags.some((tag: string) => ['NNP'].includes(tag))) {
          if (!properNouns.includes(tokenText)) {
            properNouns.push(tokenText);
          }
        }
        
        // 외국어/특수어 분류
        if (tags.some((tag: string) => ['SL', 'SH', 'SN'].includes(tag))) {
          if (!foreignWords.includes(tokenText)) {
            foreignWords.push(tokenText);
          }
        }
      });
    });

    // 결과 로깅
    if (properNouns.length > 0) {
      Logger.debug(`  🏷️  고유명사 (NNP): [${properNouns.map(noun => `"${noun}"`).join(', ')}]`);
    }
    
    if (foreignWords.length > 0) {
      Logger.debug(`  🌐 외국어/특수어 (SL/SH/SN): [${foreignWords.map(word => `"${word}"`).join(', ')}]`);
    }

    // 오류 단어들과 매칭
    const errorWords = corrections.map(c => c.original);
    const matchedErrors = errorWords.filter(word => 
      properNouns.includes(word) || foreignWords.includes(word)
    );
    
    if (matchedErrors.length > 0) {
      Logger.debug(`  ✨ 맞춤법 오류 중 형태소 분석으로 감지된 고유명사/외국어: [${matchedErrors.map(word => `"${word}"`).join(', ')}]`);
    } else {
      Logger.debug('  ❓ 맞춤법 오류 중 형태소 분석으로 고유명사/외국어로 분류된 단어 없음');
    }

    // 상세 토큰 정보 (처음 10개만)
    Logger.debug('상세 토큰 정보 (처음 10개):');
    allTokens.slice(0, 10).forEach((token, idx) => {
      Logger.debug(`  ${idx + 1}. "${token.text}" → [${token.tags.join(', ')}]`);
    });
    
    if (allTokens.length > 10) {
      Logger.debug(`  ... 및 ${allTokens.length - 10}개 토큰 더 있음`);
    }
  }

  /**
   * 형태소 분석 결과에서 고유명사를 감지합니다.
   */
  private isProperNounFromMorphemes(text: string, morphemeInfo: MorphemeInfo): boolean {
    if (!morphemeInfo || !morphemeInfo.sentences) return false;

    for (const sentence of morphemeInfo.sentences) {
      if (!sentence.tokens) continue;
      for (const token of sentence.tokens) {
        if (!token.text || !token.morphemes) continue;
        if (token.text.content === text) {
          // 품사 태그에서 고유명사 확인
          for (const morpheme of token.morphemes) {
            const tag = morpheme.tag;
            // 한국어 품사 태그: NNP(고유명사), SL(외국어), SH(한자) 등
            if (['NNP', 'SL', 'SH', 'SN'].includes(tag)) {
              const tagDescriptions: {[key: string]: string} = {
                'NNP': '고유명사',
                'SL': '외국어',
                'SH': '한자',
                'SN': '숫자'
              };
              const tagDescription = tagDescriptions[tag] || tag;
              Logger.debug(`🏷️ 형태소 고유명사 감지: "${text}" - 품사: ${tag}(${tagDescription})`);
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * Obsidian Editor를 활용한 향상된 컨텍스트 추출
   */
  private extractEnhancedContext(editor: Editor, file: unknown, originalText: string, correction: Correction, errorIndex: number, morphemeInfo?: MorphemeInfo): {
    sentenceContext?: string;
    isLikelyProperNoun: boolean;
    documentType?: string;
    detectionMethod?: string;
  } {
    // 오프셋을 에디터 위치로 변환
    const errorPosition = editor.offsetToPos(errorIndex);
    
    // 현재 문장 추출
    const sentenceContext = this.extractCurrentSentence(editor, errorPosition);
    
    // 문서 타입 감지 (마크다운, 일반 텍스트 등)
    const documentType = (typeof file === 'object' && file !== null && 'extension' in file)
      ? (file as { extension: string }).extension
      : 'unknown';
    
    // 형태소 분석 우선, 없으면 패턴 기반으로 고유명사 감지
    let isLikelyProperNoun = false;
    let detectionMethod = '';
    
    if (morphemeInfo) {
      const morphemeDetected = this.isProperNounFromMorphemes(correction.original, morphemeInfo);
      const patternDetected = this.detectProperNounPatterns(correction.original, sentenceContext);
      
      if (morphemeDetected) {
        isLikelyProperNoun = true;
        detectionMethod = '형태소 분석';
      } else if (patternDetected) {
        isLikelyProperNoun = true;
        detectionMethod = '패턴 매칭';
      }
    } else {
      const patternDetected = this.detectProperNounPatterns(correction.original, sentenceContext);
      if (patternDetected) {
        isLikelyProperNoun = true;
        detectionMethod = '패턴 매칭 (형태소 분석 없음)';
      }
    }

    return {
      sentenceContext,
      isLikelyProperNoun,
      documentType,
      detectionMethod
    };
  }

  /**
   * 현재 문장을 추출합니다.
   */
  private extractCurrentSentence(editor: Editor, position: { line: number; ch: number }): string {
    const currentLine = editor.getLine(position.line);
    
    // 한국어 문장 끝 패턴
    const sentenceEndPattern = /[.!?。！？]/g;
    
    // 문장 시작점 찾기
    let sentenceStart = 0;
    for (let i = position.ch - 1; i >= 0; i--) {
      if (sentenceEndPattern.test(currentLine[i])) {
        sentenceStart = i + 1;
        break;
      }
    }
    
    // 문장 끝점 찾기
    let sentenceEnd = currentLine.length;
    for (let i = position.ch; i < currentLine.length; i++) {
      if (sentenceEndPattern.test(currentLine[i])) {
        sentenceEnd = i + 1;
        break;
      }
    }
    
    return currentLine.slice(sentenceStart, sentenceEnd).trim();
  }

  /**
   * 패턴 기반 고유명사 감지 (형태소 분석이 없을 때 폴백)
   */
  private detectProperNounPatterns(text: string, sentenceContext: string): boolean {
    const patterns = [
      { pattern: /^[A-Z][a-z]+/, name: '영어 고유명사' },           // GitHub, React 등
      { pattern: /^[A-Z]{2,}$/, name: '영어 약어' },            // API, URL, HTTP
      { pattern: /\w+님$/, name: '존칭' },                 // 김철수님
      { pattern: /^[가-힣]{2,4}[시도군구]$/, name: '지명' }, // 서울시, 부산광역시
      { pattern: /\d{4}년/, name: '연도' },                // 2018년
      { pattern: /^[가-힣]+\.(js|ts|py|css|html|md)$/, name: '파일명' },  // 파일명
    ];
    
    for (const { pattern, name } of patterns) {
      if (pattern.test(text)) {
        Logger.debug(`🔍 패턴 고유명사 감지: "${text}" - 패턴: ${name}`);
        return true;
      }
    }
    
    return false;
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
   * ⭐ JSON 잘림 방지를 위해 보수적 배치 크기 적용
   */
  private calculateOptimalBatchSize(correctionContexts: CorrectionContext[], hasMorphemeInfo = false): number {
    if (correctionContexts.length === 0) return 5;
    
    // 평균 컨텍스트 길이 계산
    const avgContextLength = correctionContexts.reduce((sum, ctx) => sum + ctx.fullContext.length, 0) / correctionContexts.length;


    // 🔧 JSON 응답 잘림 방지를 위해 보수적으로 계산
    // 각 교정당 JSON 응답: ~120자 예상 
    // 15개 = 1800자 → 토큰 제한 초과 위험
    let optimalSize = 6; // 안전한 기본값
    
    if (avgContextLength < 50) {
      optimalSize = 8; // 매우 짧은 컨텍스트
    } else if (avgContextLength < 100) {
      optimalSize = 6; // 짧은 컨텍스트  
    } else if (avgContextLength < 200) {
      optimalSize = 4; // 보통 컨텍스트
    } else {
      optimalSize = 3; // 긴 컨텍스트
    }
    
    // 형태소 정보가 있으면 약간 더 보수적으로
    if (hasMorphemeInfo) {
      optimalSize = Math.max(3, optimalSize - 1);
    }
    
    Logger.debug(`JSON 잘림 방지 배치 크기: 평균 컨텍스트 ${avgContextLength}자, 형태소: ${hasMorphemeInfo} → ${optimalSize}개씩 처리`);
    
    return Math.min(optimalSize, 8); // 최대 8개로 안전하게 제한
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
    client: { chat: (messages: Array<{ role: string; content: string }>, maxTokens: number, model: string) => Promise<string> },
    adjustedMaxTokens: number,
    model: string,
    morphemeInfo?: MorphemeInfo  // ⭐ NEW: 형태소 정보 추가
  ): Promise<AIAnalysisResult[]> {
    Logger.debug(`배치 ${batchIndex + 1}/${totalBatches} 처리 중 (${batch.length}개 오류)`);

    const systemPrompt = AI_PROMPTS.analysisSystem;
    
    // ⭐ NEW: 형태소 정보가 있으면 새로운 프롬프트 사용
    const userPrompt = morphemeInfo 
      ? AI_PROMPTS.analysisUserWithMorphemes(batch, morphemeInfo)
      : AI_PROMPTS.analysisUserWithContext(batch);
    
    // ⭐ NEW: 형태소 정보 로깅
    if (morphemeInfo) {
      Logger.debug(`형태소 정보와 함께 AI 분석 진행 (토큰 절약 모드)`);
      const totalTokens = morphemeInfo.sentences.reduce((sum, s) => sum + (s.tokens?.length || 0), 0);
      Logger.debug(`형태소 토큰 수: ${totalTokens}개`);
    }
    
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
   * ⭐ NEW: 형태소 정보 통합 지원
   */
  async analyzeCorrections(request: AIAnalysisRequest, morphemeInfo?: MorphemeInfo): Promise<AIAnalysisResult[]> {
    Logger.debug('analyzeCorrections 시작:', {
      enabled: this.settings.enabled,
      provider: this.settings.provider,
      model: this.settings.model,
      correctionsCount: request.corrections.length
    });

    // 🔍 형태소 분석 결과 전체 로깅
    if (morphemeInfo) {
      this.logMorphemeAnalysis(morphemeInfo, request.corrections);
    }

    if (!this.settings.enabled) {
      throw new Error('AI 기능이 비활성화되어 있습니다.');
    }

    if (!(await this.hasValidApiKey(this.settings))) {
      const provider = this.settings.provider;
      const keyName = provider === 'openai' ? 'OpenAI API 키' :
                     provider === 'anthropic' ? 'Anthropic API 키' :
                     provider === 'google' ? 'Google API 키' :
                     provider === 'ollama' ? 'Ollama 엔드포인트' : 'API 키';
      throw new Error(`${keyName}가 설정되지 않았습니다. 플러그인 설정에서 ${provider} 제공자의 ${keyName}를 입력해주세요.`);
    }

    const ClientFactory = await this.getClientFactory();

    // 모델명 유효성 검사
    if (!this.settings.model || this.settings.model.trim() === '') {
      throw new Error(`모델이 설정되지 않았습니다. 플러그인 설정에서 ${this.settings.provider} 모델을 선택해주세요.`);
    }

    const client = ClientFactory.createClient(this.settings);
    
    try {
      // 컨텍스트 추출 (형태소 정보 포함)
      const allContexts = this.extractCorrectionContexts(request, morphemeInfo);
      
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
        // 배치 크기 결정 (형태소 정보 유무 고려)
        const maxBatchSize = this.calculateOptimalBatchSize(contextsToAnalyze, !!morphemeInfo);
        
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
        
        // ⭐ NEW: 형태소 정보 로깅
        if (morphemeInfo) {
          const totalTokens = morphemeInfo.sentences.reduce((sum, s) => sum + (s.tokens?.length || 0), 0);
          Logger.debug('형태소 정보 활용 AI 분석 시작:', {
            tokensCount: totalTokens,
            sentences: morphemeInfo.sentences?.length || 0
          });
        }

        // 모든 배치 처리
        for (let i = 0; i < batches.length; i++) {
          try {
            if (request.onProgress) {
              const progressMsg = morphemeInfo 
                ? `AI + 형태소 분석 중... (${Math.round(((i + 1) / batches.length) * 100)}%)`
                : `AI 분석 중... (${Math.round(((i + 1) / batches.length) * 100)}%)`;
              request.onProgress(i + 1, batches.length, progressMsg);
            }
            
            const batchResults = await this.processBatch(
              batches[i], 
              i, 
              batches.length, 
              client, 
              adjustedMaxTokens, 
              this.settings.model,
              morphemeInfo  // ⭐ NEW: 형태소 정보 전달
            );
            
            aiResults.push(...batchResults);
            
            if (i < batches.length - 1) {
              // API 과부하 방지를 위한 배치 간격 (529 오류 방지)
              await new Promise(resolve => window.setTimeout(resolve, 1500));
            }
          } catch (error) {
            Logger.error(`배치 ${i + 1} 처리 실패:`, error);
          }
        }
        Logger.log(`AI 분석 완료: ${aiResults.length}개 결과 수집됨`);
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
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`AI 분석 실패: ${message}`);
    }
  }

  /**
   * AI 응답 항목의 타입 가드
   */
  private isValidAIResponseItem(item: unknown): item is {
    correctionIndex: string | number;
    selectedValue: string;
    isExceptionProcessed?: boolean;
    confidence?: string | number;
    reasoning?: string;
  } {
    return typeof item === 'object' && item !== null &&
           'correctionIndex' in item && 'selectedValue' in item;
  }

  /**
   * AI 응답을 파싱하여 구조화된 결과로 변환합니다.
   */
  private parseAIResponse(response: string, correctionContexts: CorrectionContext[]): AIAnalysisResult[] {
    try {
      // JSON 응답 파싱 시도
      let parsedResponse: unknown[];
      
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
      
      // 3. 잘린 JSON 복구 시도 (개선된 로직)
      if (!jsonString.endsWith(']') && jsonString.includes('[')) {
        Logger.warn('JSON이 잘린 것으로 보임, 강화된 복구 시도');
        
        // 3-1. 마지막 완전한 객체 찾기
        let lastCompleteObjectIndex = -1;
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = 0; i < jsonString.length; i++) {
          const char = jsonString[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"') {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                lastCompleteObjectIndex = i;
              }
            }
          }
        }
        
        // 3-2. 복구 시도
        if (lastCompleteObjectIndex > 0) {
          jsonString = jsonString.substring(0, lastCompleteObjectIndex + 1) + ']';
          Logger.debug('고급 JSON 복구 완료');
        } else {
          // 3-3. 간단한 복구 (기존 방식)
          const lastBraceIndex = jsonString.lastIndexOf('}');
          if (lastBraceIndex > 0) {
            jsonString = jsonString.substring(0, lastBraceIndex + 1) + ']';
            Logger.debug('기본 JSON 복구 완료');
          }
        }
      }
      
      Logger.debug('파싱할 JSON (첫 200자):', jsonString.substring(0, 200) + (jsonString.length > 200 ? '...' : ''));
      
      // 🔧 JSON 파싱 시도 + 추가 복구 로직
      try {
        parsedResponse = JSON.parse(jsonString);
      } catch (parseError) {
        Logger.warn('초기 JSON 파싱 실패, 추가 복구 시도:', parseError);
        
        // 마지막 쉼표 제거 시도
        let fixedJson = jsonString.replace(/,\s*$/, '');
        if (!fixedJson.endsWith(']')) {
          fixedJson += ']';
        }
        
        try {
          parsedResponse = JSON.parse(fixedJson);
          Logger.debug('쉼표 제거로 JSON 복구 성공');
        } catch {
          // 마지막 불완전한 객체 제거 시도
          const lastCommaIndex = jsonString.lastIndexOf(',');
          if (lastCommaIndex > 0) {
            const cutJson = jsonString.substring(0, lastCommaIndex) + ']';
            try {
              parsedResponse = JSON.parse(cutJson);
              Logger.debug('불완전 객체 제거로 JSON 복구 성공');
            } catch {
              throw parseError; // 원래 오류 다시 던지기
            }
          } else {
            throw parseError;
          }
        }
      }

      const results: AIAnalysisResult[] = [];

      for (const item of parsedResponse) {
        if (!this.isValidAIResponseItem(item)) {
          Logger.warn('유효하지 않은 AI 응답 항목:', item);
          continue;
        }

        const batchIndex = typeof item.correctionIndex === 'number'
          ? item.correctionIndex
          : parseInt(String(item.correctionIndex));
        
        if (isNaN(batchIndex) || batchIndex < 0 || batchIndex >= correctionContexts.length) {
          Logger.warn('유효하지 않은 batchIndex:', batchIndex);
          continue;
        }

        const context = correctionContexts[batchIndex];
        const originalCorrectionIndex = context.correctionIndex;

        let selectedValue = item.selectedValue || '';
        
        const validOptions = [...context.corrected, context.original];
        
        // 🔍 AI 선택 분석 로깅 (공백/띄어쓰기 문제 디버깅용)
        Logger.debug(`AI 선택 분석 - 오류 "${context.original}":`);
        Logger.debug(`  AI 선택값: "${selectedValue}"`);
        Logger.debug(`  유효한 옵션들: [${validOptions.map(opt => `"${opt}"`).join(', ')}]`);
        Logger.debug(`  추천 이유: "${item.reasoning}"`);
        
        if (!validOptions.includes(selectedValue)) {
          Logger.warn(`🔴 AI가 유효하지 않은 값을 선택했습니다: "${selectedValue}"`);
          
          if (selectedValue === '원본유지' || selectedValue === '예외처리' || !selectedValue) {
            selectedValue = context.original;
            Logger.debug(`"${item.selectedValue}"를 원본 "${context.original}"로 변경`);
          } else {
            const matchedOption = this.findBestMatch(selectedValue, validOptions);
            if (matchedOption) {
              Logger.warn(`⚠️ AI 선택 불일치: "${selectedValue}" → "${matchedOption}" (자동 매칭)`);
              selectedValue = matchedOption;
            } else {
              Logger.error(`❌ 매칭 실패 - 원본으로 대체: "${selectedValue}" → "${context.original}"`);
              selectedValue = context.original;
            }
          }
        } else {
          Logger.debug(`✅ AI 선택값이 유효함: "${selectedValue}"`);
        }

        const isOriginalSelected = selectedValue === context.original;
        const isOriginalKept = isOriginalSelected && !item.isExceptionProcessed;

        const confidence = typeof item.confidence === 'number'
          ? item.confidence
          : (typeof item.confidence === 'string' ? parseInt(item.confidence) : 0);

        results.push({
          correctionIndex: originalCorrectionIndex,
          selectedValue,
          isExceptionProcessed: item.isExceptionProcessed || false,
          isOriginalKept: isOriginalKept,
          confidence: Math.max(0, Math.min(100, confidence)),
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
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`AI 응답 파싱 실패: ${message}`);
      }
    }
  }

  /**
   * 사용 가능한 모델 목록을 가져옵니다.
   */
  async fetchAvailableModels(): Promise<string[]> {
    try {
      const ClientFactory = await this.getClientFactory();
      return await ClientFactory.fetchModels(this.settings);
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
  async isAvailable(): Promise<boolean> {
    return this.settings.enabled && (await this.hasValidApiKey(this.settings));
  }

  /**
   * 현재 설정된 제공자 및 모델 정보를 반환합니다.
   */
  getProviderInfo(): { provider: string; model: string; available: boolean } {
    // 기본적인 동기 체크만 수행 (API 키는 비동기 체크 필요하므로 제외)
    return {
      provider: this.settings.provider,
      model: this.settings.model,
      available: this.settings.enabled // 기본적인 활성화 상태만 체크
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
    const cleanAiValue = aiValue.replace(/[\s*~\-+[\]]/g, '');
    
    for (const option of validOptions) {
      const cleanOption = option.replace(/[\s*~\-+[\]]/g, '');
      
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