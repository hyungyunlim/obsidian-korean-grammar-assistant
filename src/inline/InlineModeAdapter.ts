/**
 * 인라인 모드 어댑터
 * 기존 InlineModeService와의 완벽한 호환성을 제공하면서
 * 새로운 모듈식 아키텍처로 점진적 마이그레이션 지원
 */

import { App } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { InlineModeCore } from './core/InlineModeCore';
import { InlineError, Correction, AIAnalysisResult } from '../types/interfaces';
import { Logger } from '../utils/logger';

export class InlineModeAdapter {
  private core: InlineModeCore;
  private legacyService: any = null; // 기존 InlineModeService 참조
  private migrationPhase: number = 1; // 현재 마이그레이션 단계
  
  constructor(app: App, legacyService?: any) {
    this.core = new InlineModeCore(app);
    this.legacyService = legacyService;
    
    Logger.log('InlineModeAdapter: 초기화 완료', { 
      migrationPhase: this.migrationPhase,
      hasLegacyService: !!this.legacyService 
    });
  }
  
  /**
   * 마이그레이션 단계 설정
   * 1: 기본 구조만 - 모든 기능을 기존 서비스에 위임
   * 2: 데코레이션 시스템 마이그레이션 (완료)
   * 3: 이벤트 시스템 마이그레이션 (완료)
   * 4: 상태 관리 마이그레이션 (완료)
   * 5: AI 통합 마이그레이션
   * 6-8: 최적화 및 기존 코드 제거
   */
  setMigrationPhase(phase: number): void {
    this.migrationPhase = phase;
    Logger.log('InlineModeAdapter: 마이그레이션 단계 변경', { phase });
  }
  
  /**
   * 인라인 모드 활성화
   * 현재는 기존 서비스에 위임, 단계적으로 새 구현으로 전환
   */
  async enableInlineMode(): Promise<void> {
    try {
      if (this.migrationPhase >= 4) {
        // Phase 4부터는 새로운 구현 사용 (상태 관리 포함)
        await this.core.enableInlineMode();
      } else {
        // Phase 1-3에서는 기존 구현 사용
        if (this.legacyService?.enableInlineMode) {
          await this.legacyService.enableInlineMode();
        }
      }
      
      Logger.log('InlineModeAdapter: 인라인 모드 활성화 완료', { 
        migrationPhase: this.migrationPhase 
      });
      
    } catch (error) {
      Logger.error('InlineModeAdapter: 인라인 모드 활성화 실패', error);
      throw error;
    }
  }
  
  /**
   * 인라인 모드 비활성화
   */
  async disableInlineMode(): Promise<void> {
    try {
      if (this.migrationPhase >= 4) {
        await this.core.disableInlineMode();
      } else {
        if (this.legacyService?.disableInlineMode) {
          await this.legacyService.disableInlineMode();
        }
      }
      
      Logger.log('InlineModeAdapter: 인라인 모드 비활성화 완료');
      
    } catch (error) {
      Logger.error('InlineModeAdapter: 인라인 모드 비활성화 실패', error);
      throw error;
    }
  }
  
  /**
   * 텍스트 분석
   */
  async analyzeText(text: string): Promise<InlineError[]> {
    try {
      if (this.migrationPhase >= 5) {
        // Phase 5부터는 새로운 구현의 결과 반환
        await this.core.analyzeText(text);
        return Array.from(this.core.getActiveErrors().values());
      } else {
        // Phase 1-4에서는 기존 구현 사용
        if (this.legacyService?.analyzeText) {
          return await this.legacyService.analyzeText(text);
        }
        return [];
      }
      
    } catch (error) {
      Logger.error('InlineModeAdapter: 텍스트 분석 실패', error);
      throw error;
    }
  }
  
  /**
   * AI 분석 적용
   */
  async applyAIAnalysis(results: AIAnalysisResult[]): Promise<void> {
    try {
      if (this.migrationPhase >= 5) {
        await this.core.applyAIAnalysis(results);
      } else {
        if (this.legacyService?.applyAIAnalysis) {
          await this.legacyService.applyAIAnalysis(results);
        }
      }
      
      Logger.log('InlineModeAdapter: AI 분석 적용 완료');
      
    } catch (error) {
      Logger.error('InlineModeAdapter: AI 분석 적용 실패', error);
      throw error;
    }
  }
  
  /**
   * 사용자 편집 처리
   */
  async handleUserEdit(errorId: string, newValue: string): Promise<void> {
    try {
      if (this.migrationPhase >= 4) {
        await this.core.handleUserEdit(errorId, newValue);
      } else {
        if (this.legacyService?.handleUserEdit) {
          await this.legacyService.handleUserEdit(errorId, newValue);
        }
      }
      
      Logger.log('InlineModeAdapter: 사용자 편집 처리 완료');
      
    } catch (error) {
      Logger.error('InlineModeAdapter: 사용자 편집 처리 실패', error);
      throw error;
    }
  }
  
  /**
   * 상태 조회 메서드들
   * 현재 활성화된 구현에서 데이터를 가져옴
   */
  isActive(): boolean {
    if (this.migrationPhase >= 2) {
      return this.core.isActive();
    } else {
      return this.legacyService?.isInlineMode || false;
    }
  }
  
  getActiveErrors(): Map<string, InlineError> {
    if (this.migrationPhase >= 4) {
      return this.core.getActiveErrors();
    } else {
      return this.legacyService?.activeErrors || new Map();
    }
  }
  
  getErrorCount(): number {
    if (this.migrationPhase >= 4) {
      return this.core.getErrorCount();
    } else {
      return this.getActiveErrors().size;
    }
  }
  
  getFocusedErrorId(): string | null {
    if (this.migrationPhase >= 4) {
      return this.core.getFocusedErrorId();
    } else {
      return this.legacyService?.focusedErrorId || null;
    }
  }
  
  /**
   * 기존 서비스 참조 업데이트
   * 런타임에 기존 서비스가 변경될 경우 사용
   */
  updateLegacyService(legacyService: any): void {
    this.legacyService = legacyService;
    Logger.log('InlineModeAdapter: 기존 서비스 참조 업데이트');
  }
  
  /**
   * 마이그레이션 상태 확인
   */
  getMigrationStatus(): { phase: number; isUsingNewImplementation: boolean } {
    return {
      phase: this.migrationPhase,
      isUsingNewImplementation: this.migrationPhase >= 2
    };
  }
  
  /**
   * 디버그 정보 출력
   */
  debugInfo(): any {
    return {
      migrationPhase: this.migrationPhase,
      coreActive: this.core.isActive(),
      legacyActive: this.legacyService?.isInlineMode || false,
      activeErrorsCount: this.getErrorCount(),
      focusedErrorId: this.getFocusedErrorId()
    };
  }
}