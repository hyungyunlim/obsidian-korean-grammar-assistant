import { Correction, CorrectionState } from '../types/interfaces';
import { Logger } from '../utils/logger';

/**
 * 교정 상태 관리 클래스
 */
export class CorrectionStateManager {
  private states: Map<string | number, any> = new Map();
  private corrections: Correction[] = [];
  private ignoredWords: string[] = [];
  private userEditedValues: Map<number, string> = new Map();

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
        Logger.debug(`Initializing: ${correction.original} at index ${index} as ${isOriginalKept ? 'ORIGINAL_KEPT' : 'ERROR'}.`);
    });
  }

  /**
   * 특정 교정의 상태를 설정합니다.
   * @param correctionIndex 교정 인덱스
   * @param value 설정할 값
   * @param isExceptionState 예외 처리 상태 여부
   * @param isOriginalKept 원본유지 상태 여부
   * @param isUserEdited 사용자 편집 상태 여부
   */
  setState(correctionIndex: number, value: string, isExceptionState: boolean = false, isOriginalKept: boolean = false, isUserEdited: boolean = false): void {
    // 호출 위치 추적을 위한 스택 트레이스
    const stack = new Error().stack;
    const caller = stack?.split('\n')[2]?.trim() || 'unknown';
    
    Logger.debug(`🔧 setState 호출됨: index=${correctionIndex}, value="${value}", isUserEdited=${isUserEdited}, caller=${caller}`);
    
    this.states.set(correctionIndex, value);
    
    const exceptionKey = `${correctionIndex}_exception`;
    const originalKeptKey = `${correctionIndex}_originalKept`;
    const userEditedKey = `${correctionIndex}_userEdited`;

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

    if (isUserEdited) {
        this.states.set(userEditedKey, true);
        this.userEditedValues.set(correctionIndex, value);
        Logger.debug(`🔧 setState: 사용자 편집 상태 설정 - userEditedKey="${userEditedKey}", value="${value}"`);
    } else {
        // 사용자 편집 상태가 해제되는 경우 추적
        const wasUserEdited = this.states.has(userEditedKey);
        const existingUserValue = this.userEditedValues.get(correctionIndex);
        
        this.states.delete(userEditedKey);
        // 중요: userEditedValues는 삭제하지 않고 보존 - 토글 순환에서 재사용
        // this.userEditedValues.delete(correctionIndex); // 삭제하지 않음
        
        if (wasUserEdited) {
          Logger.debug(`🔧 setState: 사용자 편집 상태 해제 (편집값 보존) - userEditedKey="${userEditedKey}", 보존값="${existingUserValue}", caller=${caller}`);
        }
    }
  }

  /**
   * 특정 교정의 현재 값을 가져옵니다.
   * @param correctionIndex 교정 인덱스
   * @returns 현재 값
   */
  getValue(correctionIndex: number): string {
    const isUserEdited = this.isUserEditedState(correctionIndex);
    const userEditedValue = this.userEditedValues.get(correctionIndex);
    const statesValue = this.states.get(correctionIndex) || '';
    
    // 사용자 편집 상태이고 편집값이 있으면 편집값 반환, 없으면 상태값 반환
    const finalValue = isUserEdited && userEditedValue !== undefined ? userEditedValue : statesValue;
    
    // 디버깅: 사용자 편집 상태인데 편집값이 없는 경우 경고
    if (isUserEdited && !userEditedValue) {
      Logger.warn(`⚠️ 사용자 편집 상태인데 편집값이 없음: index=${correctionIndex}`);
    }
    
    Logger.debug(`getValue(${correctionIndex}): states="${statesValue}", userEdited=${isUserEdited}, userEditedValue="${userEditedValue}", finalValue="${finalValue}"`);
    return finalValue;
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
   * 특정 교정이 사용자 편집 상태인지 확인합니다.
   * @param correctionIndex 교정 인덱스
   * @returns 사용자 편집 상태 여부
   */
  isUserEditedState(correctionIndex: number): boolean {
    const userEditedKey = `${correctionIndex}_userEdited`;
    return !!this.states.get(userEditedKey);
  }

  /**
   * 사용자 편집된 값을 설정합니다.
   * @param correctionIndex 교정 인덱스
   * @param userValue 사용자가 입력한 값
   */
  setUserEdited(correctionIndex: number, userValue: string): void {
    Logger.debug(`🔧 setUserEdited 호출: index=${correctionIndex}, value="${userValue}"`);
    
    const beforeStates = this.states.get(correctionIndex);
    const beforeUserEdited = this.isUserEditedState(correctionIndex);
    const beforeUserValue = this.userEditedValues.get(correctionIndex);
    
    Logger.debug(`🔧 Before setState: states="${beforeStates}", userEdited=${beforeUserEdited}, userValue="${beforeUserValue}"`);
    
    // 중요: syncSameWordStates 호출하지 않고 직접 설정
    this.setState(correctionIndex, userValue, false, false, true);
    
    // 동기화는 하지 않음 - 사용자 편집은 개별 항목에만 적용
    Logger.debug(`🔧 사용자 편집은 동기화하지 않음 - 개별 항목만 적용`);
    
    const afterStates = this.states.get(correctionIndex);
    const afterUserEdited = this.isUserEditedState(correctionIndex);
    const afterUserValue = this.userEditedValues.get(correctionIndex);
    
    Logger.debug(`🔧 After setState: states="${afterStates}", userEdited=${afterUserEdited}, userValue="${afterUserValue}"`);
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
   * 5단계 토글을 수행합니다.
   * - 오류(빨간색) → 수정1, 수정2...(초록색) → 예외처리(파란색) → 원본유지(주황색) → 사용자편집(보라색) → 오류(빨간색)
   * @param correctionIndex 교정 인덱스
   * @returns 새로운 상태 정보
   */
  toggleState(correctionIndex: number): { value: string; isExceptionState: boolean } {
    Logger.debug(`🔄 toggleState 호출됨! correctionIndex: ${correctionIndex}`);
    
    if (correctionIndex < 0 || correctionIndex >= this.corrections.length) {
      throw new Error(`Invalid correction index: ${correctionIndex}`);
    }

    const correction = this.corrections[correctionIndex];
    const suggestions = [correction.original, ...correction.corrected];
    const currentValue = this.getValue(correctionIndex);
    const isCurrentlyException = this.isExceptionState(correctionIndex);
    const isCurrentlyOriginalKept = this.isOriginalKeptState(correctionIndex);
    const isCurrentlyUserEdited = this.isUserEditedState(correctionIndex);
    
    Logger.debug('toggleState Initial state:', {
      correctionIndex,
      currentValue,
      isCurrentlyException,
      isCurrentlyOriginalKept,
      isCurrentlyUserEdited,
      originalText: correction.original,
      suggestions
    });

    let newValue: string;
    let newIsException: boolean;
    let newIsOriginalKept: boolean;
    let newIsUserEdited: boolean;

    // 분기 진단용 상세 로그
    Logger.debug(`🔍 toggleState 분기 진단: isCurrentlyUserEdited=${isCurrentlyUserEdited}, isCurrentlyOriginalKept=${isCurrentlyOriginalKept}, isCurrentlyException=${isCurrentlyException}`);

    // 1. 사용자편집 상태에서 오류 상태로
    if (isCurrentlyUserEdited) {
        Logger.debug('🔄 toggleState 분기 1 진입: UserEdited -> Error');
        newValue = correction.original;
        newIsException = false;
        newIsOriginalKept = false;
        newIsUserEdited = false;
        Logger.debug('toggleState UserEdited -> Error');
    }
    // 2. 원본유지 상태에서 사용자편집 상태로 (편집값이 있는 경우만)
    else if (isCurrentlyOriginalKept) {
        Logger.debug('🔄 toggleState 분기 2 진입: OriginalKept -> ?');
        const userEditedValue = this.userEditedValues.get(correctionIndex);
        
        if (userEditedValue) {
            // 사용자 편집값이 있으면 사용자 편집 상태로
            newValue = userEditedValue;
            newIsException = false;
            newIsOriginalKept = false;
            newIsUserEdited = true;
            Logger.debug(`toggleState OriginalKept -> UserEdited: userEditedValue="${userEditedValue}"`);
        } else {
            // 사용자 편집값이 없으면 오류 상태로 건너뜀
            newValue = correction.original;
            newIsException = false;
            newIsOriginalKept = false;
            newIsUserEdited = false;
            Logger.debug('toggleState OriginalKept -> Error (편집값 없음, 사용자편집 건너뜀)');
        }
    }
    // 3. 예외처리 상태에서 원본유지 상태로
    else if (isCurrentlyException) {
        Logger.debug('🔄 toggleState 분기 3 진입: Exception -> OriginalKept');
        newValue = correction.original;
        newIsException = false;
        newIsOriginalKept = true;
        newIsUserEdited = false;
        Logger.debug('toggleState Exception -> OriginalKept');
    }
    else {
        Logger.debug('🔄 toggleState 분기 4 진입: 제안 순환 로직');
        // 4. 현재 값의 다음 제안으로 이동
        let nextIndex = suggestions.indexOf(currentValue) + 1;

        if (nextIndex >= suggestions.length) {
            // 마지막 제안에서 예외처리 상태로
            newValue = correction.original;
            newIsException = true;
            newIsOriginalKept = false;
            newIsUserEdited = false;
            Logger.debug('toggleState Last Suggestion -> Exception');
        } else {
            // 5. 다음 제안으로 이동 (오류 → 첫 번째 수정안, 수정안 → 다음 수정안)
            newValue = suggestions[nextIndex];
            newIsException = false;
            newIsOriginalKept = false;
            newIsUserEdited = false;
            Logger.debug('toggleState Next Suggestion:', newValue);
        }
    }

    // 사용자 편집 관련 상태 변화는 항상 개별적으로만 적용
    if (isCurrentlyUserEdited || newIsUserEdited) {
      // 사용자 편집 상태에서 나가거나 들어가는 경우는 현재 항목에만 적용
      this.setState(correctionIndex, newValue, newIsException, newIsOriginalKept, newIsUserEdited);
      Logger.debug(`사용자 편집 관련 상태 변화는 개별 적용만 수행: index ${correctionIndex}, from=${isCurrentlyUserEdited} to=${newIsUserEdited}`);
    } else {
      // 일반적인 상태 변화는 동기화
      this.syncSameWordStates(correction.original, newValue, newIsException, newIsOriginalKept, newIsUserEdited, correctionIndex);
    }

    return { value: newValue, isExceptionState: newIsException };
  }

  /**
   * 5단계 역방향 토글을 수행합니다.
   * - 오류(빨간색) → 사용자편집(보라색) → 원본유지(주황색) → 예외처리(파란색) → 수정N, 수정1(초록색) → 오류(빨간색)
   * @param correctionIndex 교정 인덱스
   * @returns 새로운 상태 정보
   */
  toggleStatePrev(correctionIndex: number): { value: string; isExceptionState: boolean } {
    Logger.debug(`🔄 toggleStatePrev 호출됨! correctionIndex: ${correctionIndex}`);
    
    if (correctionIndex < 0 || correctionIndex >= this.corrections.length) {
      throw new Error(`Invalid correction index: ${correctionIndex}`);
    }

    const correction = this.corrections[correctionIndex];
    const suggestions = [correction.original, ...correction.corrected];
    const currentValue = this.getValue(correctionIndex);
    const isCurrentlyException = this.isExceptionState(correctionIndex);
    const isCurrentlyOriginalKept = this.isOriginalKeptState(correctionIndex);
    const isCurrentlyUserEdited = this.isUserEditedState(correctionIndex);
    
    Logger.debug('toggleStatePrev Initial state:', {
      correctionIndex,
      currentValue,
      isCurrentlyException,
      isCurrentlyOriginalKept,
      isCurrentlyUserEdited,
      originalText: correction.original,
      suggestions
    });

    let newValue: string;
    let newIsException: boolean;
    let newIsOriginalKept: boolean;
    let newIsUserEdited: boolean;

    // 1. 오류 상태에서 사용자편집 상태로 (역방향, 편집값이 있는 경우만)
    if (currentValue === correction.original && !isCurrentlyException && !isCurrentlyOriginalKept && !isCurrentlyUserEdited) {
        const userEditedValue = this.userEditedValues.get(correctionIndex);
        
        if (userEditedValue) {
            // 사용자 편집값이 있으면 사용자 편집 상태로
            newValue = userEditedValue;
            newIsException = false;
            newIsOriginalKept = false;
            newIsUserEdited = true;
            Logger.debug(`toggleStatePrev Error -> UserEdited: userEditedValue="${userEditedValue}"`);
        } else {
            // 사용자 편집값이 없으면 원본유지 상태로 건너뜀
            newValue = correction.original;
            newIsException = false;
            newIsOriginalKept = true;
            newIsUserEdited = false;
            Logger.debug('toggleStatePrev Error -> OriginalKept (편집값 없음, 사용자편집 건너뜀)');
        }
    }
    // 2. 사용자편집 상태에서 원본유지 상태로
    else if (isCurrentlyUserEdited) {
        newValue = correction.original;
        newIsException = false;
        newIsOriginalKept = true;
        newIsUserEdited = false;
        Logger.debug('toggleStatePrev UserEdited -> OriginalKept');
    }
    // 3. 원본유지 상태에서 예외처리 상태로
    else if (isCurrentlyOriginalKept) {
        newValue = correction.original;
        newIsException = true;
        newIsOriginalKept = false;
        newIsUserEdited = false;
        Logger.debug('toggleStatePrev OriginalKept -> Exception');
    }
    // 4. 예외처리 상태에서 마지막 제안으로
    else if (isCurrentlyException) {
        if (correction.corrected.length > 0) {
            newValue = correction.corrected[correction.corrected.length - 1]; // 마지막 제안
            newIsException = false;
            newIsOriginalKept = false;
            newIsUserEdited = false;
            Logger.debug('toggleStatePrev Exception -> Last Suggestion');
        } else {
            // 제안이 없고 편집값이 있으면 사용자편집 상태로, 없으면 원본유지 상태로
            const userEditedValue = this.userEditedValues.get(correctionIndex);
            
            if (userEditedValue) {
                newValue = userEditedValue;
                newIsException = false;
                newIsOriginalKept = false;
                newIsUserEdited = true;
                Logger.debug(`toggleStatePrev Exception -> UserEdited (no suggestions): userEditedValue="${userEditedValue}"`);
            } else {
                newValue = correction.original;
                newIsException = false;
                newIsOriginalKept = true;
                newIsUserEdited = false;
                Logger.debug('toggleStatePrev Exception -> OriginalKept (no suggestions, 편집값 없음)');
            }
        }
    }
    else {
        // 5. 현재 값의 이전 제안으로 이동 (수정안들 간 역순환)
        let currentIndex = suggestions.indexOf(currentValue);
        let prevIndex = currentIndex - 1;

        if (prevIndex < 0) {
            // 첫 번째 제안에서 오류 상태로
            newValue = correction.original;
            newIsException = false;
            newIsOriginalKept = false;
            newIsUserEdited = false;
            Logger.debug('toggleStatePrev First Suggestion -> Error');
        } else {
            // 이전 제안으로 이동
            newValue = suggestions[prevIndex];
            newIsException = false;
            newIsOriginalKept = false;
            newIsUserEdited = false;
            Logger.debug('toggleStatePrev Previous Suggestion:', newValue);
        }
    }

    // 사용자 편집 관련 상태 변화는 항상 개별적으로만 적용
    if (isCurrentlyUserEdited || newIsUserEdited) {
      // 사용자 편집 상태에서 나가거나 들어가는 경우는 현재 항목에만 적용
      this.setState(correctionIndex, newValue, newIsException, newIsOriginalKept, newIsUserEdited);
      Logger.debug(`사용자 편집 관련 상태 변화는 개별 적용만 수행: index ${correctionIndex}, from=${isCurrentlyUserEdited} to=${newIsUserEdited}`);
    } else {
      // 일반적인 상태 변화는 동기화
      this.syncSameWordStates(correction.original, newValue, newIsException, newIsOriginalKept, newIsUserEdited, correctionIndex);
    }

    return { value: newValue, isExceptionState: newIsException };
  }

  /**
   * 같은 원본 텍스트를 가진 모든 교정 항목의 상태를 동기화합니다.
   * @param originalText 원본 텍스트
   * @param newValue 새로운 값
   * @param isException 예외 처리 상태
   * @param isOriginalKept 원본 유지 상태
   * @param isUserEdited 사용자 편집 상태
   */
  private syncSameWordStates(originalText: string, newValue: string, isException: boolean, isOriginalKept: boolean, isUserEdited: boolean = false, currentCorrectionIndex?: number): void {
    let syncedCount = 0;
    
    // 핵심 단어 추출 (괄호, 조사 등 제거)
    const coreWord = this.extractCoreWord(originalText);
    
    Logger.debug(`=== 동기화 시작 ===`);
    Logger.debug(`원본: "${originalText}", 핵심: "${coreWord}"`);
    Logger.debug(`전체 교정 개수: ${this.corrections.length}`);
    
    for (let i = 0; i < this.corrections.length; i++) {
      const targetOriginal = this.corrections[i].original;
      const targetCoreWord = this.extractCoreWord(targetOriginal);
      
      Logger.debug(`교정 ${i}: "${targetOriginal}" → 핵심: "${targetCoreWord}"`);
      
      // 핵심 단어가 같은 경우 동기화 (단, 다른 사용자 편집 상태는 개별적으로 유지)
      if (targetCoreWord === coreWord) {
        const existingUserEdited = this.isUserEditedState(i);
        
        if (existingUserEdited && i !== currentCorrectionIndex) {
          // 현재 수정 중인 항목이 아니고, 이미 사용자 편집된 다른 항목은 그대로 유지
          Logger.debug(`  → 매치하지만 기존 사용자 편집 상태 유지 (index ${i})`);
          // 아무것도 하지 않음 - 기존 상태 보존
        } else if (isUserEdited && i !== currentCorrectionIndex) {
          // 새로운 사용자 편집은 다른 항목에 동기화하지 않음
          Logger.debug(`  → 매치하지만 사용자 편집은 개별 항목만 적용 (index ${i})`);
          // 아무것도 하지 않음 - 동기화하지 않음
        } else {
          // 현재 항목이거나 사용자 편집이 아닌 경우에만 동기화
          const shouldPreserveUserEdited = existingUserEdited && !isUserEdited;
          const finalIsUserEdited = shouldPreserveUserEdited ? true : isUserEdited;
          const finalValue = shouldPreserveUserEdited ? this.userEditedValues.get(i) || newValue : newValue;
          
          Logger.debug(`  → 매치! 동기화 실행 (index ${i}), preserveUserEdited=${shouldPreserveUserEdited}, finalIsUserEdited=${finalIsUserEdited}, finalValue="${finalValue}"`);
          this.setState(i, finalValue, isException, isOriginalKept, finalIsUserEdited);
          syncedCount++;
        }
      } else {
        Logger.debug(`  → 매치 안됨 ("${targetCoreWord}" ≠ "${coreWord}")`);
      }
    }
    
    Logger.debug(`같은 단어 일괄 시각적 업데이트: "${originalText}" (핵심: "${coreWord}") → "${newValue}" (${syncedCount}개 항목)`);
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
    
    Logger.debug(`핵심 단어 추출: "${text}" → "${coreWord}"`);
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

    if (this.isUserEditedState(correctionIndex)) {
        Logger.debug(`DisplayClass for ${correction.original} (index ${correctionIndex}): spell-user-edited`);
        return 'spell-user-edited';
    }

    if (this.isOriginalKeptState(correctionIndex)) {
        Logger.debug(`DisplayClass for ${correction.original} (index ${correctionIndex}): spell-original-kept`);
        return 'spell-original-kept';
    }

    const currentValue = this.getValue(correctionIndex);
    const isException = this.isExceptionState(correctionIndex);

    if (currentValue === correction.original) {
      const className = isException ? 'spell-exception-processed' : 'spell-error';
      Logger.debug(`DisplayClass for ${correction.original} (index ${correctionIndex}): ${className}`);
      return className;
    } else {
      Logger.debug(`DisplayClass for ${correction.original} (index ${correctionIndex}): spell-corrected`);
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
  getAllStates(): { [key: number]: { state: 'error' | 'corrected' | 'exception-processed' | 'original-kept' | 'user-edited', value: string } } {
    const allStates: { [key: number]: { state: 'error' | 'corrected' | 'exception-processed' | 'original-kept' | 'user-edited', value: string } } = {};
    for (let i = 0; i < this.corrections.length; i++) {
      const correction = this.corrections[i];
      const value = this.getValue(i);
      let state: 'error' | 'corrected' | 'exception-processed' | 'original-kept' | 'user-edited';

      if (this.isUserEditedState(i)) {
        state = 'user-edited';
      } else if (this.isOriginalKeptState(i)) {
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
    
    Logger.log('🔧 applyCorrections 시작:', {
      originalTextLength: originalText.length,
      correctionsCount: this.corrections.length,
      originalPreview: originalText.substring(0, 100) + (originalText.length > 100 ? '...' : '')
    });
    
    // 역순으로 처리하여 인덱스 변화 방지
    for (let i = this.corrections.length - 1; i >= 0; i--) {
      const correction = this.corrections[i];
      const selectedValue = this.getValue(i);
      const isException = this.isExceptionState(i);
      const isUserEdited = this.isUserEditedState(i);
      
      Logger.debug(`🔧 교정 처리 [${i}]: "${correction.original}" → "${selectedValue}" (userEdited=${isUserEdited}, exception=${isException})`);
      
      if (isException) {
        // 예외 처리된 단어 수집
        if (!exceptionWords.includes(correction.original)) {
          exceptionWords.push(correction.original);
        }
        Logger.debug(`🔧 예외처리로 추가: "${correction.original}"`);
      } else if (selectedValue !== correction.original) {
        // 예외 처리 상태가 아니고, 원본과 다른 값이 선택된 경우에만 교정 적용
        Logger.log(`🔧 텍스트 교체 실행: "${correction.original}" → "${selectedValue}" (userEdited=${isUserEdited})`);
        const beforeReplace = finalText;
        finalText = this.replaceAllOccurrences(finalText, correction.original, selectedValue);
        const changed = beforeReplace !== finalText;
        Logger.debug(`🔧 교체 결과: 변경됨=${changed}, 텍스트길이 ${beforeReplace.length} → ${finalText.length}`);
      } else {
        Logger.debug(`🔧 교정 건너뜀: 원본과 동일하거나 예외처리됨`);
      }
    }
    
    Logger.log('🔧 applyCorrections 완료:', {
      finalTextLength: finalText.length,
      exceptionWordsCount: exceptionWords.length,
      changed: originalText !== finalText,
      finalPreview: finalText.substring(0, 100) + (finalText.length > 100 ? '...' : '')
    });
    
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
      Logger.debug(`일괄 수정: "${original}" → "${replacement}" (${occurrences}개 위치)`);
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