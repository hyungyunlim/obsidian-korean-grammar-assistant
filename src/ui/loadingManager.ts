import { Notice } from 'obsidian';
import { Logger } from '../utils/logger';

/**
 * 로딩 상태 타입
 */
export type LoadingState = 'idle' | 'analyzing' | 'ai_processing' | 'applying' | 'error';

/**
 * 로딩 단계 인터페이스
 */
interface LoadingStep {
  id: string;
  title: string;
  description: string;
  estimatedDuration: number; // 예상 시간 (ms)
  icon: string;
}

/**
 * 진행률 정보 인터페이스
 */
interface ProgressInfo {
  currentStep: number;
  totalSteps: number;
  percentage: number;
  message: string;
  elapsedTime: number;
  estimatedRemaining: number;
}

/**
 * 고급 로딩 상태 관리자
 * 단계별 진행률, 예상 시간, 시각적 피드백 제공
 */
export class LoadingManager {
  private static instance: LoadingManager | null = null;
  private currentState: LoadingState = 'idle';
  private currentNotice: Notice | null = null;
  private progressElement: HTMLElement | null = null;
  private startTime: number = 0;
  private currentStep: number = 0;
  private steps: LoadingStep[] = [];
  private onStateChangeCallback?: (state: LoadingState, progress?: ProgressInfo) => void;
  
  // 기본 로딩 단계들
  private readonly defaultSteps: LoadingStep[] = [
    {
      id: 'text_analysis',
      title: '텍스트 분석',
      description: '입력된 텍스트를 처리하고 분석합니다',
      estimatedDuration: 1000,
      icon: '📝'
    },
    {
      id: 'api_request',
      title: 'API 요청',
      description: 'Bareun.ai 서버에 맞춤법 검사를 요청합니다',
      estimatedDuration: 3000,
      icon: '🌐'
    },
    {
      id: 'result_parsing',
      title: '결과 처리',
      description: '검사 결과를 분석하고 오류를 분류합니다',
      estimatedDuration: 800,
      icon: '⚙️'
    },
    {
      id: 'ui_preparation',
      title: 'UI 준비',
      description: '교정 인터페이스를 준비합니다',
      estimatedDuration: 500,
      icon: '🎨'
    }
  ];

  private readonly aiSteps: LoadingStep[] = [
    {
      id: 'ai_context_preparation',
      title: 'AI 컨텍스트 준비',
      description: '맞춤법 오류와 주변 맥락을 AI에게 제공할 형태로 가공합니다',
      estimatedDuration: 500,
      icon: '🤖'
    },
    {
      id: 'ai_analysis',
      title: 'AI 분석',
      description: 'AI가 최적의 수정사항을 분석하고 있습니다',
      estimatedDuration: 5000,
      icon: '🧠'
    },
    {
      id: 'ai_result_processing',
      title: 'AI 결과 처리',
      description: 'AI 분석 결과를 검증하고 적용합니다',
      estimatedDuration: 800,
      icon: '✨'
    }
  ];

  private constructor() {
    Logger.debug('LoadingManager 초기화');
  }

  /**
   * 싱글톤 인스턴스 반환
   */
  static getInstance(): LoadingManager {
    if (!LoadingManager.instance) {
      LoadingManager.instance = new LoadingManager();
    }
    return LoadingManager.instance;
  }

  /**
   * 상태 변경 콜백 등록
   */
  onStateChange(callback: (state: LoadingState, progress?: ProgressInfo) => void): void {
    this.onStateChangeCallback = callback;
  }

  /**
   * 로딩 시작 (기본 맞춤법 검사)
   */
  startLoading(includeAI: boolean = false): void {
    this.steps = includeAI 
      ? [...this.defaultSteps, ...this.aiSteps]
      : [...this.defaultSteps];
    
    this.currentState = 'analyzing';
    this.currentStep = 0;
    this.startTime = Date.now();
    
    Logger.debug('로딩 시작:', { includeAI, totalSteps: this.steps.length });
    
    this.showProgressNotice();
    this.updateProgress();
  }

  /**
   * 다음 단계로 진행
   */
  nextStep(): void {
    if (this.currentStep < this.steps.length - 1) {
      this.currentStep++;
      this.updateProgress();
      
      Logger.debug(`단계 진행: ${this.currentStep + 1}/${this.steps.length}`, {
        currentStep: this.steps[this.currentStep]
      });
    }
  }

  /**
   * 특정 단계로 점프
   */
  setStep(stepId: string): void {
    const stepIndex = this.steps.findIndex(step => step.id === stepId);
    if (stepIndex !== -1) {
      this.currentStep = stepIndex;
      this.updateProgress();
      
      Logger.debug('단계 설정:', { stepId, stepIndex });
    }
  }

