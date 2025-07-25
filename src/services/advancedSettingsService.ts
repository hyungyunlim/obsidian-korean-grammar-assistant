import { PluginSettings } from '../types/interfaces';
import { DEFAULT_INLINE_MODE_SETTINGS } from './settings';
import { Logger } from '../utils/logger';

/**
 * 설정 유효성 검사 결과 인터페이스
 */
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * 설정 백업 정보 인터페이스
 */
interface SettingsBackup {
  timestamp: number;
  version: string;
  settings: PluginSettings;
  reason: string;
}

/**
 * 설정 프로파일 인터페이스
 */
interface SettingsProfile {
  id: string;
  name: string;
  description: string;
  settings: Partial<PluginSettings>;
  isDefault: boolean;
  createdAt: number;
  lastUsed: number;
}

/**
 * 설정 변경 히스토리 인터페이스
 */
interface SettingsChange {
  timestamp: number;
  field: string;
  oldValue: any;
  newValue: any;
  reason?: string;
}

/**
 * 고급 설정 관리 서비스
 * 설정 검증, 백업/복원, 프로파일 관리, 변경 히스토리 추적 기능 제공
 */
export class AdvancedSettingsService {
  private static readonly MAX_BACKUPS = 10;
  private static readonly MAX_HISTORY = 100;
  private static backups: SettingsBackup[] = [];
  private static profiles: SettingsProfile[] = [];
  private static changeHistory: SettingsChange[] = [];

