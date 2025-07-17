import { requestUrl } from 'obsidian';
import { AIClient } from '../types/interfaces';
import { API_ENDPOINTS, MODEL_PREFIXES } from '../constants/aiModels';

export class OpenAIClient implements AIClient {
  constructor(private apiKey: string) {}

  async fetchModels(): Promise<string[]> {
    if (!this.apiKey) {
      return [];
    }

    try {
      const response = await requestUrl({
        url: API_ENDPOINTS.openai.models,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 200) {
        const models = response.json.data
          .map((model: any) => model.id)
          .filter((id: string) => 
            MODEL_PREFIXES.openai.some(prefix => id.startsWith(prefix))
          )
          .sort();
        
        console.log(`[OpenAI] ${models.length}개 모델을 가져왔습니다.`);
        return models;
      }
    } catch (error) {
      console.error('[OpenAI] 모델 목록 가져오기 실패:', error);
    }
    
    return [];
  }

  async chat(
    messages: Array<{role: string, content: string}>, 
    maxTokens: number, 
    model: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenAI API 키가 설정되지 않았습니다.');
    }

    const response = await requestUrl({
      url: API_ENDPOINTS.openai.chat,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        temperature: 0.1
      })
    });

    if (response.status === 200) {
      return response.json.choices[0].message.content.trim();
    } else {
      throw new Error(`OpenAI API 오류: ${response.status} - ${response.text}`);
    }
  }
}