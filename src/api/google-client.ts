import { requestUrl } from 'obsidian';
import { AIClient } from '../types/interfaces';
import { API_ENDPOINTS } from '../constants/aiModels';

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

    // Google AI는 다른 메시지 형식을 사용
    const contents = messages.map(message => ({
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
      throw new Error('Google API 응답 형식이 올바르지 않습니다.');
    } else {
      throw new Error(`Google API 오류: ${response.status} - ${response.text}`);
    }
  }
}