import { requestUrl } from 'obsidian';
import { AIClient } from '../types/interfaces';
import { API_ENDPOINTS, MODEL_PREFIXES } from '../constants/aiModels';
import { Logger } from '../utils/logger';

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
        
        Logger.log(`${models.length}개 모델을 가져왔습니다.`);
        return models;
      }
    } catch (error) {
      Logger.error('모델 목록 가져오기 실패:', error);
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

    if (!this.apiKey.startsWith('sk-')) {
      throw new Error('OpenAI API 키 형식이 올바르지 않습니다. "sk-"로 시작해야 합니다.');
    }

    Logger.log('chat 요청 시작:', {
      model: model,
      maxTokens: maxTokens,
      messagesCount: messages.length,
      apiKeyPrefix: this.apiKey.substring(0, 7) + '...'
    });

    const requestBody = {
      model: model,
      messages: messages,
      max_tokens: maxTokens,
      temperature: 0.1
    };

    Logger.log('요청 데이터:', {
      url: API_ENDPOINTS.openai.chat,
      model: model,
      messagesCount: messages.length,
      maxTokens: maxTokens,
      bodySize: JSON.stringify(requestBody).length
    });

    let response;
    try {
      response = await requestUrl({
        url: API_ENDPOINTS.openai.chat,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
    } catch (error) {
      Logger.error('requestUrl 오류:', error);
      Logger.error('요청 정보:', {
        url: API_ENDPOINTS.openai.chat,
        model: model,
        hasApiKey: !!this.apiKey,
        bodySize: JSON.stringify(requestBody).length
      });
      throw error;
    }

    if (response.status === 200) {
      return response.json.choices[0].message.content.trim();
    } else {
      Logger.error('API 응답 오류:', {
        status: response.status,
        text: response.text,
        json: response.json
      });
      throw new Error(`OpenAI API 오류: ${response.status} - ${response.text || JSON.stringify(response.json)}`);
    }
  }
}