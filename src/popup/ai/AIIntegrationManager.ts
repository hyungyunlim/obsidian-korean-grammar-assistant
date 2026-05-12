import { App } from 'obsidian';
import { IPopupServiceManager, RenderContext } from '../types/PopupTypes';
import { AISettings, AIAnalysisRequest, AIAnalysisResult, Correction, MorphemeInfo } from '../../types/interfaces';
import { AIAnalysisService } from '../../services/aiAnalysisService';
import { TokenCalculator } from './TokenCalculator';
import { Logger } from '../../utils/logger';

/**
 * Phase 5: AI Integration Manager
 * 
 * AI 분석 관련 모든 로직을 통합 관리하는 중앙 오케스트레이터입니다.
 * 기존 aiAnalysisService를 래핑하여 팝업 내에서 AI 기능을 통합 관리합니다.
 */
export class AIIntegrationManager implements IPopupServiceManager {
  private aiAnalysisService?: AIAnalysisService;
  private tokenCalculator?: TokenCalculator;
  private isAnalyzing: boolean = false;
  private lastAnalysisResults: AIAnalysisResult[] = [];

  constructor(
    private settings: AISettings,
    private app: App
  ) {
    Logger.log('AIIntegrationManager 초기화됨');
  }

  /**
   * IPopupServiceManager 인터페이스 구현
   */
  async initialize(context: RenderContext): Promise<void> {
    Logger.log('AIIntegrationManager 초기화 시작');
    
    // AI 서비스 지연 초기화 (성능 최적화)
    if (this.hasValidSettings()) {
      this.aiAnalysisService = new AIAnalysisService(this.settings);
      this.tokenCalculator = new TokenCalculator(this.settings);
      await this.tokenCalculator.initialize(context);
    }
    
    Logger.log('AIIntegrationManager 초기화 완료');
  }

  /**
   * IPopupServiceManager 인터페이스 구현
   */
  destroy(): void {
    Logger.log('AIIntegrationManager 정리 중');
    
    this.aiAnalysisService = undefined;
    this.tokenCalculator?.destroy();
    this.tokenCalculator = undefined;
    this.isAnalyzing = false;
    this.lastAnalysisResults = [];
    
    Logger.log('AIIntegrationManager 정리 완료');
  }

  /**
   * AI 설정이 유효한지 확인합니다.
   */
  private hasValidSettings(): boolean {
    if (!this.settings || !this.settings.enabled) {
      Logger.debug('AI 설정이 비활성화됨');
      return false;
    }

    const hasApiKey = this.settings.openaiApiKey || 
                     this.settings.anthropicApiKey || 
                     this.settings.googleApiKey || 
                     this.settings.ollamaEndpoint;

    if (!hasApiKey) {
      Logger.warn('AI API 키가 설정되지 않음');
      return false;
    }

    return true;
  }

  /**
   * AI 분석이 가능한지 확인합니다.
   */
  public isAIAvailable(): boolean {
    return this.hasValidSettings() && this.aiAnalysisService !== undefined;
  }

  /**
   * 현재 AI 분석 중인지 확인합니다.
   */
  public isAIAnalyzing(): boolean {
    return this.isAnalyzing;
  }

  /**
   * 마지막 AI 분석 결과를 반환합니다.
   */
  public getLastAnalysisResults(): AIAnalysisResult[] {
    return [...this.lastAnalysisResults];
  }

  /**
   * AI 분석을 수행합니다.
   */
  public async performAIAnalysis(request: AIAnalysisRequest): Promise<AIAnalysisResult[]> {
    if (!this.aiAnalysisService) {
      Logger.error('AI 서비스가 초기화되지 않음');
      throw new Error('AI 서비스를 사용할 수 없습니다. 설정을 확인해주세요.');
    }

    if (this.isAnalyzing) {
      Logger.warn('이미 AI 분석이 진행 중입니다');
      throw new Error('이미 AI 분석이 진행 중입니다. 잠시 후 다시 시도해주세요.');
    }

    try {
      Logger.log('AI 분석 시작', { 
        correctionsCount: request.corrections.length,
        provider: this.settings.provider 
      });

      this.isAnalyzing = true;

      // 토큰 사용량 확인 및 경고
      if (this.tokenCalculator) {
        const tokenInfo = await this.tokenCalculator.calculateTokenUsage(request);
        const shouldProceed = await this.tokenCalculator.checkTokenLimits(tokenInfo);
        
        if (!shouldProceed) {
          Logger.log('사용자가 토큰 경고로 인해 AI 분석을 취소함');
          throw new Error('AI 분석이 사용자에 의해 취소되었습니다.');
        }
      }

      // AI 분석 수행
      const results = await this.aiAnalysisService.analyzeCorrections(request);
      
      this.lastAnalysisResults = results;
      
      Logger.log('AI 분석 완료', { 
        resultsCount: results.length,
        totalConfidence: results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      });

      return results;

    } catch (error: unknown) {
      Logger.error('AI 분석 중 오류 발생:', error);
      throw error;
    } finally {
      this.isAnalyzing = false;
    }
  }

