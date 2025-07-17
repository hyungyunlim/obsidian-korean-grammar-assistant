import { PluginSettings, Correction, SpellCheckResult } from '../types/interfaces';

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
    return this.parseBareunResults(data, text);
  }

  /**
   * Bareun.ai API 응답을 파싱하여 교정 정보를 추출합니다.
   * @param data API 응답 데이터
   * @param originalText 원본 텍스트
   * @returns 파싱된 결과
   */
  private parseBareunResults(data: BareunResponse, originalText: string): SpellCheckResult {
    const corrections: Correction[] = [];
    let resultOutput = data.revised || originalText;

    // revisedSentences에서 상세 오류 정보 추출
    const correctionMap = new Map<string, Correction>(); // 원문별로 교정 정보 통합
    
    console.log('=== Bareun API 응답 분석 ===');
    console.log('원본 텍스트:', originalText);
    console.log('교정된 텍스트:', data.revised);
    console.log('revisedSentences 수:', data.revisedSentences?.length || 0);
    
    if (data.revisedSentences && Array.isArray(data.revisedSentences)) {
      data.revisedSentences.forEach((sentence, sentenceIndex) => {
        console.log(`\n--- 문장 ${sentenceIndex + 1} ---`);
        console.log('원본 문장:', sentence.origin);
        console.log('교정된 문장:', sentence.revised);
        console.log('revisedBlocks 수:', sentence.revisedBlocks?.length || 0);
        
        if (sentence.revisedBlocks && Array.isArray(sentence.revisedBlocks)) {
          sentence.revisedBlocks.forEach((block, blockIndex) => {
            console.log(`\n  블록 ${blockIndex + 1}:`);
            console.log('  원본 내용:', block.origin?.content);
            console.log('  원본 위치:', `${block.origin?.beginOffset}-${block.origin?.beginOffset + block.origin?.length}`);
            console.log('  교정:', block.revised);
            console.log('  제안 수:', block.revisions?.length || 0);
            
            if (block.origin && block.revised && block.revisions) {
              const blockOriginalText = block.origin.content;
              
              // 빈 텍스트나 깨진 문자는 제외
              if (!blockOriginalText || blockOriginalText.trim().length === 0) {
                console.log('  -> 빈 텍스트로 건너뜀');
                return;
              }
              
              // 실제 원문에서 찾을 수 있는지 확인
              if (originalText.indexOf(blockOriginalText) === -1) {
                console.log('  -> 원본 텍스트에서 찾을 수 없어 건너뜀');
                return;
              }
              
              // 여러 수정 제안이 있을 경우 모두 포함
              const suggestions = block.revisions.map(rev => rev.revised);
              console.log('  제안들:', suggestions);
              
              // 중복 제거 및 원문과 다른 제안만 포함
              const uniqueSuggestions = [...new Set(suggestions)]
                .filter(s => {
                  const isValid = s !== blockOriginalText && 
                                 s.trim() !== blockOriginalText.trim() &&
                                 s.length > 0 &&
                                 !s.includes('�'); // 깨진 문자 제외
                  console.log(`    "${s}" 유효성:`, isValid);
                  return isValid;
                });
              
              console.log('  유효한 제안들:', uniqueSuggestions);
              
              // 유효한 제안이 있는 경우만 처리
              if (uniqueSuggestions.length > 0) {
                // 이미 있는 교정이면 제안을 추가, 없으면 새로 생성
                if (correctionMap.has(blockOriginalText)) {
                  console.log('  -> 기존 교정에 제안 추가');
                  const existing = correctionMap.get(blockOriginalText)!;
                  // 새로운 제안들을 기존 제안들과 합치고 중복 제거
                  const combinedSuggestions = [...new Set([...existing.corrected, ...uniqueSuggestions])];
                  correctionMap.set(blockOriginalText, {
                    ...existing,
                    corrected: combinedSuggestions
                  });
                  console.log('  -> 통합된 제안들:', combinedSuggestions);
                } else {
                  console.log('  -> 새 교정 생성');
                  correctionMap.set(blockOriginalText, {
                    original: blockOriginalText,
                    corrected: uniqueSuggestions,
                    help: block.revisions[0]?.comment || "맞춤법 교정"
                  });
                  console.log('  -> 새 교정 제안들:', uniqueSuggestions);
                }
              } else {
                console.log('  -> 유효한 제안이 없어 건너뜀');
              }
            }
          });
        }
      });
    }
    
    // Map에서 배열로 변환
    corrections.push(...correctionMap.values());
    
    console.log('\n=== 최종 교정 결과 ===');
    console.log('교정 맵 크기:', correctionMap.size);
    console.log('최종 교정 배열:', corrections);

    // 만약 교정된 텍스트는 있지만 세부 오류 정보가 없는 경우
    if (corrections.length === 0 && resultOutput !== originalText) {
      console.log('\n세부 정보가 없어 diff 로직 사용');
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
}