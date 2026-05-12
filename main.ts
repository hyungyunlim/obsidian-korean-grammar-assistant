import {
  Plugin,
  addIcon,
  Notice,
  MarkdownView,
  Editor,
} from "obsidian";
import type { EditorView } from '@codemirror/view';

// Import modularized components
import { PluginSettings } from './src/types/interfaces';
import { SettingsService } from './src/services/settings';
import { SpellCheckOrchestrator } from './src/orchestrator';
import { ModernSettingsTab } from './src/ui/settingsTab';
import { Logger } from './src/utils/logger';

// Import inline mode components
import { errorDecorationField, temporarySuggestionModeField, InlineModeService } from './src/services/inlineModeService';
import { SpellCheckApiService } from './src/services/api';
import { inlineTooltip } from './src/ui/inlineTooltip';

// 한글 맞춤법 검사 아이콘 등록
addIcon(
  "han-spellchecker",
  `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 18 18" fill="currentColor"><path d="M3.6,3.9c1.3,0,2.9,0,4.2,0,.7,0,2.3-.5,2.3.7,0,.3-.3.5-.6.5-2.2,0-4.6.2-6.8,0-.4,0-.7-.4-.8-.8-.2-.7,1.2-.7,1.5-.4h0ZM6.1,11c-4.2,0-3.7-5.8.7-5.2,3.7.2,3.1,5.6-.5,5.2h-.2ZM3.6,1.6c.7,0,1.5.4,2.3.4.8.1,1.6,0,2.4,0,.8,1.2-1.4,1.5-2.9,1.3-.9,0-2.7-.8-1.9-1.7h0ZM6.3,9.7c2.5,0,1.9-3.4-.6-2.8-1.2.2-1.4,1.8-.5,2.4.2.2.9.2,1,.3h0ZM4.9,13.2c-.1-1.2,1.5-.9,1.6.1.4,1.5-.2,2.3,2,2.1,1,0,6.7-.6,5,1.1-2.3.5-5.4.7-7.6-.3-.6-.8-.3-2.2-.9-3h0ZM11.3,1.1c2.6-.3,1.5,3.8,2,5,.6.4,2.6-.5,2.8.7,0,.4-.3.6-.6.7-.7.1-1.6,0-2.3.1-.2.1,0,.5-.1,1.1,0,1,0,4.2-.8,4.2-.2,0-.5-.3-.6-.6-.3-1.4,0-3.4,0-5,0-1.9,0-3.8-.2-4.6-.1-.4-.5-1.2-.1-1.5h.1Z"/></svg>`
);

/**
 * Obsidian의 Editor에서 내부 CodeMirror 6 EditorView를 가져온다.
 * Obsidian 공식 API에는 노출되어 있지 않지만, 모든 마크다운 Editor 인스턴스에서 `cm` 속성으로 접근 가능하다.
 */
function getEditorView(editor: Editor | undefined | null): EditorView | undefined {
  if (!editor) return undefined;
  return (editor as Editor & { cm?: EditorView }).cm;
}

/**
 * 한국어 맞춤법 검사 플러그인
 */
export default class KoreanGrammarPlugin extends Plugin {
  settings: PluginSettings;
  orchestrator: SpellCheckOrchestrator;
  // 🤖 InlineModeService는 정적 클래스로 설계되어 인스턴스 불필요
  
  // 🤖 InlineModeService 참조 (전역 변수 대신 인스턴스 속성 사용)

