import { AIClient, AISettings } from '../types/interfaces';
import { OpenAIClient } from './openai-client';
import { AnthropicClient } from './anthropic-client';
import { GoogleClient } from './google-client';
import { OllamaClient } from './ollama-client';

export class AIClientFactory {
  static createClient(settings: AISettings): AIClient {
    const provider = settings.provider;
    const apiKey = this.getApiKey(settings);
    
    console.log('[ClientFactory] 클라이언트 생성:', {
      provider: provider,
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey ? apiKey.length : 0,
      model: settings.model
    });
    
    switch (provider) {
      case 'openai':
        return new OpenAIClient(settings.openaiApiKey);
      case 'anthropic':
        return new AnthropicClient(settings.anthropicApiKey);
      case 'google':
        return new GoogleClient(settings.googleApiKey);
      case 'ollama':
        return new OllamaClient(settings.ollamaEndpoint);
      default:
        throw new Error(`지원하지 않는 AI 제공자입니다: ${provider}`);
    }
  }

  static async fetchModels(settings: AISettings): Promise<string[]> {
    const client = this.createClient(settings);
    
    // Ollama와 Anthropic은 모델 목록 가져오기를 지원하지 않음
    if (settings.provider === 'ollama' || settings.provider === 'anthropic') {
      return [];
    }

    if (!client.fetchModels) {
      return [];
    }

    try {
      return await client.fetchModels();
    } catch (error) {
      console.error(`[${settings.provider}] 모델 목록 가져오기 실패:`, error);
      return [];
    }
  }

  static getApiKey(settings: AISettings): string {
    switch (settings.provider) {
      case 'openai':
        return settings.openaiApiKey;
      case 'anthropic':
        return settings.anthropicApiKey;
      case 'google':
        return settings.googleApiKey;
      case 'ollama':
        return ''; // Ollama는 API 키가 필요 없음
      default:
        return '';
    }
  }

  static hasValidApiKey(settings: AISettings): boolean {
    if (settings.provider === 'ollama') {
      return !!settings.ollamaEndpoint;
    }
    return !!this.getApiKey(settings);
  }
}