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
import { IgnoredWordsService } from './src/services/ignoredWords';
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

  /**
   * 예외 처리된 단어들을 태그 클라우드로 렌더링합니다.
   */
  private renderIgnoredWordsCloud(container: HTMLElement): void {
    container.empty();
    
    const ignoredWords = IgnoredWordsService.getIgnoredWords(this.plugin.settings);
    
    if (ignoredWords.length === 0) {
      container.createEl("div", {
        text: "예외 처리된 단어가 없습니다.",
        cls: "setting-item-description"
      }).style.textAlign = "center";
      return;
    }

    ignoredWords.forEach(word => {
      const tag = container.createEl("span", {
        text: word,
        cls: "ignored-word-tag"
      });
      
      tag.style.cssText = `
        display: inline-block;
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        padding: 4px 8px;
        margin: 2px;
        border-radius: 12px;
        font-size: 12px;
        cursor: pointer;
        position: relative;
      `;
      
      // X 버튼 추가
      const removeBtn = tag.createEl("span", {
        text: "×",
        cls: "remove-word-btn"
      });
      removeBtn.style.cssText = `
        margin-left: 6px;
        font-weight: bold;
        opacity: 0.7;
      `;
      
      removeBtn.onclick = async (e) => {
        e.stopPropagation();
        this.plugin.settings = IgnoredWordsService.removeIgnoredWord(word, this.plugin.settings);
        await this.plugin.saveSettings();
        this.renderIgnoredWordsCloud(container);
        
        // 개수 업데이트
        const countInfo = container.parentElement?.querySelector('.setting-item-description');
        if (countInfo) {
          countInfo.textContent = `현재 ${IgnoredWordsService.getIgnoredWordsCount(this.plugin.settings)}개의 단어가 예외 처리되어 있습니다.`;
        }
      };
      
      removeBtn.onmouseover = () => {
        removeBtn.style.opacity = "1";
      };
      
      removeBtn.onmouseout = () => {
        removeBtn.style.opacity = "0.7";
      };
    });
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

    // 예외 처리된 단어 관리 섹션
    containerEl.createEl("h3", { text: "예외 처리된 단어" });
    
    const ignoredWordsDesc = containerEl.createEl("div", {
      cls: "setting-item-description",
      text: "맞춤법 검사에서 제외할 단어들을 관리합니다. 팝업에서 '예외처리'를 선택하면 자동으로 추가됩니다."
    });

    // 예외 처리된 단어 개수 표시
    const wordsCount = IgnoredWordsService.getIgnoredWordsCount(this.plugin.settings);
    const countInfo = containerEl.createEl("div", {
      cls: "setting-item-description",
      text: `현재 ${wordsCount}개의 단어가 예외 처리되어 있습니다.`
    });

    // 태그 클라우드 컨테이너
    const tagCloudContainer = containerEl.createDiv("ignored-words-container");
    tagCloudContainer.style.cssText = `
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      padding: 12px;
      margin: 10px 0;
      background: var(--background-secondary);
      min-height: 100px;
      max-height: 200px;
      overflow-y: auto;
    `;

    this.renderIgnoredWordsCloud(tagCloudContainer);

    // 단어 추가/제거 컨트롤
    new Setting(containerEl)
      .setName("단어 추가")
      .setDesc("쉼표로 구분하여 여러 단어를 한 번에 추가할 수 있습니다")
      .addText(text => {
        const input = text.setPlaceholder("예: 단어1, 단어2, 단어3");
        
        const addButton = containerEl.createEl("button", {
          text: "추가",
          cls: "mod-cta"
        });
        addButton.style.marginLeft = "8px";
        
        addButton.onclick = async () => {
          const words = input.getValue();
          if (words.trim()) {
            this.plugin.settings = IgnoredWordsService.importIgnoredWords(
              words, 
              ',', 
              this.plugin.settings
            );
            await this.plugin.saveSettings();
            input.setValue("");
            this.renderIgnoredWordsCloud(tagCloudContainer);
            countInfo.textContent = `현재 ${IgnoredWordsService.getIgnoredWordsCount(this.plugin.settings)}개의 단어가 예외 처리되어 있습니다.`;
          }
        };
        
        text.inputEl.parentElement?.appendChild(addButton);
        return text;
      });

    // 모든 단어 제거 버튼
    new Setting(containerEl)
      .setName("모든 예외 처리된 단어 제거")
      .setDesc("주의: 이 작업은 되돌릴 수 없습니다")
      .addButton(button => button
        .setButtonText("모두 제거")
        .setWarning()
        .onClick(async () => {
          this.plugin.settings = IgnoredWordsService.clearAllIgnoredWords(this.plugin.settings);
          await this.plugin.saveSettings();
          this.renderIgnoredWordsCloud(tagCloudContainer);
          countInfo.textContent = `현재 ${IgnoredWordsService.getIgnoredWordsCount(this.plugin.settings)}개의 단어가 예외 처리되어 있습니다.`;
        }));

    // 도움말 섹션
    containerEl.createEl("h3", { text: "사용법" });
    
    const helpText = containerEl.createEl("div", {
      cls: "setting-item-description"
    });
    
    helpText.innerHTML = `
      <ul>
        <li><strong>텍스트 선택 후 실행:</strong> 특정 텍스트만 검사</li>
        <li><strong>선택하지 않고 실행:</strong> 전체 문서 검사</li>
        <li><strong>미리보기 클릭:</strong> 오류 → 수정 → 예외처리 순환</li>
        <li><strong>예외 처리:</strong> 파란색으로 표시되며 향후 검사에서 제외됨</li>
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