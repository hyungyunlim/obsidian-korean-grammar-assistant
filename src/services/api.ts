import { PluginSettings, Correction, SpellCheckResult } from '../types/interfaces';
import { Logger } from '../utils/logger';

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
 * Bareun.ai API 맞춤법 검사 서비스
 */
export class SpellCheckApiService {
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
    
    Logger.log('=== Bareun API 응답 분석 ===');
    Logger.log('원본 텍스트:', originalText);
    Logger.log('교정된 텍스트:', data.revised);
    Logger.log('revisedSentences 수:', data.revisedSentences?.length || 0);
    
    if (data.revisedSentences && Array.isArray(data.revisedSentences)) {
      data.revisedSentences.forEach((sentence, sentenceIndex) => {
        Logger.log(`\n--- 문장 ${sentenceIndex + 1} ---`);
        Logger.log('원본 문장:', sentence.origin);
        Logger.log('교정된 문장:', sentence.revised);
        Logger.log('revisedBlocks 수:', sentence.revisedBlocks?.length || 0);
        
        if (sentence.revisedBlocks && Array.isArray(sentence.revisedBlocks)) {
          sentence.revisedBlocks.forEach((block, blockIndex) => {
            Logger.log(`\n  블록 ${blockIndex + 1}:`);
            Logger.log('  원본 내용:', block.origin?.content);
            Logger.log('  원본 위치:', `${block.origin?.beginOffset}-${block.origin?.beginOffset + block.origin?.length}`);
            Logger.log('  교정:', block.revised);
            Logger.log('  제안 수:', block.revisions?.length || 0);
            
            if (block.origin && block.revised && block.revisions) {
              const blockOriginalText = block.origin.content;
              
              // 빈 텍스트나 깨진 문자는 제외
              if (!blockOriginalText || blockOriginalText.trim().length === 0) {
                Logger.log('  -> 빈 텍스트로 건너뜀');
                return;
              }
              
              // 실제 원문에서 찾을 수 있는지 확인
              if (originalText.indexOf(blockOriginalText) === -1) {
                Logger.log('  -> 원본 텍스트에서 찾을 수 없어 건너뜀');
                return;
              }
              
              // 여러 수정 제안이 있을 경우 모두 포함
              const suggestions = block.revisions.map(rev => rev.revised);
              Logger.log('  제안들:', suggestions);
              
              // 중복 제거 및 원문과 다른 제안만 포함
              const uniqueSuggestions = [...new Set(suggestions)]
                .filter(s => {
                  const isValid = s !== blockOriginalText && 
                                 s.trim() !== blockOriginalText.trim() &&
                                 s.length > 0 &&
                                 !s.includes('�'); // 깨진 문자 제거
                  Logger.log(`    "${s}" 유효성:`, isValid);
                  return isValid;
                });
              
              Logger.log('  유효한 제안들:', uniqueSuggestions);
              
              // 한 글자 오류 필터링 적용
              const filteredSuggestions = this.applySingleCharFilter(
                blockOriginalText, 
                uniqueSuggestions, 
                settings.filterSingleCharErrors
              );
              
              Logger.log('  필터링된 제안들:', filteredSuggestions);
              
              // 유효한 제안이 있는 경우만 처리
              if (filteredSuggestions.length > 0) {
                // 이미 있는 교정이면 제안을 추가, 없으면 새로 생성
                if (correctionMap.has(blockOriginalText)) {
                  Logger.log('  -> 기존 교정에 제안 추가');
                  const existing = correctionMap.get(blockOriginalText)!;
                  // 새로운 제안들을 기존 제안들과 합치고 중복 제거
                  const combinedSuggestions = [...new Set([...existing.corrected, ...filteredSuggestions])];
                  correctionMap.set(blockOriginalText, {
                    ...existing,
                    corrected: combinedSuggestions
                  });
                  Logger.log('  -> 통합된 제안들:', combinedSuggestions);
                } else {
                  Logger.log('  -> 새 교정 생성');
                  correctionMap.set(blockOriginalText, {
                    original: blockOriginalText,
                    corrected: filteredSuggestions,
                    help: block.revisions[0]?.comment || "맞춤법 교정"
                  });
                  Logger.log('  -> 새 교정 제안들:', filteredSuggestions);
                }
              } else {
                Logger.log('  -> 유효한 제안이 없어 건너뜀');
              }
            }
          });
        }
      });
    }
    
    // Map에서 배열로 변환
    corrections.push(...correctionMap.values());
    
    Logger.log('\n=== 최종 교정 결과 ===');
    Logger.log('교정 맵 크기:', correctionMap.size);
    Logger.log('최종 교정 배열:', corrections);

    // 만약 교정된 텍스트는 있지만 세부 오류 정보가 없는 경우
    if (corrections.length === 0 && resultOutput !== originalText) {
      Logger.log('\n세부 정보가 없어 diff 로직 사용');
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
    }
    
    return { resultOutput, corrections };
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
      Logger.log('    한 글자 필터링 비활성화됨');
      return suggestions;
    }

    // 원본이 한 글자가 아니면 모든 제안 유지
    if (original.length !== 1) {
      Logger.log(`    원본이 한 글자가 아님 (${original.length}글자): "${original}"`);
      return suggestions;
    }

    Logger.log(`    한 글자 원본 감지: "${original}"`);

    // 의미있는 한 글자 교정인지 판단
    const meaningfulSuggestions = suggestions.filter(suggestion => {
      // 예외 케이스들
      const exceptions = this.checkSingleCharExceptions(original, suggestion);
      if (exceptions.isException) {
        Logger.log(`      "${suggestion}": 예외 처리됨 (${exceptions.reason})`);
        return true;
      }

      // 일반적으로 한 글자 교정은 필터링
      Logger.log(`      "${suggestion}": 한 글자 교정으로 필터링됨`);
      return false;
    });

    Logger.log(`    필터링 결과: ${suggestions.length} → ${meaningfulSuggestions.length}`);
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
}