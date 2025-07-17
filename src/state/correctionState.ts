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
        const isOriginalKept = ignoredWords.includes(correction.original);
        this.setState(index, correction.original, false, isOriginalKept);
        console.log(`[CorrectionState] Initializing: ${correction.original} at index ${index} as ${isOriginalKept ? 'ORIGINAL_KEPT' : 'ERROR'}.`);
    });
  }

  /**
   * 특정 교정의 상태를 설정합니다.
   * @param correctionIndex 교정 인덱스
   * @param value 설정할 값
   * @param isExceptionState 예외 처리 상태 여부
   * @param isOriginalKept 원본유지 상태 여부
   */
  setState(correctionIndex: number, value: string, isExceptionState: boolean = false, isOriginalKept: boolean = false): void {
    this.states.set(correctionIndex, value);
    
    const exceptionKey = `${correctionIndex}_exception`;
    const originalKeptKey = `${correctionIndex}_originalKept`;

    if (isExceptionState) {
      this.states.set(exceptionKey, true);
    } else {
      this.states.delete(exceptionKey);
    }

    if (isOriginalKept) {
        this.states.set(originalKeptKey, true);
    } else {
        this.states.delete(originalKeptKey);
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
   * 특정 교정이 원본유지 상태인지 확인합니다.
   * @param correctionIndex 교정 인덱스
   * @returns 원본유지 상태 여부
   */
  isOriginalKeptState(correctionIndex: number): boolean {
    const originalKeptKey = `${correctionIndex}_originalKept`;
    return !!this.states.get(originalKeptKey);
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
   * 4단계 토글을 수행합니다.
   * - 오류(빨간색) → 수정1, 수정2...(초록색) → 예외처리(파란색) → 원본유지(주황색) → 오류(빨간색)
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
    const isCurrentlyOriginalKept = this.isOriginalKeptState(correctionIndex);
    
    console.log('\n[CorrectionState.toggleState] Initial state:', {
      correctionIndex,
      currentValue,
      isCurrentlyException,
      isCurrentlyOriginalKept,
      originalText: correction.original,
      suggestions
    });

    // 1. 원본유지 상태에서 오류 상태로
    if (isCurrentlyOriginalKept) {
        this.setState(correctionIndex, correction.original, false, false);
        console.log('[CorrectionState.toggleState] OriginalKept -> Error');
        return { value: correction.original, isExceptionState: false };
    }

    // 2. 예외처리 상태에서 원본유지 상태로
    if (isCurrentlyException) {
        this.setState(correctionIndex, correction.original, false, true);
        console.log('[CorrectionState.toggleState] Exception -> OriginalKept');
        return { value: correction.original, isExceptionState: false };
    }

    // 3. 현재 값의 다음 제안으로 이동
    let nextIndex = suggestions.indexOf(currentValue) + 1;

    if (nextIndex >= suggestions.length) {
        // 마지막 제안에서 예외처리 상태로
        this.setState(correctionIndex, correction.original, true, false);
        console.log('[CorrectionState.toggleState] Last Suggestion -> Exception');
        return { value: correction.original, isExceptionState: true };
    }

    // 4. 다음 제안으로 이동 (오류 → 첫 번째 수정안, 수정안 → 다음 수정안)
    const newValue = suggestions[nextIndex];
    this.setState(correctionIndex, newValue, false, false);
    console.log('[CorrectionState.toggleState] Next Suggestion:', newValue);
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

    if (this.isOriginalKeptState(correctionIndex)) {
        console.log(`[CorrectionState] DisplayClass for ${correction.original} (index ${correctionIndex}): spell-original-kept`);
        return 'spell-original-kept';
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