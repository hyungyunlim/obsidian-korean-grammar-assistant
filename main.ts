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
import { createList, createParagraph, createLink, appendChildren, clearElement } from './src/utils/domUtils';
import { 
  AI_PROVIDER_DEFAULTS, 
  DEFAULT_AI_SETTINGS,
  OPENAI_MODELS, 
  ANTHROPIC_MODELS, 
  GOOGLE_MODELS, 
  OLLAMA_MODELS 
} from './src/constants/aiModels';

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
   * AI 설정이 없을 경우 초기화합니다.
   */
  private ensureAISettings(): void {
    if (!this.plugin.settings.ai) {
      this.plugin.settings.ai = { ...DEFAULT_AI_SETTINGS };
    }
  }

  /**
   * AI 설정 섹션을 렌더링합니다.
   */
  private renderAISettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "AI 자동 교정 기능" });

    // AI 기능 활성화/비활성화
    new Setting(containerEl)
      .setName("AI 자동 교정 활성화")
      .setDesc("AI를 사용하여 맞춤법 오류에 대한 최적의 수정사항을 자동으로 제안합니다.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.ai?.enabled || false)
        .onChange(async (value) => {
          this.ensureAISettings();
          this.plugin.settings.ai.enabled = value;
          await this.plugin.saveSettings();
          this.display(); // AI 설정이 변경되면 UI 새로고침
        }));

    if (!this.plugin.settings.ai?.enabled) {
      const disabledDesc = containerEl.createEl("div", {
        cls: "setting-item-description",
        text: "AI 기능이 비활성화되어 있습니다. 위의 토글을 활성화하면 AI 관련 설정이 표시됩니다."
      });
      disabledDesc.addClass('ai-disabled-desc');
      return;
    }

    // AI 제공자 선택
    new Setting(containerEl)
      .setName("AI 제공자")
      .setDesc("사용할 AI 서비스를 선택하세요")
      .addDropdown(dropdown => dropdown
        .addOption('openai', 'OpenAI')
        .addOption('anthropic', 'Anthropic (Claude)')
        .addOption('google', 'Google (Gemini)')
        .addOption('ollama', 'Ollama (로컬)')
        .setValue(this.plugin.settings.ai?.provider || 'openai')
        .onChange(async (value: 'openai' | 'anthropic' | 'google' | 'ollama') => {
          this.ensureAISettings();
          this.plugin.settings.ai.provider = value;
          // 제공자 변경 시 기본 모델로 설정
          this.plugin.settings.ai.model = AI_PROVIDER_DEFAULTS[value];
          await this.plugin.saveSettings();
          this.display(); // 제공자 변경 시 UI 새로고침
        }));

    // AI 모델 선택
    new Setting(containerEl)
      .setName("AI 모델")
      .setDesc("사용할 AI 모델을 선택하세요")
      .addDropdown(dropdown => {
        const provider = this.plugin.settings.ai?.provider || 'openai';
        let models: readonly string[] = [];
        
        switch (provider) {
          case 'openai':
            models = OPENAI_MODELS;
            break;
          case 'anthropic':
            models = ANTHROPIC_MODELS;
            break;
          case 'google':
            models = GOOGLE_MODELS;
            break;
          case 'ollama':
            models = OLLAMA_MODELS;
            break;
        }

        models.forEach(model => {
          dropdown.addOption(model, model);
        });

        dropdown.setValue(this.plugin.settings.ai?.model || AI_PROVIDER_DEFAULTS[provider]);
        dropdown.onChange(async (value) => {
          this.ensureAISettings();
          this.plugin.settings.ai.model = value;
          await this.plugin.saveSettings();
        });
      });

    // API 키 설정 (제공자별)
    this.renderAIApiKeySettings(containerEl);

    // 고급 설정
    new Setting(containerEl)
      .setName("최대 토큰 수")
      .setDesc("AI 응답의 최대 길이를 설정합니다. 높을수록 더 많은 오류를 한 번에 처리할 수 있습니다. (기본: 2000, 큰 문서는 5000-10000 권장)")
      .addText(text => text
        .setPlaceholder("2000")
        .setValue((this.plugin.settings.ai.maxTokens || 2000).toString())
        .onChange(async (value) => {
          const tokens = parseInt(value);
          if (!isNaN(tokens) && tokens >= 100) {
            this.ensureAISettings();
            this.plugin.settings.ai.maxTokens = tokens;
            await this.plugin.saveSettings();
          }
        }));

    // 토큰 사용량 경고 설정
    new Setting(containerEl)
      .setName("토큰 사용량 경고")
      .setDesc("AI 분석 시 예상 토큰 사용량이 많을 때 확인 메시지를 표시합니다.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.ai?.showTokenWarning || true)
        .onChange(async (value) => {
          this.ensureAISettings();
          this.plugin.settings.ai.showTokenWarning = value;
          await this.plugin.saveSettings();
          this.display(); // 토글 변경 시 UI 새로고침
        }));

    if (this.plugin.settings.ai?.showTokenWarning) {
      new Setting(containerEl)
        .setName("경고 임계값")
        .setDesc("이 토큰 수 이상일 때 확인 메시지를 표시합니다 (기본: 3000)")
        .addText(text => text
          .setPlaceholder("3000")
          .setValue((this.plugin.settings.ai?.tokenWarningThreshold || 3000).toString())
          .onChange(async (value) => {
            const threshold = parseInt(value);
            if (!isNaN(threshold) && threshold >= 500) {
              this.ensureAISettings();
              this.plugin.settings.ai.tokenWarningThreshold = threshold;
              await this.plugin.saveSettings();
            }
          }));
    }
  }

  /**
   * AI API 키 설정을 렌더링합니다.
   */
  private renderAIApiKeySettings(containerEl: HTMLElement): void {
    const provider = this.plugin.settings.ai?.provider || 'openai';

    switch (provider) {
      case 'openai':
        new Setting(containerEl)
          .setName("OpenAI API 키")
          .setDesc("OpenAI API 키를 입력하세요. https://platform.openai.com/api-keys 에서 발급받을 수 있습니다.")
          .addText(text => text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.ai?.openaiApiKey || '')
            .onChange(async (value) => {
              this.ensureAISettings();
              this.plugin.settings.ai.openaiApiKey = value;
              await this.plugin.saveSettings();
            }));
        break;
      
      case 'anthropic':
        new Setting(containerEl)
          .setName("Anthropic API 키")
          .setDesc("Anthropic (Claude) API 키를 입력하세요. https://console.anthropic.com/ 에서 발급받을 수 있습니다.")
          .addText(text => text
            .setPlaceholder("sk-ant-...")
            .setValue(this.plugin.settings.ai?.anthropicApiKey || '')
            .onChange(async (value) => {
              this.ensureAISettings();
              this.plugin.settings.ai.anthropicApiKey = value;
              await this.plugin.saveSettings();
            }));
        break;
      
      case 'google':
        new Setting(containerEl)
          .setName("Google API 키")
          .setDesc("Google AI API 키를 입력하세요. https://aistudio.google.com/app/apikey 에서 발급받을 수 있습니다.")
          .addText(text => text
            .setPlaceholder("AIza...")
            .setValue(this.plugin.settings.ai?.googleApiKey || '')
            .onChange(async (value) => {
              this.ensureAISettings();
              this.plugin.settings.ai.googleApiKey = value;
              await this.plugin.saveSettings();
            }));
        break;
      
      case 'ollama':
        new Setting(containerEl)
          .setName("Ollama 엔드포인트")
          .setDesc("로컬 Ollama 서버의 주소를 입력하세요. 기본값: http://localhost:11434")
          .addText(text => text
            .setPlaceholder("http://localhost:11434")
            .setValue(this.plugin.settings.ai?.ollamaEndpoint || 'http://localhost:11434')
            .onChange(async (value) => {
              this.ensureAISettings();
              this.plugin.settings.ai.ollamaEndpoint = value;
              await this.plugin.saveSettings();
            }));
        break;
    }
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
      }).addClass('ignored-words-empty');
      return;
    }

    ignoredWords.forEach(word => {
      const tag = container.createEl("span", {
        text: word,
        cls: "ignored-word-tag"
      });
      
      tag.addClass('ignored-word-tag');
      
      // X 버튼 추가
      const removeBtn = tag.createEl("span", {
        text: "×",
        cls: "remove-word-btn"
      });
      removeBtn.addClass('remove-word-btn');
      
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
      
      // Hover effects are now handled by CSS
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
      errorContainer.addClass('settings-error');
    }

    // AI 설정 섹션
    this.renderAISettings(containerEl);

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

    // 태그 클라우드 섹션 컨테이너
    const tagCloudSection = containerEl.createDiv("tag-cloud-section");
    tagCloudSection.addClass('tag-cloud-section');

    // 태그 클라우드 헤더 (모두 제거 버튼 포함)
    const tagCloudHeader = tagCloudSection.createDiv("tag-cloud-header");
    tagCloudHeader.addClass('tag-cloud-header');

    const headerLabel = tagCloudHeader.createEl("span", {
      text: "예외 처리된 단어 목록",
      cls: "tag-cloud-label"
    });
    headerLabel.addClass('tag-cloud-label');

    const clearAllButton = tagCloudHeader.createEl("button", {
      text: "모두 제거",
      cls: "mod-warning"
    });
    clearAllButton.addClass('clear-all-button');

    // 태그 클라우드 컨테이너
    const tagCloudContainer = tagCloudSection.createDiv("ignored-words-container");
    tagCloudContainer.addClass('ignored-words-container');

    // 모두 제거 버튼 이벤트
    clearAllButton.onclick = async () => {
      this.plugin.settings = IgnoredWordsService.clearAllIgnoredWords(this.plugin.settings);
      await this.plugin.saveSettings();
      this.renderIgnoredWordsCloud(tagCloudContainer);
      countInfo.textContent = `현재 ${IgnoredWordsService.getIgnoredWordsCount(this.plugin.settings)}개의 단어가 예외 처리되어 있습니다.`;
    };

    this.renderIgnoredWordsCloud(tagCloudContainer);

    // 단어 추가 섹션
    const addWordSetting = new Setting(containerEl)
      .setName("단어 추가")
      .setDesc("쉼표를 입력하면 미리보기가 표시되고, 엔터키를 누르면 추가됩니다");

    // 커스텀 입력 컨테이너 생성
    const inputContainer = addWordSetting.controlEl.createDiv("add-word-container");
    inputContainer.addClass('add-word-container');

    // 입력 필드와 버튼 영역
    const inputRow = inputContainer.createDiv("input-row");
    inputRow.addClass('input-row');

    const inputField = inputRow.createEl("input", {
      type: "text",
      placeholder: "예: 단어1, 단어2, 단어3"
    });
    inputField.addClass('add-word-input');

    const addButton = inputRow.createEl("button", {
      text: "추가",
      cls: "mod-cta"
    });
    addButton.addClass('add-word-button');

    // 미리보기 태그 영역
    const previewContainer = inputContainer.createDiv("tag-preview-container");
    previewContainer.addClass('tag-preview-container');

    const previewLabel = previewContainer.createEl("span", {
      text: "미리보기:",
      cls: "preview-label"
    });
    previewLabel.addClass('preview-label');

    // 현재 입력된 태그들을 추적
    let currentTags: string[] = [];

    // 태그 미리보기 업데이트 함수
    const updateTagPreview = () => {
      // 기존 태그들 제거 (라벨 제외)
      const existingTags = previewContainer.querySelectorAll('.preview-tag');
      existingTags.forEach(tag => tag.remove());

      const ignoredWords = IgnoredWordsService.getIgnoredWords(this.plugin.settings);

      if (currentTags.length > 0) {
        previewContainer.addClass('visible');
        
        currentTags.forEach((tag, index) => {
          const isAlreadyIgnored = ignoredWords.includes(tag);
          
          const tagEl = previewContainer.createEl("span", {
            text: isAlreadyIgnored ? `${tag} (무시됨)` : tag,
            cls: "preview-tag"
          });

          if (isAlreadyIgnored) {
            tagEl.addClass('preview-tag already-ignored');
          } else {
            tagEl.addClass('preview-tag new-tag');
          }
          
          // 클릭하면 해당 태그 제거
          tagEl.onclick = () => {
            currentTags.splice(index, 1);
            updateTagPreview();
          };
        });
      } else {
        previewContainer.removeClass('visible');
      }
    };

    // 단어 추가 함수
    const addWordsToSettings = async () => {
      if (currentTags.length > 0) {
        const wordsString = currentTags.join(", ");
        this.plugin.settings = IgnoredWordsService.importIgnoredWords(
          wordsString, 
          ',', 
          this.plugin.settings
        );
        await this.plugin.saveSettings();
        
        // 초기화
        currentTags = [];
        inputField.value = "";
        updateTagPreview();
        
        // UI 업데이트
        this.renderIgnoredWordsCloud(tagCloudContainer);
        countInfo.textContent = `현재 ${IgnoredWordsService.getIgnoredWordsCount(this.plugin.settings)}개의 단어가 예외 처리되어 있습니다.`;
      }
    };

    // 입력 필드 이벤트 리스너
    inputField.addEventListener('input', (e) => {
      const value = (e.target as HTMLInputElement).value;
      
      // 콤마가 입력되면 태그로 변환
      if (value.includes(',')) {
        const parts = value.split(',');
        const newWords = parts.slice(0, -1).map(word => word.trim()).filter(word => word.length > 0);
        
        newWords.forEach(word => {
          if (!currentTags.includes(word)) {
            currentTags.push(word);
          }
        });
        
        // 마지막 부분 (콤마 이후)을 입력 필드에 남김
        inputField.value = parts[parts.length - 1];
        updateTagPreview();
      }
    });

    // 엔터키 이벤트
    inputField.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        
        // 현재 입력 중인 단어도 추가
        const currentInput = inputField.value.trim();
        if (currentInput && !currentTags.includes(currentInput)) {
          currentTags.push(currentInput);
        }
        
        updateTagPreview(); // 미리보기 업데이트
        await addWordsToSettings();
      }
    });

    // 추가 버튼 클릭
    addButton.onclick = async () => {
      // 현재 입력 중인 단어도 추가
      const currentInput = inputField.value.trim();
      if (currentInput && !currentTags.includes(currentInput)) {
        currentTags.push(currentInput);
      }
      
      updateTagPreview(); // 미리보기 업데이트
      await addWordsToSettings();
    };


    // 도움말 섹션
    containerEl.createEl("h3", { text: "사용법" });
    
    const helpText = containerEl.createEl("div", {
      cls: "setting-item-description"
    });
    
    const helpItems = [
      '텍스트 선택 후 실행: 특정 텍스트만 검사',
      '선택하지 않고 실행: 전체 문서 검사',
      '미리보기 클릭: 오류 → 수정 → 예외처리 순환',
      '예외 처리: 파란색으로 표시되며 향후 검사에서 제외됨',
      '긴 텍스트: 자동 페이지 분할 및 네비게이션'
    ];
    const helpList = createList(helpItems, false);
    helpText.appendChild(helpList);

    // API 정보 섹션
    containerEl.createEl("h3", { text: "API 정보" });
    
    const apiInfo = containerEl.createEl("div", {
      cls: "setting-item-description"
    });
    
    const apiPara1 = createParagraph('이 플러그인은 ');
    const bareunLink = createLink('Bareun.ai', 'https://bareun.ai', '_blank');
    apiPara1.appendChild(bareunLink);
    apiPara1.appendChild(document.createTextNode(' 서비스를 사용합니다.'));
    
    const apiPara2 = createParagraph('API 키는 Bareun.ai 웹사이트에서 발급받을 수 있습니다.');
    
    appendChildren(apiInfo, apiPara1, apiPara2);
  }
}