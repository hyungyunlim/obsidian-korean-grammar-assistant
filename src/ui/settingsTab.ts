import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import KoreanGrammarPlugin from '../../main';
import { AI_PROVIDER_DEFAULTS } from '../constants/aiModels';
import { AdvancedSettingsService } from '../services/advancedSettingsService';
import { IgnoredWordsService } from '../services/ignoredWords';
import { Logger } from '../utils/logger';
import { createMetricsDisplay, createValidationDisplay, clearElement } from '../utils/domUtils';

/**
 * 탭 타입 정의
 */
type SettingsTab = 'basic' | 'ai' | 'advanced' | 'performance' | 'beta';

/**
 * 현대적인 탭 기반 설정 인터페이스
 * 사용자 경험을 개선하고 설정을 논리적으로 그룹화
 */
export class ModernSettingsTab extends PluginSettingTab {
  plugin: KoreanGrammarPlugin;
  private currentTab: SettingsTab = 'basic';
  private tabContainer: HTMLElement | null = null;
  private contentContainer: HTMLElement | null = null;

  constructor(app: App, plugin: KoreanGrammarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 통합 CSS 스타일 추가
    this.injectGlobalStyles();

    // 메인 래퍼 생성
    const mainWrapper = containerEl.createEl('div', { cls: 'ksc-settings-wrapper' });

    // 헤더 섹션
    this.createHeader(mainWrapper);

    // 탭 네비게이션 생성
    this.createTabNavigation(mainWrapper);

    // 콘텐츠 컨테이너 생성
    this.contentContainer = mainWrapper.createEl('div', { cls: 'ksc-content-container' });

    // 현재 탭 콘텐츠 렌더링
    this.renderCurrentTab();
  }

