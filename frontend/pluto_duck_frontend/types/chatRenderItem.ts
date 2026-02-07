/**
 * Chat UI 독립적 렌더링을 위한 타입 정의
 * Turn 기반 그룹핑 없이 개별 요소로 렌더링
 */

/**
 * 모든 렌더 아이템의 기본 속성
 */
export interface BaseRenderItem {
  /** 고유 식별자 */
  id: string;
  /** API 스트리밍 연결 키 (runId) */
  runId: string | null;
  /** 전역 정렬 순서 */
  seq: number;
  /** 표시 시간 */
  timestamp: string;
  /** 개별 스트리밍 상태 */
  isStreaming: boolean;
}

/**
 * 유저 메시지 아이템
 */
export interface UserMessageItem extends BaseRenderItem {
  type: 'user-message';
  /** 메시지 내용 */
  content: string;
  /** @mentions 목록 */
  mentions?: string[];
  /** 원본 메시지 ID */
  messageId: string;
}

/**
 * Reasoning 아이템
 */
export interface ReasoningItem extends BaseRenderItem {
  type: 'reasoning';
  /** Reasoning 텍스트 */
  content: string;
  /** 스트리밍 단계 */
  phase: 'streaming' | 'complete';
}

/**
 * Tool 호출 아이템
 */
export interface ToolItem extends BaseRenderItem {
  type: 'tool';
  /** 툴 이름 */
  toolName: string;
  /** 툴 실행 상태 */
  state: 'pending' | 'completed' | 'error';
  /** 툴 입력값 */
  input?: unknown;
  /** 툴 출력값 */
  output?: unknown;
  /** 에러 메시지 */
  error?: string;
}

/**
 * 어시스턴트 메시지 아이템
 */
export interface AssistantMessageItem extends BaseRenderItem {
  type: 'assistant-message';
  /** 메시지 내용 */
  content: string;
  /** 원본 메시지 ID */
  messageId: string;
}

/**
 * 독립적으로 렌더링 가능한 채팅 아이템 Union Type
 */
export type ChatRenderItem =
  | UserMessageItem
  | ReasoningItem
  | ToolItem
  | AssistantMessageItem;

/**
 * 아이템 타입 가드 함수들
 */
export function isUserMessageItem(item: ChatRenderItem): item is UserMessageItem {
  return item.type === 'user-message';
}

export function isReasoningItem(item: ChatRenderItem): item is ReasoningItem {
  return item.type === 'reasoning';
}

export function isToolItem(item: ChatRenderItem): item is ToolItem {
  return item.type === 'tool';
}

export function isAssistantMessageItem(item: ChatRenderItem): item is AssistantMessageItem {
  return item.type === 'assistant-message';
}