  async onload() {
    // 디버그/프로덕션 모드 설정
    if (process.env.NODE_ENV === 'production') {
      Logger.configureForProduction();
    } else {
      Logger.configureForDevelopment();
    }

    // 설정 로드
    await this.loadSettings();

    // 오케스트레이터 초기화
    this.orchestrator = new SpellCheckOrchestrator(
      this.app, 
      this.settings, 
      (updatedSettings) => {
        this.settings = updatedSettings;
        void this.saveSettings();
      }
    );

    // 🎹 인라인 모드 명령어 등록 (Command Palette 방식)
    InlineModeService.registerCommands(this);

    // 리본 아이콘 추가
    this.addRibbonIcon("han-spellchecker", "Check spelling", async () => {
      await this.orchestrator.execute();
    });
    
    // 명령어 등록 (conditional commands)
    this.addCommand({
      id: "check-korean-spelling",
      name: "한국어 맞춤법 검사",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) void this.orchestrator.execute();
        return true;
      },
    });

    this.addCommand({
      id: "check-current-paragraph",
      name: "현재 문단 맞춤법 검사",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) void this.orchestrator.executeCurrentParagraph();
        return true;
      },
    });

    this.addCommand({
      id: "check-current-word",
      name: "현재 단어 맞춤법 검사",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) void this.orchestrator.executeCurrentWord();
        return true;
      },
    });

    this.addCommand({
      id: "check-current-sentence",
      name: "현재 문장 맞춤법 검사",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) void this.orchestrator.executeCurrentSentence();
        return true;
      },
    });

    this.addCommand({
      id: "inline-spell-check",
      name: "인라인 맞춤법 검사 (베타)",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !this.settings.inlineMode.enabled) return false;
        if (!checking) void this.executeInlineSpellCheck();
        return true;
      },
    });

    this.addCommand({
      id: "inline-ai-analysis",
      name: "인라인 AI 분석 (베타)",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !this.settings.inlineMode.enabled || !this.settings.ai.enabled) return false;
        if (!checking) void this.executeInlineAIAnalysis();
        return true;
      },
    });

    this.addCommand({
      id: "inline-apply-all",
      name: "인라인 오류 일괄 적용",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !this.settings.inlineMode.enabled) return false;
        if (!checking) void this.executeInlineApplyAll();
        return true;
      },
    });

    this.addCommand({
      id: "inline-clear-all",
      name: "인라인 분석 결과 표시 일괄 취소",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !this.settings.inlineMode.enabled) return false;
        if (!checking) void this.executeInlineClearAll();
        return true;
      },
    });

    // 인라인 툴팁에 App 인스턴스 설정
    inlineTooltip.setApp(this.app);

    // 인라인 모드가 활성화된 경우 확장 기능 등록
    if (this.settings.inlineMode.enabled) {
      this.enableInlineMode();
    }

    // 설정 탭 추가
    this.addSettingTab(new ModernSettingsTab(this.app, this));

    // 🔧 문서 전환 감지 이벤트 리스너 등록
    this.setupDocumentChangeListeners();
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
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("활성화된 편집기가 없습니다.");
      return;
    }

    const editor = view.editor;
    if (!editor) {
      new Notice("편집기를 찾을 수 없습니다.");
      return;
    }

    const editorView = getEditorView(editor);
    if (!editorView) {
      new Notice("CodeMirror 에디터 뷰를 찾을 수 없습니다.");
      return;
    }

    try {
      // 에디터 뷰 및 설정 초기화
      InlineModeService.setEditorView(editorView, this.settings, this.app, async (s) => { this.settings = s; await this.saveSettings(); });

      // 선택된 텍스트 확인
      const selectedText = editor.getSelection();
      let targetText: string;
      let isSelection = false;

      if (selectedText.trim()) {
        // 선택 텍스트가 있으면 선택 영역만 검사
        targetText = selectedText;
        isSelection = true;
        Logger.log(`인라인 모드: 선택 영역 맞춤법 검사 시작 (${targetText.length}자)`);
      } else {
        // 선택 텍스트가 없으면 전체 문서 검사
        targetText = editorView.state.doc.toString();
        Logger.log(`인라인 모드: 전체 문서 맞춤법 검사 시작 (${targetText.length}자)`);
      }

      if (!targetText.trim()) {
        new Notice("검사할 텍스트가 없습니다.");
        return;
      }

      // API 서비스를 통해 맞춤법 검사 실행
      const apiService = new SpellCheckApiService();
      const result = await apiService.checkSpelling(targetText, this.settings);

      if (!result.corrections || result.corrections.length === 0) {
        new Notice(`${isSelection ? '선택 영역에서 ' : ''}맞춤법 오류가 발견되지 않았습니다.`);
        // 선택 영역 검사 시 기존 전체 오류는 유지하고 알림만 표시
        if (isSelection) {
          return;
        }
        // 전체 문서 검사 시에는 기존 오류 초기화
        InlineModeService.clearErrors(editorView);
        return;
      }

      // 인라인 모드로 오류 표시 (선택 영역 vs 전체 문서)
      if (isSelection) {
        // 선택 영역: 기존 오류 유지하고 선택 범위 오류만 업데이트
        await InlineModeService.showErrorsInSelection(
          editorView,
          result.corrections,
          selectedText,
          this.settings.inlineMode.underlineStyle,
          this.settings.inlineMode.underlineColor,
          this.app
        );
        Logger.log(`인라인 모드: 선택 영역 맞춤법 검사 완료 (${result.corrections.length}개 오류)`);
      } else {
        // 전체 문서: 기존 오류 초기화 후 새로운 오류 표시
        await InlineModeService.showErrors(
          editorView,
          result.corrections,
          this.settings.inlineMode.underlineStyle,
          this.settings.inlineMode.underlineColor,
          this.app
        );
        Logger.log(`인라인 모드: 전체 문서 맞춤법 검사 완료 (${result.corrections.length}개 오류)`);
      }

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
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView?.editor) {
        const editorView = getEditorView(activeView.editor);
        if (editorView) {
          InlineModeService.setEditorView(editorView, this.settings, this.app, async (s) => { this.settings = s; await this.saveSettings(); });
          Logger.log('인라인 모드: InlineModeService 키보드 스코프 초기화됨');
        }
      }

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
    Logger.log('인라인 모드 비활성화됨');
  }


  /**
   * 🤖 인라인 모드 AI 분석 실행
   */
  async executeInlineAIAnalysis(): Promise<void> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView?.editor) {
      new Notice('활성화된 마크다운 편집기가 없습니다.');
      return;
    }

    const editor = activeView.editor;

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

      // 🔧 CRITICAL: 현재 활성 문서의 에디터를 명시적으로 포커스하고 InlineModeService 재설정
      // 문서 클릭 후 에디터 포커스가 없는 상태에서도 올바르게 작동하도록
      editor.focus(); // 에디터에 포커스 부여
      
      const currentEditorView = getEditorView(activeView.editor);
      if (!currentEditorView) {
        Logger.error('현재 에디터뷰를 찾을 수 없습니다');
        new Notice('에디터뷰를 찾을 수 없습니다.');
        return;
      }
      
      Logger.log('🔧 CRITICAL: 현재 문서의 에디터뷰로 InlineModeService 강제 재설정');
      
      // 🔥 SMART FIX: 현재 문서 텍스트에 실제로 존재하는 오류만 유지
      Logger.log('🔥 SMART FIX: 현재 문서 기준으로 오류 필터링');
      InlineModeService.setEditorView(currentEditorView, this.settings, this.app, async (s) => { this.settings = s; await this.saveSettings(); });
      InlineModeService.filterErrorsByCurrentDocument(targetText);
      
      // 🔧 이제 정리된 상태에서 현재 문서의 오류 상태 확인
      const hasCurrentDocumentErrors = InlineModeService.hasErrors();
      Logger.log(`🔍 현재 문서의 오류 존재 여부: ${hasCurrentDocumentErrors}`);

      if (hasCurrentDocumentErrors) {
        // 케이스 1: 현재 문서에 오류가 있는 경우 - AI 분석 실행
        Logger.log('🔍 케이스 1: 현재 문서에 오류가 있어서 AI 분석 실행');
        if (isSelection) {
          // 선택 영역이 있으면 해당 영역의 오류만 AI 분석
          Logger.log('🔍 선택 영역 AI 분석 실행');
          await this.analyzeExistingInlineErrorsInSelection(selectedText);
        } else {
          // 선택 영역이 없으면 전체 오류 AI 분석
          Logger.log('🔍 전체 오류 AI 분석 실행');
          await this.analyzeExistingInlineErrors();
        }
      } else {
        // 케이스 2: 현재 문서에 오류가 없는 경우 - 맞춤법 검사 먼저 실행 후 AI 분석
        Logger.log('🔍 케이스 2: 현재 문서에 오류가 없어서 맞춤법 검사 후 AI 분석 실행');
        await this.analyzeTextWithSpellCheckAndAI(targetText, isSelection);
      }

    } catch (error) {
      Logger.error('인라인 AI 분석 오류:', error);
      new Notice('AI 분석 중 오류가 발생했습니다.');
    }
  }

  /**
   * 선택 영역 내 기존 인라인 오류에 대한 AI 분석
   */
  private async analyzeExistingInlineErrorsInSelection(selectedText: string): Promise<void> {
    // 모델 정보 가져오기
    const { getCurrentModelInfo } = await import('./src/constants/aiModels');
    const modelInfo = getCurrentModelInfo(this.settings.ai);
    
    // 1단계: 분석 시작 알림
    const analysisNotice = new Notice(`🤖 선택 영역 AI 분석 시작 (${modelInfo.displayName})...`, 0);
    
    try {
      // 2단계: 선택 영역 내 오류 필터링
      const selectionErrorCount = InlineModeService.getErrorCountInSelection(selectedText);
      if (selectionErrorCount === 0) {
        analysisNotice.hide();
        new Notice('⚠️ 선택 영역에 분석할 오류가 없습니다.', 3000);
        return;
      }
      
      analysisNotice.setMessage(`🔢 선택 영역 내 ${selectionErrorCount}개 오류 분석 준비 중...`);
      
      // 잠시 대기 (UI 업데이트 시간 확보)
      await new Promise(resolve => window.setTimeout(resolve, 500));
      
      // 3단계: AI API 호출 알림
      analysisNotice.setMessage(`🧠 선택 영역 AI 분석 중 (${modelInfo.model})... 수십 초 소요될 수 있습니다`);
      
      // 진행률 콜백을 통한 실시간 업데이트
      await InlineModeService.runAIAnalysisOnErrorsInSelection(selectedText, (current: number, total: number) => {
        analysisNotice.setMessage(`🧠 ${modelInfo.model} 분석 중... (${current}/${total})`);
      });
      
      // 3.5단계: UI 새로고침 강제 실행
      InlineModeService.refreshErrorWidgets();
      
      // 4단계: 완료 알림
      analysisNotice.hide();
      new Notice(`✅ 선택 영역 AI 분석 완료! ${selectionErrorCount}개 오류에 색상이 적용되었습니다.`, 4000);
      new Notice('💡 오류를 클릭하여 AI 추천 이유를 확인하세요.', 3000);
      
    } catch (error) {
      analysisNotice.hide();
      Logger.error('선택 영역 AI 분석 실패:', error);
      new Notice('❌ 선택 영역 AI 분석 중 오류가 발생했습니다.', 4000);
    }
  }

  /**
   * 기존 인라인 오류에 대한 AI 분석
   */
  private async analyzeExistingInlineErrors(): Promise<void> {
    // 모델 정보 가져오기
    const { getCurrentModelInfo } = await import('./src/constants/aiModels');
    const modelInfo = getCurrentModelInfo(this.settings.ai);
    
    // 1단계: 분석 시작 알림
    const analysisNotice = new Notice(`🤖 AI 분석 시작 (${modelInfo.displayName})...`, 0); // 지속적으로 표시
    
    try {
      // 2단계: 토큰 사용량 추정 및 경고 확인
      const errorCount = InlineModeService.getErrorCount();
      analysisNotice.setMessage(`🔢 ${errorCount}개 오류 분석 준비 중...`);
      
      // 토큰 사용량 경고 확인
      Logger.log(`🔍 토큰 경고 확인 시작 - 오류 개수: ${errorCount}`);
      const shouldProceed = await this.checkInlineTokenUsageWarning();
      Logger.log(`🔍 토큰 경고 결과: ${shouldProceed ? '진행' : '취소'}`);
      if (!shouldProceed) {
        analysisNotice.hide();
        return; // 사용자가 취소한 경우
      }
      
      // 잠시 대기 (UI 업데이트 시간 확보)
      await new Promise(resolve => window.setTimeout(resolve, 500));
      
      // 3단계: AI API 호출 알림
      analysisNotice.setMessage(`🧠 AI 분석 중 (${modelInfo.model})... 수십 초 소요될 수 있습니다`);
      
      // 진행률 콜백을 통한 실시간 업데이트
      await InlineModeService.runAIAnalysisOnExistingErrors((current: number, total: number) => {
        analysisNotice.setMessage(`🧠 ${modelInfo.model} 분석 중... (${current}/${total})`);
      });
      
      // 3.5단계: UI 새로고침 강제 실행
      InlineModeService.refreshErrorWidgets();
      
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
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      processNotice.hide();
      new Notice('활성화된 편집기가 없습니다.');
      return;
    }

    try {
      // 1단계: 맞춤법 검사 실행
      processNotice.setMessage(`📝 ${targetText.length}자 텍스트 맞춤법 검사 중...`);

      // 🔧 단일 InlineModeService 시스템 사용
      const editorView = getEditorView(activeView.editor);
      if (editorView) {
        InlineModeService.setEditorView(editorView, this.settings, this.app, async (s) => { this.settings = s; await this.saveSettings(); });
      }
      
      // InlineModeService를 통한 맞춤법 검사 실행
      await InlineModeService.checkText(targetText);

      // 잠시 대기 (맞춤법 검사 완료 대기)
      await new Promise(resolve => window.setTimeout(resolve, 1000));

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
      await new Promise(resolve => window.setTimeout(resolve, 3000));

      // 3단계: AI 분석 시작 알림
      const { getCurrentModelInfo } = await import('./src/constants/aiModels');
      const modelInfo = getCurrentModelInfo(this.settings.ai);
      processNotice.setMessage(`🤖 ${errorCount}개 오류 AI 분석 시작 (${modelInfo.displayName})...`);
      
      // 토큰 사용량 경고 확인
      Logger.log(`🔍 맞춤법 검사 후 토큰 경고 확인 시작 - 오류 개수: ${errorCount}`);
      Logger.log(`🔍 AI 설정 확인:`, {
        enabled: this.settings.ai.enabled,
        provider: this.settings.ai.provider,
        showTokenWarning: this.settings.ai.showTokenWarning,
        threshold: this.settings.ai.tokenWarningThreshold,
        maxTokens: this.settings.ai.maxTokens
      });
      
      try {
        const shouldProceed = await this.checkInlineTokenUsageWarning();
        Logger.log(`🔍 맞춤법 검사 후 토큰 경고 결과: ${shouldProceed ? '진행' : '취소'}`);
        if (!shouldProceed) {
          processNotice.hide();
          return; // 사용자가 취소한 경우
        }
      } catch (error) {
        Logger.error('🔍 토큰 경고 확인 중 예외 발생:', error);
        // 에러 발생 시에도 계속 진행
      }
      
      // 잠시 대기 (UI 업데이트 시간 확보)
      await new Promise(resolve => window.setTimeout(resolve, 500));
      
      // 3단계: AI API 호출
      processNotice.setMessage(`🧠 AI 분석 중 (${modelInfo.model})... 수십 초 소요될 수 있습니다`);
      
      // 진행률 콜백을 통한 실시간 업데이트
      await InlineModeService.runAIAnalysisOnExistingErrors((current: number, total: number) => {
        processNotice.setMessage(`🧠 ${modelInfo.model} 분석 중... (${current}/${total})`);
      });
      
      // 3.5단계: UI 새로고침 강제 실행
      InlineModeService.refreshErrorWidgets();
      
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
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.editor) {
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
      const editorView = getEditorView(view.editor);
      if (editorView) {
        InlineModeService.setEditorView(editorView, this.settings, this.app, async (s) => { this.settings = s; await this.saveSettings(); });
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

  /**
   * 인라인 분석 결과 표시 일괄 취소 실행
   */
  async executeInlineClearAll(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.editor) {
      new Notice('활성화된 편집기가 없습니다.');
      return;
    }

    // 현재 분석 결과가 있는지 확인
    const errorCount = InlineModeService.getErrorCount();
    if (errorCount === 0) {
      new Notice('취소할 인라인 분석 결과가 없습니다.');
      return;
    }

    const processNotice = new Notice(`🗑️ ${errorCount}개 분석 결과 표시 일괄 취소 중...`, 2000);

    try {
      // 에디터 뷰 설정
      const editorView = getEditorView(view.editor);
      if (editorView) {
        InlineModeService.setEditorView(editorView, this.settings, this.app, async (s) => { this.settings = s; await this.saveSettings(); });

        // 모든 오류 제거
        InlineModeService.clearErrors(editorView);
      }

      // 완료 알림
      processNotice.hide();
      new Notice(`✅ ${errorCount}개 분석 결과 표시가 모두 제거되었습니다!`, 3000);

    } catch (error) {
      processNotice.hide();
      Logger.error('인라인 분석 결과 표시 일괄 취소 실패:', error);
      new Notice('❌ 분석 결과 표시 일괄 취소 중 오류가 발생했습니다.', 4000);
    }
  }

  /**
   * 인라인 모드 AI 분석 토큰 경고 확인
   */
  private async checkInlineTokenUsageWarning(): Promise<boolean> {
    try {
      Logger.log('🔍 인라인 토큰 경고 확인 시작');
      
      // TokenWarningModal import
      const { TokenWarningModal } = await import('./src/utils/tokenWarningModal');
      Logger.log('🔍 TokenWarningModal 임포트 완료');
      
      // 🔧 현재 문서 검증 추가
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView?.editor) {
        Logger.warn('활성 마크다운 에디터가 없어서 토큰 경고 건너뜀');
        return true;
      }
      
      const currentEditorView = getEditorView(activeView.editor);
      if (!currentEditorView || !InlineModeService.isCurrentView(currentEditorView)) {
        Logger.warn('현재 에디터뷰가 InlineModeService와 일치하지 않아서 토큰 경고 건너뜀');
        return true;
      }
      
      // 현재 문서의 유효한 오류들만 가져오기
      const errorCount = InlineModeService.getErrorCount();
      Logger.log(`🔍 현재 문서의 유효한 오류 개수: ${errorCount}`);
      if (errorCount === 0) {
        Logger.log('🔍 유효한 오류가 없어서 바로 진행');
        return true; // 오류가 없으면 바로 진행
      }

      // 실제 오류 개수를 반영한 토큰 추정 (30개 오류면 30개로 계산)
      const sampleErrors = Array.from({ length: errorCount }, (_, i) => ({
        original: `샘플오류${i + 1}`,
        corrected: [`수정안${i + 1}`],
        help: `샘플 도움말 ${i + 1}`
      }));

      Logger.log(`🔍 토큰 추정용 샘플 오류 생성: ${sampleErrors.length}개 (실제 오류 개수: ${errorCount})`);

      // AI 분석 요청 구성 (간단한 형태)
      const request = {
        originalText: '', // 인라인 모드에서는 전체 텍스트 불필요
        corrections: sampleErrors,
        contextWindow: errorCount > 1 ? 30 : 100, // 복수 오류 시 최적화
        currentStates: {},
        enhancedContext: false // 인라인 모드에서는 단순한 컨텍스트
      };

      // AI 서비스 가져오기
      const { AIAnalysisService } = await import('./src/services/aiAnalysisService');
      const aiService = new AIAnalysisService(this.settings.ai);

      // 토큰 경고 설정
      const tokenWarningSettings = {
        showTokenWarning: this.settings.ai.showTokenWarning,
        tokenWarningThreshold: this.settings.ai.tokenWarningThreshold,
        maxTokens: this.settings.ai.maxTokens
      };

      Logger.log('🔍 토큰 경고 설정:', {
        showTokenWarning: tokenWarningSettings.showTokenWarning,
        threshold: tokenWarningSettings.tokenWarningThreshold,
        maxTokens: tokenWarningSettings.maxTokens,
        aiEnabled: this.settings.ai.enabled,
        provider: this.settings.ai.provider
      });

      // 설정 업데이트 콜백
      const onSettingsUpdate = (newMaxTokens: number) => {
        this.settings.ai.maxTokens = newMaxTokens;
        void this.saveSettings();
        Logger.log(`인라인 모드: 최대 토큰을 ${newMaxTokens}으로 업데이트했습니다.`);
        new Notice(`⚙️ 최대 토큰이 ${newMaxTokens.toLocaleString()}으로 업데이트되었습니다.`, 3000);
      };

      Logger.log('🔍 TokenWarningModal.checkTokenUsageWarning 호출 시작');
      const result = await TokenWarningModal.checkTokenUsageWarning(
        request, 
        aiService, 
        tokenWarningSettings, 
        onSettingsUpdate
      );
      Logger.log(`🔍 TokenWarningModal.checkTokenUsageWarning 결과: ${result}`);
      return result;

    } catch (error) {
      Logger.error('인라인 토큰 경고 확인 중 오류:', error);
      // 오류 발생 시 기본적으로 진행 허용
      return true;
    }
  }

  /**
   * 🔧 문서 전환 감지 이벤트 리스너 설정
   * 파일이나 리프가 변경될 때마다 InlineModeService 상태를 자동으로 정리
   */
  private setupDocumentChangeListeners(): void {

    // 파일 변경 감지 - 다른 파일로 이동할 때 트리거
    this.registerEvent(this.app.workspace.on('file-open', () => {

      // 인라인 모드가 활성화되어 있고 오류가 있으면 상태 완전 정리
      if (this.settings?.inlineMode?.enabled && InlineModeService.hasErrors()) {
        Logger.log('🔧 file-open: 이전 문서의 인라인 오류 상태 완전 정리');
        InlineModeService.forceCleanAllErrors();
      }

      // 새로운 문서에 인라인 모드 설정 (오류 상태는 깨끗한 상태에서 시작)
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView?.editor && this.settings?.inlineMode?.enabled) {
        const currentEditorView = getEditorView(activeView.editor);
        if (currentEditorView) {
          InlineModeService.setEditorView(currentEditorView, this.settings, this.app, async (s) => { this.settings = s; await this.saveSettings(); }, this);
        }
      }
    }));

    // 리프 변경 감지 - 탭 변경, 패널 변경 등을 포함한 더 광범위한 변경 감지
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {

      // 인라인 모드가 활성화되어 있고 오류가 있으면 먼저 상태 정리
      if (this.settings?.inlineMode?.enabled && InlineModeService.hasErrors()) {
        Logger.log('🔧 active-leaf-change: 이전 탭의 인라인 오류 상태 완전 정리');
        InlineModeService.forceCleanAllErrors();
      }

      // 마크다운 뷰로 변경되었을 때만 새로운 뷰 설정
      if (leaf?.view instanceof MarkdownView && this.settings?.inlineMode?.enabled) {
        const markdownView = leaf.view;
        if (markdownView?.editor) {
          const currentEditorView = getEditorView(markdownView.editor);
          if (currentEditorView) {
            InlineModeService.setEditorView(currentEditorView, this.settings, this.app, async (s) => { this.settings = s; await this.saveSettings(); }, this);
          }
        }
      }
    }));
  }
}