  /**
   * 통합 CSS 스타일 주입
   */
  private injectGlobalStyles(): void {
    if (document.querySelector('#ksc-global-styles')) return;

    const style = document.head.createEl('style', { attr: { id: 'ksc-global-styles' } });
    style.textContent = `
      /* =================================================================
         Korean Spell Checker - 통합 디자인 시스템
         ================================================================= */
      
      /* 기본 래퍼 */
      .ksc-settings-wrapper {
        max-width: 900px;
        margin: 0 auto;
        padding: 0;
        font-family: var(--font-interface);
        line-height: 1.5;
      }

      /* 헤더 */
      .ksc-header {
        text-align: center;
        margin-bottom: 32px;
        padding: 24px 0;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .ksc-header-title {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-normal);
        margin: 0 0 8px 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
      }

      .ksc-header-subtitle {
        font-size: 14px;
        color: var(--text-muted);
        margin: 0;
        font-weight: 400;
      }

      /* 탭 네비게이션 */
      .ksc-tab-nav {
        display: flex;
        gap: 2px;
        background: var(--background-secondary);
        padding: 4px;
        border-radius: 8px;
        margin-bottom: 24px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .ksc-tab-button {
        flex: 1;
        padding: 16px 12px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--text-muted);
        font-family: var(--font-interface);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        min-height: 60px;
        text-align: center;
      }

      .ksc-tab-button:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
        transform: translateY(-1px);
      }

      .ksc-tab-button.active {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      }

      .ksc-tab-icon {
        font-size: 18px;
        line-height: 1;
      }

      .ksc-tab-label {
        font-size: 12px;
        line-height: 1.2;
        font-weight: 500;
      }

      /* 콘텐츠 컨테이너 */
      .ksc-content-container {
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 12px;
        padding: 0;
        min-height: 400px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        overflow: hidden;
      }

      /* 섹션 */
      .ksc-section {
        padding: 24px;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .ksc-section:last-child {
        border-bottom: none;
      }

      .ksc-section-header {
        margin-bottom: 20px;
      }

      .ksc-section-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-normal);
        margin: 0 0 4px 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .ksc-section-desc {
        font-size: 13px;
        color: var(--text-muted);
        margin: 0;
        line-height: 1.4;
      }

      /* 정보 박스 */
      .ksc-info-box {
        background: var(--background-modifier-form-field);
        border: 1px solid var(--background-modifier-border);
        border-left: 4px solid var(--interactive-accent);
        border-radius: 6px;
        padding: 16px;
        margin: 16px 0;
        font-size: 13px;
        line-height: 1.5;
      }

      .ksc-warning-box {
        background: var(--background-modifier-error);
        border: 1px solid var(--text-error);
        border-left: 4px solid var(--text-error);
        color: var(--text-error);
      }

      .ksc-success-box {
        background: var(--background-modifier-success);
        border: 1px solid var(--text-success);
        border-left: 4px solid var(--text-success);
        color: var(--text-success);
      }

      /* 설정 그룹 */
      .ksc-setting-group {
        margin-bottom: 24px;
      }

      .ksc-setting-group:last-child {
        margin-bottom: 0;
      }

      /* 버튼 그룹 */
      .ksc-button-group {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 16px;
      }

      /* 예외 단어 태그 클라우드 */
      .ksc-tag-cloud {
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        padding: 16px;
        margin: 16px 0;
        min-height: 80px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: flex-start;
        align-content: flex-start;
      }

      .ksc-tag {
        display: inline-flex;
        align-items: center;
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        gap: 4px;
      }

      .ksc-tag:hover {
        background: var(--interactive-accent-hover);
        transform: translateY(-1px);
      }

      .ksc-tag-remove {
        background: rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        cursor: pointer;
      }

      .ksc-tag-remove:hover {
        background: rgba(255, 255, 255, 0.5);
      }

      /* 메트릭 디스플레이 */
      .ksc-metrics {
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        padding: 16px;
        font-family: var(--font-monospace);
        font-size: 13px;
        line-height: 1.6;
        margin: 16px 0;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }

      /* 모던한 버튼 스타일 */
      .ksc-button-group button {
        background: var(--interactive-normal);
        color: var(--text-normal);
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .ksc-button-group button:hover {
        background: var(--interactive-hover);
        border-color: var(--interactive-accent);
        transform: translateY(-1px);
      }

      .ksc-button-group button.mod-cta {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border-color: var(--interactive-accent);
      }

      .ksc-button-group button.mod-warning {
        background: var(--text-error);
        color: var(--text-on-accent);
        border-color: var(--text-error);
      }

      /* 토글 개선 */
      .ksc-setting-group .setting-item {
        border: none !important;
        padding: 16px 0 !important;
        border-bottom: 1px solid var(--background-modifier-border) !important;
      }

      .ksc-setting-group .setting-item:last-child {
        border-bottom: none !important;
      }

      /* 입력 필드 스타일 개선 */
      .ksc-setting-group input[type="text"],
      .ksc-setting-group input[type="number"],
      .ksc-setting-group select,
      .ksc-setting-group textarea {
        background: var(--background-modifier-form-field) !important;
        border: 1px solid var(--background-modifier-border) !important;
        border-radius: 6px !important;
        padding: 8px 12px !important;
        font-size: 13px !important;
        line-height: 1.4 !important;
        transition: border-color 0.2s ease !important;
      }

      /* 드롭다운 특별 처리 - 텍스트 잘림 방지 */
      .ksc-setting-group select {
        min-height: 36px !important;
        padding: 10px 12px !important;
        line-height: 1.2 !important;
      }

      .ksc-setting-group input[type="text"]:focus,
      .ksc-setting-group input[type="number"]:focus,
      .ksc-setting-group select:focus,
      .ksc-setting-group textarea:focus {
        border-color: var(--interactive-accent) !important;
        outline: none !important;
        box-shadow: 0 0 0 2px rgba(var(--interactive-accent-rgb), 0.2) !important;
      }

      /* 반응형 디자인 */
      @media (max-width: 768px) {
        .ksc-settings-wrapper {
          max-width: 100%;
          padding: 0 16px;
        }

        .ksc-tab-nav {
          flex-direction: column;
          gap: 4px;
        }

        .ksc-tab-button {
          flex-direction: row;
          justify-content: flex-start;
          padding: 12px 16px;
          min-height: auto;
        }

        .ksc-section {
          padding: 20px;
        }

        .ksc-button-group {
          flex-direction: column;
        }
      }

      /* 접근성 */
      .ksc-tab-button:focus {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 2px;
      }

      /* 새로운 검증 결과 스타일 - 더 깔끔하고 현대적 */
      .ksc-validation-result {
        border-radius: 8px;
        background: var(--background-secondary);
        overflow: hidden;
      }
      
      .ksc-status-card {
        padding: 16px 20px;
        background: var(--background-primary);
        border-bottom: 1px solid var(--background-modifier-border);
      }
      
      .ksc-status-line {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      
      .ksc-status-icon {
        font-size: 18px;
        flex-shrink: 0;
      }
      
      .ksc-status-text {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-normal);
      }
      
      .ksc-section-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-muted);
        margin-bottom: 12px;
        padding: 0 20px;
        padding-top: 16px;
      }
      
      .ksc-problems-section {
        border-top: 1px solid var(--background-modifier-border);
      }
      
      .ksc-problems-list {
        margin: 0;
        padding: 0 20px 16px 40px;
        list-style: none;
      }
      
      .ksc-problems-list li {
        color: var(--text-error);
        font-size: 13px;
        line-height: 1.4;
        margin-bottom: 6px;
        position: relative;
      }
      
      .ksc-problems-list li:before {
        content: "•";
        color: var(--text-error);
        position: absolute;
        left: -16px;
      }
      
      .ksc-warnings-section {
        border-top: 1px solid var(--background-modifier-border);
      }
      
      .ksc-warnings-list {
        margin: 0;
        padding: 0 20px 16px 40px;
        list-style: none;
      }
      
      .ksc-warnings-list li {
        color: var(--text-warning);
        font-size: 13px;
        line-height: 1.4;
        margin-bottom: 6px;
        position: relative;
      }
      
      .ksc-warnings-list li:before {
        content: "•";
        color: var(--text-warning);
        position: absolute;
        left: -16px;
      }
      
      .ksc-suggestions-section {
        border-top: 1px solid var(--background-modifier-border);
      }
      
      .ksc-suggestion-card {
        margin: 0 20px 12px 20px;
        padding: 12px;
        background: var(--background-modifier-form-field);
        border-radius: 6px;
        border-left: 3px solid var(--interactive-accent);
      }
      
      .ksc-suggestion-title {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-normal);
        margin-bottom: 4px;
      }
      
      .ksc-suggestion-desc {
        font-size: 12px;
        color: var(--text-muted);
        line-height: 1.3;
      }
      
      .ksc-summary-section {
        border-top: 1px solid var(--background-modifier-border);
        padding-bottom: 16px;
      }
      
      .ksc-summary-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
        padding: 0 20px;
      }
      
      .ksc-summary-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: var(--background-modifier-form-field);
        border-radius: 4px;
        font-size: 12px;
      }
      
      .ksc-summary-label {
        color: var(--text-muted);
        font-weight: 500;
      }
      
      .ksc-status-ok {
        color: var(--text-success);
        font-weight: 500;
      }
      
      .ksc-status-error {
        color: var(--text-error);
        font-weight: 500;
      }
      
      .ksc-status-warning {
        color: var(--text-warning);
        font-weight: 500;
      }
      
      .ksc-status-disabled {
        color: var(--text-faint);
        font-weight: 500;
      }

      /* 로그 뷰어 스타일 */
      .ksc-log-filter {
        margin-bottom: 12px;
        display: flex;
        gap: 8px;
        align-items: center;
      }
      
      .ksc-log-content {
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        padding: 12px;
        max-height: 400px;
        overflow-y: auto;
        font-family: var(--font-monospace);
        font-size: 12px;
        line-height: 1.4;
      }
      
      .ksc-log-empty {
        color: var(--text-muted);
        text-align: center;
        padding: 20px;
      }
      
      .ksc-log-line {
        margin-bottom: 4px;
        padding: 4px 8px;
        border-radius: 4px;
      }
      
      .ksc-log-error {
        background: rgba(255, 0, 0, 0.1);
      }
      
      .ksc-log-warn {
        background: rgba(255, 165, 0, 0.1);
      }
      
      .ksc-log-info {
        background: rgba(0, 123, 255, 0.05);
      }
      
      .ksc-log-debug {
        background: rgba(108, 117, 125, 0.05);
      }
      
      .ksc-log-timestamp {
        color: var(--text-faint);
      }
      
      .ksc-log-message {
        color: var(--text-normal);
      }
      
      .ksc-log-error .ksc-log-message {
        color: var(--text-error);
      }
      
      .ksc-log-warn .ksc-log-message {
        color: var(--text-warning);
      }
      
      .ksc-log-debug .ksc-log-message {
        color: var(--text-muted);
      }
      
      .ksc-log-data {
        color: var(--text-faint);
        font-size: 11px;
      }

      /* 애니메이션 */
      .ksc-content-container {
        animation: ksc-fadeIn 0.3s ease-out;
      }

      @keyframes ksc-fadeIn {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
  }

  /**
   * 현재 탭 콘텐츠 렌더링
   */
  private renderCurrentTab(): void {
    if (!this.contentContainer) return;

    this.contentContainer.empty();

    switch (this.currentTab) {
      case 'basic':
        this.createBasicSettingsTab(this.contentContainer);
        break;
      case 'ai':
        this.createAISettingsTab(this.contentContainer);
        break;
      case 'advanced':
        this.createAdvancedManagementTab(this.contentContainer);
        break;
      case 'performance':
        this.createMonitoringTab(this.contentContainer);
        break;
      case 'beta':
        this.createBetaFeaturesTab(this.contentContainer);
        break;
    }
  }

  /**
   * 헤더 섹션 생성
   */
  private createHeader(containerEl: HTMLElement): void {
    const header = containerEl.createEl('div', { cls: 'ksc-header' });

    const titleSetting = new Setting(header)
      .setName('📝 한국어 맞춤법 도우미')
      .setHeading();
    titleSetting.settingEl.addClasses(['ksc-header-title']);

    header.createEl('p', {
      text: '플러그인 동작을 커스터마이징하고 AI 기능을 설정하세요',
      cls: 'ksc-header-subtitle'
    });
  }

  /**
   * 탭 네비게이션 생성
   */
  private createTabNavigation(containerEl: HTMLElement): void {
    this.tabContainer = containerEl.createEl('div', { cls: 'ksc-tab-nav' });

    const tabs = [
      { id: 'basic', label: '기본 설정', icon: '⚙️', desc: 'API 키 및 기본 옵션' },
      { id: 'ai', label: 'AI 설정', icon: '🤖', desc: 'AI 자동 교정 기능' },
      { id: 'advanced', label: '고급 관리', icon: '🔧', desc: '백업, 복원, 검증' },
      { id: 'performance', label: '성능 모니터링', icon: '📊', desc: '통계 및 최적화' },
      { id: 'beta', label: '베타 기능', icon: '🧪', desc: '인라인 모드 등 실험적 기능' }
    ];

    tabs.forEach(tab => {
      const isActive = this.currentTab === tab.id;
      const tabButton = this.tabContainer!.createEl('button', {
        cls: `ksc-tab-button ${isActive ? 'active' : ''}`,
        attr: { 'data-tab': tab.id }
      });

      tabButton.createEl('span', {
        text: tab.icon,
        cls: 'ksc-tab-icon'
      });

      tabButton.createEl('span', {
        text: tab.label,
        cls: 'ksc-tab-label'
      });

      tabButton.addEventListener('click', () => {
        this.switchTab(tab.id as SettingsTab);
      });

      tabButton.title = tab.desc;
    });
  }

  /**
   * 탭 전환
   */
  private switchTab(tabId: SettingsTab): void {
    this.currentTab = tabId;
    
    // 탭 버튼 활성 상태 업데이트
    if (this.tabContainer) {
      this.tabContainer.querySelectorAll('.ksc-tab-button').forEach(button => {
        const isActive = button.getAttribute('data-tab') === tabId;
        if (isActive) {
          button.addClass('active');
        } else {
          button.removeClass('active');
        }
      });
    }

    // 콘텐츠 렌더링
    this.renderCurrentTab();
  }

  /**
   * 기본 설정 탭을 생성합니다
   */
  private createBasicSettingsTab(containerEl: HTMLElement): void {
    // 사용법 안내 섹션 (최상단)
    this.createUsageGuideSection(containerEl);

    // API 설정 섹션
    this.createAPISettingsSection(containerEl);

    // 필터링 옵션 섹션
    this.createFilteringOptionsSection(containerEl);

    // 예외 단어 관리 섹션
    this.createIgnoredWordsSection(containerEl);
  }

  /**
   * 사용법 안내 섹션을 생성합니다
   */
  private createUsageGuideSection(containerEl: HTMLElement): void {
    const section = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // 사용법 안내 헤딩
    new Setting(section)
      .setName('📖 사용법 안내')
      .setDesc('플러그인의 기본 사용 방법을 안내합니다.')
      .setHeading();

    const infoBox = section.createEl('div', { cls: 'ksc-info-box' });
    
    const steps = [
      '1️⃣ 텍스트를 선택하고 리본 아이콘을 클릭하거나 명령 팔레트에서 실행',
      '2️⃣ 팝업에서 빨간색으로 표시된 오류를 클릭하여 수정사항 확인',
      '3️⃣ AI 분석 버튼으로 자동 교정 제안 받기 (AI 기능 활성화 시)',
      '4️⃣ 적용 버튼으로 변경사항을 에디터에 반영'
    ];

    infoBox.createEl('strong', { text: '🚀 기본 사용법' });
    infoBox.createEl('br');
    infoBox.createEl('br');
    
    steps.forEach(step => {
      infoBox.createEl('div', { 
        text: step,
        attr: { style: 'margin-bottom: 4px;' }
      });
    });
  }

  /**
   * API 설정 섹션을 생성합니다
   */
  private createAPISettingsSection(containerEl: HTMLElement): void {
    const section = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // API 설정 헤딩
    new Setting(section)
      .setName('🌐 API 연결')
      .setDesc('Bareun.ai 맞춤법 검사 서비스 연결을 위한 설정입니다.')
      .setHeading();

    const settingsGroup = section.createEl('div', { cls: 'ksc-setting-group' });

    // API 키 설정
    new Setting(settingsGroup)
      .setName("Bareun.ai API 키")
      .setDesc("맞춤법 검사를 위한 Bareun.ai API 키를 입력하세요.")
      .addText((text) => {
        text
          .setPlaceholder("API 키를 입력하세요")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          });
      });

    // API 호스트 설정
    new Setting(settingsGroup)
      .setName("API 호스트")
      .setDesc("Bareun.ai API 서버 호스트 주소입니다.")
      .addText((text) => {
        text
          .setPlaceholder("bareun-api.junlim.org")
          .setValue(this.plugin.settings.apiHost)
          .onChange(async (value) => {
            this.plugin.settings.apiHost = value;
            await this.plugin.saveSettings();
          });
      });

    // API 포트 설정
    new Setting(settingsGroup)
      .setName("API 포트")
      .setDesc("Bareun.ai API 서버 포트 번호입니다.")
      .addText((text) => {
        text
          .setPlaceholder("443")
          .setValue(this.plugin.settings.apiPort.toString())
          .onChange(async (value) => {
            const port = parseInt(value);
            if (!isNaN(port) && port > 0 && port <= 65535) {
              this.plugin.settings.apiPort = port;
              await this.plugin.saveSettings();
            }
          });
      });

    // API 정보 박스
    const apiInfoBox = section.createEl('div', { cls: 'ksc-info-box' });
    apiInfoBox.createEl('strong', { text: '💡 API 키 발급 안내' });
    apiInfoBox.createEl('br');
    apiInfoBox.createEl('span', { text: 'API 키는 ' });
    const bareunLink = apiInfoBox.createEl('a', { 
      text: 'Bareun.ai 웹사이트',
      href: 'https://bareun.ai',
      attr: { target: '_blank' }
    });
    apiInfoBox.createEl('span', { text: '에서 발급받을 수 있습니다.' });
  }

  /**
   * AI 설정 탭을 생성합니다
   */
  private createAISettingsTab(containerEl: HTMLElement): void {
    // AI 기능 토글 섹션
    const aiToggleSection = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // AI 자동 교정 헤딩
    new Setting(aiToggleSection)
      .setName('🤖 AI 자동 교정')
      .setDesc('AI가 문맥을 분석하여 최적의 수정사항을 자동으로 선택합니다.')
      .setHeading();

    const settingsGroup = aiToggleSection.createEl('div', { cls: 'ksc-setting-group' });

    new Setting(settingsGroup)
      .setName("AI 기능 활성화")
      .setDesc("AI 자동 교정 기능을 사용합니다.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.ai.enabled)
        .onChange(async (value) => {
          this.plugin.settings.ai.enabled = value;
          await this.plugin.saveSettings();
          this.display(); // AI 설정이 변경되면 UI 새로고침
        }));

    if (this.plugin.settings.ai.enabled) {
      // AI 제공자 선택 섹션
      this.createAIProviderSection(containerEl);
      
      // AI 모델 설정 섹션
      this.createAIModelSection(containerEl);
      
      // AI 고급 설정 섹션
      this.createAIAdvancedSection(containerEl);
    } else {
      // AI 비활성화 안내
      const disabledInfo = containerEl.createEl('div', { cls: 'ksc-info-box' });
      disabledInfo.createEl('strong', { text: '💡 AI 기능을 활성화하면 다음과 같은 기능을 사용할 수 있습니다:' });
      disabledInfo.createEl('br');
      disabledInfo.createEl('br');
      
      const features = [
        '• 문맥을 고려한 지능형 수정 제안',
        '• 고유명사 및 전문용어 자동 인식',
        '• 신뢰도 점수와 상세한 추천 이유',
        '• 원클릭 자동 교정 적용'
      ];
      
      features.forEach(feature => {
        disabledInfo.createEl('div', { text: feature });
      });
    }
  }

  /**
   * AI 제공자 선택 섹션을 생성합니다
   */
  private createAIProviderSection(containerEl: HTMLElement): void {
    const providerSection = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // AI 제공자 헤딩
    new Setting(providerSection)
      .setName('🏢 AI 제공자')
      .setDesc('사용할 AI 서비스를 선택하고 API 키를 설정하세요.')
      .setHeading();

    const settingsGroup = providerSection.createEl('div', { cls: 'ksc-setting-group' });

    // 제공자 선택
    new Setting(settingsGroup)
      .setName("AI 제공자")
      .setDesc("사용할 AI 서비스를 선택하세요.")
      .addDropdown(dropdown => {
        dropdown
          .addOption('openai', '🔵 OpenAI (GPT)')
          .addOption('anthropic', '🟠 Anthropic (Claude)')
          .addOption('google', '🔴 Google (Gemini)')
          .addOption('ollama', '🟡 Ollama (로컬)')
          .setValue(this.plugin.settings.ai.provider)
          .onChange(async (value) => {
            this.plugin.settings.ai.provider = value as any;
            await this.plugin.saveSettings();
            this.display(); // 제공자 변경 시 UI 새로고침
          });
      });

    // 선택된 제공자에 따른 API 키 설정
    this.createProviderAPIKeySettings(settingsGroup);
  }

  /**
   * 제공자별 API 키 설정을 생성합니다
   */
  private createProviderAPIKeySettings(containerEl: HTMLElement): void {
    const provider = this.plugin.settings.ai.provider;

    if (provider === 'openai') {
      new Setting(containerEl)
        .setName("OpenAI API 키")
        .setDesc("OpenAI 서비스 사용을 위한 API 키입니다.")
        .addText(text => text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.ai.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.ai.openaiApiKey = value;
            await this.plugin.saveSettings();
          }));
    } else if (provider === 'anthropic') {
      new Setting(containerEl)
        .setName("Anthropic API 키")
        .setDesc("Anthropic (Claude) 서비스 사용을 위한 API 키입니다.")
        .addText(text => text
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.ai.anthropicApiKey)
          .onChange(async (value) => {
            this.plugin.settings.ai.anthropicApiKey = value;
            await this.plugin.saveSettings();
          }));
    } else if (provider === 'google') {
      new Setting(containerEl)
        .setName("Google AI API 키")
        .setDesc("Google Gemini 서비스 사용을 위한 API 키입니다.")
        .addText(text => text
          .setPlaceholder("AIza...")
          .setValue(this.plugin.settings.ai.googleApiKey)
          .onChange(async (value) => {
            this.plugin.settings.ai.googleApiKey = value;
            await this.plugin.saveSettings();
          }));
    } else if (provider === 'ollama') {
      new Setting(containerEl)
        .setName("Ollama 엔드포인트")
        .setDesc("로컬 Ollama 서버의 엔드포인트 주소입니다.")
        .addText(text => text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.ai.ollamaEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.ai.ollamaEndpoint = value;
            await this.plugin.saveSettings();
          }));
    }
  }

  /**
   * AI 모델 설정 섹션을 생성합니다
   */
  private createAIModelSection(containerEl: HTMLElement): void {
    const modelSection = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // 모델 설정 헤딩
    new Setting(modelSection)
      .setName('🎯 모델 선택')
      .setDesc('사용할 AI 모델과 세부 설정을 구성하세요.')
      .setHeading();

    const settingsGroup = modelSection.createEl('div', { cls: 'ksc-setting-group' });

    const provider = this.plugin.settings.ai.provider;
    const modelOptions = this.getModelOptions(provider);

    new Setting(settingsGroup)
      .setName("AI 모델")
      .setDesc(`${provider.toUpperCase()} 제공자의 사용 가능한 모델입니다.`)
      .addDropdown(dropdown => {
        modelOptions.forEach(model => {
          dropdown.addOption(model.id, model.name);
        });
        dropdown
          .setValue(this.plugin.settings.ai.model)
          .onChange(async (value) => {
            this.plugin.settings.ai.model = value;
            await this.plugin.saveSettings();
          });
      });
  }

  /**
   * 제공자별 모델 옵션을 반환합니다
   */
  private getModelOptions(provider: string): Array<{id: string, name: string}> {
    switch (provider) {
      case 'openai':
        return [
          { id: 'gpt-4o', name: 'GPT-4 Omni' },
          { id: 'gpt-4o-mini', name: 'GPT-4 Omni Mini' },
          { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' }
        ];
      case 'anthropic':
        return [
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' }
        ];
      case 'google':
        return [
          { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
          { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
        ];
      case 'ollama':
        return [
          { id: 'llama3.2:3b', name: 'Llama 3.2 3B' },
          { id: 'mistral:7b', name: 'Mistral 7B' },
          { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B' }
        ];
      default:
        return [];
    }
  }

  /**
   * AI 고급 설정 섹션을 생성합니다
   */
  private createAIAdvancedSection(containerEl: HTMLElement): void {
    const advancedSection = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // 고급 설정 헤딩
    new Setting(advancedSection)
      .setName('⚙️ 고급 옵션')
      .setDesc('AI 모델의 상세한 동작을 조정할 수 있습니다.')
      .setHeading();

    const settingsGroup = advancedSection.createEl('div', { cls: 'ksc-setting-group' });

    // 최대 토큰 수 설정
    new Setting(settingsGroup)
      .setName("최대 토큰 수")
      .setDesc("AI 요청 시 사용할 최대 토큰 수입니다. (권장: 1000-4000, 높을수록 더 상세한 분석)")
      .addText(text => text
        .setPlaceholder("예: 2000")
        .setValue(this.plugin.settings.ai.maxTokens.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.ai.maxTokens = numValue;
            await this.plugin.saveSettings();
          }
        })
      )
      .then(setting => {
        // 입력 필드를 숫자 타입으로 설정
        setting.controlEl.querySelector('input')!.type = 'number';
        setting.controlEl.querySelector('input')!.min = '100';
        setting.controlEl.querySelector('input')!.step = '100';
      });

    // 온도 설정
    new Setting(settingsGroup)
      .setName("창의성 (Temperature)")
      .setDesc("AI의 창의성 수준입니다. 낮을수록 일관된 결과, 높을수록 다양한 결과")
      .addSlider(slider => slider
        .setLimits(0, 1, 0.1)
        .setValue(this.plugin.settings.ai.temperature)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.ai.temperature = value;
          await this.plugin.saveSettings();
        }));

    // 토큰 경고 설정
    new Setting(settingsGroup)
      .setName("토큰 사용량 경고")
      .setDesc("토큰 사용량이 임계값을 초과할 때 경고를 표시합니다.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.ai.showTokenWarning)
        .onChange(async (value) => {
          this.plugin.settings.ai.showTokenWarning = value;
          await this.plugin.saveSettings();
        }));

    if (this.plugin.settings.ai.showTokenWarning) {
      new Setting(settingsGroup)
        .setName("경고 임계값")
        .setDesc("이 토큰 수를 초과하면 경고를 표시합니다.")
        .addSlider(slider => slider
          .setLimits(500, 5000, 100)
          .setValue(this.plugin.settings.ai.tokenWarningThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.ai.tokenWarningThreshold = value;
            await this.plugin.saveSettings();
          }));
    }
  }

  /**
   * 예외 단어 관리 섹션을 생성합니다
   */
  private createIgnoredWordsSection(containerEl: HTMLElement): void {
    const section = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // 예외 단어 관리 헤딩
    new Setting(section)
      .setName('📝 예외 단어 관리')
      .setDesc('맞춤법 검사에서 제외할 단어들을 관리합니다.')
      .setHeading();

    const countInfo = section.createEl('div', {
      cls: 'ksc-info-box',
      text: `현재 ${IgnoredWordsService.getIgnoredWordsCount(this.plugin.settings)}개의 단어가 예외 처리되어 있습니다.`
    });

    // 태그 클라우드 컨테이너
    const tagCloudContainer = section.createEl('div', { cls: 'ksc-tag-cloud' });

    // 입력 영역
    const inputContainer = section.createEl('div', { cls: 'ksc-setting-group' });

    new Setting(inputContainer)
      .setName("예외 단어 추가")
      .setDesc("쉼표로 구분하여 여러 단어를 한 번에 추가할 수 있습니다.")
      .addText(text => {
        text
          .setPlaceholder("예: 카카오톡, 네이버, 고유명사")
          .onChange(async (value) => {
            if (value.includes(',')) {
              // 쉼표가 포함되면 자동으로 단어들을 추가
              const words = value.split(',').map(w => w.trim()).filter(w => w.length > 0);
              if (words.length > 0) {
                const updatedSettings = IgnoredWordsService.addMultipleIgnoredWords(words, this.plugin.settings);
                this.plugin.settings = updatedSettings;
                await this.plugin.saveSettings();
                text.setValue(''); // 입력 필드 초기화
                this.renderIgnoredWordsCloud(tagCloudContainer);
                countInfo.textContent = `현재 ${IgnoredWordsService.getIgnoredWordsCount(this.plugin.settings)}개의 단어가 예외 처리되어 있습니다.`;
              }
            }
          });

        text.inputEl.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const value = text.getValue().trim();
            if (value) {
              const words = value.split(',').map(w => w.trim()).filter(w => w.length > 0);
              if (words.length > 0) {
                const updatedSettings = IgnoredWordsService.addMultipleIgnoredWords(words, this.plugin.settings);
                this.plugin.settings = updatedSettings;
                await this.plugin.saveSettings();
                text.setValue('');
                this.renderIgnoredWordsCloud(tagCloudContainer);
                countInfo.textContent = `현재 ${IgnoredWordsService.getIgnoredWordsCount(this.plugin.settings)}개의 단어가 예외 처리되어 있습니다.`;
              }
            }
          }
        });
      });

    const buttonContainer = section.createEl('div', { cls: 'ksc-button-group' });
    
    const clearAllButton = buttonContainer.createEl('button', { 
      text: '🗑️ 전체 삭제',
      cls: 'mod-warning'
    });

    clearAllButton.onclick = async () => {
      if (confirm('모든 예외 단어를 삭제하시겠습니까?')) {
        this.plugin.settings.ignoredWords = [];
        await this.plugin.saveSettings();
        this.renderIgnoredWordsCloud(tagCloudContainer);
        countInfo.textContent = `현재 ${IgnoredWordsService.getIgnoredWordsCount(this.plugin.settings)}개의 단어가 예외 처리되어 있습니다.`;
      }
    };

    // 초기 태그 클라우드 렌더링
    this.renderIgnoredWordsCloud(tagCloudContainer);
  }

  /**
   * 예외 단어 클라우드를 렌더링합니다
   */
  private renderIgnoredWordsCloud(container: HTMLElement): void {
    clearElement(container);

    if (this.plugin.settings.ignoredWords.length === 0) {
      container.createEl('div', {
        text: '예외 처리된 단어가 없습니다.',
        attr: { style: 'color: var(--text-muted); text-align: center; padding: 20px;' }
      });
      return;
    }

    this.plugin.settings.ignoredWords.forEach(word => {
      const tag = container.createEl('span', {
        text: word,
        attr: { 
          style: `
            display: inline-block;
            background: var(--interactive-accent);
            color: var(--text-on-accent);
            padding: 4px 8px;
            margin: 2px;
            border-radius: 12px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
          `
        }
      });

      tag.addEventListener('mouseenter', () => {
        tag.style.background = 'var(--interactive-accent-hover)';
      });

      tag.addEventListener('mouseleave', () => {
        tag.style.background = 'var(--interactive-accent)';
      });

      tag.onclick = async () => {
        if (confirm(`"${word}"를 예외 목록에서 제거하시겠습니까?`)) {
          const updatedSettings = IgnoredWordsService.removeIgnoredWord(word, this.plugin.settings);
          this.plugin.settings = updatedSettings;
          await this.plugin.saveSettings();
          this.renderIgnoredWordsCloud(container);
        }
      };
    });
  }


  /**
   * 고급 관리 탭을 생성합니다
   */
  private createAdvancedManagementTab(containerEl: HTMLElement): void {
    // 설정 검증 섹션
    this.createValidationSection(containerEl);
    
    // 백업 관리 섹션
    this.createBackupSection(containerEl);
    
    // 내보내기/가져오기 섹션
    this.createImportExportSection(containerEl);
  }

  /**
   * 설정 검증 섹션을 생성합니다
   */
  private createValidationSection(containerEl: HTMLElement): void {
    const { AdvancedSettingsService } = require('../services/advancedSettingsService');

    const validationSection = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // 설정 검증 헤딩
    new Setting(validationSection)
      .setName('✅ 구성 검증')
      .setDesc('현재 설정의 유효성을 검사하고 최적화 제안을 받습니다.')
      .setHeading();

    const buttonGroup = validationSection.createEl('div', { cls: 'ksc-button-group' });
    const validateButton = buttonGroup.createEl('button', { text: '설정 검증', cls: 'mod-cta' });

    // 결과 표시 영역 - ID를 부여하여 중복 방지
    const validationResult = validationSection.createEl('div', {
      attr: { 
        style: 'display: none; margin-top: 16px;',
        id: 'validation-result-container'
      }
    });

    validateButton.onclick = () => {
      try {
        const validation = AdvancedSettingsService.validateSettings(this.plugin.settings);
        const suggestions = AdvancedSettingsService.getOptimizationSuggestions(this.plugin.settings);
        
        this.createImprovedValidationDisplay(validationResult, validation, suggestions);
        
        validationResult.style.display = 'block';
        validationResult.className = ''; // 새로운 스타일에서는 클래스 제거
      } catch (error) {
        Logger.error('설정 검증 오류:', error);
        validationResult.style.display = 'block';
        validationResult.className = 'ksc-warning-box';
        validationResult.textContent = '설정 검증 중 오류가 발생했습니다.';
      }
    };
  }

  /**
   * 백업 관리 섹션을 생성합니다
   */
  private createBackupSection(containerEl: HTMLElement): void {
    const { AdvancedSettingsService } = require('../services/advancedSettingsService');

    const backupSection = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // 백업 관리 헤딩
    new Setting(backupSection)
      .setName('💾 백업 관리')
      .setDesc('설정을 백업하고 필요시 이전 상태로 복원할 수 있습니다.')
      .setHeading();

    const buttonGroup = backupSection.createEl('div', { cls: 'ksc-button-group' });
    const createBackupBtn = buttonGroup.createEl('button', { text: '백업 생성' });
    const showBackupsBtn = buttonGroup.createEl('button', { text: '백업 목록' });

    const backupListContainer = backupSection.createEl('div', {
      attr: { style: 'display: none; margin-top: 16px;' }
    });

    createBackupBtn.onclick = () => {
      AdvancedSettingsService.backupSettings(this.plugin.settings, '수동 백업');
      new Notice("설정이 백업되었습니다.");
      if (backupListContainer.style.display !== 'none') {
        updateBackupList();
      }
    };

    const updateBackupList = () => {
      const backups = AdvancedSettingsService.getBackups();
      clearElement(backupListContainer);
      
      if (backups.length === 0) {
        backupListContainer.createEl('div', { 
          text: '백업이 없습니다.',
          cls: 'ksc-info-box'
        });
      } else {
        backups.forEach((backup: any) => {
          const backupItem = backupListContainer.createEl('div', {
            cls: 'ksc-info-box',
            attr: { style: 'margin-bottom: 8px;' }
          });
          
          backupItem.createEl('strong', { text: backup.reason });
          backupItem.createEl('span', { text: ` (${backup.age})` });
          backupItem.createEl('br');
          backupItem.createEl('small', { text: `${backup.timestamp} - 버전 ${backup.version}` });
          backupItem.createEl('br');
          
          const restoreBtn = backupItem.createEl('button', { 
            text: '복원',
            attr: { style: 'margin-top: 8px; font-size: 12px;' }
          });
          
          restoreBtn.onclick = async () => {
            const restored = AdvancedSettingsService.restoreSettings(backup.index);
            if (restored) {
              this.plugin.settings = restored;
              await this.plugin.saveSettings();
              this.display();
              new Notice("설정이 복원되었습니다.");
            }
          };
        });
      }
    };

    showBackupsBtn.onclick = () => {
      const isVisible = backupListContainer.style.display !== 'none';
      backupListContainer.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        updateBackupList();
      }
    };
  }

  /**
   * 내보내기/가져오기 섹션을 생성합니다
   */
  private createImportExportSection(containerEl: HTMLElement): void {
    const { AdvancedSettingsService } = require('../services/advancedSettingsService');

    const importExportSection = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // 내보내기/가져오기 헤딩
    new Setting(importExportSection)
      .setName('📤 내보내기/가져오기')
      .setDesc('설정을 JSON 파일로 내보내거나 다른 기기에서 가져올 수 있습니다.')
      .setHeading();

    const buttonGroup = importExportSection.createEl('div', { cls: 'ksc-button-group' });
    const exportBtn = buttonGroup.createEl('button', { text: '설정 내보내기' });
    const importBtn = buttonGroup.createEl('button', { text: '설정 가져오기' });
    const resetBtn = buttonGroup.createEl('button', { 
      text: '기본값으로 재설정',
      cls: 'mod-warning'
    });

    exportBtn.onclick = () => {
      const jsonData = AdvancedSettingsService.exportSettings(this.plugin.settings);
      
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `korean-grammar-settings-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      new Notice("설정이 내보내기되었습니다.");
    };

