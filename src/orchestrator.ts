import { App, Editor, Notice, MarkdownView } from 'obsidian';
import { PluginSettings, SpellCheckResult } from './types/interfaces';
import { OptimizedSpellCheckService } from './services/optimizedApiService';
import { SettingsService } from './services/settings';
import { IgnoredWordsService } from './services/ignoredWords';
import { CorrectionPopup } from './ui/correctionPopup';
import { AIAnalysisService } from './services/aiAnalysisService';
import { LoadingManager } from './ui/loadingManager';
import { Logger } from './utils/logger';
import { getCurrentParagraph, getCurrentWord, getCurrentSentence } from './utils/textUtils';

/**
 * 맞춤법 검사 워크플로우를 관리하는 오케스트레이터 클래스
 */
export class SpellCheckOrchestrator {
  private app: App;
  private settings: PluginSettings;
  private apiService: OptimizedSpellCheckService;
  private aiService: AIAnalysisService;
  private onSettingsUpdated?: (settings: PluginSettings) => void;

  constructor(app: App, settings: PluginSettings, onSettingsUpdated?: (settings: PluginSettings) => void) {
    this.app = app;
    this.settings = settings;
    this.apiService = new OptimizedSpellCheckService(
      5,     // maxBatchSize
      2000,  // batchTimeoutMs  
      15000, // requestTimeoutMs
      3,     // maxConcurrentBatches
      {
        maxSize: 1000,              // 캐시 최대 1000개
        ttlMinutes: 30,             // 30분 TTL
        cleanupIntervalMinutes: 5   // 5분마다 정리
      }
    );
    this.aiService = new AIAnalysisService(settings.ai);
    this.onSettingsUpdated = onSettingsUpdated;
  }

  /**
   * 맞춤법 검사를 실행합니다.
   */
  async execute(): Promise<void> {
    try {
      // 1. 활성 마크다운 뷰와 에디터 가져오기
      const { editor, selectedText, selectionStart, selectionEnd, file } = this.getEditorInfo();
      
      if (!selectedText || selectedText.trim().length === 0) {
        new Notice("검사할 텍스트가 없습니다.");
        return;
      }

      // 2. 설정 유효성 검사
      const validation = SettingsService.validateSettings(this.settings);
      if (!validation.isValid) {
        new Notice(`설정 오류: ${validation.errors.join(', ')}`);
        return;
      }

      // 3. 로딩 매니저 시작
      const loadingManager = LoadingManager.getInstance();
      loadingManager.startLoading(false); // AI 분석은 별도로 처리

      try {
        // 텍스트 분석 단계
        loadingManager.setStep('text_analysis');
        await this.sleep(300); // 시각적 피드백을 위한 짧은 대기
        
        // API 요청 단계
        loadingManager.setStep('api_request');
        
        // 4. 맞춤법 검사 API 호출 (긴 텍스트는 medium, 짧은 텍스트는 high 우선순위)
        const priority = selectedText.length > 1000 ? 'medium' : 'high';
        const result = await this.apiService.checkSpelling(selectedText, this.settings, priority);
        
        // 5. 형태소 분석 및 교정 개선 (통합 처리)
        let morphemeInfo = null;
        if (result.corrections && result.corrections.length > 0) {
          try {
            Logger.log('형태소 분석 수행 중...');
            // 1차: 형태소 분석 수행 (AI용으로도 사용할 데이터)
            morphemeInfo = await this.apiService.analyzeMorphemes(selectedText, this.settings);
            Logger.log('형태소 분석 완료:', {
              hasMorphemeInfo: !!morphemeInfo,
              sentences: morphemeInfo?.sentences?.length || 0
            });

            // 2차: 오류가 2개 이상일 때만 교정 개선 수행 (이미 분석된 morphemeInfo 재사용)
            if (result.corrections.length > 1) {
              Logger.log('형태소 기반 교정 개선 수행...');
              result.corrections = await this.apiService.improveCorrectionsWithMorphemeData(
                selectedText, result.corrections, this.settings, morphemeInfo
              );
              Logger.log(`교정 개선 완료: ${result.corrections.length}개 오류`);
            }
          } catch (morphemeError) {
            Logger.warn('형태소 분석 실패, 원본 교정 및 패턴 매칭 사용:', morphemeError);
            morphemeInfo = null;
          }
        }
        
        // 결과 처리 단계
        loadingManager.setStep('result_parsing');
        await this.sleep(200);
        
        // UI 준비 단계
        loadingManager.setStep('ui_preparation');
        await this.sleep(100);
        
        // 5. 로딩 완료
        loadingManager.complete();

        // 7. 결과 처리
        this.handleSpellCheckResult(result, selectedText, selectionStart, selectionEnd, editor, file, morphemeInfo);

      } catch (error) {
        // 6. 로딩 에러 처리
        loadingManager.error('맞춤법 검사 중 오류가 발생했습니다');
        
        // 에러는 이미 OptimizedSpellCheckService에서 처리되므로 추가 처리 불필요
        Logger.error('맞춤법 검사 실행 오류:', error);
      }

    } catch (error) {
      Logger.error('Spell check orchestrator error:', error);
      new Notice(`오류가 발생했습니다: ${error.message}`);
    }
  }

