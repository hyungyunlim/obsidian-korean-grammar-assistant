import { Logger } from './logger';

/**
 * 메모리 청크 인터페이스
 */
interface MemoryChunk<T> {
  id: string;
  data: T;
  lastAccessed: number;
  accessCount: number;
  size: number;
}

/**
 * 메모리 사용량 정보 인터페이스
 */
interface MemoryUsage {
  totalChunks: number;
  activeChunks: number;
  totalSize: number;
  activeSize: number;
  hitRatio: number;
  accessPatterns: {
    hot: number;    // 자주 접근되는 청크
    warm: number;   // 보통 접근되는 청크
    cold: number;   // 드물게 접근되는 청크
  };
}

/**
 * 메모리 최적화 설정 인터페이스
 */
interface OptimizerConfig {
  maxChunks: number;           // 최대 청크 수
  maxMemoryMB: number;         // 최대 메모리 사용량 (MB)
  cleanupInterval: number;     // 정리 주기 (ms)
  accessThreshold: {
    hot: number;    // 핫 데이터 임계값
    warm: number;   // 웜 데이터 임계값
  };
  ttl: {
    hot: number;    // 핫 데이터 TTL (ms)
    warm: number;   // 웜 데이터 TTL (ms)
    cold: number;   // 콜드 데이터 TTL (ms)
  };
}

/**
 * 메모리 최적화 관리자
 * LRU + 접근 패턴 기반 지능형 메모리 관리
 */
export class MemoryOptimizer<T> {
  private chunks = new Map<string, MemoryChunk<T>>();
  private config: OptimizerConfig;
  private cleanupTimer?: NodeJS.Timeout;
  private stats = {
    totalAccess: 0,
    cacheHits: 0,
    cacheMisses: 0,
    evictions: 0
  };

  constructor(config: Partial<OptimizerConfig> = {}) {
    this.config = {
      maxChunks: 500,
      maxMemoryMB: 50,
      cleanupInterval: 30000, // 30초
      accessThreshold: {
        hot: 10,
        warm: 3
      },
      ttl: {
        hot: 300000,    // 5분
        warm: 180000,   // 3분
        cold: 60000     // 1분
      },
      ...config
    };

    this.startCleanupTimer();
    
    Logger.debug('MemoryOptimizer 초기화:', this.config);
  }

  /**
   * 데이터를 저장합니다
   */
  set(id: string, data: T): void {
    // 메모리 제한 확인
    this.enforceMemoryLimits();
    
    const size = this.estimateSize(data);
    const now = Date.now();
    
    const chunk: MemoryChunk<T> = {
      id,
      data,
      lastAccessed: now,
      accessCount: 1,
      size
    };
    
    // 기존 청크가 있으면 교체
    if (this.chunks.has(id)) {
      const existing = this.chunks.get(id)!;
      chunk.accessCount = existing.accessCount;
    }
    
    this.chunks.set(id, chunk);
    
    Logger.debug('메모리 청크 저장:', { 
      id: id.substring(0, 50) + '...', 
      size,
      totalChunks: this.chunks.size 
    });
  }

  /**
   * 데이터를 가져옵니다
   */
  get(id: string): T | null {
    this.stats.totalAccess++;
    
    const chunk = this.chunks.get(id);
    if (!chunk) {
      this.stats.cacheMisses++;
      Logger.debug('메모리 미스:', { id: id.substring(0, 50) + '...' });
      return null;
    }
    
    // 접근 정보 업데이트
    chunk.lastAccessed = Date.now();
    chunk.accessCount++;
    
    // LRU 갱신 (맵에서 제거 후 다시 추가)
    this.chunks.delete(id);
    this.chunks.set(id, chunk);
    
    this.stats.cacheHits++;
    Logger.debug('메모리 히트:', { 
      id: id.substring(0, 50) + '...', 
      accessCount: chunk.accessCount 
    });
    
    return chunk.data;
  }

  /**
   * 특정 데이터를 삭제합니다
   */
  delete(id: string): boolean {
    const success = this.chunks.delete(id);
    if (success) {
      Logger.debug('메모리 청크 삭제:', { id: id.substring(0, 50) + '...' });
    }
    return success;
  }

  /**
   * 모든 데이터를 삭제합니다
   */
  clear(): void {
    const count = this.chunks.size;
    this.chunks.clear();
    this.stats = {
      totalAccess: 0,
      cacheHits: 0,
      cacheMisses: 0,
      evictions: 0
    };
    
    Logger.log('메모리 전체 정리:', { deletedChunks: count });
  }

  /**
   * 메모리 사용량 정보를 반환합니다
   */
  getMemoryUsage(): MemoryUsage {
    const now = Date.now();
    let totalSize = 0;
    let activeSize = 0;
    let activeChunks = 0;
    
    const patterns = { hot: 0, warm: 0, cold: 0 };
    
    for (const chunk of this.chunks.values()) {
      totalSize += chunk.size;
      
      // 활성 상태 확인 (최근 1분 내 접근)
      if (now - chunk.lastAccessed < 60000) {
        activeSize += chunk.size;
        activeChunks++;
      }
      
      // 접근 패턴 분류
      if (chunk.accessCount >= this.config.accessThreshold.hot) {
        patterns.hot++;
      } else if (chunk.accessCount >= this.config.accessThreshold.warm) {
        patterns.warm++;
      } else {
        patterns.cold++;
      }
    }
    
    const hitRatio = this.stats.totalAccess > 0 
      ? (this.stats.cacheHits / this.stats.totalAccess) * 100 
      : 0;
    
    return {
      totalChunks: this.chunks.size,
      activeChunks,
      totalSize,
      activeSize,
      hitRatio: Math.round(hitRatio * 100) / 100,
      accessPatterns: patterns
    };
  }

