/**
 * 데코레이션 매니저
 * 모든 데코레이션의 생성, 업데이트, 삭제를 관리
 */

import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { Range } from '@codemirror/state';
import { StateField, StateEffect } from '@codemirror/state';
import { EnhancedInlineError, InlineStateEffect } from '../types/InlineTypes';
import { InlineError } from '../../types/interfaces';
import { ErrorDecoration } from './ErrorDecoration';
import { Logger } from '../../utils/logger';

/**
 * 데코레이션 상태 필드
 * CodeMirror의 상태 관리와 통합
 */
export const decorationState = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  
  update(decorations, tr) {
    // 문서 변경에 따른 데코레이션 위치 조정
    decorations = decorations.map(tr.changes);
    
    // 상태 효과에 따른 데코레이션 업데이트
    for (let effect of tr.effects) {
      if (effect.is(InlineStateEffect)) {
        const manager = DecorationManager.getInstance();
        decorations = manager.applyStateEffect(decorations, effect.value);
      }
    }
    
    return decorations;
  },
  
  provide: f => EditorView.decorations.from(f)
});

/**
 * 데코레이션 매니저 클래스
 */
export class DecorationManager {
  private static instance: DecorationManager;
  private errorDecoration: ErrorDecoration;
  private currentView: EditorView | null = null;
  private focusedErrorId: string | null = null;
  
  private constructor() {
    this.errorDecoration = ErrorDecoration.getInstance();
  }
  
  public static getInstance(): DecorationManager {
    if (!DecorationManager.instance) {
      DecorationManager.instance = new DecorationManager();
    }
    return DecorationManager.instance;
  }
  
  /**
   * 초기화
   */
  initialize(view: EditorView): void {
    this.currentView = view;
    Logger.log('DecorationManager: 초기화 완료');
  }
  
  /**
   * 상태 효과 적용
   */
  applyStateEffect(decorations: DecorationSet, update: any): DecorationSet {
    switch (update.type) {
      case 'add':
        return this.addErrorDecoration(decorations, update.error);
      case 'remove':
        return this.removeErrorDecoration(decorations, update.errorId);
      case 'update':
        return this.updateErrorDecoration(decorations, update.errorId, update.updates);
      case 'clear':
        return Decoration.none;
      default:
        return decorations;
    }
  }
  
  /**
   * 오류 데코레이션 추가
   */
  private addErrorDecoration(decorations: DecorationSet, error: InlineError): DecorationSet {
    try {
      const decoration = this.errorDecoration.createDecoration(error, this.focusedErrorId || undefined);
      
      Logger.log('DecorationManager: 데코레이션 추가', {
        errorId: error.uniqueId,
        start: error.start,
        end: error.end
      });
      
      return decorations.update({
        add: [decoration.range(error.start, error.end)]
      });
      
    } catch (error) {
      Logger.error('DecorationManager: 데코레이션 추가 실패', error);
      return decorations;
    }
  }
  
  /**
   * 오류 데코레이션 제거
   */
  private removeErrorDecoration(decorations: DecorationSet, errorId: string): DecorationSet {
    try {
      Logger.log('DecorationManager: 데코레이션 제거', { errorId });
      
      // 해당 errorId를 가진 데코레이션을 찾아서 제거
      const toRemove: any[] = [];
      decorations.between(0, this.currentView?.state.doc.length || 0, (from, to, decoration) => {
        const attrs = (decoration as any).spec?.attributes;
        if (attrs && attrs['data-error-id'] === errorId) {
          toRemove.push(decoration.range(from, to));
        }
      });
      
      return decorations.update({
        filter: (from, to, decoration) => {
          const attrs = (decoration as any).spec?.attributes;
          return !(attrs && attrs['data-error-id'] === errorId);
        }
      });
      
    } catch (error) {
      Logger.error('DecorationManager: 데코레이션 제거 실패', error);
      return decorations;
    }
  }
  
