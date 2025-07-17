import { requestUrl } from 'obsidian';
import { AIClient } from '../types/interfaces';

export class OllamaClient implements AIClient {
  constructor(private endpoint: string) {}

  async chat(
    messages: Array<{role: string, content: string}>, 
    maxTokens: number, 
    model: string
  ): Promise<string> {
    if (!this.endpoint) {
      throw new Error('Ollama 엔드포인트가 설정되지 않았습니다.');
    }

    // Ollama 형식으로 메시지 변환
    let prompt = '';
    messages.forEach(message => {
      if (message.role === 'system') {
        prompt += `System: ${message.content}\n\n`;
      } else if (message.role === 'user') {
        prompt += `Human: ${message.content}\n\n`;
      } else if (message.role === 'assistant') {
        prompt += `Assistant: ${message.content}\n\n`;
      }
    });
    prompt += 'Assistant: ';

    const response = await requestUrl({
      url: `${this.endpoint}/api/generate`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        options: {
          num_predict: maxTokens,
          temperature: 0.1
        },
        stream: false
      })
    });

    if (response.status === 200) {
      return response.json.response.trim();
    } else {
      throw new Error(`Ollama API 오류: ${response.status} - ${response.text}`);
    }
  }
}