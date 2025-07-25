import { 
  App, 
  Editor, 
  EditorSuggest, 
  EditorPosition, 
  EditorSuggestContext, 
  EditorSuggestTriggerInfo, 
  TFile,
  Menu,
  Modal,
  Notice
} from 'obsidian';
import { Correction } from '../types/interfaces';
import { Logger } from '../utils/logger';
import { SpellCheckApiService } from '../services/api';

/**
 * 한국어 맞춤법 제안 인터페이스
 */
interface KoreanGrammarSuggestion {
  original: string;
  corrections: string[];
  help?: string;
  range: { start: EditorPosition; end: EditorPosition };
  confidence?: number;
}

/**
 * 한국어 단어 매치 인터페이스
 */
interface WordMatch {
  word: string;
  start: number;
  end: number;
  line: number;
}

/**
 * EditorSuggest 기반 한국어 맞춤법 검사
 * Obsidian의 네이티브 자동완성 시스템을 활용
 */
export class KoreanGrammarSuggest extends EditorSuggest<KoreanGrammarSuggestion> {
  private corrections: Map<string, Correction> = new Map();
  private apiService: SpellCheckApiService;
  private lastCheckTime: number = 0;
  private checkCooldown: number = 1000; // 1초 쿨다운
  
  // 한글 패턴 정규식
  private koreanPattern = /[\u3131-\u318E\uAC00-\uD7A3]+/g;
  private wordBoundaryPattern = /[^\u3131-\u318E\uAC00-\uD7A3\s]/;

  constructor(app: App, private settings: any) {
    super(app);
    this.apiService = new SpellCheckApiService();
    
    // 제안 개수 제한
    this.limit = this.settings?.inlineMode?.maxSuggestions || 5;
    
    // 지시사항 설정
    this.setInstructions([
      { command: '↑↓', purpose: '탐색' },
      { command: '↵', purpose: '선택' },
      { command: 'esc', purpose: '닫기' },
      { command: 'Ctrl+Space', purpose: '자세히' }
    ]);
    
    Logger.debug('KoreanGrammarSuggest 초기화됨');
  }

  /**
   * 트리거 조건 확인
   * 한글 단어에서 맞춤법 오류 감지 시 제안 시스템 활성화
   */
  onTrigger(
    cursor: EditorPosition, 
    editor: Editor, 
    file: TFile
  ): EditorSuggestTriggerInfo | null {
    // 쿨다운 체크
    if (Date.now() - this.lastCheckTime < this.checkCooldown) {
      return null;
    }

    // 현재 커서 위치의 한글 단어 찾기
    const wordMatch = this.findKoreanWordAtCursor(cursor, editor);
    if (!wordMatch) {
      return null;
    }

    // 해당 단어에 대한 교정 정보 확인
    const correction = this.corrections.get(wordMatch.word);
    if (!correction || correction.corrected.length === 0) {
      return null;
    }

    Logger.debug(`맞춤법 제안 트리거: "${wordMatch.word}"`);

    return {
      start: { line: wordMatch.line, ch: wordMatch.start },
      end: { line: wordMatch.line, ch: wordMatch.end },
      query: wordMatch.word
    };
  }

  /**
   * 수정 제안 생성
   */
  async getSuggestions(context: EditorSuggestContext): Promise<KoreanGrammarSuggestion[]> {
    const correction = this.corrections.get(context.query);
    if (!correction) {
      return [];
    }

    const suggestion: KoreanGrammarSuggestion = {
      original: correction.original,
      corrections: correction.corrected,
      help: correction.help,
      range: { start: context.start, end: context.end },
      confidence: this.calculateConfidence(correction)
    };

    Logger.debug(`제안 생성: ${correction.corrected.length}개 수정안`);
    return [suggestion];
  }