  /**
   * 오류 데코레이션 업데이트
   */
  private updateErrorDecoration(
    decorations: DecorationSet, 
    errorId: string, 
    updates: Partial<InlineError>
  ): DecorationSet {
    try {
      Logger.log('DecorationManager: 데코레이션 업데이트', { errorId, updates });
      
      // 기존 데코레이션 제거 후 새로운 데코레이션 추가
      let updated = this.removeErrorDecoration(decorations, errorId);
      
      // 업데이트된 오류 정보로 새 데코레이션 생성
      // 실제 구현에서는 오류 정보를 어딘가에서 가져와야 함
      // TODO: 상태 관리자와 연동 필요
      
      return updated;
      
    } catch (error) {
      Logger.error('DecorationManager: 데코레이션 업데이트 실패', error);
      return decorations;
    }
  }
  
  /**
   * 모든 오류에 대한 데코레이션 생성
   */
  createAllDecorations(errors: Map<string, InlineError>): Range<Decoration>[] {
    const decorations: Range<Decoration>[] = [];
    
    for (const [errorId, error] of errors) {
      try {
        const decoration = this.errorDecoration.createDecoration(error, this.focusedErrorId || undefined);
        decorations.push(decoration.range(error.start, error.end));
      } catch (err) {
        Logger.error('DecorationManager: 개별 데코레이션 생성 실패', { errorId, error: err });
      }
    }
    
    Logger.log('DecorationManager: 전체 데코레이션 생성 완료', { count: decorations.length });
    return decorations;
  }
  
  /**
   * 포커스된 오류 설정
   */
  setFocusedError(errorId: string | null): void {
    const previousFocusedId = this.focusedErrorId;
    this.focusedErrorId = errorId;
    
    Logger.log('DecorationManager: 포커스 변경', {
      previous: previousFocusedId,
      current: errorId
    });
    
    // 뷰가 있으면 즉시 업데이트
    if (this.currentView) {
      this.updateFocusDecorations(previousFocusedId, errorId);
    }
  }
  
  /**
   * 포커스 데코레이션 업데이트
   */
  private updateFocusDecorations(previousId: string | null, currentId: string | null): void {
    if (!this.currentView) return;
    
    const effects: StateEffect<any>[] = [];
    
    // 이전 포커스 제거
    if (previousId) {
      effects.push(InlineStateEffect.of({
        type: 'update',
        errorId: previousId,
        updates: { isFocused: false }
      }));
    }
    
    // 새 포커스 설정
    if (currentId) {
      effects.push(InlineStateEffect.of({
        type: 'update',
        errorId: currentId,
        updates: { isFocused: true }
      }));
    }
    
    // 상태 업데이트 디스패치
    if (effects.length > 0) {
      this.currentView.dispatch({ effects });
    }
  }
  
  /**
   * 모든 데코레이션 제거
   */
  clearAllDecorations(): void {
    if (!this.currentView) return;
    
    Logger.log('DecorationManager: 모든 데코레이션 제거');
    
    this.currentView.dispatch({
      effects: InlineStateEffect.of({ type: 'clear' })
    });
    
    this.focusedErrorId = null;
  }
  
  /**
   * 데코레이션 업데이트 (외부 호출용)
   */
  updateDecorations(errors: Map<string, InlineError>): void {
    if (!this.currentView) {
      Logger.warn('DecorationManager: 뷰가 없어 데코레이션을 업데이트할 수 없음');
      return;
    }
    
    Logger.log('DecorationManager: 데코레이션 업데이트 시작', { errorCount: errors.size });
    
    // 모든 기존 데코레이션 제거
    this.clearAllDecorations();
    
    // 새 데코레이션 추가
    const effects: StateEffect<any>[] = [];
    for (const [errorId, error] of errors) {
      effects.push(InlineStateEffect.of({
        type: 'add',
        error: error
      }));
    }
    
    if (effects.length > 0) {
      this.currentView.dispatch({ effects });
    }
    
    Logger.log('DecorationManager: 데코레이션 업데이트 완료');
  }
  
  /**
   * 현재 뷰 반환
   */
  getCurrentView(): EditorView | null {
    return this.currentView;
  }
  
  /**
   * 디버그 정보
   */
  getDebugInfo(): any {
    return {
      hasView: !!this.currentView,
      focusedErrorId: this.focusedErrorId,
      viewStateLength: this.currentView?.state.doc.length || 0
    };
  }
}