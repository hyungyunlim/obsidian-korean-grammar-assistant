import { PluginSettings } from '../types/interfaces';
import { DEFAULT_AI_SETTINGS } from '../constants/aiModels';

/**
 * API 설정 파일에서 기본값 로드 (로컬 개발용)
 */
function loadApiConfig(): PluginSettings {
  try {
    // Node.js 환경에서만 작동 (개발 시)
    if (typeof require !== 'undefined') {
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(__dirname, '../../api-config.json');
      
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('로컬 API 설정 파일을 로드했습니다.');
        return config;
      }
    }
  } catch (error) {
    console.log('로컬 API 설정 파일을 로드할 수 없습니다. 기본값을 사용합니다.');
  }
  
  // 기본값 (배포용)
  return {
    apiKey: '', // 사용자가 직접 입력해야 함
    apiHost: 'bareun-api.junlim.org',
    apiPort: 443,
    ignoredWords: [],
    ai: DEFAULT_AI_SETTINGS
  };
}

/**
 * 기본 플러그인 설정
 */
export const DEFAULT_SETTINGS: PluginSettings = loadApiConfig();

/**
 * 설정 관리 서비스
 */
export class SettingsService {
  /**
   * 설정 유효성을 검사합니다.
   * @param settings 검사할 설정
   * @returns 유효성 검사 결과
   */
  static validateSettings(settings: PluginSettings): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!settings.apiKey || settings.apiKey.trim() === '') {
      errors.push('API 키가 설정되지 않았습니다.');
    }

    if (!settings.apiHost || settings.apiHost.trim() === '') {
      errors.push('API 호스트가 설정되지 않았습니다.');
    }

    if (!settings.apiPort || settings.apiPort <= 0 || settings.apiPort > 65535) {
      errors.push('유효하지 않은 포트 번호입니다.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 설정을 기본값과 병합합니다.
   * @param userSettings 사용자 설정
   * @returns 병합된 설정
   */
  static mergeWithDefaults(userSettings: Partial<PluginSettings>): PluginSettings {
    // 깊은 병합을 위해 AI 설정을 별도로 처리
    const mergedSettings = Object.assign({}, DEFAULT_SETTINGS, userSettings);
    
    // AI 설정이 있으면 기본값과 병합
    if (userSettings.ai) {
      mergedSettings.ai = Object.assign({}, DEFAULT_AI_SETTINGS, userSettings.ai);
    } else {
      mergedSettings.ai = Object.assign({}, DEFAULT_AI_SETTINGS);
    }
    
    return mergedSettings;
  }

  /**
   * API 엔드포인트 URL을 생성합니다.
   * @param settings 플러그인 설정
   * @returns API URL
   */
  static buildApiUrl(settings: PluginSettings): string {
    const protocol = settings.apiPort === 443 ? 'https' : 'http';
    const port = (settings.apiPort === 443 || settings.apiPort === 80) ? '' : `:${settings.apiPort}`;
    return `${protocol}://${settings.apiHost}${port}/bareun/api/v1/correct-error`;
  }
}