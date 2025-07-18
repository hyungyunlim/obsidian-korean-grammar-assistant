import { Notice } from 'obsidian';
import { Logger } from '../utils/logger';

/**
 * 에러 타입 분류
 */
export type ErrorType = 
  | 'NETWORK_ERROR'
  | 'API_KEY_ERROR' 
  | 'API_RATE_LIMIT'
  | 'API_SERVER_ERROR'
  | 'TIMEOUT_ERROR'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * 에러 정보 인터페이스
 */
interface ErrorInfo {
  type: ErrorType;
  message: string;
  userMessage: string;
  suggestion?: string;
  retryable: boolean;
  details?: any;
}

/**
 * 재시도 설정 인터페이스
 */
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

/**
 * 고급 에러 핸들링 서비스
 * 에러 분류, 사용자 친화적 메시지, 자동 재시도 기능 제공
 */
export class ErrorHandlerService {
  private static readonly DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2
  };

  private static retryCount = new Map<string, number>();

  /**
   * 에러를 분석하고 적절한 대응 방안을 제공합니다
   */
  static analyzeError(error: any, context?: string): ErrorInfo {
    Logger.error('에러 분석 시작:', { error, context });

    // 네트워크 에러
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return {
        type: 'NETWORK_ERROR',
        message: 'Network request failed',
        userMessage: '인터넷 연결을 확인해주세요',
        suggestion: '네트워크 상태를 확인하고 다시 시도해주세요.',
        retryable: true,
        details: error
      };
    }

    // API 키 에러
    if (error.message?.includes('API 키') || error.message?.includes('api-key')) {
      return {
        type: 'API_KEY_ERROR',
        message: 'Invalid API key',
        userMessage: 'API 키가 올바르지 않습니다',
        suggestion: '플러그인 설정에서 올바른 Bareun.ai API 키를 입력해주세요.',
        retryable: false,
        details: error
      };
    }

    // HTTP 상태 코드 기반 분류
    if (error.message?.includes('API 요청 실패')) {
      const statusMatch = error.message.match(/(\d{3})/);
      const status = statusMatch ? parseInt(statusMatch[1]) : 0;

      switch (Math.floor(status / 100)) {
        case 4:
          if (status === 401 || status === 403) {
            return {
              type: 'API_KEY_ERROR',
              message: `Authentication failed: ${status}`,
              userMessage: 'API 키 인증에 실패했습니다',
              suggestion: 'API 키가 올바른지 확인하고, 만료되지 않았는지 확인해주세요.',
              retryable: false,
              details: { status, error }
            };
          } else if (status === 429) {
            return {
              type: 'API_RATE_LIMIT',
              message: 'Rate limit exceeded',
              userMessage: 'API 사용량 한도를 초과했습니다',
              suggestion: '잠시 후 다시 시도해주세요. 너무 많은 요청을 보내고 있습니다.',
              retryable: true,
              details: { status, error }
            };
          } else {
            return {
              type: 'API_SERVER_ERROR',
              message: `Client error: ${status}`,
              userMessage: '요청이 올바르지 않습니다',
              suggestion: '텍스트 내용을 확인하고 다시 시도해주세요.',
              retryable: false,
              details: { status, error }
            };
          }

        case 5:
          return {
            type: 'API_SERVER_ERROR',
            message: `Server error: ${status}`,
            userMessage: '서버에 일시적인 문제가 발생했습니다',
            suggestion: '잠시 후 다시 시도해주세요. 문제가 계속되면 Bareun.ai 서비스 상태를 확인해주세요.',
            retryable: true,
            details: { status, error }
          };

        default:
          return {
            type: 'API_SERVER_ERROR',
            message: `HTTP error: ${status}`,
            userMessage: 'API 요청에 실패했습니다',
            suggestion: '네트워크 상태를 확인하고 다시 시도해주세요.',
            retryable: true,
            details: { status, error }
          };
      }
    }

    // 타임아웃 에러
    if (error.message?.includes('타임아웃') || error.message?.includes('timeout')) {
      return {
        type: 'TIMEOUT_ERROR',
        message: 'Request timeout',
        userMessage: '요청 시간이 초과되었습니다',
        suggestion: '네트워크가 느리거나 텍스트가 너무 깁니다. 텍스트를 나누어 다시 시도해주세요.',
        retryable: true,
        details: error
      };
    }

    // JSON 파싱 에러
    if (error.name === 'SyntaxError' || error.message?.includes('JSON')) {
      return {
        type: 'PARSE_ERROR',
        message: 'Failed to parse response',
        userMessage: '서버 응답을 처리할 수 없습니다',
        suggestion: '서버에 일시적인 문제가 있을 수 있습니다. 잠시 후 다시 시도해주세요.',
        retryable: true,
        details: error
      };
    }

    // 유효성 검사 에러
    if (error.message?.includes('유효') || error.message?.includes('validation')) {
      return {
        type: 'VALIDATION_ERROR',
        message: 'Validation failed',
        userMessage: '입력 데이터가 올바르지 않습니다',
        suggestion: '텍스트 내용을 확인하고 다시 시도해주세요.',
        retryable: false,
        details: error
      };
    }

    // 기본 (알 수 없는 에러)
    return {
      type: 'UNKNOWN_ERROR',
      message: error.message || 'Unknown error occurred',
      userMessage: '예상치 못한 오류가 발생했습니다',
      suggestion: '문제가 계속되면 플러그인을 다시 로드하거나 Obsidian을 재시작해주세요.',
      retryable: true,
      details: error
    };
  }

  /**
   * 에러를 처리하고 사용자에게 적절한 피드백을 제공합니다
   */
  static handleError(error: any, context?: string): ErrorInfo {
    const errorInfo = this.analyzeError(error, context);
    
    Logger.error('에러 처리:', { 
      type: errorInfo.type,
      context,
      retryable: errorInfo.retryable
    });

    // 사용자 알림 표시
    this.showUserNotification(errorInfo);

    return errorInfo;
  }

  /**
   * 자동 재시도가 가능한 함수를 실행합니다
   */
  static async withRetry<T>(
    fn: () => Promise<T>,
    context: string,
    config: Partial<RetryConfig> = {}
  ): Promise<T> {
    const retryConfig = { ...this.DEFAULT_RETRY_CONFIG, ...config };
    const retryKey = `${context}_${Date.now()}`;
    
    let lastError: any;
    let attempt = 0;

    while (attempt <= retryConfig.maxRetries) {
      try {
        if (attempt > 0) {
          Logger.log(`재시도 ${attempt}/${retryConfig.maxRetries}:`, { context });
        }

        const result = await fn();
        
        // 성공 시 재시도 카운트 초기화
        if (attempt > 0) {
          Logger.log('재시도 성공:', { context, attempt });
        }
        this.retryCount.delete(retryKey);
        
        return result;

      } catch (error) {
        lastError = error;
        attempt++;

        const errorInfo = this.analyzeError(error, context);
        
        // 재시도 불가능한 에러면 즉시 실패
        if (!errorInfo.retryable) {
          Logger.error('재시도 불가능한 에러:', { type: errorInfo.type, context });
          throw error;
        }

        // 최대 재시도 횟수 도달
        if (attempt > retryConfig.maxRetries) {
          Logger.error('최대 재시도 횟수 도달:', { context, attempt });
          break;
        }

        // 재시도 딜레이 계산 (exponential backoff)
        const delay = Math.min(
          retryConfig.baseDelay * Math.pow(retryConfig.backoffFactor, attempt - 1),
          retryConfig.maxDelay
        );

        Logger.warn(`재시도 대기 중:`, { context, attempt, delay: `${delay}ms` });
        
        // 사용자에게 재시도 알림
        if (attempt === 1) {
          new Notice(`연결 문제로 재시도 중... (${attempt}/${retryConfig.maxRetries})`, 2000);
        }

        await this.sleep(delay);
      }
    }

    // 모든 재시도 실패
    const finalErrorInfo = this.handleError(lastError, `${context} (재시도 ${retryConfig.maxRetries}회 실패)`);
    throw lastError;
  }

  /**
   * 사용자에게 친화적인 알림을 표시합니다
   */
  private static showUserNotification(errorInfo: ErrorInfo): void {
    const { type, userMessage, suggestion, retryable } = errorInfo;
    
    // 에러 타입별 아이콘
    const icons = {
      NETWORK_ERROR: '🌐',
      API_KEY_ERROR: '🔑',
      API_RATE_LIMIT: '⏱️',
      API_SERVER_ERROR: '🔧',
      TIMEOUT_ERROR: '⏰',
      PARSE_ERROR: '📄',
      VALIDATION_ERROR: '⚠️',
      UNKNOWN_ERROR: '❓'
    };

    const icon = icons[type] || '❌';
    const retryText = retryable ? ' (자동 재시도 중)' : '';
    
    // 메인 에러 메시지
    new Notice(`${icon} ${userMessage}${retryText}`, 4000);
    
    // 해결 방안 제안 (있는 경우)
    if (suggestion) {
      setTimeout(() => {
        new Notice(`💡 ${suggestion}`, 6000);
      }, 500);
    }
  }

  /**
   * 에러 통계를 반환합니다
   */
  static getErrorStats(): Record<ErrorType, number> {
    const stats = Logger.getHistory('ERROR');
    const errorStats: Record<ErrorType, number> = {
      NETWORK_ERROR: 0,
      API_KEY_ERROR: 0,
      API_RATE_LIMIT: 0,
      API_SERVER_ERROR: 0,
      TIMEOUT_ERROR: 0,
      PARSE_ERROR: 0,
      VALIDATION_ERROR: 0,
      UNKNOWN_ERROR: 0
    };

    for (const log of stats) {
      // 로그에서 에러 타입 추출 (간단한 패턴 매칭)
      if (log.message.includes('네트워크') || log.message.includes('fetch')) {
        errorStats.NETWORK_ERROR++;
      } else if (log.message.includes('API 키') || log.message.includes('키')) {
        errorStats.API_KEY_ERROR++;
      } else if (log.message.includes('rate limit') || log.message.includes('429')) {
        errorStats.API_RATE_LIMIT++;
      } else if (log.message.includes('타임아웃') || log.message.includes('timeout')) {
        errorStats.TIMEOUT_ERROR++;
      } else if (log.message.includes('JSON') || log.message.includes('parse')) {
        errorStats.PARSE_ERROR++;
      } else if (log.message.includes('API') || log.message.includes('서버')) {
        errorStats.API_SERVER_ERROR++;
      } else {
        errorStats.UNKNOWN_ERROR++;
      }
    }

    return errorStats;
  }

  /**
   * 비동기 대기 헬퍼
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 재시도 상태 초기화
   */
  static clearRetryState(): void {
    this.retryCount.clear();
    Logger.log('재시도 상태 초기화됨');
  }
}