  /**
   * 제안 항목 렌더링
   */
  renderSuggestion(suggestion: KoreanGrammarSuggestion, el: HTMLElement): void {
    const container = el.createDiv({ cls: 'kgc-suggestion-container' });
    
    // 헤더: 원본 오류
    const header = container.createDiv({ cls: 'kgc-suggestion-header' });
    header.createSpan({ 
      cls: 'kgc-suggestion-error-icon',
      text: '❌' 
    });
    header.createSpan({ 
      cls: 'kgc-suggestion-error-text',
      text: suggestion.original 
    });

    // 신뢰도 표시 (있는 경우)
    if (suggestion.confidence !== undefined) {
      header.createSpan({
        cls: 'kgc-suggestion-confidence',
        text: `${suggestion.confidence}%`
      });
    }

    // 수정 제안들
    const correctionsList = container.createDiv({ cls: 'kgc-suggestion-corrections' });
    
    suggestion.corrections.forEach((correction, index) => {
      const correctionItem = correctionsList.createDiv({ 
        cls: 'kgc-suggestion-item',
        attr: { 'data-index': index.toString() }
      });
      
      correctionItem.createSpan({
        cls: 'kgc-suggestion-check-icon',
        text: '✓'
      });
      
      correctionItem.createSpan({
        cls: 'kgc-suggestion-text',
        text: correction
      });
      
      // 첫 번째 제안은 기본 선택으로 표시
      if (index === 0) {
        correctionItem.addClass('kgc-suggestion-item--primary');
      }
    });

    // 도움말 (있는 경우)
    if (suggestion.help) {
      const helpSection = container.createDiv({ cls: 'kgc-suggestion-help' });
      helpSection.createSpan({
        cls: 'kgc-suggestion-help-icon',
        text: '💡'
      });
      helpSection.createSpan({
        cls: 'kgc-suggestion-help-text',
        text: suggestion.help
      });
    }

    // 추가 옵션 힌트
    const footer = container.createDiv({ cls: 'kgc-suggestion-footer' });
    footer.createSpan({
      cls: 'kgc-suggestion-hint',
      text: 'Ctrl+Space: 상세 옵션'
    });
  }

  /**
   * 제안 선택 처리
   */
  selectSuggestion(suggestion: KoreanGrammarSuggestion, evt: MouseEvent | KeyboardEvent): void {
    const editor = this.context?.editor;
    if (!editor) return;

    // Ctrl/Cmd + 클릭 시 상세 옵션 표시
    if ((evt.ctrlKey || evt.metaKey) || (evt as KeyboardEvent).code === 'Space') {
      this.showDetailedOptions(suggestion, editor, evt);
      return;
    }

    // 기본 동작: 첫 번째 수정 제안 적용
    const selectedCorrection = suggestion.corrections[0];
    this.applySuggestion(suggestion, selectedCorrection, editor);
  }

  /**
   * 상세 옵션 메뉴 표시
   */
  private showDetailedOptions(suggestion: KoreanGrammarSuggestion, editor: Editor, evt?: MouseEvent | KeyboardEvent): void {
    const menu = new Menu();

    // 각 수정 제안을 메뉴 아이템으로 추가
    suggestion.corrections.forEach((correction, index) => {
      menu.addItem((item) => {
        item
          .setTitle(correction)
          .setIcon(index === 0 ? 'star' : 'edit')
          .onClick(() => {
            this.applySuggestion(suggestion, correction, editor);
          });

        // 첫 번째 제안은 추천 표시
        if (index === 0) {
          item.setSection('추천');
        }
      });
    });

    menu.addSeparator();

    // 무시 옵션
    menu.addItem((item) => {
      item
        .setTitle('이 오류 무시')
        .setIcon('x')
        .onClick(() => {
          this.ignoreError(suggestion.original);
        });
    });

    // 도움말 (있는 경우)
    if (suggestion.help) {
      menu.addItem((item) => {
        item
          .setTitle('도움말 보기')
          .setIcon('help-circle')
          .onClick(() => {
            this.showHelpModal(suggestion.help!);
          });
      });
    }

    // 마우스 이벤트 처리
    if (evt instanceof MouseEvent) {
      menu.showAtMouseEvent(evt);
    } else {
      // 키보드 이벤트인 경우 현재 커서 위치에 표시
      menu.showAtPosition({ x: 0, y: 0 });
    }
  }

  /**
   * 수정 제안 적용
   */
  private applySuggestion(
    suggestion: KoreanGrammarSuggestion, 
    selectedCorrection: string,
    editor: Editor
  ): void {
    editor.replaceRange(
      selectedCorrection,
      suggestion.range.start,
      suggestion.range.end
    );

    // 해당 오류를 교정 목록에서 제거
    this.corrections.delete(suggestion.original);

    Logger.log(`맞춤법 수정 적용: "${suggestion.original}" → "${selectedCorrection}"`);
    
    new Notice(`"${suggestion.original}"이(가) "${selectedCorrection}"로 수정되었습니다.`);
  }

