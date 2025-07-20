import { Correction, CorrectionState } from '../types/interfaces';
import { Logger } from '../utils/logger';

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
        Logger.log(`Initializing: ${correction.original} at index ${index} as ${isOriginalKept ? 'ORIGINAL_KEPT' : 'ERROR'}.`);
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
    Logger.log(`🔄 toggleState 호출됨! correctionIndex: ${correctionIndex}`);
    
    if (correctionIndex < 0 || correctionIndex >= this.corrections.length) {
      throw new Error(`Invalid correction index: ${correctionIndex}`);
    }

    const correction = this.corrections[correctionIndex];
    const suggestions = [correction.original, ...correction.corrected];
    const currentValue = this.getValue(correctionIndex);
    const isCurrentlyException = this.isExceptionState(correctionIndex);
    const isCurrentlyOriginalKept = this.isOriginalKeptState(correctionIndex);
    
    Logger.log('toggleState Initial state:', {
      correctionIndex,
      currentValue,
      isCurrentlyException,
      isCurrentlyOriginalKept,
      originalText: correction.original,
      suggestions
    });

    let newValue: string;
    let newIsException: boolean;
    let newIsOriginalKept: boolean;

    // 1. 원본유지 상태에서 오류 상태로
    if (isCurrentlyOriginalKept) {
        newValue = correction.original;
        newIsException = false;
        newIsOriginalKept = false;
        Logger.log('toggleState OriginalKept -> Error');
    }
    // 2. 예외처리 상태에서 원본유지 상태로
    else if (isCurrentlyException) {
        newValue = correction.original;
        newIsException = false;
        newIsOriginalKept = true;
        Logger.log('toggleState Exception -> OriginalKept');
    }
    else {
        // 3. 현재 값의 다음 제안으로 이동
        let nextIndex = suggestions.indexOf(currentValue) + 1;

        if (nextIndex >= suggestions.length) {
            // 마지막 제안에서 예외처리 상태로
            newValue = correction.original;
            newIsException = true;
            newIsOriginalKept = false;
            Logger.log('toggleState Last Suggestion -> Exception');
        } else {
            // 4. 다음 제안으로 이동 (오류 → 첫 번째 수정안, 수정안 → 다음 수정안)
            newValue = suggestions[nextIndex];
            newIsException = false;
            newIsOriginalKept = false;
            Logger.log('toggleState Next Suggestion:', newValue);
        }
    }

    // 같은 원본 텍스트를 가진 모든 교정 항목에 동일한 상태 적용 (일괄 시각적 업데이트)
    this.syncSameWordStates(correction.original, newValue, newIsException, newIsOriginalKept);

    return { value: newValue, isExceptionState: newIsException };
  }

  /**
   * 4단계 역방향 토글을 수행합니다.
   * - 오류(빨간색) → 원본유지(주황색) → 예외처리(파란색) → 수정N, 수정1(초록색) → 오류(빨간색)
   * @param correctionIndex 교정 인덱스
   * @returns 새로운 상태 정보
   */
  toggleStatePrev(correctionIndex: number): { value: string; isExceptionState: boolean } {
    Logger.log(`🔄 toggleStatePrev 호출됨! correctionIndex: ${correctionIndex}`);
    
    if (correctionIndex < 0 || correctionIndex >= this.corrections.length) {
      throw new Error(`Invalid correction index: ${correctionIndex}`);
    }

    const correction = this.corrections[correctionIndex];
    const suggestions = [correction.original, ...correction.corrected];
    const currentValue = this.getValue(correctionIndex);
    const isCurrentlyException = this.isExceptionState(correctionIndex);
    const isCurrentlyOriginalKept = this.isOriginalKeptState(correctionIndex);
    
    Logger.log('toggleStatePrev Initial state:', {
      correctionIndex,
      currentValue,
      isCurrentlyException,
      isCurrentlyOriginalKept,
      originalText: correction.original,
      suggestions
    });

    let newValue: string;
    let newIsException: boolean;
    let newIsOriginalKept: boolean;

    // 1. 오류 상태에서 원본유지 상태로 (역방향)
    if (currentValue === correction.original && !isCurrentlyException && !isCurrentlyOriginalKept) {
        newValue = correction.original;
        newIsException = false;
        newIsOriginalKept = true;
        Logger.log('toggleStatePrev Error -> OriginalKept');
    }
    // 2. 원본유지 상태에서 예외처리 상태로
    else if (isCurrentlyOriginalKept) {
        newValue = correction.original;
        newIsException = true;
        newIsOriginalKept = false;
        Logger.log('toggleStatePrev OriginalKept -> Exception');
    }
    // 3. 예외처리 상태에서 마지막 제안으로
    else if (isCurrentlyException) {
        if (correction.corrected.length > 0) {
            newValue = correction.corrected[correction.corrected.length - 1]; // 마지막 제안
            newIsException = false;
            newIsOriginalKept = false;
            Logger.log('toggleStatePrev Exception -> Last Suggestion');
        } else {
            // 제안이 없으면 오류 상태로
            newValue = correction.original;
            newIsException = false;
            newIsOriginalKept = false;
            Logger.log('toggleStatePrev Exception -> Error (no suggestions)');
        }
    }
    else {
        // 4. 현재 값의 이전 제안으로 이동 (수정안들 간 역순환)
        let currentIndex = suggestions.indexOf(currentValue);
        let prevIndex = currentIndex - 1;

        if (prevIndex < 0) {
            // 첫 번째 제안에서 오류 상태로
            newValue = correction.original;
            newIsException = false;
            newIsOriginalKept = false;
            Logger.log('toggleStatePrev First Suggestion -> Error');
        } else {
            // 이전 제안으로 이동
            newValue = suggestions[prevIndex];
            newIsException = false;
            newIsOriginalKept = false;
            Logger.log('toggleStatePrev Previous Suggestion:', newValue);
        }
    }

    // 같은 원본 텍스트를 가진 모든 교정 항목에 동일한 상태 적용 (일괄 시각적 업데이트)
    this.syncSameWordStates(correction.original, newValue, newIsException, newIsOriginalKept);

    return { value: newValue, isExceptionState: newIsException };
  }

  /**
   * 같은 원본 텍스트를 가진 모든 교정 항목의 상태를 동기화합니다.
   * @param originalText 원본 텍스트
   * @param newValue 새로운 값
   * @param isException 예외 처리 상태
   * @param isOriginalKept 원본 유지 상태
   */
  private syncSameWordStates(originalText: string, newValue: string, isException: boolean, isOriginalKept: boolean): void {
    let syncedCount = 0;
    
    // 핵심 단어 추출 (괄호, 조사 등 제거)
    const coreWord = this.extractCoreWord(originalText);
    
    Logger.log(`=== 동기화 시작 ===`);
    Logger.log(`원본: "${originalText}", 핵심: "${coreWord}"`);
    Logger.log(`전체 교정 개수: ${this.corrections.length}`);
    
    for (let i = 0; i < this.corrections.length; i++) {
      const targetOriginal = this.corrections[i].original;
      const targetCoreWord = this.extractCoreWord(targetOriginal);
      
      Logger.log(`교정 ${i}: "${targetOriginal}" → 핵심: "${targetCoreWord}"`);
      
      // 핵심 단어가 같은 경우 동기화
      if (targetCoreWord === coreWord) {
        Logger.log(`  → 매치! 동기화 실행`);
        this.setState(i, newValue, isException, isOriginalKept);
        syncedCount++;
      } else {
        Logger.log(`  → 매치 안됨 ("${targetCoreWord}" ≠ "${coreWord}")`);
      }
    }
    
    Logger.log(`같은 단어 일괄 시각적 업데이트: "${originalText}" (핵심: "${coreWord}") → "${newValue}" (${syncedCount}개 항목)`);
  }

  /**
   * 텍스트에서 핵심 단어를 추출합니다.
   * @param text 원본 텍스트
   * @returns 핵심 단어
   */
  private extractCoreWord(text: string): string {
    // 1. 괄호와 그 내용 제거: "지킬(Jekyll)" → "지킬"
    let coreWord = text.replace(/\([^)]*\)/g, '');
    
    // 2. 일반적인 한국어 조사 제거: "지킬로", "지킬은", "지킬이" → "지킬"
    const particles = ['은', '는', '이', '가', '을', '를', '에', '에서', '로', '으로', '와', '과', '도', '만', '까지', '부터', '처럼', '같이', '보다', '마다', '조차', '마저', '라도', '나마', '이나', '거나'];
    
    for (const particle of particles) {
      if (coreWord.endsWith(particle)) {
        coreWord = coreWord.slice(0, -particle.length);
        break; // 하나의 조사만 제거
      }
    }
    
    // 3. 공백 제거
    coreWord = coreWord.trim();
    
    Logger.log(`핵심 단어 추출: "${text}" → "${coreWord}"`);
    return coreWord;
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
        Logger.log(`DisplayClass for ${correction.original} (index ${correctionIndex}): spell-original-kept`);
        return 'spell-original-kept';
    }

    const currentValue = this.getValue(correctionIndex);
    const isException = this.isExceptionState(correctionIndex);

    if (currentValue === correction.original) {
      const className = isException ? 'spell-exception-processed' : 'spell-error';
      Logger.log(`DisplayClass for ${correction.original} (index ${correctionIndex}): ${className}`);
      return className;
    } else {
      Logger.log(`DisplayClass for ${correction.original} (index ${correctionIndex}): spell-corrected`);
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
  getAllStates(): { [key: number]: { state: 'error' | 'corrected' | 'exception-processed' | 'original-kept', value: string } } {
    const allStates: { [key: number]: { state: 'error' | 'corrected' | 'exception-processed' | 'original-kept', value: string } } = {};
    for (let i = 0; i < this.corrections.length; i++) {
      const correction = this.corrections[i];
      const value = this.getValue(i);
      let state: 'error' | 'corrected' | 'exception-processed' | 'original-kept';

      if (this.isOriginalKeptState(i)) {
        state = 'original-kept';
      } else if (this.isExceptionState(i)) {
        state = 'exception-processed';
      } else if (value !== correction.original) {
        state = 'corrected';
      } else {
        state = 'error';
      }
      
      allStates[i] = { state, value };
    }
    return allStates;
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
        // 모든 발생 위치를 일괄 수정 (자동 일괄 수정)
        finalText = this.replaceAllOccurrences(finalText, correction.original, selectedValue);
      }
    }
    
    return { finalText, exceptionWords };
  }

  /**
   * 텍스트에서 모든 발생 위치를 안전하게 교체합니다.
   * @param text 대상 텍스트
   * @param original 원본 문자열
   * @param replacement 교체할 문자열
   * @returns 교체된 텍스트
   */
  private replaceAllOccurrences(text: string, original: string, replacement: string): string {
    // 정확한 단어 경계를 고려한 교체
    // 단순 replaceAll 대신 정규식을 사용하여 더 정확한 매칭
    
    // 특수 문자 이스케이프 처리
    const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // 전역 교체 (모든 발생 위치)
    const regex = new RegExp(escapedOriginal, 'g');
    const result = text.replace(regex, replacement);
    
    // 교체 결과 로깅
    const occurrences = (text.match(regex) || []).length;
    if (occurrences > 0) {
      Logger.log(`일괄 수정: "${original}" → "${replacement}" (${occurrences}개 위치)`);
    }
    
    return result;
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