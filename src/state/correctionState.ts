import { Correction, CorrectionState } from '../types/interfaces';

/**
 * 교정 상태 관리 클래스
 */
export class CorrectionStateManager {
  private states: Map<string | number, any> = new Map();
  private corrections: Correction[] = [];

  constructor(corrections: Correction[]) {
    this.corrections = corrections;
    this.initializeStates();
  }

  /**
   * 상태를 초기화합니다.
   */
  private initializeStates(): void {
    this.states.clear();
    this.corrections.forEach((correction, index) => {
      this.states.set(index, correction.original);
    });
  }

  /**
   * 특정 교정의 상태를 설정합니다.
   * @param correctionIndex 교정 인덱스
   * @param value 설정할 값
   * @param isExceptionState 예외 처리 상태 여부
   */
  setState(correctionIndex: number, value: string, isExceptionState: boolean = false): void {
    this.states.set(correctionIndex, value);
    
    const exceptionKey = `${correctionIndex}_exception`;
    if (isExceptionState) {
      this.states.set(exceptionKey, true);
    } else {
      this.states.delete(exceptionKey);
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
  toggleState(correctionIndex: number): { value: string; isExceptionState: boolean } {
    if (correctionIndex < 0 || correctionIndex >= this.corrections.length) {
      throw new Error(`Invalid correction index: ${correctionIndex}`);
    }

    const correction = this.corrections[correctionIndex];
    const suggestions = correction.corrected;
    const currentValue = this.getValue(correctionIndex);
    const isCurrentlyException = this.isExceptionState(correctionIndex);

    console.log('Toggle state analysis:', {
      correctionIndex,
      currentValue,
      isCurrentlyException,
      originalText: correction.original,
      suggestions
    });

    // 현재 상태 분석
    const isCurrentlyOriginal = currentValue === correction.original;
    const currentSuggestionIndex = suggestions.indexOf(currentValue);

    if (isCurrentlyOriginal && !isCurrentlyException) {
      // 빨간색 상태 → 첫 번째 제안 (초록색)
      const newValue = suggestions[0] || correction.original;
      this.setState(correctionIndex, newValue, false);
      console.log('Red → Green: Moving to first suggestion');
      return { value: newValue, isExceptionState: false };
      
    } else if (isCurrentlyOriginal && isCurrentlyException) {
      // 파란색 상태 (예외처리) → 빨간색 상태
      this.setState(correctionIndex, correction.original, false);
      console.log('Blue(Exception) → Red: Removing exception flag');
      return { value: correction.original, isExceptionState: false };
      
    } else if (currentSuggestionIndex >= 0) {
      // 현재 제안 상태 (초록색)
      if (currentSuggestionIndex < suggestions.length - 1) {
        // 다음 제안으로 이동
        const nextValue = suggestions[currentSuggestionIndex + 1];
        this.setState(correctionIndex, nextValue, false);
        console.log(`Green → Green: Moving to suggestion ${currentSuggestionIndex + 1}`);
        return { value: nextValue, isExceptionState: false };
      } else {
        // 마지막 제안 → 파란색 상태 (예외 처리)
        this.setState(correctionIndex, correction.original, true);
        console.log('Green → Blue(Exception): Setting exception flag');
        return { value: correction.original, isExceptionState: true };
      }
      
    } else {
      // 알 수 없는 상태 → 첫 번째 제안으로 리셋
      const newValue = suggestions[0] || correction.original;
      this.setState(correctionIndex, newValue, false);
      console.log('Unknown → Green: Resetting to first suggestion');
      return { value: newValue, isExceptionState: false };
    }
  }

  /**
   * 특정 교정의 표시 클래스를 가져옵니다.
   * @param correctionIndex 교정 인덱스
   * @returns CSS 클래스명
   */
  getDisplayClass(correctionIndex: number): string {
    const correction = this.corrections[correctionIndex];
    if (!correction) return '';

    const currentValue = this.getValue(correctionIndex);
    const isException = this.isExceptionState(correctionIndex);

    if (currentValue === correction.original) {
      return isException ? 'spell-exception-processed' : 'spell-error';
    } else {
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