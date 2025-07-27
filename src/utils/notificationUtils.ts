import { Notice } from 'obsidian';
import { Logger } from './logger';

/**
 * 알림창 관련 공통 유틸리티 함수들
 */
export class NotificationUtils {
  
  /**
   * API 분석 시작 알림을 표시합니다.
   */
  static showAnalysisStartNotice(analysisType: 'spelling' | 'morpheme' | 'ai' = 'spelling'): Notice {
    const messages = {
      spelling: '🔍 맞춤법 검사 중...',
      morpheme: '📋 형태소 분석 중...',
      ai: '🤖 AI 분석 중...'
    };
    
    const message = messages[analysisType];
    Logger.log(`알림 표시: ${message}`);
    
    return new Notice(message, 0); // 0 = 자동으로 사라지지 않음
  }

  /**
   * API 분석 완료 알림을 표시합니다.
   */
  static showAnalysisCompleteNotice(
    analysisType: 'spelling' | 'morpheme' | 'ai',
    resultCount: number,
    duration: number = 3000
  ): Notice {
    let message: string;
    
    switch (analysisType) {
      case 'spelling':
        message = resultCount > 0 
          ? `✅ 맞춤법 검사 완료: ${resultCount}개 오류 발견`
          : '✅ 맞춤법 검사 완료: 오류 없음';
        break;
      case 'morpheme':
        message = `📋 형태소 분석 완료: ${resultCount}개 토큰 분석`;
        break;
      case 'ai':
        message = `🤖 AI 분석 완료: ${resultCount}개 제안 분석`;
        break;
    }
    
    Logger.log(`알림 표시: ${message}`);
    return new Notice(message, duration);
  }

  /**
   * API 오류 알림을 표시합니다.
   */
  static showApiErrorNotice(
    errorType: 'api_key' | 'network' | 'timeout' | 'parse' | 'general',
    errorMessage?: string,
    duration: number = 5000
  ): Notice {
    let message: string;
    
    switch (errorType) {
      case 'api_key':
        message = '❌ API 키가 설정되지 않았습니다. 플러그인 설정에서 Bareun.ai API 키를 입력해주세요.';
        break;
      case 'network':
        message = '❌ 네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.';
        break;
      case 'timeout':
        message = '❌ API 요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.';
        break;
      case 'parse':
        message = '❌ API 응답 파싱에 실패했습니다. 잠시 후 다시 시도해주세요.';
        break;
      case 'general':
      default:
        message = errorMessage 
          ? `❌ API 요청에 실패했습니다: ${errorMessage}`
          : '❌ 알 수 없는 오류가 발생했습니다.';
        break;
    }
    
    Logger.error(`오류 알림 표시: ${message}`);
    return new Notice(message, duration);
  }

  /**
   * 중복 제거 결과 알림을 표시합니다.
   */
  static showDuplicateRemovalNotice(
    originalCount: number,
    finalCount: number,
    usedMorpheme: boolean = false,
    duration: number = 2000
  ): Notice {
    const removedCount = originalCount - finalCount;
    
    if (removedCount <= 0) {
      return new Notice('ℹ️ 중복 오류 없음', duration);
    }
    
    // 형태소 분석 여부에 따른 메시지 차별화
    let message: string;
    if (usedMorpheme) {
      message = `🔄 중복 오류 ${removedCount}개 제거됨 (형태소 분석 활용)`;
    } else {
      message = `🔄 중복 오류 ${removedCount}개 제거됨`;
    }
    
    Logger.log(`중복 제거 알림: ${originalCount}개 → ${finalCount}개 (형태소: ${usedMorpheme})`);
    return new Notice(message, duration);
  }

  /**
   * 캐시 사용 알림을 표시합니다.
   */
  static showCacheUsedNotice(
    cacheType: 'spelling' | 'morpheme',
    duration: number = 2000
  ): Notice {
    const messages = {
      spelling: '⚡ 캐시된 맞춤법 검사 결과 사용',
      morpheme: '⚡ 캐시된 형태소 분석 결과 사용'
    };
    
    const message = messages[cacheType];
    Logger.debug(`캐시 사용 알림: ${message}`);
    
    return new Notice(message, duration);
  }

  /**
   * 인라인 모드 전용: 오류 적용 알림을 표시합니다.
   */
  static showInlineErrorAppliedNotice(
    errorText: string,
    correctedText: string,
    duration: number = 2000
  ): Notice {
    const message = `✅ "${errorText}" → "${correctedText}" 적용됨`;
    Logger.log(`인라인 오류 적용: ${message}`);
    
    return new Notice(message, duration);
  }

  /**
   * 인라인 모드 전용: 예외 처리 알림을 표시합니다.
   */
  static showInlineExceptionNotice(
    errorText: string,
    duration: number = 2000
  ): Notice {
    const message = `🔵 "${errorText}" 예외 처리됨`;
    Logger.log(`인라인 예외 처리: ${message}`);
    
    return new Notice(message, duration);
  }

  /**
   * 기존 Notice를 업데이트합니다 (진행률 표시용).
   */
  static updateNoticeMessage(notice: Notice, newMessage: string): void {
    if (notice && notice.noticeEl) {
      const messageEl = notice.noticeEl.querySelector('.notice-message');
      if (messageEl) {
        messageEl.textContent = newMessage;
      }
    }
  }

  /**
   * Notice를 안전하게 숨깁니다.
   */
  static hideNotice(notice: Notice | null): void {
    if (notice && notice.hide) {
      try {
        notice.hide();
      } catch (error) {
        Logger.debug('Notice 숨김 실패 (이미 제거됨):', error);
      }
    }
  }
}