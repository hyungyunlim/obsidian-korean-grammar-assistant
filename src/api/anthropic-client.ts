import { requestUrl } from 'obsidian';
import { AIClient } from '../types/interfaces';
import { API_ENDPOINTS } from '../constants/aiModels';

export class AnthropicClient implements AIClient {
  constructor(private apiKey: string) {}

  async chat(
    messages: Array<{role: string, content: string}>, 
    maxTokens: number, 
    model: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Anthropic API 키가 설정되지 않았습니다.');
    }

    // Anthropic API는 system 메시지를 별도로 처리
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');

    const response = await requestUrl({
      url: API_ENDPOINTS.anthropic.messages,
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        temperature: 0.1,
        system: systemMessage?.content || '',
        messages: userMessages
      })
    });

    if (response.status === 200) {
      return response.json.content[0].text.trim();
    } else {
      console.error('[Anthropic] API 응답 오류:', {
        status: response.status,
        text: response.text,
        json: response.json
      });
      throw new Error(`Anthropic API 오류: ${response.status} - ${response.text || JSON.stringify(response.json)}`);
    }
  }
}