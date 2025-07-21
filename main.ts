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

    // 설정 탭 추가
    this.addSettingTab(new ModernSettingsTab(this.app, this));
  }

  onunload() {
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
}


