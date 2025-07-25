import {
  Plugin,
  PluginSettingTab,
  App,
  Setting,
  addIcon,
  Notice,
} from "obsidian";

// Import modularized components
import { PluginSettings } from './src/types/interfaces';
import { DEFAULT_SETTINGS, SettingsService } from './src/services/settings';
import { IgnoredWordsService } from './src/services/ignoredWords';
import { SpellCheckOrchestrator } from './src/orchestrator';
import { ModernSettingsTab } from './src/ui/settingsTab';
import { Logger } from './src/utils/logger';

// Import inline mode components
import { errorDecorationField, InlineModeService } from './src/services/inlineModeService';
import { SpellCheckApiService } from './src/services/api';
import { KoreanGrammarSuggest } from './src/ui/koreanGrammarSuggest';

// 한글 맞춤법 검사 아이콘 등록
addIcon(
  "han-spellchecker",
  `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 18 18" fill="currentColor"><path d="M3.6,3.9c1.3,0,2.9,0,4.2,0,.7,0,2.3-.5,2.3.7,0,.3-.3.5-.6.5-2.2,0-4.6.2-6.8,0-.4,0-.7-.4-.8-.8-.2-.7,1.2-.7,1.5-.4h0ZM6.1,11c-4.2,0-3.7-5.8.7-5.2,3.7.2,3.1,5.6-.5,5.2h-.2ZM3.6,1.6c.7,0,1.5.4,2.3.4.8.1,1.6,0,2.4,0,.8,1.2-1.4,1.5-2.9,1.3-.9,0-2.7-.8-1.9-1.7h0ZM6.3,9.7c2.5,0,1.9-3.4-.6-2.8-1.2.2-1.4,1.8-.5,2.4.2.2.9.2,1,.3h0ZM4.9,13.2c-.1-1.2,1.5-.9,1.6.1.4,1.5-.2,2.3,2,2.1,1,0,6.7-.6,5,1.1-2.3.5-5.4.7-7.6-.3-.6-.8-.3-2.2-.9-3h0ZM11.3,1.1c2.6-.3,1.5,3.8,2,5,.6.4,2.6-.5,2.8.7,0,.4-.3.6-.6.7-.7.1-1.6,0-2.3.1-.2.1,0,.5-.1,1.1,0,1,0,4.2-.8,4.2-.2,0-.5-.3-.6-.6-.3-1.4,0-3.4,0-5,0-1.9,0-3.8-.2-4.6-.1-.4-.5-1.2-.1-1.5h.1Z"/></svg>`
);

/**
 * 한국어 맞춤법 검사 플러그인
 */
export default class KoreanGrammarPlugin extends Plugin {
  settings: PluginSettings;
  orchestrator: SpellCheckOrchestrator;
  grammarSuggest: KoreanGrammarSuggest | null = null;

  async onload() {
    // 환경에 따른 로거 최적화 설정
    if (process.env.NODE_ENV === 'production') {
      Logger.configureForProduction();
    } else {
      Logger.configureForDevelopment();
    }
    
    Logger.log('Korean Grammar Assistant 플러그인 로딩 시작');

    // 설정 로드
    await this.loadSettings();

    // 오케스트레이터 초기화
    this.orchestrator = new SpellCheckOrchestrator(
      this.app, 
      this.settings, 
      (updatedSettings) => {
        this.settings = updatedSettings;
        this.saveSettings();
      }
    );

    // 리본 아이콘 추가
    this.addRibbonIcon("han-spellchecker", "Check Spelling", async () => {
      await this.orchestrator.execute();
    });

    // 명령어 등록
    this.addCommand({
      id: "check-korean-spelling",
      name: "한국어 맞춤법 검사",
      callback: async () => {
        await this.orchestrator.execute();
      },
    });

    // 현재 문단 맞춤법 검사 명령어 추가
    this.addCommand({
      id: "check-current-paragraph",
      name: "현재 문단 맞춤법 검사",
      callback: async () => {
        await this.orchestrator.executeCurrentParagraph();
      },
    });

    // 현재 단어 맞춤법 검사 명령어 추가
    this.addCommand({
      id: "check-current-word",
      name: "현재 단어 맞춤법 검사",
      callback: async () => {
        await this.orchestrator.executeCurrentWord();
      },
    });

    // 현재 문장 맞춤법 검사 명령어 추가
    this.addCommand({
      id: "check-current-sentence",
      name: "현재 문장 맞춤법 검사",
      callback: async () => {
        await this.orchestrator.executeCurrentSentence();
      },
    });

    // 인라인 모드 명령어 추가 (베타 기능)
    this.addCommand({
      id: "inline-spell-check",
      name: "인라인 맞춤법 검사 (베타)",
      callback: async () => {
        if (!this.settings.inlineMode.enabled) {
          new Notice("인라인 모드가 비활성화되어 있습니다. 설정에서 베타 기능을 활성화하세요.");
          return;
        }
        await this.executeInlineSpellCheck();
      },
    });

    // EditorSuggest 기반 인라인 모드 명령어 추가
    this.addCommand({
      id: "inline-spell-check-suggest",
      name: "인라인 맞춤법 검사 (EditorSuggest)",
      callback: async () => {
        if (!this.settings.inlineMode.enabled) {
          new Notice("인라인 모드가 비활성화되어 있습니다. 설정에서 베타 기능을 활성화하세요.");
          return;
        }
        await this.executeInlineSpellCheckWithSuggest();
      },
    });

    // 인라인 모드가 활성화된 경우 EditorSuggest 등록
    if (this.settings.inlineMode.enabled) {
      this.enableInlineMode();
    }

    // 설정 탭 추가
    this.addSettingTab(new ModernSettingsTab(this.app, this));
  }