  /**
   * 성능 통계를 반환합니다
   */
  getStats(): typeof this.stats & { hitRatio: number } {
    const hitRatio = this.stats.totalAccess > 0 
      ? (this.stats.cacheHits / this.stats.totalAccess) * 100 
      : 0;
    
    return {
      ...this.stats,
      hitRatio: Math.round(hitRatio * 100) / 100
    };
  }

  /**
   * 메모리 압축을 수행합니다
   */
  compress(): void {
    const beforeSize = this.chunks.size;
    const beforeMemory = this.getMemoryUsage().totalSize;
    
    this.performCleanup(true); // 강제 정리
    
    const afterSize = this.chunks.size;
    const afterMemory = this.getMemoryUsage().totalSize;
    
    Logger.log('메모리 압축 완료:', {
      removedChunks: beforeSize - afterSize,
      savedMemory: beforeMemory - afterMemory,
      compressionRatio: Math.round(((beforeSize - afterSize) / beforeSize) * 100)
    });
  }

  /**
   * 메모리 최적화기를 종료합니다
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    
    this.clear();
    Logger.debug('MemoryOptimizer 종료');
  }

  /**
   * 메모리 제한을 강제 적용합니다
   */
  private enforceMemoryLimits(): void {
    const usage = this.getMemoryUsage();
    const maxMemoryBytes = this.config.maxMemoryMB * 1024 * 1024;
    
    // 청크 수 제한
    if (this.chunks.size >= this.config.maxChunks) {
      this.evictLeastRecentlyUsed(this.config.maxChunks * 0.8); // 20% 여유 공간 확보
    }
    
    // 메모리 사용량 제한
    if (usage.totalSize > maxMemoryBytes) {
      this.evictByMemoryPressure(maxMemoryBytes * 0.8); // 20% 여유 공간 확보
    }
  }

  /**
   * LRU 정책으로 청크를 제거합니다
   */
  private evictLeastRecentlyUsed(targetSize: number): void {
    const sortedChunks = Array.from(this.chunks.entries())
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);
    
    let removedCount = 0;
    while (this.chunks.size > targetSize && removedCount < sortedChunks.length) {
      const [id] = sortedChunks[removedCount];
      this.chunks.delete(id);
      this.stats.evictions++;
      removedCount++;
    }
    
    if (removedCount > 0) {
      Logger.debug('LRU 기반 제거:', { removedCount });
    }
  }

  /**
   * 메모리 압박 상황에서 청크를 제거합니다
   */
  private evictByMemoryPressure(targetMemory: number): void {
    // 크기가 큰 청크부터 제거
    const sortedChunks = Array.from(this.chunks.entries())
      .sort(([, a], [, b]) => b.size - a.size);
    
    let currentMemory = this.getMemoryUsage().totalSize;
    let removedCount = 0;
    
    for (const [id, chunk] of sortedChunks) {
      if (currentMemory <= targetMemory) break;
      
      this.chunks.delete(id);
      currentMemory -= chunk.size;
      this.stats.evictions++;
      removedCount++;
    }
    
    if (removedCount > 0) {
      Logger.debug('메모리 압박 기반 제거:', { removedCount, savedMemory: this.getMemoryUsage().totalSize - currentMemory });
    }
  }

  /**
   * 정기적인 정리 작업을 수행합니다
   */
  private performCleanup(force = false): void {
    const now = Date.now();
    const toRemove: string[] = [];
    
    for (const [id, chunk] of this.chunks.entries()) {
      const age = now - chunk.lastAccessed;
      let shouldRemove = false;
      
      // 접근 패턴에 따른 TTL 적용
      if (chunk.accessCount >= this.config.accessThreshold.hot) {
        shouldRemove = age > this.config.ttl.hot;
      } else if (chunk.accessCount >= this.config.accessThreshold.warm) {
        shouldRemove = age > this.config.ttl.warm;
      } else {
        shouldRemove = age > this.config.ttl.cold;
      }
      
      if (shouldRemove || force) {
        toRemove.push(id);
      }
    }
    
    toRemove.forEach(id => {
      this.chunks.delete(id);
      this.stats.evictions++;
    });
    
    if (toRemove.length > 0) {
      Logger.debug('TTL 기반 정리:', { removedCount: toRemove.length, force });
    }
  }

  /**
   * 데이터 크기를 추정합니다
   */
  private estimateSize(data: T): number {
    if (typeof data === 'string') {
      return data.length * 2; // UTF-16 가정
    }
    
    if (typeof data === 'object' && data !== null) {
      try {
        return JSON.stringify(data).length * 2;
      } catch {
        return 1000; // 기본값
      }
    }
    
    return 100; // 기본 크기
  }

  /**
   * 정리 타이머를 시작합니다
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.config.cleanupInterval);
  }
}