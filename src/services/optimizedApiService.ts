import { PluginSettings, SpellCheckResult, Correction } from '../types/interfaces';
import { SpellCheckApiService } from './api';
import { SpellCheckCacheService } from './cacheService';
import { ErrorHandlerService } from './errorHandler';
import { Logger } from '../utils/logger';

/**
 * 배치 요청 아이템 인터페이스
 */
interface BatchRequestItem {
  text: string;
  resolve: (result: SpellCheckResult) => void;
  reject: (error: Error) => void;
  timestamp: number;
  priority: 'high' | 'medium' | 'low';
}

/**
 * API 성능 메트릭 인터페이스
 */
interface ApiMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  queueLength: number;
  activeBatches: number;
}

/**
 * 최적화된 맞춤법 검사 API 서비스
 * 캐싱, 배치 처리, 디바운싱, 우선순위 큐 등을 통합 제공
 */
export class OptimizedSpellCheckService {
  private apiService: SpellCheckApiService;
  private cacheService: SpellCheckCacheService;
  private requestQueue: BatchRequestItem[] = [];
  private processing = false;
  private readonly maxBatchSize: number;
  private readonly batchTimeout: number;
  private readonly requestTimeout: number;
  private readonly maxConcurrentBatches: number;
  private activeBatches = 0;
  private batchTimer?: NodeJS.Timeout;
  
