import { PluginSettings, Correction, SpellCheckResult } from '../types/interfaces';
import { Logger } from '../utils/logger';
import { ErrorHandlerService } from './errorHandler';

/**
 * Bareun.ai API 응답 인터페이스
 */
interface BareunResponse {
  origin: string;
  revised: string;
  revisedSentences?: Array<{
    origin: string;
    revised: string;
    revisedBlocks?: Array<{
      origin: {
        content: string;
        beginOffset: number;
        length: number;
      };
      revised: string;
      revisions: Array<{
        revised: string;
        comment?: string;
      }>;
    }>;
  }>;
}

/**
 * 형태소 분석 응답 인터페이스 (실제 API 응답 구조)
 */
interface TextSpan {
  content: string;
  beginOffset: number;
  length: number;
}

interface Morpheme {
  text: TextSpan;
  tag: string;
  probability: number;
  outOfVocab: string;
}

interface Token {
  text: TextSpan;
  morphemes: Morpheme[];
  lemma: string;
  tagged: string;
  modified: string;
}

interface Sentence {
  text: TextSpan;
  tokens: Token[];
  refined: string;
}

interface MorphemeResponse {
  sentences: Sentence[];
  language: string;
}

/**
 * Bareun.ai API 맞춤법 검사 서비스
 */
export class SpellCheckApiService {
  private morphemeCache: Map<string, MorphemeResponse> = new Map();
  private readonly maxCacheSize = 100; // 최대 100개 캐시 유지
  /**
   * 텍스트의 형태소를 분석합니다 (캐싱 및 최적화 적용).
   * @param text 분석할 텍스트
   * @param settings 플러그인 설정
   * @returns 형태소 분석 결과
   */
  async analyzeMorphemes(text: string, settings: PluginSettings): Promise<MorphemeResponse> {
    // 1. 캐시 확인 (텍스트 기반 캐싱)
    const cacheKey = `morpheme_${this.hashText(text)}`;
    const cachedResult = this.morphemeCache.get(cacheKey);
    if (cachedResult) {
      Logger.debug('형태소 분석 캐시에서 결과 반환:', { textLength: text.length });
      return cachedResult;
    }

    // 2. 재시도 로직을 포함한 API 호출
    try {
      const result = await this.executeMorphemeRequest(text, settings);
      
      // 3. 캐시에 저장 (성공한 경우만)
      this.morphemeCache.set(cacheKey, result);
      this.manageCacheSize();
      
      return result;
    } catch (error) {
      Logger.error('형태소 분석 실패:', error);
      throw error;
    }
  }