  /**
   * 로딩 완료
   */
  complete(): void {
    this.currentState = 'idle';
    this.hideNotice();
    
    const totalTime = Date.now() - this.startTime;
    Logger.debug('로딩 완료:', { totalTime: `${totalTime}ms` });
    
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback('idle');
    }
  }

  /**
   * 에러 상태로 변경
   */
  error(message: string): void {
    this.currentState = 'error';
    this.hideNotice();
    
    // 에러 메시지 표시
    new Notice(`❌ ${message}`, 5000);
    
    Logger.error('로딩 에러:', { message });
    
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback('error');
    }
  }

  /**
   * 현재 상태 반환
   */
  getState(): LoadingState {
    return this.currentState;
  }

  /**
   * 진행률 정보 반환
   */
  getProgress(): ProgressInfo {
    const elapsedTime = Date.now() - this.startTime;
    const currentStepInfo = this.steps[this.currentStep];
    
    // 전체 예상 시간 계산
    const totalEstimatedTime = this.steps.reduce((sum, step) => sum + step.estimatedDuration, 0);
    
    // 현재까지 완료된 시간 + 현재 단계 진행률
    const completedTime = this.steps.slice(0, this.currentStep).reduce((sum, step) => sum + step.estimatedDuration, 0);
    const currentStepProgress = Math.min(elapsedTime - completedTime, currentStepInfo?.estimatedDuration || 0);
    const totalProgress = completedTime + currentStepProgress;
    
    const percentage = Math.min(95, Math.round((totalProgress / totalEstimatedTime) * 100));
    const estimatedRemaining = Math.max(0, totalEstimatedTime - totalProgress);
    
    return {
      currentStep: this.currentStep + 1,
      totalSteps: this.steps.length,
      percentage,
      message: currentStepInfo?.description || '처리 중...',
      elapsedTime,
      estimatedRemaining
    };
  }

  /**
   * 수동으로 진행률 업데이트
   */
  setCustomProgress(percentage: number, message: string): void {
    if (this.progressElement) {
      this.updateProgressDisplay(percentage, message);
    }
  }

  /**
   * 로딩 취소
   */
  cancel(): void {
    this.currentState = 'idle';
    this.hideNotice();
    
    Logger.debug('로딩 취소됨');
    
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback('idle');
    }
  }

  /**
   * 컴팩트한 토스트 스타일 진행률 표시 생성
   */
  private showProgressNotice(): void {
    this.hideNotice();
    
    // 커스텀 토스트 컨테이너 생성 (styles are defined in styles.css)
    const toastContainer = activeDocument.body.createDiv({
      cls: 'spell-check-toast'
    });
    
    this.progressElement = toastContainer;
    
    // Notice 객체 흉내 (호환성을 위해)
    this.currentNotice = {
      hide: () => {
        toastContainer.addClass('kga-slide-out-down');
        window.setTimeout(() => {
          toastContainer.remove();
        }, 200);
      }
    } as unknown as Notice;
  }

  /**
   * 진행률 업데이트
   */
  private updateProgress(): void {
    if (!this.progressElement) return;
    
    const progress = this.getProgress();
    this.updateProgressDisplay(progress.percentage, progress.message);
    
    // 상태 변경 콜백 호출
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(this.currentState, progress);
    }
  }

  /**
   * 컴팩트한 진행률 디스플레이 업데이트
   */
  private updateProgressDisplay(percentage: number, message: string): void {
    if (!this.progressElement) return;
    
    const currentStepInfo = this.steps[this.currentStep];
    const progress = this.getProgress();
    
    // 기존 내용 제거
    this.progressElement.empty();
    
    // 헤더 영역 (아이콘 + 제목)
    const header = this.progressElement.createDiv({
      cls: 'kga-loading-progress-header'
    });
    
    header.createSpan({ 
      text: currentStepInfo?.icon || '⏳',
      cls: 'kga-loading-progress-icon'
    });
    
    const titleContainer = header.createDiv({ 
      cls: 'kga-loading-progress-title-container'
    });
    
    titleContainer.createDiv({ 
      text: currentStepInfo?.title || '처리 중',
      cls: 'kga-loading-progress-title'
    });
    
    // 진행률 바
    const progressBarContainer = this.progressElement.createDiv({
      cls: 'kga-loading-progress-bar-container'
    });
    
    progressBarContainer.createEl('progress', {
      cls: 'kga-loading-progress-bar',
      attr: {
        max: '100',
        value: String(percentage)
      }
    });
    
    // 하단 정보 (간단하게)
    const footer = this.progressElement.createDiv({
      cls: 'kga-loading-progress-footer'
    });
    
    footer.createSpan({ text: `${percentage}%` });
    footer.createSpan({ text: `${progress.currentStep}/${progress.totalSteps}` });
  }

  /**
   * Notice 숨기기
   */
  private hideNotice(): void {
    if (this.currentNotice) {
      this.currentNotice.hide();
      this.currentNotice = null;
      this.progressElement = null;
    }
  }

  /**
   * 리소스 정리
   */
  static destroy(): void {
    if (LoadingManager.instance) {
      LoadingManager.instance.hideNotice();
      LoadingManager.instance = null;
      Logger.debug('LoadingManager 정리됨');
    }
  }
}
