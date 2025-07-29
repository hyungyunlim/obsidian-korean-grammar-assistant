import { IPopupServiceManager, RenderContext } from '../types/PopupTypes';
import { AISettings, AIAnalysisRequest, CorrectionContext } from '../../types/interfaces';
import { estimateAnalysisTokenUsage, estimateCost } from '../../utils/tokenEstimator';
import { TokenUsage, TokenWarningSettings, TokenWarningModal } from '../../utils/tokenWarningModal';
import { Logger } from '../../utils/logger';
import { Notice } from 'obsidian';

/**
 * Phase 5: Token Calculator
 * 
 * AI 토큰 계산 및 사용량 경고를 관리하는 모듈입니다.
 * 기존 tokenEstimator와 tokenWarningModal을 래핑하여 팝업에서 사용합니다.
 */
export class TokenCalculator implements IPopupServiceManager {
  private warningSettings: TokenWarningSettings;
  private lastTokenUsage?: TokenUsage;

  constructor(private settings: AISettings) {
    // 기본 경고 설정
    this.warningSettings = {
      showTokenWarning: settings.showTokenWarning ?? true,
      tokenWarningThreshold: settings.tokenWarningThreshold ?? 1000,
      maxTokens: settings.maxTokens ?? 8000
    };

    Logger.log('TokenCalculator 초기화됨', this.warningSettings);
  }

  /**
   * IPopupServiceManager 인터페이스 구현
   */
  async initialize(context: RenderContext): Promise<void> {
    Logger.debug('TokenCalculator 초기화 시작');
    
    // 초기화 시 특별한 작업은 없음 (지연 로딩 방식)
    this.lastTokenUsage = undefined;
    
    Logger.debug('TokenCalculator 초기화 완료');
  }

  /**
   * IPopupServiceManager 인터페이스 구현
   */
  destroy(): void {
    Logger.debug('TokenCalculator 정리 중');
    
    this.lastTokenUsage = undefined;
    
    Logger.debug('TokenCalculator 정리 완료');
  }

  /**
   * AI 분석 요청의 토큰 사용량을 계산합니다.
   */
  public async calculateTokenUsage(request: AIAnalysisRequest): Promise<TokenUsage> {
    Logger.debug('토큰 사용량 계산 시작', { 
      correctionsCount: request.corrections.length,
      contextWindow: request.contextWindow 
    });

    try {
      // CorrectionContext 배열 생성
      const correctionContexts = request.corrections.map((correction, index) => ({
        correctionIndex: index,
        original: correction.original,
        corrected: correction.corrected,
        help: correction.help || '',
        contextBefore: '',
        contextAfter: '',
        fullContext: correction.original
      }));

      // 기존 tokenEstimator 사용
      const basicTokenUsage = estimateAnalysisTokenUsage(correctionContexts);
      
      // TokenUsage 형태로 변환
      const tokenUsage: TokenUsage = {
        inputTokens: basicTokenUsage.inputTokens,
        estimatedOutputTokens: basicTokenUsage.estimatedOutputTokens,
        totalEstimated: basicTokenUsage.totalEstimated,
        estimatedCost: estimateCost(basicTokenUsage.totalEstimated, this.settings.provider || 'openai'),
        morphemeOptimized: false // 기본값
      };

      this.lastTokenUsage = tokenUsage;

      Logger.log('토큰 사용량 계산 완료', {
        inputTokens: tokenUsage.inputTokens,
        totalEstimated: tokenUsage.totalEstimated,
        estimatedCost: tokenUsage.estimatedCost,
        morphemeOptimized: tokenUsage.morphemeOptimized
      });

      return tokenUsage;

    } catch (error) {
      Logger.error('토큰 사용량 계산 중 오류:', error);
      
      // 오류 발생 시 기본값 반환
      const fallbackUsage: TokenUsage = {
        inputTokens: 0,
        estimatedOutputTokens: 0,
        totalEstimated: 0,
        estimatedCost: '$0.00',
        morphemeOptimized: false
      };

      this.lastTokenUsage = fallbackUsage;
      return fallbackUsage;
    }
  }

  /**
   * 토큰 제한을 확인하고 필요시 사용자에게 경고를 표시합니다.
   */
  public async checkTokenLimits(tokenUsage: TokenUsage): Promise<boolean> {
    Logger.debug('토큰 제한 확인', {
      totalTokens: tokenUsage.totalEstimated,
      threshold: this.warningSettings.tokenWarningThreshold,
      showWarning: this.warningSettings.showTokenWarning
    });

    // 경고가 비활성화된 경우 바로 허용
    if (!this.warningSettings.showTokenWarning) {
      Logger.debug('토큰 경고가 비활성화됨 - 바로 진행');
      return true;
    }

    // 임계값 미만인 경우 바로 허용
    if (tokenUsage.totalEstimated < this.warningSettings.tokenWarningThreshold) {
      Logger.debug('토큰 사용량이 임계값 미만 - 바로 진행');
      return true;
    }

    // 최대 토큰 초과인 경우 거부
    if (tokenUsage.totalEstimated > this.warningSettings.maxTokens) {
      Logger.warn('토큰 사용량이 최대값 초과', {
        estimated: tokenUsage.totalEstimated,
        max: this.warningSettings.maxTokens
      });
      
      // 에러 모달 표시
      this.showTokenLimitError(tokenUsage);
      return false;
    }

    // 임계값 초과 시 경고 모달 표시
    try {
      Logger.log('토큰 경고 모달 표시', {
        estimated: tokenUsage.totalEstimated,
        cost: tokenUsage.estimatedCost
      });

      // TokenWarningModal을 사용하여 사용자 확인 받기
      const userApproved = await this.showTokenWarningModal(tokenUsage);
      
      Logger.log('사용자 토큰 경고 응답', { approved: userApproved });
      return userApproved;

    } catch (error) {
      Logger.error('토큰 경고 모달 표시 중 오류:', error);
      return false;
    }
  }

