import {
  Plugin,
  PluginSettingTab,
  App,
  Setting,
  addIcon,
} from "obsidian";

// Import modularized components
import { PluginSettings } from './src/types/interfaces';
import { DEFAULT_SETTINGS, SettingsService } from './src/services/settings';
import { SpellCheckOrchestrator } from './src/orchestrator';

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
  private orchestrator: SpellCheckOrchestrator;

  async onload() {
    // 설정 로드
    await this.loadSettings();

    // 오케스트레이터 초기화
    this.orchestrator = new SpellCheckOrchestrator(this.app, this.settings);

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

    // 설정 탭 추가
    this.addSettingTab(new SpellingSettingTab(this.app, this));
  }

  onunload() {
    // 정리 작업은 각 컴포넌트에서 담당
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

/**
 * 설정 탭 클래스
 */
class SpellingSettingTab extends PluginSettingTab {
  plugin: KoreanGrammarPlugin;

  constructor(app: App, plugin: KoreanGrammarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 헤더
    containerEl.createEl("h2", { text: "한국어 맞춤법 검사 설정" });

    // API 키 설정
    new Setting(containerEl)
      .setName("Bareun.ai API 키")
      .setDesc("Bareun.ai 서비스의 API 키를 입력하세요")
      .addText(text => text
        .setPlaceholder("API 키를 입력하세요")
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
        }));

    // API 호스트 설정
    new Setting(containerEl)
      .setName("API 호스트")
      .setDesc("API 서버의 호스트 주소")
      .addText(text => text
        .setPlaceholder("bareun-api.junlim.org")
        .setValue(this.plugin.settings.apiHost)
        .onChange(async (value) => {
          this.plugin.settings.apiHost = value;
          await this.plugin.saveSettings();
        }));

    // API 포트 설정
    new Setting(containerEl)
      .setName("API 포트")
      .setDesc("API 서버의 포트 번호")
      .addText(text => text
        .setPlaceholder("443")
        .setValue(this.plugin.settings.apiPort.toString())
        .onChange(async (value) => {
          const port = parseInt(value);
          if (!isNaN(port) && port > 0 && port <= 65535) {
            this.plugin.settings.apiPort = port;
            await this.plugin.saveSettings();
          }
        }));

    // 설정 검증 결과 표시
    const validation = SettingsService.validateSettings(this.plugin.settings);
    if (!validation.isValid) {
      const errorContainer = containerEl.createEl("div", {
        cls: "setting-item-description",
        text: `설정 오류: ${validation.errors.join(', ')}`
      });
      errorContainer.style.color = "var(--text-error)";
      errorContainer.style.marginTop = "10px";
    }

    // 도움말 섹션
    containerEl.createEl("h3", { text: "사용법" });
    
    const helpText = containerEl.createEl("div", {
      cls: "setting-item-description"
    });
    
    helpText.innerHTML = `
      <ul>
        <li><strong>텍스트 선택 후 실행:</strong> 특정 텍스트만 검사</li>
        <li><strong>선택하지 않고 실행:</strong> 전체 문서 검사</li>
        <li><strong>미리보기 클릭:</strong> 오류 → 수정 → 원본선택 순환</li>
        <li><strong>긴 텍스트:</strong> 자동 페이지 분할 및 네비게이션</li>
      </ul>
    `;

    // API 정보 섹션
    containerEl.createEl("h3", { text: "API 정보" });
    
    const apiInfo = containerEl.createEl("div", {
      cls: "setting-item-description"
    });
    
    apiInfo.innerHTML = `
      <p>이 플러그인은 <a href="https://bareun.ai" target="_blank">Bareun.ai</a> 서비스를 사용합니다.</p>
      <p>API 키는 Bareun.ai 웹사이트에서 발급받을 수 있습니다.</p>
    `;
  }
}