    importBtn.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
          const content = e.target?.result as string;
          const result = AdvancedSettingsService.importSettings(content);
          
          if (result.success && result.settings) {
            AdvancedSettingsService.backupSettings(this.plugin.settings, '가져오기 전 백업');
            
            this.plugin.settings = result.settings;
            await this.plugin.saveSettings();
            this.display();
            new Notice("설정이 가져오기되었습니다.");
          } else {
            new Notice(`설정 가져오기 실패: ${result.error}`);
          }
        };
        
        reader.readAsText(file);
      };
      
      input.click();
    };

    resetBtn.onclick = async () => {
      const confirmed = confirm('모든 설정을 기본값으로 재설정하시겠습니까? 현재 설정은 백업됩니다.');
      if (confirmed) {
        const defaultSettings = AdvancedSettingsService.resetToDefaults(this.plugin.settings);
        this.plugin.settings = defaultSettings;
        await this.plugin.saveSettings();
        this.display();
        new Notice("설정이 기본값으로 재설정되었습니다.");
      }
    };
  }

  /**
   * 성능 모니터링 탭을 생성합니다
   */
  private createMonitoringTab(containerEl: HTMLElement): void {
    // 실시간 메트릭 섹션
    this.createMetricsSection(containerEl);
    
    // 로그 관리 섹션
    this.createLogManagementSection(containerEl);
    
    // 성능 제어 섹션
    this.createPerformanceControlSection(containerEl);
  }

  /**
   * 실시간 메트릭 섹션을 생성합니다
   */
  private createMetricsSection(containerEl: HTMLElement): void {
    const metricsSection = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // 실시간 성능 메트릭 헤딩
    new Setting(metricsSection)
      .setName('📊 실시간 성능 메트릭')
      .setDesc('API 호출 성능과 캐시 효율성을 실시간으로 모니터링합니다.')
      .setHeading();

    const metricsDisplay = metricsSection.createEl('div', {
      cls: 'ksc-metrics',
      attr: { id: 'metrics-display-container' }
    });

    // 추가 통계 컶테이너 - ID로 중복 방지
    const additionalStatsContainer = metricsSection.createEl('div', {
      attr: { id: 'additional-stats-container' }
    });

    const buttonGroup = metricsSection.createEl('div', { cls: 'ksc-button-group' });
    const refreshBtn = buttonGroup.createEl('button', { text: '새로고침', cls: 'mod-cta' });

    const updateMetrics = () => {
      try {
        const metrics = this.plugin.orchestrator.getPerformanceMetrics();
        
        const { Logger } = require('../utils/logger');
        const { ErrorHandlerService } = require('../services/errorHandler');
        const logStats = Logger.getStats();
        const errorStats = ErrorHandlerService.getErrorStats();
        
        const extendedMetrics = { ...metrics, logStats, errorStats };
        createMetricsDisplay(metricsDisplay, extendedMetrics);
        
        // 추가 통계 섹션 - 기존 컴테이너 재사용
        clearElement(additionalStatsContainer);
        const additionalStats = additionalStatsContainer.createEl('div', { cls: 'ksc-info-box' });
        
        additionalStats.createEl('strong', { text: '로그 통계:' });
        additionalStats.createEl('br');
        const logMetrics = [
          `총 로그: ${logStats.total}`,
          `에러: ${logStats.ERROR}`,
          `경고: ${logStats.WARN}`,
          `정보: ${logStats.INFO}`
        ];
        logMetrics.forEach(metric => {
          additionalStats.createEl('div', { text: `• ${metric}` });
        });
        
        additionalStats.createEl('br');
        additionalStats.createEl('strong', { text: '에러 분류:' });
        additionalStats.createEl('br');
        const errorMetrics = [
          `네트워크: ${errorStats.NETWORK_ERROR}`,
          `API 키: ${errorStats.API_KEY_ERROR}`,
          `요청 제한: ${errorStats.API_RATE_LIMIT}`,
          `서버: ${errorStats.API_SERVER_ERROR}`,
          `타임아웃: ${errorStats.TIMEOUT_ERROR}`
        ];
        errorMetrics.forEach(metric => {
          additionalStats.createEl('div', { text: `• ${metric}` });
        });
        
      } catch (error) {
        clearElement(metricsDisplay);
        metricsDisplay.createEl('div', { text: '메트릭을 가져올 수 없습니다.' });
      }
    };

    refreshBtn.onclick = updateMetrics;
    updateMetrics(); // 초기 표시

    // 자동 업데이트 (15초마다)
    const metricsInterval = setInterval(updateMetrics, 15000);
    
    // 정리 함수 등록
    const originalHide = this.hide.bind(this);
    this.hide = () => {
      clearInterval(metricsInterval);
      originalHide();
    };
  }

  /**
   * 로그 관리 섹션을 생성합니다
   */
  private createLogManagementSection(containerEl: HTMLElement): void {
    const { Logger } = require('../utils/logger');
    
    const logSection = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // 로그 관리 헤딩
    new Setting(logSection)
      .setName('📋 로그 관리')
      .setDesc('플러그인 실행 로그를 확인하고 다운로드할 수 있습니다.')
      .setHeading();

    // 로그 통계 표시
    const updateLogStats = () => {
      const stats = Logger.getStats();
      const memUsage = Logger.getMemoryUsage();
      
      const statsContainer = logSection.querySelector('#log-stats-container') as HTMLElement;
      if (statsContainer) {
        clearElement(statsContainer);
        
        const statsBox = statsContainer.createEl('div', { cls: 'ksc-info-box' });
        statsBox.createEl('strong', { text: '📊 로그 통계' });
        statsBox.createEl('br');
        statsBox.createEl('div', { text: `• 총 로그: ${stats.total}개` });
        statsBox.createEl('div', { text: `• 정보: ${stats.INFO}개` });
        statsBox.createEl('div', { text: `• 경고: ${stats.WARN}개` });
        statsBox.createEl('div', { text: `• 오류: ${stats.ERROR}개` });
        statsBox.createEl('div', { text: `• 디버그: ${stats.DEBUG}개` });
        statsBox.createEl('br');
        statsBox.createEl('div', { text: `• 메모리 사용량: ${Math.round(memUsage.estimatedBytes / 1024)}KB` });
        statsBox.createEl('div', { text: `• 최대 보관: 1000개` });
      }
    };

    // 통계 컨테이너
    const statsContainer = logSection.createEl('div', { 
      attr: { id: 'log-stats-container' }
    });
    
    // 로그 뷰어 컨테이너
    const logViewerContainer = logSection.createEl('div', {
      attr: { 
        id: 'log-viewer-container',
        style: 'display: none; margin-top: 16px;'
      }
    });

    // 버튼 그룹
    const buttonGroup = logSection.createEl('div', { cls: 'ksc-button-group' });
    const refreshStatsBtn = buttonGroup.createEl('button', { text: '통계 새로고침', cls: 'mod-cta' });
    const viewLogsBtn = buttonGroup.createEl('button', { text: '로그 보기' });
    const downloadLogsBtn = buttonGroup.createEl('button', { text: '로그 다운로드' });
    const clearLogsBtn = buttonGroup.createEl('button', { text: '로그 지우기', cls: 'mod-warning' });

    // 초기 통계 표시
    updateLogStats();

    // 버튼 이벤트 핸들러
    refreshStatsBtn.onclick = updateLogStats;

    viewLogsBtn.onclick = () => {
      const isVisible = logViewerContainer.style.display !== 'none';
      
      if (isVisible) {
        logViewerContainer.style.display = 'none';
        viewLogsBtn.textContent = '로그 보기';
      } else {
        this.displayLogViewer(logViewerContainer);
        logViewerContainer.style.display = 'block';
        viewLogsBtn.textContent = '로그 숨기기';
      }
    };

    downloadLogsBtn.onclick = () => {
      this.downloadLogs();
    };

    clearLogsBtn.onclick = () => {
      if (confirm('모든 로그를 삭제하시겠습니까?')) {
        Logger.clearHistory();
        updateLogStats();
        if (logViewerContainer.style.display !== 'none') {
          this.displayLogViewer(logViewerContainer);
        }
      }
    };
  }

  /**
   * 로그 뷰어를 표시합니다
   */
  private displayLogViewer(container: HTMLElement): void {
    const { Logger } = require('../utils/logger');
    clearElement(container);
    
    const logs = Logger.getHistory();
    
    // 로그 필터 컨트롤
    const filterContainer = container.createEl('div', { cls: 'ksc-log-filter' });
    
    filterContainer.createEl('label', { text: '레벨 필터:' });
    const levelSelect = filterContainer.createEl('select');
    levelSelect.createEl('option', { text: '전체', value: '' });
    levelSelect.createEl('option', { text: '오류', value: 'ERROR' });
    levelSelect.createEl('option', { text: '경고', value: 'WARN' });
    levelSelect.createEl('option', { text: '정보', value: 'INFO' });
    levelSelect.createEl('option', { text: '디버그', value: 'DEBUG' });

    // 로그 내용 컨테이너
    const logContent = container.createEl('div', { cls: 'ksc-log-content' });

    const displayLogs = (filteredLogs: any[]) => {
      clearElement(logContent);
      
      if (filteredLogs.length === 0) {
        logContent.createEl('div', { 
          text: '표시할 로그가 없습니다.',
          cls: 'ksc-log-empty'
        });
        return;
      }

      // 최신 로그부터 표시 (역순)
      const sortedLogs = [...filteredLogs].reverse();
      
      sortedLogs.forEach(log => {
        const logLine = logContent.createEl('div', {
          cls: `ksc-log-line ksc-log-${log.level.toLowerCase()}`
        });
        
        const timestamp = log.timestamp.toLocaleString('ko-KR');
        const levelIcon = this.getLogLevelIcon(log.level);
        
        logLine.createEl('span', {
          text: `[${timestamp}] ${levelIcon} `,
          cls: 'ksc-log-timestamp'
        });
        
        logLine.createEl('span', {
          text: log.message,
          cls: 'ksc-log-message'
        });
        
        if (log.data) {
          logLine.createEl('br');
          logLine.createEl('span', {
            text: `  데이터: ${JSON.stringify(log.data, null, 2)}`,
            cls: 'ksc-log-data'
          });
        }
      });
    };

    // 초기 로그 표시
    displayLogs(logs);

    // 필터 이벤트
    levelSelect.onchange = () => {
      const selectedLevel = levelSelect.value;
      const filteredLogs = selectedLevel ? 
        logs.filter((log: any) => log.level === selectedLevel) : 
        logs;
      displayLogs(filteredLogs);
    };
  }


  /**
   * 로그 레벨별 아이콘을 반환합니다
   */
  private getLogLevelIcon(level: string): string {
    switch (level) {
      case 'ERROR': return '❌';
      case 'WARN': return '⚠️';
      case 'INFO': return 'ℹ️';
      case 'DEBUG': return '🐛';
      default: return '📝';
    }
  }

  /**
   * 로그를 다운로드합니다
   */
  private downloadLogs(): void {
    const { Logger } = require('../utils/logger');
    
    try {
      const logs = Logger.getHistory();
      const stats = Logger.getStats();
      const memUsage = Logger.getMemoryUsage();
      
      // 로그 데이터 구성
      const logData = {
        meta: {
          exportDate: new Date().toISOString(),
          pluginVersion: '0.2.0',
          totalLogs: stats.total,
          statistics: stats,
          memoryUsage: memUsage
        },
        logs: logs.map((log: any) => ({
          timestamp: log.timestamp.toISOString(),
          level: log.level,
          message: log.message,
          data: log.data
        }))
      };
      
      // JSON 파일로 다운로드
      const jsonString = JSON.stringify(logData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      // 현재 시간으로 파일명 생성 (YYYY-MM-DD_HH-MM-SS 형식)
      const now = new Date();
      const timestamp = now.toISOString()
        .replace(/T/, '_')           // T를 _로 변경
        .replace(/:/g, '-')          // :를 -로 변경 (파일명에서 :는 사용 불가)
        .replace(/\.\d{3}Z$/, '');   // 밀리초와 Z 제거
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `korean-grammar-logs-${timestamp}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      
      // 성공 메시지
      new Notice('로그가 다운로드되었습니다.');
      
    } catch (error) {
      Logger.error('로그 다운로드 오류:', error);
      new Notice('로그 다운로드 중 오류가 발생했습니다.');
    }
  }

  /**
   * 성능 제어 섹션을 생성합니다
   */
  private createPerformanceControlSection(containerEl: HTMLElement): void {
    const controlSection = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // 성능 제어 헤딩
    new Setting(controlSection)
      .setName('🔧 성능 제어')
      .setDesc('캐시 및 대기 중인 요청을 관리하여 성능을 최적화합니다.')
      .setHeading();

    const buttonGroup = controlSection.createEl('div', { cls: 'ksc-button-group' });
    const clearCacheBtn = buttonGroup.createEl('button', { text: '캐시 정리' });
    const cancelRequestsBtn = buttonGroup.createEl('button', { text: '대기 요청 취소' });

    clearCacheBtn.onclick = () => {
      this.plugin.orchestrator.clearCache();
      // 캐시 정리 후 메트릭 업데이트
      const metricsDisplay = document.getElementById('metrics-display-container');
      const additionalStats = document.getElementById('additional-stats-container');
      if (metricsDisplay && additionalStats) {
        // 기존 updateMetrics 함수 호출
        try {
          const metrics = this.plugin.orchestrator.getPerformanceMetrics();
          const { Logger } = require('../utils/logger');
          const { ErrorHandlerService } = require('../services/errorHandler');
          const logStats = Logger.getStats();
          const errorStats = ErrorHandlerService.getErrorStats();
          const extendedMetrics = { ...metrics, logStats, errorStats };
          createMetricsDisplay(metricsDisplay, extendedMetrics);
          
          clearElement(additionalStats);
          const additionalStatsBox = additionalStats.createEl('div', { cls: 'ksc-info-box' });
          additionalStatsBox.createEl('strong', { text: '로그 통계:' });
          additionalStatsBox.createEl('br');
          const logMetrics = [
            `총 로그: ${logStats.total}`,
            `에러: ${logStats.ERROR}`,
            `경고: ${logStats.WARN}`,
            `정보: ${logStats.INFO}`
          ];
          logMetrics.forEach(metric => {
            additionalStatsBox.createEl('div', { text: `• ${metric}` });
          });
          additionalStatsBox.createEl('br');
          additionalStatsBox.createEl('strong', { text: '에러 분류:' });
          additionalStatsBox.createEl('br');
          const errorMetrics = [
            `네트워크: ${errorStats.NETWORK_ERROR}`,
            `API 키: ${errorStats.API_KEY_ERROR}`,
            `요청 제한: ${errorStats.API_RATE_LIMIT}`,
            `서버: ${errorStats.API_SERVER_ERROR}`,
            `타임아웃: ${errorStats.TIMEOUT_ERROR}`
          ];
          errorMetrics.forEach(metric => {
            additionalStatsBox.createEl('div', { text: `• ${metric}` });
          });
        } catch (error) {
          Logger.error('메트릭 업데이트 오류:', error);
        }
      }
    };

    cancelRequestsBtn.onclick = () => {
      this.plugin.orchestrator.cancelPendingRequests();
    };

    // 성능 팁 박스
    const tipsBox = controlSection.createEl('div', { cls: 'ksc-info-box' });
    tipsBox.createEl('strong', { text: '💡 성능 최적화 팁:' });
    tipsBox.createEl('br');
    tipsBox.createEl('br');
    
    const tips = [
      '• 캐시 정리: 메모리 사용량이 높을 때 실행하세요',
      '• 요청 취소: 네트워크가 느릴 때 대기 중인 요청을 정리하세요',
      '• AI 토큰 수: 2000-3000 토큰이 속도와 품질의 균형점입니다',
      '• 예외 단어: 500개 이상일 때 정기적으로 정리하세요'
    ];
    
    tips.forEach(tip => {
      tipsBox.createEl('div', { text: tip });
    });
  }

  /**
   * 개선된 검증 결과 디스플레이
   */
  private createImprovedValidationDisplay(parent: HTMLElement, validation: any, suggestions: any[]): void {
    clearElement(parent);
    
    // 전체 결과 컨테이너 - 더 깔끔한 디자인
    const resultContainer = parent.createEl('div', { cls: 'ksc-validation-result' });

    // 상태 요약 카드 (간소화)
    const statusCard = resultContainer.createEl('div', { cls: 'ksc-status-card' });
    
    // 상태 아이콘과 메시지를 한 줄로
    const statusLine = statusCard.createEl('div', { cls: 'ksc-status-line' });
    
    const statusIcon = statusLine.createEl('span', {
      text: validation.isValid ? '✅' : '❌',
      cls: 'ksc-status-icon'
    });
    
    const statusText = statusLine.createEl('span', {
      text: validation.isValid ? '모든 설정이 정상입니다' : '일부 설정에 문제가 있습니다',
      cls: 'ksc-status-text'
    });

    // 문제가 있는 경우에만 상세 정보 표시
    if (!validation.isValid) {
      if (validation.errors && validation.errors.length > 0) {
        const problemsSection = resultContainer.createEl('div', { cls: 'ksc-problems-section' });
        problemsSection.createEl('div', { 
          text: '🔧 해결해야 할 문제',
          cls: 'ksc-section-title'
        });
        
        const problemsList = problemsSection.createEl('ul', { cls: 'ksc-problems-list' });
        validation.errors.forEach((error: string) => {
          problemsList.createEl('li', { text: error });
        });
      }
    }

    // 경고사항이 있으면 표시
    if (validation.warnings && validation.warnings.length > 0) {
      const warningsSection = resultContainer.createEl('div', { cls: 'ksc-warnings-section' });
      warningsSection.createEl('div', { 
        text: '⚠️ 주의사항',
        cls: 'ksc-section-title'
      });
      
      const warningsList = warningsSection.createEl('ul', { cls: 'ksc-warnings-list' });
      validation.warnings.forEach((warning: string) => {
        warningsList.createEl('li', { text: warning });
      });
    }

    // 최적화 제안이 있으면 표시 (간소화)
    if (suggestions && suggestions.length > 0) {
      const suggestionsSection = resultContainer.createEl('div', { cls: 'ksc-suggestions-section' });
      suggestionsSection.createEl('div', { 
        text: '💡 개선 제안',
        cls: 'ksc-section-title'
      });
      
      suggestions.forEach((suggestion: any) => {
        const suggestionCard = suggestionsSection.createEl('div', { cls: 'ksc-suggestion-card' });
        
        const impactBadge = suggestion.impact === 'high' ? '🔴' : 
                           suggestion.impact === 'medium' ? '🟡' : '🟢';
        
        suggestionCard.createEl('div', {
          text: `${impactBadge} ${suggestion.title}`,
          cls: 'ksc-suggestion-title'
        });
        
        suggestionCard.createEl('div', {
          text: suggestion.action,
          cls: 'ksc-suggestion-desc'
        });
      });
    }

    // 현재 설정 상태 요약 (더 유용한 정보로)
    const summarySection = resultContainer.createEl('div', { cls: 'ksc-summary-section' });
    summarySection.createEl('div', { 
      text: '📋 현재 설정 상태',
      cls: 'ksc-section-title'
    });
    
    const summaryGrid = summarySection.createEl('div', { cls: 'ksc-summary-grid' });
    
    // API 상태
    const apiStatus = summaryGrid.createEl('div', { cls: 'ksc-summary-item' });
    apiStatus.createEl('span', { text: 'API', cls: 'ksc-summary-label' });
    apiStatus.createEl('span', { 
      text: this.plugin.settings.apiKey ? '✓ 설정됨' : '✗ 미설정',
      cls: this.plugin.settings.apiKey ? 'ksc-status-ok' : 'ksc-status-error'
    });
    
    // AI 상태
    const aiStatus = summaryGrid.createEl('div', { cls: 'ksc-summary-item' });
    aiStatus.createEl('span', { text: 'AI 기능', cls: 'ksc-summary-label' });
    const aiText = this.plugin.settings.ai.enabled ? 
      `✓ ${this.plugin.settings.ai.provider.toUpperCase()}` : '✗ 비활성화';
    aiStatus.createEl('span', { 
      text: aiText,
      cls: this.plugin.settings.ai.enabled ? 'ksc-status-ok' : 'ksc-status-disabled'
    });
    
    // 예외 단어 상태
    const ignoredStatus = summaryGrid.createEl('div', { cls: 'ksc-summary-item' });
    ignoredStatus.createEl('span', { text: '예외 단어', cls: 'ksc-summary-label' });
    const wordCount = this.plugin.settings.ignoredWords.length;
    const wordStatus = wordCount === 0 ? '없음' : 
                      wordCount > 100 ? `${wordCount}개 (많음)` : `${wordCount}개`;
    ignoredStatus.createEl('span', { 
      text: wordStatus,
      cls: wordCount > 100 ? 'ksc-status-warning' : 'ksc-status-ok'
    });
  }

  /**
   * 필터링 옵션 섹션을 생성합니다
   */
  private createFilteringOptionsSection(containerEl: HTMLElement): void {
    const section = containerEl.createEl('div', { cls: 'ksc-section' });
    
    // 필터링 옵션 헤딩
    new Setting(section)
      .setName('🔍 필터링 옵션')
      .setDesc('맞춤법 검사 결과를 필터링하는 옵션을 설정합니다.')
      .setHeading();

    // 한 글자 오류 필터링 설정
    new Setting(section)
      .setName('한 글자 오류 필터링')
      .setDesc('한 글자로 된 맞춤법 오류 제안을 필터링합니다. 의미있는 교정(조사, 어미 등)은 예외 처리됩니다.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.filterSingleCharErrors)
        .onChange(async (value) => {
          this.plugin.settings.filterSingleCharErrors = value;
          await this.plugin.saveSettings();
        }));

    // 필터링 예외 케이스 안내
    const infoBox = section.createEl('div', { cls: 'ksc-info-box' });
    infoBox.createEl('strong', { text: '🛡️ 예외 처리되는 한 글자 교정' });
    infoBox.createEl('br');
    infoBox.createEl('br');
    
    const exceptions = [
      '• 숫자/영문 → 한글 변환 (예: "1" → "일")',
      '• 특수문자 → 한글 변환 (예: "@" → "에")',
      '• 자주 틀리는 조사/어미 (예: "되" ↔ "돼", "안" ↔ "않")',
      '• 한 글자 → 여러 글자 확장 (예: "하" → "하여")'
    ];
    
    exceptions.forEach(exception => {
      infoBox.createEl('div', { 
        text: exception,
        attr: { style: 'margin-bottom: 4px; color: var(--text-muted);' }
      });
    });

    // 필터링 통계 표시 (실시간)
    const statsContainer = section.createEl('div', { cls: 'ksc-filter-stats' });
    this.updateFilteringStats(statsContainer);
  }

  /**
   * 필터링 통계를 업데이트합니다
   */
  private updateFilteringStats(container: HTMLElement): void {
    container.empty();
    
    const statsBox = container.createEl('div', { 
      cls: 'ksc-stats-box',
      attr: { style: 'margin-top: 12px; padding: 12px; background: var(--background-secondary); border-radius: 6px;' }
    });
    
    statsBox.createEl('div', { 
      text: '📊 필터링 통계',
      attr: { style: 'font-weight: 600; margin-bottom: 8px;' }
    });
    
    const statusText = this.plugin.settings.filterSingleCharErrors ? 
      '✅ 한 글자 오류 필터링이 활성화되어 있습니다.' :
      '⚠️ 한 글자 오류 필터링이 비활성화되어 있습니다.';
    
    statsBox.createEl('div', { 
      text: statusText,
      attr: { style: 'color: var(--text-muted); font-size: 14px;' }
    });
    
    if (this.plugin.settings.filterSingleCharErrors) {
      statsBox.createEl('div', { 
        text: '💡 팁: 의미있는 한 글자 교정(조사, 어미 등)은 자동으로 예외 처리됩니다.',
        attr: { style: 'color: var(--text-accent); font-size: 13px; margin-top: 4px;' }
      });
    }
  }

  /**
   * 베타 기능 탭을 생성합니다
   */
  private createBetaFeaturesTab(containerEl: HTMLElement): void {
    // 경고 메시지 섹션
    this.createBetaWarningSection(containerEl);
    
    // 인라인 모드 설정 섹션
    this.createInlineModeSection(containerEl);
  }

  /**
   * 베타 기능 경고 섹션을 생성합니다
   */
  private createBetaWarningSection(containerEl: HTMLElement): void {
    const section = containerEl.createEl('div', { cls: 'ksc-section' });
    
    const warningHeading = new Setting(section)
      .setName('⚠️ 베타 기능 안내')
      .setHeading();
    warningHeading.settingEl.addClasses(['ksc-section-title']);

    const warningBox = section.createEl('div', { 
      cls: 'ksc-warning-box',
      attr: { 
        style: 'background: rgba(255, 196, 0, 0.1); border: 1px solid rgba(255, 196, 0, 0.3); border-radius: 8px; padding: 16px; margin-bottom: 20px;'
      }
    });

    warningBox.createEl('div', {
      text: '🧪 실험적 기능',
      attr: { style: 'font-weight: 600; color: var(--text-warning); margin-bottom: 8px;' }
    });

    const warnings = [
      '이 섹션의 기능들은 베타 버전입니다.',
      '일부 기능이 예상과 다르게 동작할 수 있습니다.',
      '피드백과 버그 리포트는 언제나 환영합니다.',
      '안정화 후 정식 기능으로 승격될 예정입니다.'
    ];

    warnings.forEach(warning => {
      warningBox.createEl('div', {
        text: `• ${warning}`,
        attr: { style: 'color: var(--text-muted); margin-bottom: 4px; font-size: 14px;' }
      });
    });
  }

  /**
   * 인라인 모드 설정 섹션을 생성합니다
   */
  private createInlineModeSection(containerEl: HTMLElement): void {
    const section = containerEl.createEl('div', { cls: 'ksc-section' });
    
    const inlineHeading = new Setting(section)
      .setName('📝 인라인 모드')
      .setHeading();
    inlineHeading.settingEl.addClasses(['ksc-section-title']);

    // 기능 설명
    const descBox = section.createEl('div', { 
      cls: 'ksc-info-box',
      attr: { 
        style: 'background: var(--background-secondary); border-radius: 8px; padding: 16px; margin-bottom: 20px;'
      }
    });

    descBox.createEl('div', {
      text: '🎯 에디터 내 실시간 맞춤법 검사',
      attr: { style: 'font-weight: 600; margin-bottom: 8px;' }
    });

    const features = [
      '오타 텍스트에 밑줄 표시',
      '호버/클릭으로 수정 제안 확인',
      '사용자 편집 시 밑줄 자동 제거',
      'Command Palette로 검사 실행'
    ];

    features.forEach(feature => {
      descBox.createEl('div', {
        text: `• ${feature}`,
        attr: { style: 'color: var(--text-muted); margin-bottom: 4px;' }
      });
    });

    // 활성화 토글
    new Setting(section)
      .setName('인라인 모드 활성화')
      .setDesc('에디터 내에서 실시간으로 맞춤법 오류를 표시합니다.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.inlineMode.enabled)
        .onChange(async (value) => {
          this.plugin.settings.inlineMode.enabled = value;
          await this.plugin.saveSettings();
          
          // 🔧 인라인 모드 즉시 적용/해제
          if (value) {
            this.plugin.enableInlineMode();
            Logger.log('인라인 모드 즉시 활성화');
            new Notice('인라인 모드가 활성화되었습니다. 에디터에서 텍스트를 입력하면 실시간 검사가 시작됩니다.');
          } else {
            this.plugin.disableInlineMode();
            Logger.log('인라인 모드 즉시 비활성화');
            new Notice('인라인 모드가 비활성화되었습니다.');
          }
          
          // UI 새로고침 (인라인 모드 하위 설정들 표시/숨김)
          this.display();
        }));

    // 밑줄 스타일 설정 (인라인 모드가 활성화된 경우에만)
    if (this.plugin.settings.inlineMode.enabled) {
      new Setting(section)
        .setName('밑줄 스타일')
        .setDesc('오류 표시에 사용할 밑줄 스타일을 선택하세요.')
        .addDropdown(dropdown => dropdown
          .addOption('wavy', '물결선 (추천)')
          .addOption('solid', '직선')
          .addOption('dotted', '점선')
          .addOption('dashed', '파선')
          .setValue(this.plugin.settings.inlineMode.underlineStyle)
          .onChange(async (value: 'wavy' | 'solid' | 'dotted' | 'dashed') => {
            this.plugin.settings.inlineMode.underlineStyle = value;
            await this.plugin.saveSettings();
          }));

      new Setting(section)
        .setName('밑줄 색상')
        .setDesc('오류 표시에 사용할 밑줄 색상을 설정하세요.')
        .addText(text => text
          .setPlaceholder('#ff0000')
          .setValue(this.plugin.settings.inlineMode.underlineColor)
          .onChange(async (value) => {
            if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
              this.plugin.settings.inlineMode.underlineColor = value;
              await this.plugin.saveSettings();
            }
          }));

      new Setting(section)
        .setName('툴팁 표시 방식')
        .setDesc('문법 오류 수정 제안을 표시할 방법을 선택하세요. "자동"은 플랫폼에 최적화된 방식을 사용합니다.')
        .addDropdown(dropdown => dropdown
          .addOption('auto', '🤖 자동 (권장) - 플랫폼별 최적화')
          .addOption('hover', '🖱️ 마우스 호버 - 데스크톱 전용')
          .addOption('click', '👆 클릭/탭 - 모바일 친화적')
          .addOption('disabled', '🚫 툴팁 비활성화')
          .setValue(this.plugin.settings.inlineMode.tooltipTrigger || 'auto')
          .onChange(async (value: 'auto' | 'hover' | 'click' | 'disabled') => {
            this.plugin.settings.inlineMode.tooltipTrigger = value;
            
            // 🔧 레거시 설정도 자동 업데이트 (하위 호환성)
            switch (value) {
              case 'auto':
                this.plugin.settings.inlineMode.showTooltipOnHover = true;
                this.plugin.settings.inlineMode.showTooltipOnClick = true;
                break;
              case 'hover':
                this.plugin.settings.inlineMode.showTooltipOnHover = true;
                this.plugin.settings.inlineMode.showTooltipOnClick = false;
                break;
              case 'click':
                this.plugin.settings.inlineMode.showTooltipOnHover = false;
                this.plugin.settings.inlineMode.showTooltipOnClick = true;
                break;
              case 'disabled':
                this.plugin.settings.inlineMode.showTooltipOnHover = false;
                this.plugin.settings.inlineMode.showTooltipOnClick = false;
                break;
            }
            
            await this.plugin.saveSettings();
            
            // 사용자에게 설정 변경 안내
            const modeNames = {
              'auto': '자동 모드 (플랫폼별 최적화)',
              'hover': '호버 모드 (데스크톱 전용)',
              'click': '클릭 모드 (모바일 친화적)',
              'disabled': '툴팁 비활성화'
            };
            new Notice(`툴팁 표시 방식: ${modeNames[value]}`);
          }));

      // 📱 플랫폼별 설명 추가
      section.createEl('div', {
        text: '💡 자동 모드: 데스크톱에서는 호버, 모바일에서는 탭으로 자동 동작',
        attr: { 
          style: 'font-size: 0.9em; color: var(--text-muted); margin-top: 8px; padding: 8px; background: var(--background-secondary); border-radius: 4px;' 
        }
      });
    }
  }
}
