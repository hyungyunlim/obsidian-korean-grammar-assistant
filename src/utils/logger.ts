/**
 * 로깅 레벨 타입
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * 로그 항목 인터페이스
 */
interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  data?: unknown;
}

/**
 * 성능 최적화된 로거 클래스
 * 개발 및 프로덕션 환경 모두 지원하며 성능 모니터링 기능 포함
 */
export class Logger {
  private static logHistory: LogEntry[] = [];
  private static maxLogHistory = 1000;
  private static enableHistory = true;
  private static currentLogLevel: LogLevel = 'INFO'; // 기본 로그 레벨
  
  // 로그 레벨 우선순위 (낮을수록 중요)
  private static logLevelPriority: Record<LogLevel, number> = {
    'DEBUG': 0,
    'INFO': 1,
    'WARN': 2,
    'ERROR': 3
  };

  private static isDevelopment(): boolean {
    // Check if we're in development mode
    // In production build, this will be optimized away
    return process.env.NODE_ENV !== 'production';
  }

  /**
   * 현재 로그 레벨이 출력 가능한지 확인합니다
   */
  private static shouldLog(level: LogLevel): boolean {
    return this.logLevelPriority[level] >= this.logLevelPriority[this.currentLogLevel];
  }

  /**
   * 일반 정보 로그
   */
  static log(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('INFO')) return;
    
    this.writeLog('INFO', message, args.length > 0 ? args : undefined);
    if (this.isDevelopment()) {
      console.log(`[Korean Grammar Assistant] ${message}`, ...args);
    }
  }

  /**
   * 디버그 로그 (개발 모드에서만)
   */
  static debug(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('DEBUG')) return;
    
    this.writeLog('DEBUG', message, args.length > 0 ? args : undefined);
    if (this.isDevelopment()) {
      console.debug(`[Korean Grammar Assistant DEBUG] ${message}`, ...args);
    }
  }

  /**
   * 경고 로그
   */
  static warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('WARN')) return;
    
    this.writeLog('WARN', message, args.length > 0 ? args : undefined);
    if (this.isDevelopment()) {
      console.warn(`[Korean Grammar Assistant WARN] ${message}`, ...args);
    }
  }

  /**
   * 에러 로그 (프로덕션에서도 표시)
   */
  static error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('ERROR')) return;
    
    this.writeLog('ERROR', message, args.length > 0 ? args : undefined);
    // 프로덕션에서도 에러는 표시하되, 간단하게
    if (this.isDevelopment()) {
      console.error(`[Korean Grammar Assistant ERROR] ${message}`, ...args);
    } else {
      console.error(`[Korean Grammar Assistant] Error: ${message}`);
    }
  }

  /**
   * 성능 측정 시작
   */
  static startTimer(label: string): () => number {
    const startTime = performance.now();
    
    return () => {
      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);
      this.debug(`⏱️ ${label}: ${duration}ms`);
      return duration;
    };
  }

  /**
   * 비동기 함수의 성능을 측정합니다
   */
  static async measureAsync<T>(
    label: string, 
    fn: () => Promise<T>
  ): Promise<T> {
    const endTimer = this.startTimer(label);
    try {
      const result = await fn();
      endTimer();
      return result;
    } catch (error) {
      endTimer();
      this.error(`${label} 실행 중 오류:`, error);
      throw error;
    }
  }

  /**
   * 그룹 로깅 시작 (개발 모드에서만)
   */
  static group(label: string): void {
    if (this.isDevelopment()) {
      console.group(`🔸 ${label}`);
    }
  }

  /**
   * 그룹 로깅 종료 (개발 모드에서만)
   */
  static groupEnd(): void {
    if (this.isDevelopment()) {
      console.groupEnd();
    }
  }

  /**
   * 로그 히스토리를 반환합니다
   */
  static getHistory(level?: LogLevel): LogEntry[] {
    if (level) {
      return this.logHistory.filter(entry => entry.level === level);
    }
    return [...this.logHistory];
  }

  /**
   * 로그 히스토리를 클리어합니다
   */
  static clearHistory(): void {
    this.logHistory = [];
  }

  /**
   * 로그 통계를 반환합니다
   */
  static getStats(): Record<LogLevel, number> & { total: number } {
    const stats = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, total: 0 };
    
    for (const entry of this.logHistory) {
      stats[entry.level]++;
      stats.total++;
    }
    
    return stats;
  }

  /**
   * 메모리 사용량 모니터링 (근사치)
   */
  static getMemoryUsage(): { historySize: number; estimatedBytes: number } {
    const historySize = this.logHistory.length;
    const estimatedBytes = this.logHistory.reduce((total, entry) => {
      return total + 
        entry.message.length * 2 + // UTF-16 가정
        (entry.data ? JSON.stringify(entry.data).length * 2 : 0) +
        32; // 기본 오버헤드
    }, 0);
    
    return { historySize, estimatedBytes };
  }

  /**
   * 히스토리 저장 활성화/비활성화
   */
  static setHistoryEnabled(enabled: boolean): void {
    this.enableHistory = enabled;
    if (!enabled) {
      this.clearHistory();
    }
  }

  /**
   * 로그 레벨을 설정합니다 (성능 최적화)
   * @param level - 최소 출력 로그 레벨
   */
  static setLogLevel(level: LogLevel): void {
    this.currentLogLevel = level;
    this.debug(`로그 레벨이 ${level}로 설정됨`);
  }

  /**
   * 현재 로그 레벨을 반환합니다
   */
  static getLogLevel(): LogLevel {
    return this.currentLogLevel;
  }

  /**
   * 프로덕션 환경에 최적화된 설정을 적용합니다
   */
  static configureForProduction(): void {
    this.setLogLevel('WARN'); // 경고와 에러만 로깅
    this.setHistoryEnabled(false); // 히스토리 비활성화로 메모리 절약
    this.debug('프로덕션 모드 로깅 설정 적용됨');
  }

  /**
   * 개발 환경에 최적화된 설정을 적용합니다
   */
  static configureForDevelopment(): void {
    this.setLogLevel('DEBUG'); // 모든 로그 출력
    this.setHistoryEnabled(true); // 히스토리 활성화
    this.debug('개발 모드 로깅 설정 적용됨');
  }

  /**
   * 실제 로그 작성 (히스토리 관리)
   */
  private static writeLog(level: LogLevel, message: string, data?: unknown): void {
    if (!this.enableHistory || !this.shouldLog(level)) return;

    const logEntry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      data
    };

    this.logHistory.push(logEntry);
    
    // 최대 히스토리 크기 유지
    if (this.logHistory.length > this.maxLogHistory) {
      this.logHistory = this.logHistory.slice(-this.maxLogHistory);
    }
  }
}