/**
 * 토큰 사용량 경고 모달 유틸리티
 * correctionPopup과 인라인 모드에서 공통으로 사용
 */

import { Logger } from './logger';
import { Notice, Platform, MarkdownView } from 'obsidian';
import type { AIAnalysisRequest } from '../types/interfaces';

export interface TokenUsage {
  inputTokens: number;
  estimatedOutputTokens: number;
  totalEstimated: number;
  estimatedCost: string;
  morphemeOptimized?: boolean;
}

export interface TokenWarningSettings {
  showTokenWarning: boolean;
  tokenWarningThreshold: number;
  maxTokens: number;
}

export class TokenWarningModal {
  
  /**
   * 토큰 사용량 경고를 확인하고 사용자 확인을 받습니다.
   */
  static async checkTokenUsageWarning(
    request: AIAnalysisRequest, 
    aiService: any,
    settings: TokenWarningSettings,
    onSettingsUpdate?: (newMaxTokens: number) => void
  ): Promise<boolean> {
    Logger.log('🔍 TokenWarningModal.checkTokenUsageWarning 시작');
    
    // AI 서비스에서 설정 확인
    const aiSettings = aiService?.getProviderInfo();
    Logger.log('🔍 AI 서비스 정보:', aiSettings);
    
    if (!aiService || !aiSettings?.available) {
      Logger.warn('AI 서비스를 사용할 수 없습니다.');
      return false;
    }

    const showWarning = settings.showTokenWarning;
    const threshold = settings.tokenWarningThreshold;
    const maxTokens = settings.maxTokens;
    
    Logger.log('🔍 토큰 경고 설정 확인:', { showWarning, threshold, maxTokens });
    
    if (!showWarning) {
      Logger.log('🔍 토큰 경고가 비활성화되어 있어서 바로 진행');
      return true; // 경고 비활성화된 경우
    }

    // 토큰 사용량 추정
    Logger.log('🔍 토큰 사용량 추정 시작');
    const tokenUsage = await this.estimateTokenUsageWithMorphemes(request, aiService);
    const isOverMaxTokens = tokenUsage.totalEstimated > maxTokens;
    
    // 디버깅: 토큰 사용량 확인
    Logger.log('🔍 토큰 경고 모달 토큰 사용량:', {
      total: tokenUsage.totalEstimated,
      input: tokenUsage.inputTokens,
      output: tokenUsage.estimatedOutputTokens,
      cost: tokenUsage.estimatedCost,
      morphemeOptimized: tokenUsage.morphemeOptimized,
      threshold,
      maxTokens,
      isOverThreshold: tokenUsage.totalEstimated >= threshold,
      isOverMaxTokens
    });
    
    if (tokenUsage.totalEstimated < threshold && !isOverMaxTokens) {
      Logger.log('🔍 임계값 미만이고 최대 토큰 이내라서 바로 진행');
      return true; // 임계값 미만이고 최대 토큰 이내면 바로 진행
    }

    Logger.log('🔍 토큰 경고 모달 표시 조건 만족 - 모달 표시 시작');

    // 확인 모달 표시
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay kga-token-warning-overlay korean-grammar-token-modal';

      const modalContent = this.createTokenWarningModal(tokenUsage, isOverMaxTokens, maxTokens);
      modal.appendChild(modalContent);

      // 🔧 모바일에서 배경 커서/입력 차단 및 키보드 숨김
      if (Platform.isMobile) {
        document.body.classList.add('spell-popup-open');
        this.hideKeyboardAndBlurEditor();
        Logger.debug('📱 토큰 모달: spell-popup-open 클래스 추가 및 키보드 숨김 처리');
      }

      document.body.appendChild(modal);
      
      // 포커스 설정 (약간의 지연)
      setTimeout(() => {
        modal.focus();
        Logger.debug('토큰 경고 모달: 포커스 설정 완료');
      }, 10);

      // 이벤트 처리
      let handleResponse = (action: 'cancel' | 'proceed' | 'updateSettings') => {
        // 🔧 모바일에서 배경 입력 차단 해제 (CorrectionPopup과 동일한 방식)
        if (Platform.isMobile) {
          document.body.classList.remove('spell-popup-open');
          Logger.debug('📱 토큰 모달: spell-popup-open 클래스 제거로 배경 입력 복원');
        }
        
        modal.remove();
        
        if (action === 'proceed') {
          Logger.log('토큰 경고 모달: 사용자가 계속 진행을 선택했습니다.');
          resolve(true);
        } else if (action === 'updateSettings') {
          Logger.log('토큰 경고 모달: 사용자가 설정 업데이트를 선택했습니다.');
          // 설정 업데이트 후 진행
          if (onSettingsUpdate) {
            const newMaxTokens = tokenUsage.totalEstimated + 1000; // 여유분 추가
            onSettingsUpdate(newMaxTokens);
          }
          resolve(true);
        } else {
          Logger.log('토큰 경고 모달: 사용자가 취소를 선택했습니다.');
          resolve(false);
        }
      };

      // 키보드 이벤트 처리 (모든 키 이벤트 차단)
      const handleKeyboard = (e: KeyboardEvent) => {
        Logger.debug(`토큰 경고 모달: 키 이벤트 감지 - ${e.key} (코드: ${e.code})`);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        if (e.key === 'Enter') {
          Logger.debug('토큰 경고 모달: Enter키 감지 - 진행');
          handleResponse('proceed');
        } else if (e.key === 'Escape') {
          Logger.debug('토큰 경고 모달: Escape키 감지 - 취소');
          handleResponse('cancel');
        }
        // 다른 모든 키 이벤트는 무시하고 전파 차단
      };

      // 이벤트 리스너 등록 (캡처 단계에서 모든 이벤트 차단)
      modal.addEventListener('keydown', handleKeyboard, { capture: true });
      
      // 글로벌 키보드 이벤트도 차단 (모달이 최상위에서 모든 키 입력 처리)
      const globalKeyHandler = (e: KeyboardEvent) => {
        if (document.body.contains(modal)) {
          Logger.debug(`토큰 경고 모달: 글로벌 키 이벤트 차단 - ${e.key}`);
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          // 글로벌 레벨에서도 키 처리
          if (e.key === 'Enter') {
            Logger.debug('토큰 경고 모달: 글로벌 Enter키 감지 - 진행');
            handleResponse('proceed');
          } else if (e.key === 'Escape') {
            Logger.debug('토큰 경고 모달: 글로벌 Escape키 감지 - 취소');
            handleResponse('cancel');
          }
        }
      };
      
      window.addEventListener('keydown', globalKeyHandler, { capture: true });
      
      // 정리 함수 래핑 (메모리 누수 방지)
      const originalHandleResponse = handleResponse;
      handleResponse = (action: 'cancel' | 'proceed' | 'updateSettings') => {
        // 이벤트 리스너 제거
        modal.removeEventListener('keydown', handleKeyboard, { capture: true });
        window.removeEventListener('keydown', globalKeyHandler, { capture: true });
        
        Logger.debug('토큰 경고 모달: 모든 이벤트 리스너 제거 완료');
        originalHandleResponse(action);
      };

      modal.querySelector('#token-warning-cancel')?.addEventListener('click', () => handleResponse('cancel'));
      modal.querySelector('#token-warning-proceed')?.addEventListener('click', () => handleResponse('proceed'));
      modal.querySelector('#token-warning-update-settings')?.addEventListener('click', () => handleResponse('updateSettings'));
    });
  }

  /**
   * 토큰 경고 모달의 DOM 구조를 생성합니다.
   */
  private static createTokenWarningModal(tokenUsage: TokenUsage, isOverMaxTokens: boolean, maxTokens: number): HTMLElement {
    const content = document.createElement('div');
    content.className = 'kga-token-warning-content';

    const headerInfo = content.appendChild(document.createElement('div'));
    headerInfo.className = 'kga-token-warning-header';

    const title = headerInfo.appendChild(document.createElement('h3'));
    title.className = 'kga-token-warning-title';
    title.textContent = isOverMaxTokens ? '토큰 사용량 확인' : '토큰 사용량 안내';

    const description = headerInfo.appendChild(document.createElement('p'));
    description.className = 'kga-token-warning-description';
    description.textContent = isOverMaxTokens ? '설정된 한계를 초과했습니다' : '예상 사용량이 높습니다';

    const details = content.appendChild(document.createElement('div'));
    details.className = 'kga-token-warning-details';

    const stats = details.appendChild(document.createElement('div'));
    stats.className = 'kga-token-warning-stats';

    const totalTokenItem = stats.appendChild(document.createElement('div'));
    totalTokenItem.className = 'kga-token-stat-item';

    const totalTokenNumber = totalTokenItem.appendChild(document.createElement('div'));
    totalTokenNumber.className = 'kga-token-stat-number';
    totalTokenNumber.textContent = tokenUsage.totalEstimated.toLocaleString();

    const totalTokenLabel = totalTokenItem.appendChild(document.createElement('div'));
    totalTokenLabel.className = 'kga-token-stat-label';
    totalTokenLabel.textContent = '총 토큰';

    const costItem = stats.appendChild(document.createElement('div'));
    costItem.className = 'kga-token-stat-item';

    const costNumber = costItem.appendChild(document.createElement('div'));
    costNumber.className = 'kga-token-stat-number';
    costNumber.textContent = tokenUsage.estimatedCost;

    const costLabel = costItem.appendChild(document.createElement('div'));
    costLabel.className = 'kga-token-stat-label';
    costLabel.textContent = '예상 비용';

    const rec = details.appendChild(document.createElement('div'));
    rec.className = 'kga-token-warning-recommendation';

    const recText = rec.appendChild(document.createElement('div'));
    recText.className = 'kga-token-warning-recommendation-text';
    recText.textContent = `입력: ${tokenUsage.inputTokens.toLocaleString()} • 출력: ${tokenUsage.estimatedOutputTokens.toLocaleString()}`;

    if (isOverMaxTokens) {
      const overLimit = content.appendChild(document.createElement('div'));
      overLimit.className = 'kga-token-warning-over-limit';

      const overLimitIcon = overLimit.appendChild(document.createElement('div'));
      overLimitIcon.className = 'kga-token-warning-over-limit-icon';
      overLimitIcon.textContent = '⚠️';

      const overLimitText = overLimit.appendChild(document.createElement('div'));
      overLimitText.className = 'kga-token-warning-over-limit-text';

      const overLimitTitle = overLimitText.appendChild(document.createElement('div'));
      overLimitTitle.className = 'kga-token-warning-over-limit-title';
      overLimitTitle.textContent = '설정된 최대 토큰을 초과했습니다';

      const overLimitDesc = overLimitText.appendChild(document.createElement('div'));
      overLimitDesc.className = 'kga-token-warning-over-limit-description';
      overLimitDesc.textContent = `현재 설정: ${maxTokens.toLocaleString()} 토큰 → 초과량: ${(tokenUsage.totalEstimated - maxTokens).toLocaleString()} 토큰`;
    }

    const actions = content.appendChild(document.createElement('div'));
    actions.className = 'kga-token-warning-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'token-warning-cancel';
    cancelBtn.className = 'kga-token-warning-btn kga-token-warning-btn-cancel';
    cancelBtn.textContent = '취소';
    actions.appendChild(cancelBtn);

    if (isOverMaxTokens) {
      const updateBtn = document.createElement('button');
      updateBtn.id = 'token-warning-update-settings';
      updateBtn.className = 'kga-token-warning-btn kga-token-warning-btn-settings';
      updateBtn.textContent = '설정 업데이트 후 진행';
      actions.appendChild(updateBtn);
    }

    const proceedBtn = document.createElement('button');
    proceedBtn.id = 'token-warning-proceed';
    proceedBtn.className = 'kga-token-warning-btn kga-token-warning-btn-proceed';
    proceedBtn.textContent = isOverMaxTokens ? '강제 진행' : '계속 진행';
    actions.appendChild(proceedBtn);

    return content;
  }

  /**
   * 형태소 최적화를 고려한 토큰 사용량을 추정합니다.
   */
  private static async estimateTokenUsageWithMorphemes(request: AIAnalysisRequest, aiService: any): Promise<TokenUsage> {
    try {
      Logger.log('🔍 토큰 추정 시작 - 요청 정보:', {
        correctionsCount: request.corrections.length,
        contextWindow: request.contextWindow,
        originalTextLength: request.originalText?.length || 0
      });

      // 효율성을 위해 토큰 경고에서는 형태소 분석 호출하지 않음
      // 대신 교정 개수를 기반으로 최적화 효과 추정
      const hasMultipleCorrections = request.corrections.length > 1;
      const morphemeOptimized = hasMultipleCorrections; // 복수 교정 시 최적화 효과 예상
      
      Logger.log('🔍 토큰 경고용 형태소 최적화 추정:', {
        correctionsCount: request.corrections.length,
        estimatedOptimization: morphemeOptimized,
        reason: morphemeOptimized ? '복수 교정으로 컨텍스트 축소 예상' : '단일 교정으로 최적화 불필요'
      });
      
      // 최적화된 요청 생성
      const adjustedRequest = {
        ...request,
        contextWindow: morphemeOptimized ? 30 : 100, // 형태소 최적화 시 컨텍스트 축소
      };
      
      // 기본 토큰 추정
      Logger.log('🔍 AI 서비스 토큰 추정 호출 전');
      const baseEstimation = aiService?.estimateTokenUsage(adjustedRequest) || {
        inputTokens: 0,
        estimatedOutputTokens: 0,
        totalEstimated: 0,
        estimatedCost: '$0.00'
      };
      Logger.log('🔍 AI 서비스 토큰 추정 결과:', baseEstimation);
      
      // 형태소 정보 토큰 추가 (간소화된 형태)
      const morphemeTokens = morphemeOptimized ? 50 : 0; // 형태소 분석 메타데이터
      
      const finalEstimation = {
        inputTokens: baseEstimation.inputTokens + morphemeTokens,
        estimatedOutputTokens: baseEstimation.estimatedOutputTokens,
        totalEstimated: baseEstimation.totalEstimated + morphemeTokens,
        estimatedCost: baseEstimation.estimatedCost,
        morphemeOptimized
      };
      
      Logger.debug('형태소 최적화 반영 토큰 추정:', {
        before: baseEstimation.totalEstimated,
        after: finalEstimation.totalEstimated,
        contextReduction: morphemeOptimized ? (100 - 30) : 0, // 70토큰 절약
        morphemeTokens,
        netChange: morphemeOptimized ? (morphemeTokens - 70) : 0, // 순 변화량
        optimized: morphemeOptimized
      });
      
      return finalEstimation;
      
    } catch (error) {
      Logger.error('토큰 추정 실패, 기본값 사용:', error);
      
      // 실패 시 기본 추정 사용
      const fallbackEstimation = aiService?.estimateTokenUsage(request) || {
        inputTokens: 0,
        estimatedOutputTokens: 0,
        totalEstimated: 0,
        estimatedCost: '$0.00'
      };
      
      Logger.warn('폴백 토큰 추정 사용:', fallbackEstimation);
      
      return {
        ...fallbackEstimation,
        morphemeOptimized: false
      };
    }
  }

  /**
   * 🔧 모바일에서 키보드 숨기기 및 에디터 포커스 해제 (인라인 툴팁과 동일한 로직)
   */
  private static hideKeyboardAndBlurEditor(): void {
    try {
      // 1. 옵시디언 API를 통한 에디터 포커스 해제 (window를 통한 접근)
      const obsidianApp = (window as any).app;
      if (obsidianApp) {
        const activeView = obsidianApp.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.editor) {
          // 에디터가 포커스되어 있는지 확인 후 포커스 해제
          if ((activeView.editor as any).hasFocus?.()) {
            Logger.log('📱 토큰 모달: 에디터 포커스 해제 시작');
            (activeView.editor as any).blur?.();
            
            // CodeMirror 에디터 직접 접근
            const cmEditor = (activeView.editor as any).cm;
            if (cmEditor && cmEditor.dom) {
              (cmEditor.dom as HTMLElement).blur();
            }
          }
        }
      }

      // 2. DOM 레벨에서 모든 포커스 가능한 요소 포커스 해제
      const focusedElement = document.activeElement as HTMLElement;
      if (focusedElement && focusedElement.blur) {
        focusedElement.blur();
        Logger.log('📱 토큰 모달: DOM 포커스 해제 완료');
      }

      // 3. CodeMirror 에디터 포커스 해제 (추가 안전장치)
      const cmEditors = document.querySelectorAll('.cm-editor .cm-content');
      cmEditors.forEach(editor => {
        if (editor instanceof HTMLElement) {
          editor.blur();
        }
      });

      // 4. 키보드 숨기기를 위한 더미 input 생성 및 포커스/블러
      const hiddenInput = document.createElement('input');
      hiddenInput.classList.add('kga-stealth-input');
      document.body.appendChild(hiddenInput);
      
      // 짧은 시간 후 포커스 후 즉시 블러하여 키보드 숨기기
      setTimeout(() => {
        hiddenInput.focus();
        setTimeout(() => {
          hiddenInput.blur();
          document.body.removeChild(hiddenInput);
          Logger.log('📱 토큰 모달: 키보드 숨김 처리 완료');
        }, 50);
      }, 100);

    } catch (error) {
      Logger.warn('📱 토큰 모달 키보드 숨김 중 오류:', error);
    }
  }

}
