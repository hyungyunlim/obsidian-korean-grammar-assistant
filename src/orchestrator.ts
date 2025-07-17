import { App, Editor, Notice, MarkdownView } from 'obsidian';
import { PluginSettings, SpellCheckResult } from './types/interfaces';
import { SpellCheckApiService } from './services/api';
import { SettingsService } from './services/settings';
import { IgnoredWordsService } from './services/ignoredWords';
import { CorrectionPopup } from './ui/correctionPopup';

/**
 * 맞춤법 검사 워크플로우를 관리하는 오케스트레이터 클래스
 */
export class SpellCheckOrchestrator {
  private app: App;
  private settings: PluginSettings;
  private apiService: SpellCheckApiService;
  private onSettingsUpdated?: (settings: PluginSettings) => void;

  constructor(app: App, settings: PluginSettings, onSettingsUpdated?: (settings: PluginSettings) => void) {
    this.app = app;
    this.settings = settings;
    this.apiService = new SpellCheckApiService();
    this.onSettingsUpdated = onSettingsUpdated;
  }

  /**
   * 맞춤법 검사를 실행합니다.
   */
  async execute(): Promise<void> {
    try {
      // 1. 활성 마크다운 뷰와 에디터 가져오기
      const { editor, selectedText, selectionStart, selectionEnd } = this.getEditorInfo();
      
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

      // 3. API 호출 표시
      const loadingNotice = new Notice("맞춤법을 검사하는 중...", 0);

      try {
        // 4. 맞춤법 검사 API 호출
        const result = await this.apiService.checkSpelling(selectedText, this.settings);
        
        // 5. 로딩 표시 제거
        loadingNotice.hide();

        // 6. 결과 처리
        this.handleSpellCheckResult(result, selectedText, selectionStart, selectionEnd, editor);

      } catch (error) {
        loadingNotice.hide();
        this.handleApiError(error);
      }

    } catch (error) {
      console.error('Spell check orchestrator error:', error);
      new Notice(`오류가 발생했습니다: ${error.message}`);
    }
  }

  /**
   * 에디터 정보를 가져옵니다.
   */
  private getEditorInfo() {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = markdownView?.editor;
    
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
        console.warn("Failed to get document bounds using API methods, using fallback:", error);
        // 폴백: 텍스트 기반 계산
        const lines = selectedText.split('\n');
        selectionStart = { line: 0, ch: 0 };
        selectionEnd = { line: lines.length - 1, ch: lines[lines.length - 1].length };
      }
    }

    return { editor, selectedText, selectionStart, selectionEnd };
  }

  /**
   * 맞춤법 검사 결과를 처리합니다.
   */
  private handleSpellCheckResult(
    result: SpellCheckResult,
    selectedText: string,
    selectionStart: any,
    selectionEnd: any,
    editor: Editor
  ): void {
    if (result.corrections.length === 0) {
      new Notice("수정할 것이 없습니다. 훌륭합니다!");
      return;
    }

    // 교정 팝업 생성 및 표시
    const popup = new CorrectionPopup(this.app, {
      corrections: result.corrections,
      selectedText: selectedText,
      start: selectionStart,
      end: selectionEnd,
      editor: editor,
      onExceptionWordsAdded: (words: string[]) => this.handleExceptionWords(words)
    });

    popup.render();
    popup.show();
  }

  /**
   * API 오류를 처리합니다.
   */
  private handleApiError(error: any): void {
    console.error('API Error:', error);
    
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
  }
}