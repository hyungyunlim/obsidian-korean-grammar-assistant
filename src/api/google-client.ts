import { requestUrl } from 'obsidian';
import { AIClient } from '../types/interfaces';
import { API_ENDPOINTS } from '../constants/aiModels';
import { Logger } from '../utils/logger';

export class GoogleClient implements AIClient {
  constructor(private apiKey: string) {}

  async chat(
    messages: Array<{role: string, content: string}>, 
    maxTokens: number, 
    model: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Google API 키가 설정되지 않았습니다.');
    }

    // Google AI는 다른 메시지 형식을 사용하고 system 메시지를 지원하지 않음
    // system 메시지가 있으면 첫 번째 user 메시지에 합침
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');
    
    if (systemMessage && userMessages.length > 0) {
      // system 메시지를 첫 번째 user 메시지에 합침
      userMessages[0].content = `${systemMessage.content}\n\n${userMessages[0].content}`;
    }
    
    const contents = userMessages.map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }));

    const response = await requestUrl({
      url: `${API_ENDPOINTS.google.generateContent(model)}?key=${this.apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.1
        }
      })
    });

    if (response.status === 200) {
      const candidate = response.json.candidates?.[0];
      if (candidate?.content?.parts?.[0]?.text) {
        return candidate.content.parts[0].text.trim();
      }
      Logger.error('[Google] API 응답 형식 오류:', response.json);
      throw new Error('Google API 응답 형식이 올바르지 않습니다.');
    } else {
      Logger.error('[Google] API 응답 오류:', {
        status: response.status,
        text: response.text,
        json: response.json
      });
      throw new Error(`Google API 오류: ${response.status} - ${response.text || JSON.stringify(response.json)}`);
    }
  }
}