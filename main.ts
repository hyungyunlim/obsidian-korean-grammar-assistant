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
import { errorDecorationField, temporarySuggestionModeField, InlineModeService } from './src/services/inlineModeService';
import { SpellCheckApiService } from './src/services/api';

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
  // 🤖 InlineModeService는 정적 클래스로 설계되어 인스턴스 불필요

  async onload() {
    // 디버그/프로덕션 모드 설정
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

    // 🎹 인라인 모드 명령어 등록 (Command Palette 방식)
    InlineModeService.registerCommands(this);

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


    // 🤖 인라인 모드 AI 분석 명령어 추가
    this.addCommand({
      id: "inline-ai-analysis",
      name: "🤖 인라인 AI 분석 (베타)",
      callback: async () => {
        if (!this.settings.inlineMode.enabled) {
          new Notice("인라인 모드가 비활성화되어 있습니다. 설정에서 베타 기능을 활성화하세요.");
          return;
        }
        if (!this.settings.ai.enabled) {
          new Notice("AI 기능이 비활성화되어 있습니다. 설정에서 AI 기능을 활성화하세요.");
          return;
        }
        await this.executeInlineAIAnalysis();
      },
    });

    // 📝 인라인 모드 일괄 적용 명령어 추가
    this.addCommand({
      id: "inline-apply-all",
      name: "📝 인라인 오류 일괄 적용",
      callback: async () => {
        if (!this.settings.inlineMode.enabled) {
          new Notice("인라인 모드가 비활성화되어 있습니다. 설정에서 베타 기능을 활성화하세요.");
          return;
        }
        await this.executeInlineApplyAll();
      },
    });

    // 인라인 모드가 활성화된 경우 확장 기능 등록
    if (this.settings.inlineMode.enabled) {
      this.enableInlineMode();
    }

    // 설정 탭 추가
    this.addSettingTab(new ModernSettingsTab(this.app, this));

    // 🤖 전역 설정 등록 (인라인 모드 AI 분석용)
    (window as any).koreanGrammarPlugin = {
      settings: this.settings,
      instance: this
    };

    Logger.log('Korean Grammar Assistant 플러그인 로딩 완료');
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

      // 인라인 모드로 오류 표시 (형태소 API 통합)
      await InlineModeService.showErrors(
        editorView,
        result.corrections,
        this.settings.inlineMode.underlineStyle,
        this.settings.inlineMode.underlineColor,
        this.app
      );

      Logger.log(`인라인 모드: 맞춤법 검사 완료`);

    } catch (error) {
      Logger.error('인라인 모드 맞춤법 검사 오류:', error);
      new Notice('맞춤법 검사 중 오류가 발생했습니다.');
    }
  }

  /**
   * 인라인 모드 활성화
   */
  enableInlineMode(): void {
    try {
      // CodeMirror 확장 기능 등록
      this.registerEditorExtension([errorDecorationField, temporarySuggestionModeField]);

      // InlineModeService 초기화 (키보드 단축키 지원을 위해 필요)
      const activeLeaf = this.app.workspace.activeLeaf;
      if (activeLeaf && activeLeaf.view && (activeLeaf.view as any).editor) {
        // @ts-ignore - Obsidian 내부 API 사용
        const editorView = (activeLeaf.view as any).editor.cm;
        if (editorView) {
          InlineModeService.setEditorView(editorView, this.settings, this.app);
          Logger.log('인라인 모드: InlineModeService 키보드 스코프 초기화됨');
        }
      }

      // 전역 접근을 위한 참조 설정
      (window as any).InlineModeService = InlineModeService;

      Logger.log('인라인 모드 활성화됨 (InlineModeService + 키보드 단축키)');

    } catch (error) {
      Logger.error('인라인 모드 활성화 실패:', error);
      new Notice('인라인 모드 활성화에 실패했습니다.');
    }
  }

  /**
   * 인라인 모드 비활성화
   */
  disableInlineMode(): void {
    // 전역 객체 정리
    if ((window as any).InlineModeService) {
      delete (window as any).InlineModeService;
    }

    Logger.log('인라인 모드 비활성화됨');
  }


  /**
   * 🤖 인라인 모드 AI 분석 실행
   */
  async executeInlineAIAnalysis(): Promise<void> {
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
      // 선택된 텍스트가 있는지 확인
      const selectedText = editor.getSelection();
      let targetText = selectedText;
      let isSelection = false;

      if (!targetText.trim()) {
        // 선택된 텍스트가 없으면 전체 문서
        targetText = editor.getValue();
        if (!targetText.trim()) {
          new Notice('분석할 텍스트가 없습니다.');
          return;
        }
      } else {
        isSelection = true;
      }

      Logger.log(`인라인 AI 분석 시작 - ${isSelection ? '선택된 영역' : '전체 문서'}: ${targetText.length}자`);

      // 🔧 기존 인라인 오류가 있는지 확인
      const hasExistingErrors = InlineModeService.hasErrors();

      if (hasExistingErrors) {
        // 케이스 1: 기존 오류가 있는 경우 - AI 분석 실행
        await this.analyzeExistingInlineErrors();
      } else {
        // 케이스 2: 기존 오류가 없는 경우 - 맞춤법 검사 먼저 실행 후 AI 분석
        await this.analyzeTextWithSpellCheckAndAI(targetText, isSelection);
      }

    } catch (error) {
      Logger.error('인라인 AI 분석 오류:', error);
      new Notice('AI 분석 중 오류가 발생했습니다.');
    }
  }

  /**
   * 기존 인라인 오류에 대한 AI 분석
   */
  private async analyzeExistingInlineErrors(): Promise<void> {
    // 1단계: 분석 시작 알림
    const analysisNotice = new Notice('🤖 AI 분석을 시작합니다...', 0); // 지속적으로 표시
    
    try {
      // 2단계: 토큰 사용량 추정 알림
      const errorCount = InlineModeService.getErrorCount();
      analysisNotice.setMessage(`🔢 ${errorCount}개 오류 분석 준비 중...`);
      
      // 잠시 대기 (UI 업데이트 시간 확보)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 3단계: AI API 호출 알림
      analysisNotice.setMessage('🧠 AI 분석 중... (수십 초 소요될 수 있습니다)');
      
      // 진행률 콜백을 통한 실시간 업데이트
      await InlineModeService.runAIAnalysisOnExistingErrors((current: number, total: number) => {
        analysisNotice.setMessage(`🧠 AI 분석 중... (${current}/${total})`);
      });
      
      // 3.5단계: UI 새로고침 강제 실행
      InlineModeService.refreshErrorWidgets();
      Logger.debug('AI 분석 완료 후 UI 새로고침 실행');
      
      // 4단계: 완료 알림
      analysisNotice.hide();
      new Notice(`✅ AI 분석 완료! ${errorCount}개 오류에 색상이 적용되었습니다.`, 4000);
      new Notice('💡 오류를 클릭하여 AI 추천 이유를 확인하세요.', 3000);
      
    } catch (error) {
      analysisNotice.hide();
      Logger.error('기존 오류 AI 분석 실패:', error);
      new Notice('❌ AI 분석 중 오류가 발생했습니다.', 4000);
    }
  }

  /**
   * 맞춤법 검사 후 AI 분석 실행
   */
  private async analyzeTextWithSpellCheckAndAI(targetText: string, isSelection: boolean): Promise<void> {
    // 전체 프로세스 알림 (지속적 표시)
    const processNotice = new Notice('📝 맞춤법 검사를 시작합니다...', 0);

    // 에디터 정보 가져오기
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) {
      processNotice.hide();
      new Notice('활성화된 편집기가 없습니다.');
      return;
    }

    try {
      // 1단계: 맞춤법 검사 실행
      processNotice.setMessage(`📝 ${targetText.length}자 텍스트 맞춤법 검사 중...`);
      
      // 🔧 단일 InlineModeService 시스템 사용
      // @ts-ignore - Obsidian 내부 API 사용  
      const editorView = (activeLeaf.view as any).editor?.cm;
      if (editorView) {
        InlineModeService.setEditorView(editorView, this.settings, this.app);
        Logger.debug('에디터 뷰 및 설정 완료 for checkText');
      }
      
      // InlineModeService를 통한 맞춤법 검사 실행
      await InlineModeService.checkText(targetText);
      Logger.debug('InlineModeService 맞춤법 검사 완료');

      // 잠시 대기 (맞춤법 검사 완료 대기)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 오류 개수 확인
      const errorCount = InlineModeService.getErrorCount();
      if (errorCount === 0) {
        processNotice.hide();
        new Notice('✅ 맞춤법 오류가 발견되지 않았습니다.', 3000);
        return;
      }

      // 2단계: 맞춤법 검사 완료 - 빨간색 오류 확인 시간 제공
      processNotice.setMessage(`✅ 맞춤법 검사 완료! ${errorCount}개 오류 발견 (빨간색 표시)`);
      
      // 사용자가 빨간색 오류를 확인할 수 있는 시간 (3초)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 3단계: AI 분석 시작 알림
      processNotice.setMessage(`🤖 ${errorCount}개 오류에 대한 AI 분석 시작...`);
      
      // 잠시 대기 (UI 업데이트 시간 확보)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 3단계: AI API 호출
      processNotice.setMessage('🧠 AI 분석 중... (수십 초 소요될 수 있습니다)');
      
      // 진행률 콜백을 통한 실시간 업데이트
      await InlineModeService.runAIAnalysisOnExistingErrors((current: number, total: number) => {
        processNotice.setMessage(`🧠 AI 분석 중... (${current}/${total})`);
      });
      
      // 3.5단계: UI 새로고침 강제 실행
      InlineModeService.refreshErrorWidgets();
      Logger.debug('AI 분석 완료 후 UI 새로고침 실행');
      
      // 4단계: 완료 알림
      processNotice.hide();
      new Notice(`✅ 맞춤법 검사 및 AI 분석 완료!`, 4000);
      new Notice(`🎨 ${errorCount}개 오류에 AI 색상이 적용되었습니다.`, 3000);
      new Notice('💡 오류를 클릭하여 AI 추천 이유를 확인하세요.', 3000);

    } catch (error) {
      processNotice.hide();
      Logger.error('맞춤법 검사 및 AI 분석 실패:', error);
      new Notice('❌ 분석 중 오류가 발생했습니다.', 4000);
    }
  }

  /**
   * 📝 인라인 모드 일괄 적용 실행
   */
  async executeInlineApplyAll(): Promise<void> {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf || !activeLeaf.view || !(activeLeaf.view as any).editor) {
      new Notice('활성화된 편집기가 없습니다.');
      return;
    }

    // 현재 오류가 있는지 확인
    const errorCount = InlineModeService.getErrorCount();
    if (errorCount === 0) {
      new Notice('적용할 인라인 오류가 없습니다. 먼저 맞춤법 검사를 실행하세요.');
      return;
    }

    const processNotice = new Notice(`📝 ${errorCount}개 오류 일괄 적용 중...`, 0);

    try {
      // 에디터 뷰 설정
      // @ts-ignore - Obsidian 내부 API 사용  
      const editorView = (activeLeaf.view as any).editor?.cm;
      if (editorView) {
        InlineModeService.setEditorView(editorView, this.settings, this.app);
      }

      // 일괄 적용 실행
      const appliedCount = await InlineModeService.applyAllCorrections();

      // 완료 알림
      processNotice.hide();
      new Notice(`✅ ${appliedCount}개 오류가 에디터에 적용되었습니다!`, 4000);
      
      if (appliedCount < errorCount) {
        const skippedCount = errorCount - appliedCount;
        new Notice(`💡 ${skippedCount}개 오류는 건너뛰거나 예외처리 사전에 등록되었습니다.`, 3000);
      }

    } catch (error) {
      processNotice.hide();
      Logger.error('인라인 오류 일괄 적용 실패:', error);
      new Notice('❌ 일괄 적용 중 오류가 발생했습니다.', 4000);
    }
  }
}