  /**
   * 실제 형태소 분석 API 요청을 수행합니다.
   */
  private async executeMorphemeRequest(text: string, settings: PluginSettings): Promise<MorphemeResponse> {
    const protocol = settings.apiPort === 443 ? 'https' : 'http';
    const port = (settings.apiPort === 443 || settings.apiPort === 80) ? '' : `:${settings.apiPort}`;
    const apiUrl = `${protocol}://${settings.apiHost}${port}/bareun/api/v1/analyze`;
    
    // REST API 문서에 따른 올바른 요청 형식
    const requestBody = {
      document: {
        content: text,
        language: "ko-KR"
      },
      encoding_type: "UTF8"
    };

    Logger.debug('형태소 분석 API 요청:', {
      url: apiUrl,
      textLength: text.length,
      cached: false
    });

    // 재시도 로직 적용 + 타임아웃 설정
    return await ErrorHandlerService.withRetry(
      async () => {
        // AbortController를 사용한 타임아웃 처리
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10초 타임아웃

        try {
          const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "api-key": settings.apiKey
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorText = await response.text();
            Logger.error('형태소 분석 API 오류:', {
              status: response.status,
              statusText: response.statusText,
              errorBody: errorText
            });
            throw new Error(`형태소 분석 API 요청 실패: ${response.status} ${response.statusText}`);
          }

          const data = await response.json();
          Logger.debug('형태소 분석 API 응답 성공:', { 
            textLength: text.length,
            tokensCount: data.sentences?.reduce((count: number, sentence: any) => count + sentence.tokens.length, 0) || 0,
            sentencesCount: data.sentences?.length || 0
          });
          return data;
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.name === 'AbortError') {
            throw new Error('형태소 분석 요청 타임아웃 (10초)');
          }
          throw error;
        }
      },
      `morpheme-analysis-${text.substring(0, 50)}`,
      {
        maxRetries: 2,
        baseDelay: 1000,
        maxDelay: 3000,
        backoffFactor: 1.5
      }
    );
  }

  /**
   * 텍스트를 해시합니다 (캐시 키 생성용).
   */
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32비트 정수로 변환
    }
    return hash.toString(36);
  }

  /**
   * 캐시 크기를 관리합니다 (LRU 방식).
   */
  private manageCacheSize(): void {
    if (this.morphemeCache.size > this.maxCacheSize) {
      // 가장 오래된 항목부터 제거 (Map은 삽입 순서를 유지)
      const firstKey = this.morphemeCache.keys().next().value;
      this.morphemeCache.delete(firstKey);
      Logger.debug('형태소 캐시 크기 관리: 오래된 항목 삭제');
    }
  }

  /**
   * 캐시를 수동으로 정리합니다.
   */
  clearMorphemeCache(): void {
    this.morphemeCache.clear();
    Logger.debug('형태소 캐시 정리 완료');
  }

  /**
   * 캐시 통계를 반환합니다.
   */
  getMorphemeCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.morphemeCache.size,
      maxSize: this.maxCacheSize
    };
  }

  /**
   * 텍스트의 맞춤법을 검사합니다.
   * @param text 검사할 텍스트
   * @param settings 플러그인 설정
   * @returns 검사 결과
   */
  async checkSpelling(text: string, settings: PluginSettings): Promise<SpellCheckResult> {
    // API 키 유효성 검사
    if (!settings.apiKey || settings.apiKey.trim() === '') {
      throw new Error("API 키가 설정되지 않았습니다. 플러그인 설정에서 Bareun.ai API 키를 입력해주세요.");
    }

    const protocol = settings.apiPort === 443 ? 'https' : 'http';
    const port = (settings.apiPort === 443 || settings.apiPort === 80) ? '' : `:${settings.apiPort}`;
    const apiUrl = `${protocol}://${settings.apiHost}${port}/bareun/api/v1/correct-error`;
    
    const requestBody = {
      document: {
        content: text,
        type: "PLAIN_TEXT"
      },
      encoding_type: "UTF8",
      auto_split: true
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": settings.apiKey
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`API 요청 실패: ${response.status} ${response.statusText}`);
    }

    const data: BareunResponse = await response.json();
    return this.parseBareunResults(data, text, settings);
  }

  /**
   * Bareun.ai API 응답을 파싱하여 교정 정보를 추출합니다.
   * @param data API 응답 데이터
   * @param originalText 원본 텍스트
   * @param settings 플러그인 설정
   * @returns 파싱된 결과
   */
  private parseBareunResults(data: BareunResponse, originalText: string, settings: PluginSettings): SpellCheckResult {
    const corrections: Correction[] = [];
    let resultOutput = data.revised || originalText;

    // revisedSentences에서 상세 오류 정보 추출
    const correctionMap = new Map<string, Correction>(); // 원문별로 교정 정보 통합
    
    Logger.debug('=== Bareun API 응답 분석 ===');
    Logger.debug('원본 텍스트:', originalText);
    Logger.debug('교정된 텍스트:', data.revised);
    Logger.debug('revisedSentences 수:', data.revisedSentences?.length || 0);
    
    // 🔧 전체 텍스트 검증: 원본과 교정본이 실질적으로 같으면 오류 없음으로 처리
    const cleanOriginal = originalText.trim().replace(/\s+/g, ' ');
    const cleanRevised = (data.revised || '').trim().replace(/\s+/g, ' ');
    
    Logger.log('🔍 전체 텍스트 비교:');
    Logger.log('  정리된 원본:', `"${cleanOriginal}"`);
    Logger.log('  정리된 교정:', `"${cleanRevised}"`);
    Logger.log('  텍스트 동일 여부:', cleanOriginal === cleanRevised);
    
    // 1차 검증: 완전히 동일한 경우
    if (cleanOriginal === cleanRevised) {
      Logger.log('✅ 전체 텍스트 검증: 원본과 교정본이 동일하여 오류 없음으로 처리');
      return {
        resultOutput: originalText,
        corrections: []
      };
    }
    
    // 2차 검증: 길이와 문자 유사도로 실질적 동일성 확인
    const lengthDiff = Math.abs(cleanOriginal.length - cleanRevised.length);
    const maxLength = Math.max(cleanOriginal.length, cleanRevised.length);
    const lengthSimilarity = maxLength > 0 ? 1 - (lengthDiff / maxLength) : 1;
    
    // 3차 검증: 문자 단위 유사도 계산
    const charSimilarity = this.calculateCharacterSimilarity(cleanOriginal, cleanRevised);
    
    Logger.log('📊 유사도 분석:');
    Logger.log(`  길이 유사도: ${(lengthSimilarity * 100).toFixed(1)}% (차이: ${lengthDiff}자)`);
    Logger.log(`  문자 유사도: ${(charSimilarity * 100).toFixed(1)}%`);
    
    // 4차 검증: 높은 유사도면 오류 없음으로 처리
    if (lengthSimilarity > 0.95 && charSimilarity > 0.95) {
      Logger.log('✅ 유사도 검증: 텍스트가 매우 유사하여 오류 없음으로 처리');
      return {
        resultOutput: originalText,
        corrections: []
      };
    }
    
    if (data.revisedSentences && Array.isArray(data.revisedSentences)) {
      data.revisedSentences.forEach((sentence, sentenceIndex) => {
        Logger.debug(`\n--- 문장 ${sentenceIndex + 1} ---`);
        Logger.debug('원본 문장:', sentence.origin);
        Logger.debug('교정된 문장:', sentence.revised);
        Logger.debug('revisedBlocks 수:', sentence.revisedBlocks?.length || 0);
        
        if (sentence.revisedBlocks && Array.isArray(sentence.revisedBlocks)) {
          sentence.revisedBlocks.forEach((block, blockIndex) => {
            Logger.log(`
  블록 ${blockIndex + 1}:`);
            Logger.debug(`  전체 블록 정보:`, JSON.stringify(block, null, 2));
            Logger.debug('  원본 내용:', block.origin?.content);
            Logger.debug('  원본 위치:', `${block.origin?.beginOffset}-${block.origin?.beginOffset + block.origin?.length}`);
            Logger.debug('  교정:', block.revised);
            Logger.debug('  제안 수:', block.revisions?.length || 0);
            
            if (block.origin && block.revised && block.revisions) {
              const blockOriginalText = block.origin.content;
              
              Logger.log(`📝 블록 상세 분석:`);
              Logger.log(`  원본: "${blockOriginalText}"`);
              Logger.log(`  교정: "${block.revised}"`);
              Logger.log(`  원본 = 교정: ${blockOriginalText === block.revised}`);
              
              // 🔧 엄격한 검증: 원본과 교정본이 실질적으로 같으면 오류가 아님
              if (blockOriginalText === block.revised) {
                Logger.debug('  -> 원본과 교정본이 동일하여 건너뜀');
                return;
              }
              
              // 빈 텍스트나 깨진 문자는 제외
              if (!blockOriginalText || blockOriginalText.trim().length === 0) {
                Logger.debug('  -> 빈 텍스트로 건너뜀');
                return;
              }
              
              // 실제 원문에서 찾을 수 있는지 확인
              if (originalText.indexOf(blockOriginalText) === -1) {
                Logger.debug('  -> 원본 텍스트에서 찾을 수 없어 건너뜀');
                return;
              }
              
              // 🔧 추가 검증: 의미 있는 교정인지 확인
              const isSignificantChange = this.isSignificantCorrection(blockOriginalText, block.revised, block.revisions);
              if (!isSignificantChange) {
                Logger.debug('  -> 의미 없는 변경으로 건너뜀');
                return;
              }
              
              // 여러 수정 제안이 있을 경우 모두 포함
              const suggestions = block.revisions.map(rev => rev.revised);
              Logger.debug(`  🔍 API에서 받은 제안 수: ${suggestions.length}개`);
              Logger.debug('  제안들:', suggestions);
              
              // 중복 제거 및 원문과 다른 제안만 포함
              const uniqueSuggestions = [...new Set(suggestions)]
                .filter(s => {
                  // 기본 검증
                  const basicValid = s !== blockOriginalText && 
                                   s.trim() !== blockOriginalText.trim() &&
                                   s.length > 0 &&
                                   !s.includes('\uFFFD'); // 깨진 문자 제거
                  
                  // 🔧 추가 검증: 대소문자, 공백, 특수문자 무시하고 실질적으로 같은지 확인
                  const normalizedOriginal = blockOriginalText.toLowerCase().replace(/[\s\-_.,!?]/g, '');
                  const normalizedSuggestion = s.toLowerCase().replace(/[\s\-_.,!?]/g, '');
                  const substantiallyDifferent = normalizedOriginal !== normalizedSuggestion;
                  
                  const isValid = basicValid && substantiallyDifferent;
                  Logger.debug(`    "${s}" 검증 - 기본: ${basicValid}, 실질차이: ${substantiallyDifferent}, 최종: ${isValid}`);
                  return isValid;
                });
              
              Logger.debug(`  ✅ 중복제거 후 유효한 제안 수: ${uniqueSuggestions.length}개`);
              Logger.debug('  유효한 제안들:', uniqueSuggestions);
              
              // 한 글자 오류 필터링 적용
              const filteredSuggestions = this.applySingleCharFilter(
                blockOriginalText, 
                uniqueSuggestions, 
                settings.filterSingleCharErrors
              );
              
              Logger.debug(`  🚀 최종 필터링된 제안 수: ${filteredSuggestions.length}개`);
              Logger.debug('  필터링된 제안들:', filteredSuggestions);
              
              // 유효한 제안이 있는 경우만 처리
              if (filteredSuggestions.length > 0) {
                // 이미 있는 교정이면 제안을 추가, 없으면 새로 생성
                if (correctionMap.has(blockOriginalText)) {
                  Logger.debug('  -> 기존 교정에 제안 추가');
                  const existing = correctionMap.get(blockOriginalText)!;
                  // 새로운 제안들을 기존 제안들과 합치고 중복 제거
                  const combinedSuggestions = [...new Set([...existing.corrected, ...filteredSuggestions])];
                  correctionMap.set(blockOriginalText, {
                    ...existing,
                    corrected: combinedSuggestions
                  });
                  Logger.debug('  -> 통합된 제안들:', combinedSuggestions);
                } else {
                  Logger.debug('  -> 새 교정 생성');
                  correctionMap.set(blockOriginalText, {
                    original: blockOriginalText,
                    corrected: filteredSuggestions,
                    help: block.revisions[0]?.comment || "맞춤법 교정"
                  });
                  Logger.debug('  -> 새 교정 제안들:', filteredSuggestions);
                }
              } else {
                Logger.debug('  -> 유효한 제안이 없어 건너뜀');
              }
            }
          });
        }
      });
    }
    
    // correctionMap을 배열로 변환
    corrections.push(...Array.from(correctionMap.values()));
    
    Logger.debug('\n=== 최종 교정 결과 ===');
    Logger.debug('교정 맵 크기:', correctionMap.size);
    Logger.log('최종 교정 배열:', corrections);
    
    // 🔍 최종 교정 상세 분석
    Logger.log('📊 최종 교정 상세:');
    Logger.log(`  총 교정 수: ${corrections.length}개`);
    corrections.forEach((correction, index) => {
      Logger.log(`  ${index + 1}. "${correction.original}" → [${correction.corrected.join(', ')}]`);
      Logger.log(`     설명: ${correction.help}`);
    });
    
    // 만약 교정된 텍스트는 있지만 세부 오류 정보가 없는 경우
    // 단, 공백이나 줄바꿈 차이는 무시하고 실제 내용이 다른 경우만 처리
    const normalizedSource = originalText.replace(/\s+/g, ' ').trim();
    const normalizedResult = resultOutput.replace(/\s+/g, ' ').trim();
    
    if (corrections.length === 0 && normalizedResult !== normalizedSource) {
      Logger.log('세부 정보가 없어 diff 로직 사용');
      Logger.debug('원본 (정규화):', normalizedSource);
      Logger.debug('결과 (정규화):', normalizedResult);
      
      // 간단한 diff 로직으로 변경된 부분 찾기
      const words = originalText.split(/(\s+)/);
      const revisedWords = resultOutput.split(/(\s+)/);
      
      for (let i = 0; i < Math.min(words.length, revisedWords.length); i++) {
        if (words[i] !== revisedWords[i] && words[i].trim() && revisedWords[i].trim()) {
          corrections.push({
            original: words[i],
            corrected: [revisedWords[i]],
            help: "자동 교정됨"
          });
        }
      }
    } else if (corrections.length === 0) {
      Logger.log('맞춤법 오류 없음 - diff 로직 실행 안함');
    }
    
    return { resultOutput, corrections };
  }

  /**
   * 형태소 분석을 활용하여 겹치는 오류를 해결합니다.
   * @param text 원본 텍스트
   * @param corrections 교정 배열
   * @param settings 플러그인 설정
   * @returns 개선된 교정 배열
   */
  async improveCorrectionsWithMorphemes(
    text: string, 
    corrections: Correction[], 
    settings: PluginSettings
  ): Promise<Correction[]> {
    try {
      Logger.log('\n=== 형태소 분석 기반 교정 개선 ===');
      
      // 형태소 분석 수행
      const morphemeData = await this.analyzeMorphemes(text, settings);
      Logger.debug('형태소 분석 완료:', morphemeData);

      // 겹치는 오류들을 형태소 단위로 그룹화
      const improvedCorrections = this.groupCorrectionsByMorphemes(corrections, morphemeData, text);
      
      Logger.debug(`교정 개선 결과: ${corrections.length}개 → ${improvedCorrections.length}개`);
      return improvedCorrections;
      
    } catch (error) {
      Logger.debug('형태소 분석 실패, 원본 교정 사용:', error);
      return corrections; // 실패 시 원본 교정 반환
    }
  }

  /**
   * 이미 분석된 형태소 데이터를 사용하여 교정을 개선합니다 (중복 API 호출 방지).
   * @param text 원본 텍스트
   * @param corrections 교정 배열
   * @param settings 플러그인 설정
   * @param morphemeData 이미 분석된 형태소 데이터
   * @returns 개선된 교정 배열
   */
  async improveCorrectionsWithMorphemeData(
    text: string, 
    corrections: Correction[], 
    settings: PluginSettings,
    morphemeData: MorphemeResponse
  ): Promise<Correction[]> {
    try {
      Logger.debug('=== 형태소 데이터 기반 교정 개선 (재사용) ===');
      Logger.debug('기존 형태소 데이터 재사용:', morphemeData);

      // 겹치는 오류들을 형태소 단위로 그룹화
      const improvedCorrections = this.groupCorrectionsByMorphemes(corrections, morphemeData, text);
      
      Logger.debug(`교정 개선 결과 (재사용): ${corrections.length}개 → ${improvedCorrections.length}개`);
      return improvedCorrections;
      
    } catch (error) {
      Logger.debug('형태소 데이터 기반 교정 개선 실패, 원본 교정 사용:', error);
      return corrections; // 실패 시 원본 교정 반환
    }
  }

  /**
   * 형태소 정보를 기반으로 교정을 그룹화합니다.
   * @param corrections 원본 교정 배열
   * @param morphemeData 형태소 분석 결과
   * @param originalText 원본 텍스트
   * @returns 그룹화된 교정 배열
   */
  private groupCorrectionsByMorphemes(
    corrections: Correction[], 
    morphemeData: MorphemeResponse, 
    originalText: string
  ): Correction[] {
    // 토큰 정보를 위치별로 매핑 (토큰이 전체 단어 경계를 나타냄)
    const tokenMap = new Map<string, Token>();
    
    morphemeData.sentences.forEach(sentence => {
      sentence.tokens.forEach(token => {
        tokenMap.set(token.text.content, token);
      });
    });

    Logger.debug('토큰 맵:', Array.from(tokenMap.keys()));

    // 겹치는 교정들을 식별하고 통합
    const groupedCorrections: Correction[] = [];
    const processedRanges = new Set<string>();

    corrections.forEach(correction => {
      const correctionPositions = this.findAllPositions(originalText, correction.original);
      
      correctionPositions.forEach(position => {
        const rangeKey = `${position}_${position + correction.original.length}`;
        
        if (!processedRanges.has(rangeKey)) {
          // 이 위치에서 겹치는 다른 교정들 찾기
          const overlappingCorrections = this.findOverlappingCorrections(
            corrections, originalText, position, correction.original.length
          );
          
          if (overlappingCorrections.length > 1) {
            Logger.debug(`위치 ${position}에서 겹치는 교정들:`, overlappingCorrections.map(c => c.original));
            
            // 형태소 정보를 기반으로 최적의 교정 선택
            const bestCorrection = this.selectBestCorrectionWithTokens(
              overlappingCorrections, tokenMap, originalText, position
            );
            
            if (bestCorrection) {
              groupedCorrections.push(bestCorrection);
              Logger.debug(`선택된 교정: "${bestCorrection.original}"`);
              
              // 겹치는 모든 범위를 처리됨으로 표시
              overlappingCorrections.forEach(corr => {
                const corrPositions = this.findAllPositions(originalText, corr.original);
                corrPositions.forEach(pos => {
                  const key = `${pos}_${pos + corr.original.length}`;
                  processedRanges.add(key);
                });
              });
            }
          } else {
            // 겹치지 않는 교정은 그대로 추가
            groupedCorrections.push(correction);
            processedRanges.add(rangeKey);
          }
        }
      });
    });

    return groupedCorrections;
  }

  /**
   * 특정 위치에서 겹치는 교정들을 찾습니다.
   */
  private findOverlappingCorrections(
    corrections: Correction[], 
    text: string, 
    position: number, 
    length: number
  ): Correction[] {
    const overlapping: Correction[] = [];
    const endPosition = position + length;

    corrections.forEach(correction => {
      const positions = this.findAllPositions(text, correction.original);
      
      positions.forEach(pos => {
        const corrEnd = pos + correction.original.length;
        
        // 겹치는 조건 확인
        if (!(corrEnd <= position || endPosition <= pos)) {
          if (!overlapping.some(existing => existing.original === correction.original)) {
            overlapping.push(correction);
          }
        }
      });
    });

    return overlapping;
  }

  /**
   * 토큰 정보를 기반으로 최적의 교정을 선택합니다.
   */
  private selectBestCorrectionWithTokens(
    corrections: Correction[], 
    tokenMap: Map<string, Token>, 
    text: string, 
    position: number
  ): Correction | null {
    // 1. 토큰 경계와 일치하는 교정 우선 선택
    for (const correction of corrections) {
      const token = tokenMap.get(correction.original);
      if (token) {
        Logger.debug(`토큰 경계 일치 교정 선택: "${correction.original}" (토큰 단위)`);
        return correction;
      }
    }

    // 2. 가장 긴 텍스트 우선
    const longestCorrections = corrections.filter(c => 
      c.original.length === Math.max(...corrections.map(corr => corr.original.length))
    );

    if (longestCorrections.length === 1) {
      Logger.debug(`가장 긴 교정 선택: "${longestCorrections[0].original}"`);
      return longestCorrections[0];
    }

    // 3. 첫 번째 교정 선택 (기본값)
    Logger.debug(`기본 선택: "${longestCorrections[0].original}"`);
    return longestCorrections[0];
  }

  /**
   * 텍스트에서 특정 패턴의 모든 위치를 찾습니다.
   */
  private findAllPositions(text: string, pattern: string): number[] {
    const positions: number[] = [];
    let index = text.indexOf(pattern);
    
    while (index !== -1) {
      positions.push(index);
      index = text.indexOf(pattern, index + 1);
    }
    
    return positions;
  }

  /**
   * 두 문자열의 문자 단위 유사도를 계산합니다.
   * @param str1 문자열 1
   * @param str2 문자열 2
   * @returns 문자 단위 유사도 (0 ~ 1)
   */
  private calculateCharacterSimilarity(str1: string, str2: string): number {
    const minLength = Math.min(str1.length, str2.length);
    let commonChars = 0;

    for (let i = 0; i < minLength; i++) {
      if (str1[i] === str2[i]) {
        commonChars++;
      }
    }

    return minLength > 0 ? commonChars / minLength : 0;
  }

  /**
   * 한 글자 오류 필터링을 적용합니다.
   * @param original 원본 텍스트
   * @param suggestions 수정 제안들
   * @param filterEnabled 필터링 활성화 여부
   * @returns 필터링된 제안들
   */
  private applySingleCharFilter(original: string, suggestions: string[], filterEnabled: boolean): string[] {
    if (!filterEnabled) {
      Logger.debug('    한 글자 필터링 비활성화됨');
      return suggestions;
    }

    // 원본이 한 글자가 아니면 모든 제안 유지
    if (original.length !== 1) {
      Logger.debug(`    원본이 한 글자가 아님 (${original.length}글자): "${original}"`);
      return suggestions;
    }

    Logger.debug(`    한 글자 원본 감지: "${original}"`);

    // 의미있는 한 글자 교정인지 판단
    const meaningfulSuggestions = suggestions.filter(suggestion => {
      // 예외 케이스들
      const exceptions = this.checkSingleCharExceptions(original, suggestion);
      if (exceptions.isException) {
        Logger.debug(`      "${suggestion}": 예외 처리됨 (${exceptions.reason})`);
        return true;
      }

      // 일반적으로 한 글자 교정은 필터링
      Logger.debug(`      "${suggestion}": 한 글자 교정으로 필터링됨`);
      return false;
    });

    Logger.debug(`    필터링 결과: ${suggestions.length} → ${meaningfulSuggestions.length}`);
    return meaningfulSuggestions;
  }

  /**
   * 한 글자 교정의 예외 케이스를 확인합니다.
   * @param original 원본 글자
   * @param suggestion 제안 글자
   * @returns 예외 처리 결과
   */
  private checkSingleCharExceptions(original: string, suggestion: string): { isException: boolean; reason: string } {
    // 1. 숫자/영문 → 한글 변환 (의미있는 교정)
    if (/[0-9a-zA-Z]/.test(original) && /[가-힣]/.test(suggestion)) {
      return { isException: true, reason: '숫자/영문 → 한글 변환' };
    }

    // 2. 특수문자 → 한글 변환
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(original) && /[가-힣]/.test(suggestion)) {
      return { isException: true, reason: '특수문자 → 한글 변환' };
    }

    // 3. 자주 틀리는 한 글자 교정 (화이트리스트)
    const commonSingleCharCorrections: Record<string, string[]> = {
      '되': ['된', '됨', '돼'],  // 되/돼 혼용
      '돼': ['된', '되'],
      '안': ['않'],            // 안/않 혼용  
      '않': ['안'],
      '의': ['에', '을', '를'], // 조사 혼용
      '에': ['의', '을'],
      '을': ['를', '의'],
      '를': ['을', '의'],
      '이': ['가', '히'],       // 이/가, 이/히 혼용
      '가': ['이', '가'],
      '히': ['이', '게'],
      '게': ['히', '에']
    };

    if (commonSingleCharCorrections[original]?.includes(suggestion)) {
      return { isException: true, reason: '자주 틀리는 한 글자 교정' };
    }

    // 4. 제안이 한 글자가 아닌 경우 (한 글자 → 여러 글자는 의미있는 교정)
    if (suggestion.length > 1) {
      return { isException: true, reason: '한 글자 → 여러 글자 확장' };
    }

    // 일반적인 한 글자 → 한 글자 교정은 필터링
    return { isException: false, reason: '일반적인 한 글자 교정' };
  }

  /**
   * 의미 있는 교정인지 확인합니다.
   * @param original 원본 텍스트
   * @param revised 교정된 텍스트
   * @param revisions 제안 목록
   * @returns 의미 있는 교정 여부
   */
  private isSignificantCorrection(original: string, revised: string, revisions: Array<{ revised: string }>): boolean {
    // 1. 원본과 교정본이 같으면 의미 없음
    if (original === revised) {
      Logger.debug('    -> 원본과 교정본이 동일');
      return false;
    }
    
    // 2. 빈 텍스트면 의미 없음
    if (!original || original.trim().length === 0) {
      Logger.debug('    -> 빈 텍스트');
      return false;
    }
    
    // 3. 제안들이 모두 원본과 같으면 의미 없음
    const uniqueRevisions = [...new Set(revisions.map(r => r.revised))];
    if (uniqueRevisions.length === 1 && uniqueRevisions[0] === original) {
      Logger.debug('    -> 모든 제안이 원본과 동일');
      return false;
    }
    
    // 4. 한 글자 교정의 경우 예외 케이스 확인
    if (original.length === 1 && revised.length === 1) {
      const exceptions = this.checkSingleCharExceptions(original, revised);
      if (!exceptions.isException) {
        Logger.debug('    -> 한 글자 교정이지만 예외 케이스 아님');
        return false;
      }
    }
    
    // 5. 정규화된 텍스트가 같으면 의미 없음 (대소문자, 공백, 특수문자 무시)
    const normalizedOriginal = original.toLowerCase().replace(/[\s\-_.,!?]/g, '');
    const normalizedRevised = revised.toLowerCase().replace(/[\s\-_.,!?]/g, '');
    if (normalizedOriginal === normalizedRevised) {
      Logger.debug('    -> 정규화된 텍스트가 동일');
      return false;
    }
    
    Logger.debug('    -> 의미 있는 교정으로 판단');
    return true;
  }
}