import { SpellCheckResult } from '../types/interfaces';
import { Logger } from '../utils/logger';

/**
 * 캐시 아이템 인터페이스
 */
interface CacheItem {
  result: SpellCheckResult;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
}

/**
 * 캐시 통계 인터페이스
 */
interface CacheStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRatio: number;
  cacheSize: number;
  memoryUsage: number;
}

/**
 * 맞춤법 검사 결과 캐싱 서비스
 * 메모리 효율적인 LRU + TTL 하이브리드 캐시 구현
 */
export class SpellCheckCacheService {
  private cache = new Map<string, CacheItem>();
  private readonly maxSize: number;
  private readonly ttl: number; // TTL in milliseconds
  private readonly cleanupInterval: number;
  private cleanupTimer?: NodeJS.Timeout;
  
  // 통계 정보
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  constructor(
    maxSize = 1000,           // 최대 1000개 캐시 항목
    ttlMinutes = 30,          // 30분 TTL
    cleanupIntervalMinutes = 5 // 5분마다 정리
  ) {
    this.maxSize = maxSize;
    this.ttl = ttlMinutes * 60 * 1000;
    this.cleanupInterval = cleanupIntervalMinutes * 60 * 1000;
    
    Logger.debug('SpellCheckCacheService 초기화:', {
      maxSize,
      ttlMinutes,
      cleanupIntervalMinutes
    });
    
    this.startCleanupTimer();
  }

  /**
   * 캐시에서 결과를 가져옵니다
   * @param text 검사할 텍스트 (키로 사용)
   * @returns 캐시된 결과 또는 null
   */
  get(text: string): SpellCheckResult | null {
    this.stats.totalRequests++;
    
    const key = this.generateKey(text);
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.cacheMisses++;
      Logger.debug('캐시 미스:', { key: key.substring(0, 50) + '...' });
      return null;
    }
    
    const now = Date.now();
    
    // TTL 체크
    if (now - item.timestamp > this.ttl) {
      this.cache.delete(key);
      this.stats.cacheMisses++;
      Logger.debug('캐시 만료:', { key: key.substring(0, 50) + '...' });
      return null;
    }
    
    // LRU 업데이트
    item.accessCount++;
    item.lastAccessed = now;
    
    // 캐시 히트 시 맨 뒤로 이동 (LRU)
    this.cache.delete(key);
    this.cache.set(key, item);
    
    this.stats.cacheHits++;
    Logger.debug('캐시 히트:', { 
      key: key.substring(0, 50) + '...',
      accessCount: item.accessCount 
    });
    
    return item.result;
  }

  /**
   * 결과를 캐시에 저장합니다
   * @param text 검사한 텍스트
   * @param result 검사 결과
   */
  set(text: string, result: SpellCheckResult): void {
    const key = this.generateKey(text);
    const now = Date.now();
    
    // 캐시 크기 제한 확인
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLeastRecentlyUsed();
    }
    
    const item: CacheItem = {
      result,
      timestamp: now,
      accessCount: 1,
      lastAccessed: now
    };
    
    this.cache.set(key, item);
    
    Logger.debug('캐시 저장:', { 
      key: key.substring(0, 50) + '...',
      cacheSize: this.cache.size,
      corrections: result.corrections.length
    });
  }

  /**
   * 캐시 통계를 반환합니다
   */
  getStats(): CacheStats {
    const hitRatio = this.stats.totalRequests > 0 
      ? (this.stats.cacheHits / this.stats.totalRequests) * 100 
      : 0;
    
    return {
      totalRequests: this.stats.totalRequests,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      hitRatio: Math.round(hitRatio * 100) / 100,
      cacheSize: this.cache.size,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  /**
   * 캐시를 완전히 비웁니다
   */
  clear(): void {
    this.cache.clear();
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    
    Logger.debug('캐시 전체 삭제 완료');
  }

  /**
   * 만료된 항목들을 정리합니다
   */
  cleanup(): void {
    const now = Date.now();
    let removedCount = 0;
    
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > this.ttl) {
        this.cache.delete(key);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      Logger.debug('캐시 정리 완료:', { 
        removedCount, 
        remainingSize: this.cache.size 
      });
    }
  }

  /**
   * 캐시 서비스를 종료하고 정리합니다
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
    Logger.debug('SpellCheckCacheService 종료');
  }

  /**
   * 텍스트에서 캐시 키를 생성합니다
   * @param text 원본 텍스트
   * @returns 해시된 키
   */
  private generateKey(text: string): string {
    // 정규화: 공백 정리, 대소문자 통일
    const normalized = text.trim().replace(/\s+/g, ' ');
    
    // 간단한 해시 함수 (실제 환경에서는 crypto 모듈 사용 권장)
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit integer로 변환
    }
    
    return `spell_${Math.abs(hash)}_${normalized.length}`;
  }

  /**
   * LRU 정책에 따라 가장 오래된 항목을 제거합니다
   */
  private evictLeastRecentlyUsed(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();
    
    for (const [key, item] of this.cache.entries()) {
      if (item.lastAccessed < oldestTime) {
        oldestTime = item.lastAccessed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      Logger.debug('LRU 제거:', { 
        key: oldestKey.substring(0, 50) + '...',
        age: Date.now() - oldestTime
      });
    }
  }

  /**
   * 대략적인 메모리 사용량을 추정합니다 (바이트 단위)
   */
  private estimateMemoryUsage(): number {
    let totalSize = 0;
    
    for (const [key, item] of this.cache.entries()) {
      // 키 크기
      totalSize += key.length * 2; // UTF-16 가정
      
      // 결과 객체 크기 추정
      totalSize += JSON.stringify(item.result).length * 2;
      
      // 메타데이터 크기
      totalSize += 32; // timestamp, accessCount, lastAccessed
    }
    
    return totalSize;
  }

  /**
   * 정리 타이머를 시작합니다
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }
}