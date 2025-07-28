/**
 * 인라인 모드 전용 타입 정의
 * 기존 interfaces.ts와 호환성을 유지하면서 확장
 */

import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { InlineError, Correction, AIAnalysisResult } from '../../types/interfaces';

// 기존 InlineError를 확장한 강화된 타입
export interface EnhancedInlineError extends InlineError {
  // UI 상태 관련
  isHovered?: boolean;
  isFocused?: boolean;
  
  // 데코레이션 관련
  decoration?: Decoration;
  widget?: WidgetType;
  
  // 성능 최적화 관련
  lastUpdate?: number;
  shouldUpdate?: boolean;
}

// 인라인 모드 전체 상태
export interface InlineModeState {
  isActive: boolean;
  activeErrors: Map<string, EnhancedInlineError>;
  focusedErrorId: string | null;
  aiAnalysisInProgress: boolean;
  lastAnalysisTime: number;
}

// 데코레이션 타입 구분
export type DecorationTypeEnum = 'error' | 'ai-corrected' | 'focus' | 'hover';

// 이벤트 타입 정의
export interface InlineEventData {
  errorId: string;
  eventType: 'click' | 'hover' | 'focus' | 'blur';
  position: { x: number; y: number };
  element: HTMLElement;
}

// 상태 업데이트 효과
export interface InlineStateUpdate {
  type: 'add' | 'remove' | 'update' | 'clear';
  errorId?: string;
  error?: EnhancedInlineError;
  updates?: Partial<EnhancedInlineError>;
}

// StateEffect 타입 정의
export const InlineStateEffect = StateEffect.define<InlineStateUpdate>();

// 설정 옵션
export interface InlineModeConfig {
  enableHover: boolean;
  enableKeyboard: boolean;
  autoFocus: boolean;
  debounceMs: number;
  maxErrors: number;
}

// 성능 메트릭
export interface InlinePerformanceMetrics {
  decorationUpdateTime: number;
  eventProcessingTime: number;
  errorCount: number;
  lastUpdateTimestamp: number;
}