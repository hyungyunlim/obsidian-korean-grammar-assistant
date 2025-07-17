import { AISettings, AIAnalysisRequest, AIAnalysisResult, Correction } from '../types/interfaces';
import { AIClientFactory } from '../api/clientFactory';
import { AI_PROMPTS } from '../constants/aiModels';

export class AIAnalysisService {
  constructor(private settings: AISettings) {}

  /**
   * AI를 사용하여 맞춤법 오류를 분석하고 최적의 수정사항을 제안합니다.
   */
  async analyzeCorrections(request: AIAnalysisRequest): Promise<AIAnalysisResult[]> {
    if (!this.settings.enabled) {
      throw new Error('AI 기능이 비활성화되어 있습니다.');
    }

    if (!AIClientFactory.hasValidApiKey(this.settings)) {
      throw new Error('AI API 키가 설정되지 않았습니다.');
    }

    const client = AIClientFactory.createClient(this.settings);
    
    try {
      const messages = [
        {
          role: 'system',
          content: AI_PROMPTS.analysisSystem
        },
        {
          role: 'user',
          content: AI_PROMPTS.analysisUser(request.originalText, request.corrections)
        }
      ];

      console.log('[AI] 분석 요청 전송 중...', {
        provider: this.settings.provider,
        model: this.settings.model,
        correctionsCount: request.corrections.length
      });

      const response = await client.chat(messages, this.settings.maxTokens, this.settings.model);
      
      console.log('[AI] 응답 수신:', response);

      return this.parseAIResponse(response, request.corrections);
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
      
      // JSON 응답 추출 (마크다운 코드 블록이나 다른 텍스트가 포함될 수 있음)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        // JSON 배열이 직접 있는 경우
        parsedResponse = JSON.parse(response);
      }

      const results: AIAnalysisResult[] = [];

      for (const item of parsedResponse) {
        const correctionIndex = parseInt(item.correctionIndex);
        
        // 유효성 검사
        if (isNaN(correctionIndex) || correctionIndex < 0 || correctionIndex >= corrections.length) {
          console.warn('[AI] 유효하지 않은 correctionIndex:', correctionIndex);
          continue;
        }

        const correction = corrections[correctionIndex];
        const selectedValue = item.selectedValue || '';
        
        // 선택된 값이 유효한 옵션인지 확인
        const validOptions = [...correction.corrected, correction.original];
        if (!validOptions.includes(selectedValue)) {
          console.warn('[AI] 유효하지 않은 선택값:', selectedValue, '가능한 옵션:', validOptions);
          continue;
        }

        results.push({
          correctionIndex,
          selectedValue,
          isExceptionProcessed: item.isExceptionProcessed || false,
          confidence: Math.max(0, Math.min(100, parseInt(item.confidence) || 0)),
          reasoning: item.reasoning || '이유가 제공되지 않았습니다.'
        });
      }

      return results;
    } catch (error) {
      console.error('[AI] 응답 파싱 오류:', error, '원본 응답:', response);
      throw new Error('AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.');
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
}