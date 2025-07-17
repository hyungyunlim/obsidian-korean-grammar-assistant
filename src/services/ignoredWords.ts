import { PluginSettings } from '../types/interfaces';

/**
 * 예외 처리된 단어 관리 서비스
 */
export class IgnoredWordsService {
  /**
   * 단어가 예외 처리되었는지 확인합니다.
   * @param word 확인할 단어
   * @param settings 플러그인 설정
   * @returns 예외 처리 여부
   */
  static isWordIgnored(word: string, settings: PluginSettings): boolean {
    return settings.ignoredWords.includes(word.trim());
  }

  /**
   * 단어를 예외 처리 목록에 추가합니다.
   * @param word 추가할 단어
   * @param settings 플러그인 설정
   * @returns 업데이트된 설정
   */
  static addIgnoredWord(word: string, settings: PluginSettings): PluginSettings {
    const trimmedWord = word.trim();
    
    if (!trimmedWord || this.isWordIgnored(trimmedWord, settings)) {
      return settings; // 이미 존재하거나 빈 문자열인 경우 변경하지 않음
    }

    return {
      ...settings,
      ignoredWords: [...settings.ignoredWords, trimmedWord].sort()
    };
  }

  /**
   * 단어를 예외 처리 목록에서 제거합니다.
   * @param word 제거할 단어
   * @param settings 플러그인 설정
   * @returns 업데이트된 설정
   */
  static removeIgnoredWord(word: string, settings: PluginSettings): PluginSettings {
    const trimmedWord = word.trim();
    
    return {
      ...settings,
      ignoredWords: settings.ignoredWords.filter(w => w !== trimmedWord)
    };
  }

  /**
   * 예외 처리된 단어 목록을 가져옵니다.
   * @param settings 플러그인 설정
   * @returns 예외 처리된 단어 배열
   */
  static getIgnoredWords(settings: PluginSettings): string[] {
    return [...settings.ignoredWords].sort();
  }

  /**
   * 예외 처리된 단어 수를 가져옵니다.
   * @param settings 플러그인 설정
   * @returns 예외 처리된 단어 수
   */
  static getIgnoredWordsCount(settings: PluginSettings): number {
    return settings.ignoredWords.length;
  }

  /**
   * 모든 예외 처리된 단어를 제거합니다.
   * @param settings 플러그인 설정
   * @returns 업데이트된 설정
   */
  static clearAllIgnoredWords(settings: PluginSettings): PluginSettings {
    return {
      ...settings,
      ignoredWords: []
    };
  }

  /**
   * 단어 목록을 일괄 추가합니다.
   * @param words 추가할 단어 배열
   * @param settings 플러그인 설정
   * @returns 업데이트된 설정
   */
  static addMultipleIgnoredWords(words: string[], settings: PluginSettings): PluginSettings {
    const newWords = words
      .map(word => word.trim())
      .filter(word => word && !this.isWordIgnored(word, settings));

    if (newWords.length === 0) {
      return settings;
    }

    return {
      ...settings,
      ignoredWords: [...settings.ignoredWords, ...newWords].sort()
    };
  }

  /**
   * 예외 처리된 단어를 검색합니다.
   * @param query 검색어
   * @param settings 플러그인 설정
   * @returns 검색 결과
   */
  static searchIgnoredWords(query: string, settings: PluginSettings): string[] {
    const trimmedQuery = query.trim().toLowerCase();
    
    if (!trimmedQuery) {
      return this.getIgnoredWords(settings);
    }

    return settings.ignoredWords
      .filter(word => word.toLowerCase().includes(trimmedQuery))
      .sort();
  }

  /**
   * 예외 처리된 단어를 문자열로 내보냅니다.
   * @param settings 플러그인 설정
   * @param separator 구분자 (기본값: ', ')
   * @returns 예외 처리된 단어들을 구분자로 연결한 문자열
   */
  static exportIgnoredWords(settings: PluginSettings, separator: string = ', '): string {
    return this.getIgnoredWords(settings).join(separator);
  }

  /**
   * 문자열에서 예외 처리된 단어를 가져와 일괄 추가합니다.
   * @param wordsString 단어들이 포함된 문자열
   * @param separator 구분자 (기본값: ',')
   * @param settings 플러그인 설정
   * @returns 업데이트된 설정
   */
  static importIgnoredWords(
    wordsString: string, 
    separator: string = ',', 
    settings: PluginSettings
  ): PluginSettings {
    const words = wordsString
      .split(separator)
      .map(word => word.trim())
      .filter(word => word);

    return this.addMultipleIgnoredWords(words, settings);
  }
}