  /**
   * 오류 무시
   */
  private ignoreError(original: string): void {
    this.corrections.delete(original);
    Logger.log(`맞춤법 오류 무시: "${original}"`);
    new Notice(`"${original}" 오류를 무시했습니다.`);
  }

  /**
   * 도움말 모달 표시
   */
  private showHelpModal(helpText: string): void {
    const modal = new Modal(this.app);
    modal.titleEl.setText('맞춤법 도움말');
    
    const content = modal.contentEl;
    content.createEl('p', { text: helpText });
    
    const buttonContainer = content.createDiv({ cls: 'modal-button-container' });
    buttonContainer.createEl('button', { 
      text: '닫기',
      cls: 'mod-cta'
    }).addEventListener('click', () => {
      modal.close();
    });
    
    modal.open();
  }

  /**
   * 커서 위치의 한글 단어 찾기
   */
  private findKoreanWordAtCursor(cursor: EditorPosition, editor: Editor): WordMatch | null {
    const line = editor.getLine(cursor.line);
    const cursorPos = cursor.ch;
    
    // 커서 위치 앞뒤로 한글 단어 경계 찾기
    let start = cursorPos;
    let end = cursorPos;
    
    // 시작 위치 찾기 (뒤로)
    while (start > 0) {
      const char = line[start - 1];
      if (this.isKoreanChar(char)) {
        start--;
      } else {
        break;
      }
    }
    
    // 끝 위치 찾기 (앞으로)
    while (end < line.length) {
      const char = line[end];
      if (this.isKoreanChar(char)) {
        end++;
      } else {
        break;
      }
    }
    
    // 유효한 한글 단어인지 확인
    if (end - start < 1) {
      return null;
    }
    
    const word = line.slice(start, end);
    if (!this.isKoreanWord(word)) {
      return null;
    }
    
    return {
      word,
      start,
      end,
      line: cursor.line
    };
  }

  /**
   * 한글 문자 확인
   */
  private isKoreanChar(char: string): boolean {
    const code = char.charCodeAt(0);
    return (
      (code >= 0x3131 && code <= 0x318E) || // 한글 자모
      (code >= 0xAC00 && code <= 0xD7A3)    // 한글 완성형
    );
  }

  /**
   * 한글 단어 확인
   */
  private isKoreanWord(word: string): boolean {
    return word.length >= 1 && /[\uAC00-\uD7A3]/.test(word);
  }

  /**
   * 신뢰도 계산
   */
  private calculateConfidence(correction: Correction): number {
    // 수정 제안 개수와 도움말 유무를 기반으로 신뢰도 계산
    let confidence = 80; // 기본 신뢰도
    
    if (correction.corrected.length === 1) {
      confidence += 10; // 단일 제안은 신뢰도 높음
    }
    
    if (correction.help && correction.help.trim()) {
      confidence += 10; // 도움말이 있으면 신뢰도 높음
    }
    
    return Math.min(confidence, 100);
  }

  /**
   * 맞춤법 검사 결과 업데이트
   */
  async updateCorrections(text: string): Promise<void> {
    try {
      this.lastCheckTime = Date.now();
      
      const result = await this.apiService.checkSpelling(text, this.settings);
      
      // 교정 정보 맵 업데이트
      this.corrections.clear();
      result.corrections.forEach(correction => {
        this.corrections.set(correction.original, correction);
      });
      
      Logger.debug(`교정 정보 업데이트: ${result.corrections.length}개 오류`);
      
    } catch (error) {
      Logger.error('맞춤법 검사 실패:', error);
    }
  }

  /**
   * 설정 업데이트
   */
  updateSettings(settings: any): void {
    this.settings = settings;
    this.limit = settings?.inlineMode?.maxSuggestions || 5;
    this.checkCooldown = settings?.inlineMode?.checkDelay || 1000;
  }

  /**
   * 서비스 정리
   */
  cleanup(): void {
    this.corrections.clear();
    Logger.debug('KoreanGrammarSuggest 정리됨');
  }
}