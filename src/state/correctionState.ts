import { Correction, CorrectionState } from '../types/interfaces';

/**
 * 교정 상태 관리 클래스
 */
export class CorrectionStateManager {
  private states: Map<string | number, any> = new Map();
  private corrections: Correction[] = [];
  private ignoredWords: string[] = [];

  constructor(corrections: Correction[], ignoredWords: string[] = []) {
    this.corrections = corrections;
    this.ignoredWords = ignoredWords;
    this.initializeStates(ignoredWords);
  }

  /**
   * 상태를 초기화합니다.
   */
  private initializeStates(ignoredWords: string[]): void {
    this.states.clear();
    this.corrections.forEach((correction, index) => {
        const isIgnored = ignoredWords.includes(correction.original);
        this.setState(index, correction.original, false, isIgnored);
        console.log(`[CorrectionState] Initializing: ${correction.original} at index ${index} as ${isIgnored ? 'IGNORED' : 'ERROR'}.`);
    });
  }

  /**
   * 특정 교정의 상태를 설정합니다.
   * @param correctionIndex 교정 인덱스
   * @param value 설정할 값
   * @param isExceptionState 예외 처리 상태 여부
   */
  setState(correctionIndex: number, value: string, isExceptionState: boolean = false, isIgnoredState: boolean = false): void {
    this.states.set(correctionIndex, value);
    
    const exceptionKey = `${correctionIndex}_exception`;
    const ignoredKey = `${correctionIndex}_ignored`;

    if (isExceptionState) {
      this.states.set(exceptionKey, true);
    } else {
      this.states.delete(exceptionKey);
    }

    if (isIgnoredState) {
        this.states.set(ignoredKey, true);
    } else {
        this.states.delete(ignoredKey);
    }
  }

  /**
   * 특정 교정의 현재 값을 가져옵니다.
   * @param correctionIndex 교정 인덱스
   * @returns 현재 값
   */
  getValue(correctionIndex: number): string {
    return this.states.get(correctionIndex) || '';
  }

  /**
   * 특정 교정이 예외 처리 상태인지 확인합니다.
   * @param correctionIndex 교정 인덱스
   * @returns 예외 처리 상태 여부
   */
  isExceptionState(correctionIndex: number): boolean {
    const exceptionKey = `${correctionIndex}_exception`;
    return !!this.states.get(exceptionKey);
  }

  /**
   * 3단계 토글을 수행합니다 (빨간색 → 초록색 → 파란색(예외처리) → 빨간색).
   * @param correctionIndex 교정 인덱스
   * @returns 새로운 상태 정보
   */
  isIgnoredState(correctionIndex: number): boolean {
    const ignoredKey = `${correctionIndex}_ignored`;
    return !!this.states.get(ignoredKey);
  }

  /**
   * 특정 단어가 초기에 무시된 단어인지 확인합니다.
   * @param word 확인할 단어
   * @returns 초기에 무시된 단어 여부
   */
  private isInitiallyIgnoredWord(word: string): boolean {
    return this.ignoredWords.includes(word);
  }

  /**
   * 3단계 토글을 수행합니다.
   * - 일반 단어: 빨간색(오류) → 초록색(수정) → 파란색(예외처리) → 빨간색(오류)
   * - 무시된 단어: 주황색(무시됨) → 빨간색(오류) → 초록색(수정) → 파란색(예외처리) → 주황색(무시됨)
   * @param correctionIndex 교정 인덱스
   * @returns 새로운 상태 정보
   */
  toggleState(correctionIndex: number): { value: string; isExceptionState: boolean } {
    if (correctionIndex < 0 || correctionIndex >= this.corrections.length) {
      throw new Error(`Invalid correction index: ${correctionIndex}`);
    }

    const correction = this.corrections[correctionIndex];
    const suggestions = [correction.original, ...correction.corrected];
    const currentValue = this.getValue(correctionIndex);
    const isCurrentlyException = this.isExceptionState(correctionIndex);
    const isCurrentlyIgnored = this.isIgnoredState(correctionIndex);
    
    // 이 단어가 초기에 무시된 단어인지 확인 (ignoredWords에 포함되어 있는지)
    const wasInitiallyIgnored = this.isInitiallyIgnoredWord(correction.original);

    console.log('\n[CorrectionState.toggleState] Initial state:', {
      correctionIndex,
      currentValue,
      isCurrentlyException,
      isCurrentlyIgnored,
      wasInitiallyIgnored,
      originalText: correction.original,
      suggestions
    });

    if (isCurrentlyIgnored) {
        // Ignored (Orange) -> Error (Red)
        this.setState(correctionIndex, correction.original, false, false);
        console.log('[CorrectionState.toggleState] Ignored -> Error');
        return { value: correction.original, isExceptionState: false };
    }

    let nextIndex = suggestions.indexOf(currentValue) + 1;

    if (isCurrentlyException) {
        if (wasInitiallyIgnored) {
            // Exception (Blue) -> Ignored (Orange) - 초기에 무시된 단어만
            this.setState(correctionIndex, correction.original, false, true);
            console.log('[CorrectionState.toggleState] Exception -> Ignored (initially ignored word)');
            return { value: correction.original, isExceptionState: false };
        } else {
            // Exception (Blue) -> Error (Red) - 일반 단어
            this.setState(correctionIndex, correction.original, false, false);
            console.log('[CorrectionState.toggleState] Exception -> Error (regular word)');
            return { value: correction.original, isExceptionState: false };
        }
    }

    if (nextIndex >= suggestions.length) {
        // Last suggestion (Green) -> Exception (Blue)
        this.setState(correctionIndex, correction.original, true, false);
        console.log('[CorrectionState.toggleState] Last Suggestion -> Exception');
        return { value: correction.original, isExceptionState: true };
    }

    // Error (Red) or Corrected (Green) -> Next suggestion (Green)
    const newValue = suggestions[nextIndex];
    this.setState(correctionIndex, newValue, false, false);
    console.log('[CorrectionState.toggleState] Next Suggestion');
    return { value: newValue, isExceptionState: false };
  }