  /**
   * 에디터 정보를 가져옵니다.
   */
  private getEditorInfo() {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = markdownView?.editor;
    const file = markdownView?.file; // ⭐ NEW: File 정보 추가
    
    if (!editor) {
      throw new Error("에디터를 찾을 수 없습니다.");
    }

    let selectedText = editor.getSelection();
    let selectionStart = editor.getCursor("from");
    let selectionEnd = editor.getCursor("to");
    
    // 선택된 텍스트가 없으면 전체 문서 사용
    if (!selectedText || selectedText.trim().length === 0) {
      const fullText = editor.getValue();
      if (!fullText || fullText.trim().length === 0) {
        throw new Error("문서에 텍스트가 없습니다.");
      }
      
      selectedText = fullText;
      
      // 전체 문서 범위 설정
      try {
        const totalLines = editor.lineCount();
        const lastLine = totalLines - 1;
        const lastLineText = editor.getLine(lastLine);
        selectionStart = { line: 0, ch: 0 };
        selectionEnd = { line: lastLine, ch: lastLineText.length };
      } catch (error) {
        Logger.warn("Failed to get document bounds using API methods, using fallback:", error);
        // 폴백: 텍스트 기반 계산
        const lines = selectedText.split('\n');
        selectionStart = { line: 0, ch: 0 };
        selectionEnd = { line: lines.length - 1, ch: lines[lines.length - 1].length };
      }
    }

    return { editor, selectedText, selectionStart, selectionEnd, file };
  }

  /**
   * 맞춤법 검사 결과를 처리합니다.
   */
  private handleSpellCheckResult(
    result: SpellCheckResult,
    selectedText: string,
    selectionStart: any,
    selectionEnd: any,
    editor: Editor,
    file?: any,
    morphemeInfo?: any
  ): void {
    if (result.corrections.length === 0) {
      new Notice("수정할 것이 없습니다. 훌륭합니다!");
      return;
    }

    // 텍스트 정리 - API 호출과 일치시키기
    const cleanedText = selectedText.trim();
    Logger.debug('handleSpellCheckResult 텍스트 정리:', {
      originalLength: selectedText.length,
      cleanedLength: cleanedText.length,
      correctionsCount: result.corrections.length
    });

    // 교정 팝업 생성 및 표시
    const popup = new CorrectionPopup(this.app, {
      corrections: result.corrections,
      selectedText: cleanedText,
      start: selectionStart,
      end: selectionEnd,
      editor: editor,
      file: file, // ⭐ NEW: File 인스턴스 전달 (메타데이터 정보용)
      morphemeInfo: morphemeInfo, // ⭐ NEW: 형태소 분석 정보 전달 (AI 분석용)
      ignoredWords: IgnoredWordsService.getIgnoredWords(this.settings),
      onExceptionWordsAdded: (words: string[]) => this.handleExceptionWords(words)
    }, this.aiService, (newMaxTokens: number) => this.handleMaxTokensUpdate(newMaxTokens));

    popup.render();
    popup.show();
  }