  /**
   * AI 분석 요청을 생성합니다.
   */
  public createAnalysisRequest(
    originalText: string,
    corrections: Correction[],
    currentStates?: AIAnalysisRequest['currentStates'],
    morphemeData?: MorphemeInfo
  ): AIAnalysisRequest {
    Logger.debug('AI 분석 요청 생성', { 
      textLength: originalText.length,
      correctionsCount: corrections.length 
    });

    return {
      originalText,
      corrections,
      currentStates: currentStates || {},
      morphemeData,
      contextWindow: this.settings.contextWindow || 50,
      enhancedContext: true,
      editor: undefined, // 팝업에서는 에디터 정보 불필요
      file: undefined    // 팝업에서는 파일 정보 불필요
    };
  }

  /**
   * AI 분석 결과를 검증합니다.
   */
  public validateAnalysisResults(
    results: AIAnalysisResult[], 
    originalCorrections: Correction[]
  ): { valid: AIAnalysisResult[], invalid: AIAnalysisResult[] } {
    const valid: AIAnalysisResult[] = [];
    const invalid: AIAnalysisResult[] = [];

    results.forEach(result => {
      // 기본 검증
      if (result.correctionIndex < 0 || 
          result.correctionIndex >= originalCorrections.length ||
          !result.selectedValue ||
          result.confidence < 0 || 
          result.confidence > 100) {
        
        Logger.warn('AI 분석 결과 검증 실패:', result);
        invalid.push(result);
        return;
      }

      valid.push(result);
    });

    Logger.log('AI 분석 결과 검증 완료', { 
      validCount: valid.length, 
      invalidCount: invalid.length 
    });

    return { valid, invalid };
  }

  /**
   * AI 분석 결과를 사용자에게 표시할 수 있는 형태로 변환합니다.
   */
  public formatAnalysisResults(results: AIAnalysisResult[]): string {
    if (results.length === 0) {
      return 'AI 분석 결과가 없습니다.';
    }

    const summary = results.map((result, index) => {
      const confidence = `${result.confidence}%`;
      const action = result.isExceptionProcessed ? '예외처리' : '수정 적용';
      const reasoning = result.reasoning || '이유 없음';
      
      return `${index + 1}. [${confidence}] ${action}: "${result.selectedValue}" - ${reasoning}`;
    });

    const avgConfidence = Math.round(
      results.reduce((sum, r) => sum + r.confidence, 0) / results.length
    );

    return [
      `🤖 AI 분석 완료 (총 ${results.length}개, 평균 신뢰도: ${avgConfidence}%)`,
      '',
      ...summary
    ].join('\n');
  }

  /**
   * 설정을 업데이트합니다.
   */
  public updateSettings(newSettings: AISettings): void {
    Logger.log('AI 설정 업데이트');
    
    this.settings = newSettings;
    
    // 설정 변경 시 서비스 재초기화
    if (this.hasValidSettings()) {
      this.aiAnalysisService = new AIAnalysisService(this.settings);
      if (this.tokenCalculator) {
        this.tokenCalculator.updateSettings(newSettings);
      }
    } else {
      this.aiAnalysisService = undefined;
    }
  }

  /**
   * AI 분석 통계를 반환합니다.
   */
  public getAnalysisStats(): {
    isAvailable: boolean;
    isAnalyzing: boolean;
    lastResultsCount: number;
    averageConfidence: number;
    provider: string;
  } {
    const avgConfidence = this.lastAnalysisResults.length > 0
      ? Math.round(this.lastAnalysisResults.reduce((sum, r) => sum + r.confidence, 0) / this.lastAnalysisResults.length)
      : 0;

    return {
      isAvailable: this.isAIAvailable(),
      isAnalyzing: this.isAnalyzing,
      lastResultsCount: this.lastAnalysisResults.length,
      averageConfidence: avgConfidence,
      provider: this.settings.provider || 'none'
    };
  }
}