  // 성능 메트릭
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    responseTimes: [] as number[]
  };

  constructor(
    maxBatchSize = 5,         // 배치당 최대 5개 요청
    batchTimeoutMs = 2000,    // 2초 대기 후 배치 처리
    requestTimeoutMs = 15000, // 15초 요청 타임아웃
    maxConcurrentBatches = 3, // 최대 3개 동시 배치
    cacheOptions?: {
      maxSize?: number;
      ttlMinutes?: number;
      cleanupIntervalMinutes?: number;
    }
  ) {
    this.apiService = new SpellCheckApiService();
    this.cacheService = new SpellCheckCacheService(
      cacheOptions?.maxSize,
      cacheOptions?.ttlMinutes,
      cacheOptions?.cleanupIntervalMinutes
    );
    
    this.maxBatchSize = maxBatchSize;
    this.batchTimeout = batchTimeoutMs;
    this.requestTimeout = requestTimeoutMs;
    this.maxConcurrentBatches = maxConcurrentBatches;
    
    Logger.log('OptimizedSpellCheckService 초기화:', {
      maxBatchSize,
      batchTimeoutMs,
      requestTimeoutMs,
      maxConcurrentBatches
    });
  }

  /**
   * 맞춤법 검사를 수행합니다 (최적화된 버전)
   * @param text 검사할 텍스트
   * @param settings 플러그인 설정
   * @param priority 요청 우선순위
   * @returns 검사 결과 Promise
   */
  async checkSpelling(
    text: string, 
    settings: PluginSettings, 
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<SpellCheckResult> {
    this.metrics.totalRequests++;
    
    // 1. 캐시 확인
    const cachedResult = this.cacheService.get(text);
    if (cachedResult) {
      Logger.log('캐시에서 결과 반환:', { textLength: text.length });
      return cachedResult;
    }
    
    // 2. 짧은 텍스트나 긴급한 요청은 즉시 처리
    if (text.length < 50 || priority === 'high') {
      Logger.log('즉시 처리:', { textLength: text.length, priority });
      return this.processSingleRequest(text, settings);
    }
    
    // 3. 배치 큐에 추가
    return new Promise<SpellCheckResult>((resolve, reject) => {
      const item: BatchRequestItem = {
        text,
        resolve,
        reject,
        timestamp: Date.now(),
        priority
      };
      
      // 우선순위에 따라 큐에 삽입
      this.insertByPriority(item);
      
      Logger.log('배치 큐에 추가:', { 
        queueLength: this.requestQueue.length,
        priority,
        textLength: text.length
      });
      
      // 배치 처리 트리거
      this.scheduleBatchProcessing(settings);
    });
  }

  /**
   * 서비스 성능 메트릭을 반환합니다
   */
  getMetrics(): ApiMetrics & { cache: any; morphemeCache: any } {
    const avgResponseTime = this.metrics.responseTimes.length > 0
      ? this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length
      : 0;
    
    return {
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
      averageResponseTime: Math.round(avgResponseTime),
      queueLength: this.requestQueue.length,
      activeBatches: this.activeBatches,
      cache: this.cacheService.getStats(),
      morphemeCache: this.apiService.getMorphemeCacheStats() // ⭐ NEW: 형태소 캐시 통계
    };
  }

  /**
   * 캐시를 수동으로 정리합니다
   */
  clearCache(): void {
    this.cacheService.clear();
    this.apiService.clearMorphemeCache(); // ⭐ NEW: 형태소 캐시도 정리
  }

  /**
   * 대기 중인 모든 요청을 취소합니다
   */
  cancelPendingRequests(): void {
    const error = new Error('요청이 취소되었습니다');
    
    this.requestQueue.forEach(item => {
      item.reject(error);
    });
    
    this.requestQueue = [];
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    
    Logger.log('대기 중인 모든 요청 취소됨');
  }

  /**
   * 서비스를 종료하고 리소스를 정리합니다
   */
  destroy(): void {
    this.cancelPendingRequests();
    this.cacheService.destroy();
    Logger.log('OptimizedSpellCheckService 종료');
  }

  /**
   * 단일 요청을 즉시 처리합니다 (에러 핸들링 및 재시도 포함)
   */
  private async processSingleRequest(text: string, settings: PluginSettings): Promise<SpellCheckResult> {
    const startTime = Date.now();
    
    try {
      // 자동 재시도와 에러 핸들링을 적용한 API 호출
      const result = await ErrorHandlerService.withRetry(
        async () => {
          return await this.executeWithTimeout(
            () => this.apiService.checkSpelling(text, settings),
            this.requestTimeout
          );
        },
        `spell-check-${text.substring(0, 50)}`,
        {
          maxRetries: 2,
          baseDelay: 1000,
          maxDelay: 5000,
          backoffFactor: 2
        }
      );
      
      // 캐시에 저장
      this.cacheService.set(text, result);
      
      // 메트릭 업데이트
      const responseTime = Date.now() - startTime;
      this.updateMetrics(true, responseTime);
      
      return result;
    } catch (error) {
      this.updateMetrics(false, Date.now() - startTime);
      
      // 에러 분석 및 사용자 친화적 처리
      const errorInfo = ErrorHandlerService.handleError(error, 'spell-check-api');
      
      // 원본 에러를 그대로 throw (이미 ErrorHandlerService에서 사용자 알림 처리됨)
      throw error;
    }
  }

  /**
   * 배치 처리를 스케줄링합니다
   */
  private scheduleBatchProcessing(settings: PluginSettings): void {
    // 이미 처리 중이거나 큐가 비어있으면 스킵
    if (this.processing || this.requestQueue.length === 0) {
      return;
    }
    
    // 동시 배치 제한 확인
    if (this.activeBatches >= this.maxConcurrentBatches) {
      Logger.log('최대 동시 배치 수 도달, 대기 중');
      return;
    }
    
    // 큐가 가득 찼거나 타임아웃 설정
    if (this.requestQueue.length >= this.maxBatchSize) {
      this.processBatch(settings);
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.processBatch(settings);
      }, this.batchTimeout);
    }
  }

  /**
   * 배치를 처리합니다
   */
  private async processBatch(settings: PluginSettings): Promise<void> {
    if (this.processing || this.requestQueue.length === 0) {
      return;
    }
    
    this.processing = true;
    this.activeBatches++;
    
    // 타이머 정리
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    
    // 배치 추출 (우선순위 고려)
    const batch = this.requestQueue.splice(0, this.maxBatchSize);
    
    Logger.log('배치 처리 시작:', { 
      batchSize: batch.length,
      remainingQueue: this.requestQueue.length,
      activeBatches: this.activeBatches
    });
    
    try {
      // 배치 내 각 요청을 병렬 처리
      const promises = batch.map(async (item) => {
        try {
          const result = await this.processSingleRequest(item.text, settings);
          item.resolve(result);
        } catch (error) {
          item.reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      
      await Promise.allSettled(promises);
      
    } catch (error) {
      Logger.error('배치 처리 중 오류:', error);
      
      // 배치 전체 실패 시 모든 요청에 에러 전달
      batch.forEach(item => {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      });
    } finally {
      this.processing = false;
      this.activeBatches--;
      
      Logger.log('배치 처리 완료:', { 
        remainingQueue: this.requestQueue.length,
        activeBatches: this.activeBatches
      });
      
      // 대기 중인 요청이 있으면 다음 배치 처리
      if (this.requestQueue.length > 0) {
        setTimeout(() => this.scheduleBatchProcessing(settings), 100);
      }
    }
  }

  /**
   * 우선순위에 따라 큐에 아이템을 삽입합니다
   */
  private insertByPriority(item: BatchRequestItem): void {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const itemPriority = priorityOrder[item.priority];
    
    let insertIndex = this.requestQueue.length;
    
    for (let i = 0; i < this.requestQueue.length; i++) {
      const existingPriority = priorityOrder[this.requestQueue[i].priority];
      if (itemPriority < existingPriority) {
        insertIndex = i;
        break;
      }
    }
    
    this.requestQueue.splice(insertIndex, 0, item);
  }

  /**
   * 타임아웃을 적용한 함수 실행
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>, 
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`요청 타임아웃 (${timeoutMs}ms)`));
      }, timeoutMs);
      
      fn()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 성능 메트릭을 업데이트합니다
   */
  private updateMetrics(success: boolean, responseTime: number): void {
    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }
    
    this.metrics.responseTimes.push(responseTime);
    
    // 최근 100개 응답 시간만 유지
    if (this.metrics.responseTimes.length > 100) {
      this.metrics.responseTimes = this.metrics.responseTimes.slice(-100);
    }
  }

  /**
   * 형태소 분석을 활용하여 겹치는 오류를 해결합니다.
   * @param text 원본 텍스트
   * @param corrections 교정 배열
   * @param settings 플러그인 설정
   * @returns 개선된 교정 배열
   */
  async improveCorrectionsWithMorphemes(
    text: string, 
    corrections: Correction[], 
    settings: PluginSettings
  ): Promise<Correction[]> {
    return await this.apiService.improveCorrectionsWithMorphemes(text, corrections, settings);
  }

  /**
   * 이미 분석된 형태소 데이터를 사용하여 교정을 개선합니다 (중복 API 호출 방지).
   * @param text 원본 텍스트
   * @param corrections 교정 배열
   * @param settings 플러그인 설정
   * @param morphemeData 이미 분석된 형태소 데이터
   * @returns 개선된 교정 배열
   */
  async improveCorrectionsWithMorphemeData(
    text: string, 
    corrections: Correction[], 
    settings: PluginSettings,
    morphemeData: any
  ): Promise<Correction[]> {
    return await this.apiService.improveCorrectionsWithMorphemeData(text, corrections, settings, morphemeData);
  }

  /**
   * 형태소 분석을 수행합니다.
   */
  async analyzeMorphemes(text: string, settings: PluginSettings): Promise<any> {
    return await this.apiService.analyzeMorphemes(text, settings);
  }
}