  /**
   * 설정을 포괄적으로 검증합니다
   */
  static validateSettings(settings: PluginSettings): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: []
    };

    // API 키 검증
    if (!settings.apiKey || settings.apiKey.trim() === '') {
      result.errors.push('API 키가 설정되지 않았습니다');
      result.isValid = false;
    } else if (settings.apiKey.length < 10) {
      result.warnings.push('API 키가 너무 짧습니다. 올바른 키인지 확인해주세요');
    }

    // API 호스트 검증
    if (!settings.apiHost || settings.apiHost.trim() === '') {
      result.errors.push('API 호스트가 설정되지 않았습니다');
      result.isValid = false;
    } else {
      try {
        new URL(`https://${settings.apiHost}`);
      } catch {
        result.errors.push('API 호스트 형식이 올바르지 않습니다');
        result.isValid = false;
      }
    }

    // API 포트 검증
    if (settings.apiPort < 1 || settings.apiPort > 65535) {
      result.errors.push('API 포트는 1-65535 범위여야 합니다');
      result.isValid = false;
    }

    // AI 설정 검증
    if (settings.ai) {
      if (settings.ai.enabled) {
        // 최소 하나의 API 키는 있어야 함
        const hasApiKey = settings.ai.openaiApiKey || 
                         settings.ai.anthropicApiKey || 
                         settings.ai.googleApiKey ||
                         settings.ai.ollamaEndpoint;
        
        if (!hasApiKey) {
          result.errors.push('AI 기능이 활성화되었지만 사용 가능한 API 키가 없습니다');
          result.isValid = false;
        }

        // 토큰 수 검증
        if (settings.ai.maxTokens < 100) {
          result.warnings.push('최대 토큰 수가 너무 적습니다. 복잡한 분석에 제한이 있을 수 있습니다');
        } else if (settings.ai.maxTokens > 8000) {
          result.warnings.push('최대 토큰 수가 매우 큽니다. 비용이 많이 발생할 수 있습니다');
        }

        // 프로바이더별 검증
        if (settings.ai.provider === 'ollama' && !settings.ai.ollamaEndpoint) {
          result.errors.push('Ollama 프로바이더 선택 시 엔드포인트가 필요합니다');
          result.isValid = false;
        }
      }
    }

    // 예외 단어 검증
    if (settings.ignoredWords && settings.ignoredWords.length > 1000) {
      result.warnings.push(`예외 단어가 ${settings.ignoredWords.length}개로 매우 많습니다. 성능에 영향을 줄 수 있습니다`);
    }

    // 성능 최적화 제안
    if (settings.ignoredWords && settings.ignoredWords.length > 100) {
      result.suggestions.push('예외 단어가 많습니다. 정기적으로 불필요한 단어를 정리하는 것을 권장합니다');
    }

    if (settings.ai && settings.ai.enabled && settings.ai.maxTokens > 4000) {
      result.suggestions.push('AI 토큰 수를 줄이면 응답 속도가 향상됩니다');
    }

    Logger.debug('설정 검증 완료:', {
      isValid: result.isValid,
      errorsCount: result.errors.length,
      warningsCount: result.warnings.length
    });

    return result;
  }

  /**
   * 설정을 백업합니다
   */
  static backupSettings(settings: PluginSettings, reason: string = '수동 백업'): void {
    const backup: SettingsBackup = {
      timestamp: Date.now(),
      version: '0.2.0', // 현재 플러그인 버전
      settings: JSON.parse(JSON.stringify(settings)), // 깊은 복사
      reason
    };

    this.backups.unshift(backup);

    // 최대 백업 수 유지
    if (this.backups.length > this.MAX_BACKUPS) {
      this.backups = this.backups.slice(0, this.MAX_BACKUPS);
    }

    Logger.debug('설정 백업 생성:', { reason, backupCount: this.backups.length });
  }

  /**
   * 백업에서 설정을 복원합니다
   */
  static restoreSettings(backupIndex: number): PluginSettings | null {
    if (backupIndex < 0 || backupIndex >= this.backups.length) {
      Logger.error('잘못된 백업 인덱스:', { backupIndex, availableBackups: this.backups.length });
      return null;
    }

    const backup = this.backups[backupIndex];
    const restoredSettings = JSON.parse(JSON.stringify(backup.settings));

    Logger.debug('설정 복원:', { 
      backupTimestamp: new Date(backup.timestamp).toISOString(),
      reason: backup.reason 
    });

    return restoredSettings;
  }

  /**
   * 백업 목록을 반환합니다
   */
  static getBackups(): Array<{
    index: number;
    timestamp: string;
    reason: string;
    version: string;
    age: string;
  }> {
    return this.backups.map((backup, index) => ({
      index,
      timestamp: new Date(backup.timestamp).toLocaleString(),
      reason: backup.reason,
      version: backup.version,
      age: this.formatAge(Date.now() - backup.timestamp)
    }));
  }

  /**
   * 설정 프로파일을 생성합니다
   */
  static createProfile(
    name: string, 
    description: string, 
    settings: Partial<PluginSettings>
  ): string {
    const profile: SettingsProfile = {
      id: this.generateId(),
      name: name.trim(),
      description: description.trim(),
      settings: JSON.parse(JSON.stringify(settings)),
      isDefault: false,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };

    this.profiles.push(profile);

    Logger.debug('설정 프로파일 생성:', { name, id: profile.id });
    return profile.id;
  }

  /**
   * 설정 프로파일을 적용합니다
   */
  static applyProfile(profileId: string, currentSettings: PluginSettings): PluginSettings {
    const profile = this.profiles.find(p => p.id === profileId);
    if (!profile) {
      Logger.error('프로파일을 찾을 수 없음:', { profileId });
      return currentSettings;
    }

    // 프로파일 설정을 현재 설정에 병합
    const mergedSettings = this.mergeSettings(currentSettings, profile.settings);
    
    // 사용 시간 업데이트
    profile.lastUsed = Date.now();

    Logger.debug('설정 프로파일 적용:', { name: profile.name, id: profileId });
    return mergedSettings;
  }

  /**
   * 프로파일 목록을 반환합니다
   */
  static getProfiles(): Array<{
    id: string;
    name: string;
    description: string;
    isDefault: boolean;
    createdAt: string;
    lastUsed: string;
  }> {
    return this.profiles.map(profile => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      isDefault: profile.isDefault,
      createdAt: new Date(profile.createdAt).toLocaleString(),
      lastUsed: new Date(profile.lastUsed).toLocaleString()
    }));
  }

  /**
   * 프로파일을 삭제합니다
   */
  static deleteProfile(profileId: string): boolean {
    const index = this.profiles.findIndex(p => p.id === profileId);
    if (index === -1) {
      return false;
    }

    const profile = this.profiles[index];
    if (profile.isDefault) {
      Logger.debug('기본 프로파일은 삭제할 수 없습니다:', { profileId });
      return false;
    }

    this.profiles.splice(index, 1);
    Logger.debug('설정 프로파일 삭제:', { name: profile.name, id: profileId });
    return true;
  }

  /**
   * 설정 변경을 추적합니다
   */
  static trackChange(field: string, oldValue: any, newValue: any, reason?: string): void {
    const change: SettingsChange = {
      timestamp: Date.now(),
      field,
      oldValue: JSON.parse(JSON.stringify(oldValue)),
      newValue: JSON.parse(JSON.stringify(newValue)),
      reason
    };

    this.changeHistory.unshift(change);

    // 최대 히스토리 크기 유지
    if (this.changeHistory.length > this.MAX_HISTORY) {
      this.changeHistory = this.changeHistory.slice(0, this.MAX_HISTORY);
    }

    Logger.debug('설정 변경 추적:', { field, reason });
  }

  /**
   * 변경 히스토리를 반환합니다
   */
  static getChangeHistory(limit: number = 20): Array<{
    timestamp: string;
    field: string;
    oldValue: string;
    newValue: string;
    reason?: string;
    age: string;
  }> {
    return this.changeHistory.slice(0, limit).map(change => ({
      timestamp: new Date(change.timestamp).toLocaleString(),
      field: change.field,
      oldValue: this.stringifyValue(change.oldValue),
      newValue: this.stringifyValue(change.newValue),
      reason: change.reason,
      age: this.formatAge(Date.now() - change.timestamp)
    }));
  }

  /**
   * 설정을 기본값으로 재설정합니다
   */
  static resetToDefaults(currentSettings: PluginSettings): PluginSettings {
    // 현재 설정을 백업
    this.backupSettings(currentSettings, '기본값 재설정 전 백업');

    // 기본 설정 반환 (실제 기본값들)
    const defaultSettings: PluginSettings = {
      apiKey: '',
      apiHost: 'bareun-api.junlim.org',
      apiPort: 443,
      ignoredWords: [],
      ai: {
        enabled: false,
        provider: 'openai',
        openaiApiKey: '',
        anthropicApiKey: '',
        googleApiKey: '',
        ollamaEndpoint: 'http://localhost:11434',
        model: 'gpt-4o-mini',
        maxTokens: 2000,
        temperature: 0.3,
        showTokenWarning: true,
        tokenWarningThreshold: 1500
      },
      filterSingleCharErrors: true,
      inlineMode: DEFAULT_INLINE_MODE_SETTINGS
    };

    Logger.debug('설정을 기본값으로 재설정');
    return defaultSettings;
  }

  /**
   * 설정을 내보냅니다 (JSON 형태)
   */
  static exportSettings(settings: PluginSettings): string {
    const exportData = {
      version: '0.2.0',
      timestamp: Date.now(),
      settings: settings,
      metadata: {
        exportedBy: 'Korean Grammar Assistant',
        platform: navigator.platform,
        userAgent: navigator.userAgent.substring(0, 100)
      }
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 설정을 가져옵니다 (JSON에서)
   */
  static importSettings(jsonData: string): { success: boolean; settings?: PluginSettings; error?: string } {
    try {
      const importData = JSON.parse(jsonData);
      
      // 기본 유효성 검사
      if (!importData.settings) {
        return { success: false, error: '유효하지 않은 설정 파일입니다' };
      }

      const settings = importData.settings as PluginSettings;
      const validation = this.validateSettings(settings);

      if (!validation.isValid) {
        return { 
          success: false, 
          error: `설정 유효성 검사 실패: ${validation.errors.join(', ')}` 
        };
      }

      Logger.debug('설정 가져오기 성공:', { version: importData.version });
      return { success: true, settings };

    } catch (error) {
      Logger.error('설정 가져오기 실패:', error);
      return { success: false, error: '설정 파일을 파싱할 수 없습니다' };
    }
  }

  /**
   * 성능 최적화 제안을 생성합니다
   */
  static getOptimizationSuggestions(settings: PluginSettings): Array<{
    type: 'performance' | 'cost' | 'usability';
    title: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    action: string;
  }> {
    const suggestions = [];

    // AI 관련 최적화
    if (settings.ai?.enabled) {
      if (settings.ai.maxTokens > 4000) {
        suggestions.push({
          type: 'cost' as const,
          title: 'AI 토큰 수 최적화',
          description: '높은 토큰 수는 비용 증가와 응답 지연을 일으킬 수 있습니다',
          impact: 'medium' as const,
          action: '토큰 수를 2000-3000으로 조정하는 것을 권장합니다'
        });
      }

      if (!settings.ai.openaiApiKey && !settings.ai.anthropicApiKey && 
          !settings.ai.googleApiKey && !settings.ai.ollamaEndpoint) {
        suggestions.push({
          type: 'usability' as const,
          title: 'AI API 키 설정',
          description: 'AI 기능이 활성화되었지만 사용 가능한 API 키가 없습니다',
          impact: 'high' as const,
          action: '최소 하나의 AI 서비스 API 키를 설정해주세요'
        });
      }
    }

    // 예외 단어 최적화
    if (settings.ignoredWords.length > 500) {
      suggestions.push({
        type: 'performance' as const,
        title: '예외 단어 정리',
        description: '너무 많은 예외 단어는 검사 성능을 저하시킬 수 있습니다',
        impact: 'medium' as const,
        action: '불필요한 예외 단어를 정리하는 것을 권장합니다'
      });
    }

    return suggestions;
  }

  /**
   * 설정을 병합합니다
   */
  private static mergeSettings(base: PluginSettings, override: Partial<PluginSettings>): PluginSettings {
    const merged = JSON.parse(JSON.stringify(base));
    
    Object.keys(override).forEach(key => {
      const value = (override as any)[key];
      if (value !== undefined) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // 객체는 재귀적으로 병합
          (merged as any)[key] = { ...(merged as any)[key], ...value };
        } else {
          // 원시값과 배열은 직접 할당
          (merged as any)[key] = value;
        }
      }
    });

    return merged;
  }

  /**
   * 고유 ID를 생성합니다
   */
  private static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * 값을 문자열로 변환합니다
   */
  private static stringifyValue(value: any): string {
    if (typeof value === 'string') {
      return value.length > 50 ? value.substring(0, 50) + '...' : value;
    }
    
    if (Array.isArray(value)) {
      return `배열 (${value.length}개 항목)`;
    }
    
    if (typeof value === 'object' && value !== null) {
      return `객체 (${Object.keys(value).length}개 속성)`;
    }
    
    return String(value);
  }

  /**
   * 시간 차이를 포맷합니다
   */
  private static formatAge(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}일 전`;
    if (hours > 0) return `${hours}시간 전`;
    if (minutes > 0) return `${minutes}분 전`;
    return `${seconds}초 전`;
  }
}