  /**
   * API 오류를 처리합니다.
   */
  private handleApiError(error: any): void {
    Logger.error('API Error:', error);
    
    if (error.message?.includes('API 키')) {
      new Notice("API 키가 설정되지 않았습니다. 플러그인 설정에서 Bareun.ai API 키를 입력해주세요.");
    } else if (error.message?.includes('API 요청 실패')) {
      new Notice(`API 요청에 실패했습니다: ${error.message}`);
    } else if (error.message?.includes('네트워크')) {
      new Notice("네트워크 연결을 확인해주세요.");
    } else {
      new Notice(`맞춤법 검사 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  /**
   * 예외 처리된 단어들을 설정에 추가합니다.
   */
  private handleExceptionWords(words: string[]): void {
    if (words.length === 0) return;

    const updatedSettings = IgnoredWordsService.addMultipleIgnoredWords(words, this.settings);
    
    if (updatedSettings.ignoredWords.length > this.settings.ignoredWords.length) {
      this.settings = updatedSettings;
      
      // 설정 업데이트 콜백 호출
      if (this.onSettingsUpdated) {
        this.onSettingsUpdated(this.settings);
      }

      const addedCount = updatedSettings.ignoredWords.length - this.settings.ignoredWords.length + words.length;
      new Notice(`${words.length}개의 단어가 예외 처리 목록에 추가되었습니다.`);
    }
  }

  /**
   * 설정을 업데이트합니다.
   */
  updateSettings(newSettings: PluginSettings): void {
    this.settings = newSettings;
    // AI 서비스 설정도 업데이트
    this.aiService.updateSettings(newSettings.ai);
  }

  /**
   * API 서비스 성능 메트릭을 반환합니다.
   */
  getPerformanceMetrics(): any {
    return this.apiService.getMetrics();
  }

  /**
   * 캐시를 수동으로 정리합니다.
   */
  clearCache(): void {
    this.apiService.clearCache();
    new Notice("캐시가 정리되었습니다.");
  }

  /**
   * 대기 중인 모든 요청을 취소합니다.
   */
  cancelPendingRequests(): void {
    this.apiService.cancelPendingRequests();
    new Notice("대기 중인 요청들이 취소되었습니다.");
  }

  /**
   * 오케스트레이터를 종료하고 리소스를 정리합니다.
   */
  destroy(): void {
    this.apiService.destroy();
    LoadingManager.destroy();
  }

  /**
   * 비동기 대기 헬퍼 함수
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 현재 문단의 맞춤법을 검사합니다.
   */
  async executeCurrentParagraph(): Promise<void> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice("활성화된 마크다운 편집기가 없습니다.");
      return;
    }

    const editor = activeView.editor;
    if (!editor) {
      new Notice("편집기에 접근할 수 없습니다.");
      return;
    }

    try {
      // 현재 문단 감지 (개선된 버전)
      const paragraphData = getCurrentParagraph(editor);
      const selectedText = paragraphData.text.trim();
      
      if (!selectedText) {
        new Notice("현재 문단에 검사할 텍스트가 없습니다.");
        return;
      }

      Logger.debug(`현재 문단 맞춤법 검사 시작: ${selectedText.length}자`);
      
      // 기존 execute 메서드의 로직 재사용
      await this.performSpellCheck(selectedText, editor, paragraphData.from, paragraphData.to);
      
    } catch (error) {
      Logger.error('현재 문단 맞춤법 검사 중 오류 발생:', error);
      new Notice(`현재 문단 맞춤법 검사 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  /**
   * 현재 단어의 맞춤법을 검사합니다.
   */
  async executeCurrentWord(): Promise<void> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice("활성화된 마크다운 편집기가 없습니다.");
      return;
    }

    const editor = activeView.editor;
    if (!editor) {
      new Notice("편집기에 접근할 수 없습니다.");
      return;
    }

    try {
      // 현재 단어 감지
      const wordData = getCurrentWord(editor);
      
      if (!wordData) {
        new Notice("현재 위치에 검사할 단어가 없습니다.");
        return;
      }

      const selectedText = wordData.text.trim();
      
      if (!selectedText) {
        new Notice("현재 단어에 검사할 텍스트가 없습니다.");
        return;
      }

      Logger.debug(`현재 단어 맞춤법 검사 시작: "${selectedText}"`);
      
      // 기존 execute 메서드의 로직 재사용
      await this.performSpellCheck(selectedText, editor, wordData.from, wordData.to);
      
    } catch (error) {
      Logger.error('현재 단어 맞춤법 검사 중 오류 발생:', error);
      new Notice(`현재 단어 맞춤법 검사 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  /**
   * 현재 문장의 맞춤법을 검사합니다.
   */
  async executeCurrentSentence(): Promise<void> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice("활성화된 마크다운 편집기가 없습니다.");
      return;
    }

    const editor = activeView.editor;
    if (!editor) {
      new Notice("편집기에 접근할 수 없습니다.");
      return;
    }

    try {
      // 현재 문장 감지
      const sentenceData = getCurrentSentence(editor);
      const selectedText = sentenceData.text.trim();
      
      if (!selectedText) {
        new Notice("현재 문장에 검사할 텍스트가 없습니다.");
        return;
      }

      Logger.log(`현재 문장 맞춤법 검사 시작: "${selectedText}"`);
      
      // 기존 execute 메서드의 로직 재사용
      await this.performSpellCheck(selectedText, editor, sentenceData.from, sentenceData.to);
      
    } catch (error) {
      Logger.error('현재 문장 맞춤법 검사 중 오류 발생:', error);
      new Notice(`현재 문장 맞춤법 검사 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  /**
   * 맞춤법 검사를 수행하는 공통 메서드
   */
  private async performSpellCheck(
    selectedText: string, 
    editor: Editor, 
    from?: any, 
    to?: any
  ): Promise<void> {
    // File 인스턴스 가져오기
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = activeView?.file;
    // 텍스트 정리 - 모든 공백 문제 해결
    const cleanedText = selectedText.trim();
    
    // 설정 검증
    const validation = SettingsService.validateSettings(this.settings);
    if (!validation.isValid) {
      new Notice(`설정 오류: ${validation.errors.join(', ')}`);
      return;
    }

    // 로딩 시작
    LoadingManager.getInstance().startLoading();

    try {
      // API 호출 - 정리된 텍스트 사용
      const result = await this.apiService.checkSpelling(cleanedText, this.settings);
      
      if (result.corrections && result.corrections.length > 0) {
        Logger.log(`맞춤법 검사 완료: ${result.corrections.length}개 오류 발견`);
        Logger.debug('API 호출 텍스트:', {
          originalLength: selectedText.length,
          cleanedLength: cleanedText.length,
          originalFirst20: selectedText.substring(0, 20),
          cleanedFirst20: cleanedText.substring(0, 20)
        });
        
        // 팝업 설정 - 정리된 텍스트 사용 (API 응답과 일치)
        const popupConfig = {
          selectedText: cleanedText,
          corrections: result.corrections,
          ignoredWords: this.settings.ignoredWords || [],
          editor,
          file: file, // ⭐ NEW: File 인스턴스 전달
          start: from || { line: 0, ch: 0 },
          end: to || { line: 0, ch: cleanedText.length }
        };
        
        // 팝업 표시
        const popup = new CorrectionPopup(
          this.app,
          popupConfig,
          this.aiService,
          (newMaxTokens: number) => this.handleMaxTokensUpdate(newMaxTokens)
        );
        
        popup.render();
        popup.show();
        
      } else {
        new Notice("수정할 것이 없습니다. 훌륭합니다!");
      }
    } catch (error) {
      Logger.error('맞춤법 검사 중 오류 발생:', error);
      if (error.message.includes('API 키')) {
        new Notice("API 키가 설정되지 않았습니다. 플러그인 설정에서 Bareun.ai API 키를 입력해주세요.");
      } else if (error.message.includes('요청')) {
        new Notice(`API 요청에 실패했습니다: ${error.message}`);
      } else if (error.message.includes('네트워크')) {
        new Notice("네트워크 연결을 확인해주세요.");
      } else {
        new Notice(`맞춤법 검사 중 오류가 발생했습니다: ${error.message}`);
      }
    } finally {
      LoadingManager.getInstance().complete();
    }
  }

  /**
   * 최대 토큰 설정을 업데이트합니다.
   */
  private handleMaxTokensUpdate(newMaxTokens: number): void {
    this.settings.ai.maxTokens = newMaxTokens;
    this.aiService.updateSettings(this.settings.ai);
    
    // 메인 플러그인에 설정 저장 요청
    if (this.onSettingsUpdated) {
      this.onSettingsUpdated(this.settings);
    }
  }
}