  /**
   * 토큰 경고 모달을 표시합니다.
   */
  private async showTokenWarningModal(tokenUsage: TokenUsage): Promise<boolean> {
    return new Promise((resolve) => {
      // 모달 컨테이너 생성
      const modal = document.createElement('div');
      modal.className = 'modal-container token-warning-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      `;

      // 모달 콘텐츠
      const content = document.createElement('div');
      content.className = 'modal token-warning-content';
      content.style.cssText = `
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        padding: 24px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      `;

      content.innerHTML = `
        <div class="modal-title" style="font-size: 18px; font-weight: 600; margin-bottom: 16px; color: var(--text-normal);">
          🚨 토큰 사용량 경고
        </div>
        <div class="modal-content" style="margin-bottom: 20px; color: var(--text-normal);">
          <p>AI 분석에 많은 토큰이 사용될 예정입니다:</p>
          <div style="background: var(--background-secondary); padding: 12px; border-radius: 4px; margin: 12px 0;">
            <div><strong>예상 토큰:</strong> ${tokenUsage.totalEstimated.toLocaleString()}개</div>
            <div><strong>예상 비용:</strong> ${tokenUsage.estimatedCost}</div>
            ${tokenUsage.morphemeOptimized ? '<div style="color: var(--text-accent);"><strong>✓ 형태소 최적화 적용됨</strong></div>' : ''}
          </div>
          <p>계속 진행하시겠습니까?</p>
        </div>
        <div class="modal-button-container" style="display: flex; gap: 8px; justify-content: flex-end;">
          <button class="mod-cta token-warning-proceed" style="background: var(--interactive-accent); color: var(--text-on-accent);">
            진행
          </button>
          <button class="token-warning-cancel">
            취소
          </button>
        </div>
      `;

      modal.appendChild(content);
      document.body.appendChild(modal);

      // 버튼 이벤트
      const proceedBtn = content.querySelector('.token-warning-proceed') as HTMLButtonElement;
      const cancelBtn = content.querySelector('.token-warning-cancel') as HTMLButtonElement;

      const cleanup = () => {
        document.body.removeChild(modal);
      };

      proceedBtn?.addEventListener('click', () => {
        cleanup();
        resolve(true);
      });

      cancelBtn?.addEventListener('click', () => {
        cleanup();
        resolve(false);
      });

      // ESC 키 처리
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          cleanup();
          document.removeEventListener('keydown', handleKeyDown);
          resolve(false);
        }
      };
      document.addEventListener('keydown', handleKeyDown);

      // 모달 외부 클릭 처리
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          cleanup();
          resolve(false);
        }
      });
    });
  }

  /**
   * 토큰 한도 초과 에러를 표시합니다.
   */
  private showTokenLimitError(tokenUsage: TokenUsage): void {
    // Obsidian Notice 사용
    new Notice(
      `토큰 사용량이 너무 많습니다 (${tokenUsage.totalEstimated}개). 최대 ${this.warningSettings.maxTokens}개까지 허용됩니다.`,
      5000
    );
  }

  /**
   * 마지막 토큰 사용량을 반환합니다.
   */
  public getLastTokenUsage(): TokenUsage | undefined {
    return this.lastTokenUsage;
  }

  /**
   * 토큰 사용량을 사용자 친화적 문자열로 변환합니다.
   */
  public formatTokenUsage(tokenUsage: TokenUsage): string {
    const { inputTokens, estimatedOutputTokens, totalEstimated, estimatedCost, morphemeOptimized } = tokenUsage;

    const lines = [
      `입력 토큰: ${inputTokens.toLocaleString()}개`,
      `출력 토큰: ${estimatedOutputTokens.toLocaleString()}개 (예상)`,
      `총 토큰: ${totalEstimated.toLocaleString()}개`,
      `예상 비용: ${estimatedCost}`
    ];

    if (morphemeOptimized) {
      lines.push('✓ 형태소 분석 최적화 적용');
    }

    return lines.join('\n');
  }

  /**
   * 토큰 계산 설정을 업데이트합니다.
   */
  public updateSettings(newSettings: AISettings): void {
    Logger.debug('TokenCalculator 설정 업데이트');
    
    this.settings = newSettings;
    this.warningSettings = {
      showTokenWarning: newSettings.showTokenWarning ?? true,
      tokenWarningThreshold: newSettings.tokenWarningThreshold ?? 1000,
      maxTokens: newSettings.maxTokens ?? 8000
    };
  }

  /**
   * 현재 토큰 설정 정보를 반환합니다.
   */
  public getTokenSettings(): TokenWarningSettings {
    return { ...this.warningSettings };
  }

  /**
   * 토큰 통계를 반환합니다.
   */
  public getTokenStats(): {
    lastUsage?: TokenUsage;
    settings: TokenWarningSettings;
    isWithinLimits: boolean;
  } {
    const isWithinLimits = this.lastTokenUsage ? 
      this.lastTokenUsage.totalEstimated <= this.warningSettings.maxTokens : 
      true;

    return {
      lastUsage: this.lastTokenUsage,
      settings: this.warningSettings,
      isWithinLimits
    };
  }
}