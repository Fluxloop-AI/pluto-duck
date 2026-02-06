/**
 * Chat UI 렌더링을 위한 유틸리티 함수들
 * Turn 기반 구조를 Flat Array로 변환
 */

import type { ChatTurn } from '../hooks/useMultiTabChat';
import type {
  ChatRenderItem,
  UserMessageItem,
  ReasoningItem,
  ToolItem,
  AssistantMessageItem,
} from '../types/chatRenderItem';

/**
 * 다양한 형태의 content에서 텍스트 추출
 */
export function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (content?.text) return content.text;
  if (content?.content) return extractText(content.content);
  return JSON.stringify(content);
}

/**
 * 텍스트에서 @mention 추출
 */
export function extractMentions(text: string): string[] {
  const mentionRegex = /@([\w-]+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

/**
 * ChatTurn 배열을 flat한 ChatRenderItem 배열로 변환
 * API 의존성(runId) 유지하면서 UI만 독립적으로 렌더링
 */
export function flattenTurnsToRenderItems(turns: ChatTurn[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let globalSeq = 0;

  turns.forEach(turn => {
    const baseRunId = turn.runId;
    const isActive = turn.isActive;

    // 1. User Messages
    turn.userMessages.forEach(msg => {
      const content = extractText(msg.content);
      const mentions = extractMentions(content);

      const item: UserMessageItem = {
        id: `user-${msg.id}`,
        type: 'user-message',
        runId: baseRunId,
        seq: globalSeq++,
        timestamp: msg.created_at,
        content,
        mentions: mentions.length > 0 ? mentions : undefined,
        messageId: msg.id,
        isStreaming: false, // 유저 메시지는 스트리밍 없음
      };
      items.push(item);
    });

    // 2. Reasoning (존재하거나 스트리밍 중이면)
    if (turn.reasoningText || isActive) {
      const item: ReasoningItem = {
        id: `reasoning-${baseRunId || turn.key}`,
        type: 'reasoning',
        runId: baseRunId,
        seq: globalSeq++,
        timestamp: new Date().toISOString(),
        content: turn.reasoningText || '',
        phase: isActive ? 'streaming' : 'complete',
        isStreaming: isActive && !turn.assistantMessages.length,
      };
      items.push(item);
    }

    // 3. Tools (개별적으로)
    turn.groupedToolEvents.forEach((tool, idx) => {
      const item: ToolItem = {
        id: `tool-${baseRunId || turn.key}-${idx}`,
        type: 'tool',
        runId: baseRunId,
        seq: globalSeq++,
        timestamp: tool.startEvent?.timestamp || new Date().toISOString(),
        toolName: tool.toolName,
        state: tool.state,
        input: tool.input,
        output: tool.output,
        error: tool.error,
        isStreaming: tool.state === 'pending' && isActive,
      };
      items.push(item);
    });

    // 4. Assistant Messages (streaming fallback first)
    if (!turn.assistantMessages.length && turn.streamingAssistantText) {
      const item: AssistantMessageItem = {
        id: `assistant-stream-${baseRunId || turn.key}`,
        type: 'assistant-message',
        runId: baseRunId,
        seq: globalSeq++,
        timestamp: new Date().toISOString(),
        content: turn.streamingAssistantText,
        messageId: `stream-${baseRunId || turn.key}`,
        isStreaming: isActive && !turn.streamingAssistantFinal,
      };
      items.push(item);
    }

    turn.assistantMessages.forEach(msg => {
      const item: AssistantMessageItem = {
        id: `assistant-${msg.id}`,
        type: 'assistant-message',
        runId: baseRunId,
        seq: globalSeq++,
        timestamp: msg.created_at,
        content: extractText(msg.content),
        messageId: msg.id,
        isStreaming: isActive,
      };
      items.push(item);
    });
  });

  return items;
}

/**
 * RenderItem 배열에서 마지막 어시스턴트 메시지 아이템 찾기
 */
export function findLastAssistantItem(items: ChatRenderItem[]): AssistantMessageItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'assistant-message') {
      return items[i] as AssistantMessageItem;
    }
  }
  return null;
}

/**
 * runId가 변경되었는지 확인 (시각적 그룹핑용)
 */
export function isRunIdChanged(current: ChatRenderItem, next: ChatRenderItem | undefined): boolean {
  if (!next) return true;
  return current.runId !== next.runId;
}