  onunload() {
    // 인라인 모드 정리
    this.disableInlineMode();
    
    // 오케스트레이터 정리
    if (this.orchestrator) {
      this.orchestrator.destroy();
    }
  }

  async loadSettings() {
    const savedData = await this.loadData();
    this.settings = SettingsService.mergeWithDefaults(savedData || {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // 오케스트레이터 설정 업데이트
    if (this.orchestrator) {
      this.orchestrator.updateSettings(this.settings);
    }
  }

  /**
   * 인라인 맞춤법 검사 실행
   */
  async executeInlineSpellCheck(): Promise<void> {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) {
      new Notice("활성화된 편집기가 없습니다.");
      return;
    }

    // @ts-ignore - Obsidian 내부 API 사용
    const editor = activeLeaf.view.editor;
    if (!editor) {
      new Notice("편집기를 찾을 수 없습니다.");
      return;
    }

    // @ts-ignore - CodeMirror 6 에디터 뷰 접근
    const editorView = editor.cm;
    if (!editorView) {
      new Notice("CodeMirror 에디터 뷰를 찾을 수 없습니다.");
      return;
    }

    Logger.log('인라인 모드: 맞춤법 검사 시작');

    try {
      // 에디터 뷰 및 설정 초기화
      InlineModeService.setEditorView(editorView, this.settings, this.app);

      // 전체 텍스트 가져오기
      const fullText = editorView.state.doc.toString();
      if (!fullText.trim()) {
        new Notice("검사할 텍스트가 없습니다.");
        return;
      }

      // API 서비스를 통해 맞춤법 검사 실행
      const apiService = new SpellCheckApiService();
      const result = await apiService.checkSpelling(fullText, this.settings);

      if (!result.corrections || result.corrections.length === 0) {
        new Notice("맞춤법 오류가 발견되지 않았습니다.");
        return;
      }

      // 인라인 모드로 오류 표시
      InlineModeService.showErrors(
        editorView,
        result.corrections,
        this.settings.inlineMode.underlineStyle,
        this.settings.inlineMode.underlineColor,
        this.app
      );

      new Notice(`${result.corrections.length}개의 맞춤법 오류를 발견했습니다.`);
      Logger.log(`인라인 모드: ${result.corrections.length}개 오류 표시 완료`);

    } catch (error) {
      Logger.error('인라인 모드 맞춤법 검사 오류:', error);
      new Notice('맞춤법 검사 중 오류가 발생했습니다.');
    }
  }

  /**
   * 인라인 모드 활성화
   */
  enableInlineMode(): void {
    if (this.grammarSuggest) return; // 이미 활성화됨

    try {
      // EditorSuggest 인스턴스 생성
      this.grammarSuggest = new KoreanGrammarSuggest(this.app, this.settings);
      this.registerEditorSuggest(this.grammarSuggest);

      // 기존 Widget 기반 시스템도 병행 (향후 단계적 제거 예정)
      this.registerEditorExtension([errorDecorationField]);
      (window as any).InlineModeService = InlineModeService;

      Logger.log('인라인 모드 활성화됨 (EditorSuggest)');

    } catch (error) {
      Logger.error('인라인 모드 활성화 실패:', error);
      new Notice('인라인 모드 활성화에 실패했습니다.');
    }
  }

  /**
   * 인라인 모드 비활성화
   */
  disableInlineMode(): void {
    if (this.grammarSuggest) {
      this.grammarSuggest.cleanup();
      // EditorSuggest는 별도 해제 메서드가 없으므로 참조만 제거
      this.grammarSuggest = null;
    }

    // 전역 객체 정리
    if ((window as any).InlineModeService) {
      delete (window as any).InlineModeService;
    }

    Logger.log('인라인 모드 비활성화됨');
  }

  /**
   * EditorSuggest 기반 인라인 맞춤법 검사 실행
   */
  async executeInlineSpellCheckWithSuggest(): Promise<void> {
    if (!this.grammarSuggest) {
      new Notice('인라인 모드가 활성화되지 않았습니다.');
      return;
    }

    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) {
      new Notice('활성화된 편집기가 없습니다.');
      return;
    }

    // @ts-ignore - Obsidian 내부 API 사용
    const editor = activeLeaf.view.editor;
    if (!editor) {
      new Notice('편집기를 찾을 수 없습니다.');
      return;
    }

    try {
      // 전체 텍스트 가져오기
      const fullText = editor.getValue();
      if (!fullText.trim()) {
        new Notice('검사할 텍스트가 없습니다.');
        return;
      }

      Logger.log('EditorSuggest 기반 맞춤법 검사 시작');

      // 맞춤법 검사 실행 및 결과를 EditorSuggest에 업데이트
      await this.grammarSuggest.updateCorrections(fullText);

      new Notice('맞춤법 검사가 완료되었습니다. 오타에 커서를 놓으면 수정 제안이 표시됩니다.');

    } catch (error) {
      Logger.error('EditorSuggest 기반 맞춤법 검사 오류:', error);
      new Notice('맞춤법 검사 중 오류가 발생했습니다.');
    }
  }
}