  /**
   * 특정 교정의 표시 클래스를 가져옵니다.
   * @param correctionIndex 교정 인덱스
   * @returns CSS 클래스명
   */
  getDisplayClass(correctionIndex: number): string {
    const correction = this.corrections[correctionIndex];
    if (!correction) return '';

    if (this.isIgnoredState(correctionIndex)) {
        console.log(`[CorrectionState] DisplayClass for ${correction.original} (index ${correctionIndex}): spell-ignored`);
        return 'spell-ignored';
    }

    const currentValue = this.getValue(correctionIndex);
    const isException = this.isExceptionState(correctionIndex);

    if (currentValue === correction.original) {
      const className = isException ? 'spell-exception-processed' : 'spell-error';
      console.log(`[CorrectionState] DisplayClass for ${correction.original} (index ${correctionIndex}): ${className}`);
      return className;
    } else {
      console.log(`[CorrectionState] DisplayClass for ${correction.original} (index ${correctionIndex}): spell-corrected`);
      return 'spell-corrected';
    }
  }

  /**
   * 특정 값이 선택되었는지 확인합니다 (오류 카드용).
   * @param correctionIndex 교정 인덱스
   * @param value 확인할 값
   * @returns 선택 여부
   */
  isSelected(correctionIndex: number, value: string): boolean {
    const correction = this.corrections[correctionIndex];
    if (!correction) return false;

    const currentValue = this.getValue(correctionIndex);
    const isException = this.isExceptionState(correctionIndex);

    if (value === correction.original) {
      // "예외처리" 버튼: 예외처리 상태일 때만 선택
      return currentValue === correction.original && isException;
    } else {
      // 제안 버튼: 해당 제안이 선택되고 예외처리 상태가 아닐 때만 선택
      return currentValue === value && !isException;
    }
  }

  /**
   * 모든 상태를 가져옵니다.
   * @returns 상태 맵
   */
  getAllStates(): Map<string | number, any> {
    return new Map(this.states);
  }

  /**
   * 최종 적용할 텍스트를 생성합니다.
   * @param originalText 원본 텍스트
   * @returns 교정이 적용된 텍스트와 예외 처리된 단어들
   */
  applyCorrections(originalText: string): { finalText: string; exceptionWords: string[] } {
    let finalText = originalText;
    const exceptionWords: string[] = [];
    
    // 역순으로 처리하여 인덱스 변화 방지
    for (let i = this.corrections.length - 1; i >= 0; i--) {
      const correction = this.corrections[i];
      const selectedValue = this.getValue(i);
      const isException = this.isExceptionState(i);
      
      if (isException) {
        // 예외 처리된 단어 수집
        if (!exceptionWords.includes(correction.original)) {
          exceptionWords.push(correction.original);
        }
      } else if (selectedValue !== correction.original) {
        // 예외 처리 상태가 아니고, 원본과 다른 값이 선택된 경우에만 교정 적용
        const lastIndex = finalText.lastIndexOf(correction.original);
        if (lastIndex !== -1) {
          finalText = 
            finalText.slice(0, lastIndex) + 
            selectedValue + 
            finalText.slice(lastIndex + correction.original.length);
        }
      }
    }
    
    return { finalText, exceptionWords };
  }

  /**
   * 예외 처리된 단어 목록을 가져옵니다.
   * @returns 예외 처리된 단어 배열
   */
  getExceptionWords(): string[] {
    const exceptionWords: string[] = [];
    
    for (let i = 0; i < this.corrections.length; i++) {
      if (this.isExceptionState(i)) {
        const correction = this.corrections[i];
        if (!exceptionWords.includes(correction.original)) {
          exceptionWords.push(correction.original);
        }
      }
    }
    
    return exceptionWords;
  }
}