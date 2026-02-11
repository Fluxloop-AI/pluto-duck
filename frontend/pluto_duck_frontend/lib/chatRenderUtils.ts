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
  ToolGroupItem,
  AssistantMessageItem,
  ApprovalItem,
} from '../types/chatRenderItem';
import type { TimelineItem } from '../types/chatTimelineItem';
import {
  buildTimelineItemsFromTurns,
  type TimelineTurnEnvelope,
} from './chatTimelineReducer.ts';
import {
  LEGACY_STREAMING_ASSISTANT_ITEM_ID_PREFIX,
  STREAMING_ASSISTANT_MESSAGE_ID_PREFIX,
} from './chatStreamingIds.ts';

/**
 * 다양한 형태의 content에서 텍스트 추출
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (isRecord(content) && typeof content.text === 'string') return content.text;
  if (isRecord(content) && content.content !== undefined) return extractText(content.content);
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

function toTimelineTurns(turns: ChatTurn[]): TimelineTurnEnvelope[] {
  return turns.map(turn => ({
    runId: turn.runId,
    userMessages: turn.userMessages,
    assistantMessages: turn.assistantMessages,
    events: turn.events,
    isActive: turn.isActive,
    streamingAssistantText: turn.streamingAssistantText,
    streamingAssistantFinal: turn.streamingAssistantFinal,
  }));
}

function toApprovalDecision(value: unknown): ApprovalItem['decision'] {
  if (value === 'approved' || value === 'approve') return 'approved';
  if (value === 'rejected' || value === 'reject') return 'rejected';
  return 'pending';
}

function toRenderItemsFromTimeline(timelineItems: TimelineItem[]): ChatRenderItem[] {
  const renderItems: ChatRenderItem[] = [];
  timelineItems.forEach((item, index) => {
    if (item.type === 'user-message') {
      const userItem: UserMessageItem = {
        id: item.id,
        type: 'user-message',
        runId: item.runId,
        seq: index,
        timestamp: item.timestamp,
        content: item.content,
        mentions: item.mentions && item.mentions.length > 0 ? item.mentions : undefined,
        messageId: item.messageId,
        isStreaming: item.isStreaming,
      };
      renderItems.push(userItem);
      return;
    }
    if (item.type === 'reasoning') {
      const reasoningItem: ReasoningItem = {
        id: item.id,
        type: 'reasoning',
        runId: item.runId,
        seq: index,
        timestamp: item.timestamp,
        content: item.content,
        phase: item.status === 'complete' ? 'complete' : 'streaming',
        isStreaming: item.isStreaming,
      };
      renderItems.push(reasoningItem);
      return;
    }
    if (item.type === 'tool') {
      const toolItem: ToolItem = {
        id: item.id,
        type: 'tool',
        runId: item.runId,
        seq: index,
        timestamp: item.timestamp,
        toolName: item.toolName,
        state: item.state,
        input: item.input,
        output: item.output,
        error: item.error,
        isStreaming: item.isStreaming,
      };
      renderItems.push(toolItem);
      return;
    }
    if (item.type === 'assistant-message') {
      const assistantItem: AssistantMessageItem = {
        id: item.id,
        type: 'assistant-message',
        runId: item.runId,
        seq: index,
        timestamp: item.timestamp,
        content: item.content,
        messageId: item.messageId ?? item.id,
        isStreaming: item.isStreaming,
      };
      renderItems.push(assistantItem);
      return;
    }
    if (item.type === 'approval') {
      const approvalItem: ApprovalItem = {
        id: item.id,
        type: 'approval',
        runId: item.runId,
        seq: index,
        timestamp: item.timestamp,
        content: item.content,
        decision: toApprovalDecision(item.decision),
        isStreaming: item.isStreaming,
      };
      renderItems.push(approvalItem);
    }
  });
  return renderItems;
}

export function deriveGroupState(children: ToolItem[]): ToolGroupItem['state'] {
  if (children.some(child => child.state === 'error')) {
    return 'error';
  }
  if (children.some(child => child.state === 'pending')) {
    return 'pending';
  }
  return 'completed';
}

export function groupConsecutiveTools(items: ChatRenderItem[]): ChatRenderItem[] {
  const groupedItems: ChatRenderItem[] = [];
  let index = 0;

  while (index < items.length) {
    const current = items[index];
    if (current.type !== 'tool') {
      groupedItems.push(current);
      index += 1;
      continue;
    }

    const children: ToolItem[] = [current];
    let cursor = index + 1;

    while (cursor < items.length) {
      const candidate = items[cursor];
      if (candidate.type !== 'tool') {
        break;
      }
      if (candidate.runId !== current.runId || candidate.toolName !== current.toolName) {
        break;
      }
      children.push(candidate);
      cursor += 1;
    }

    if (children.length === 1) {
      groupedItems.push(current);
    } else {
      const firstChild = children[0];
      const groupedItem: ToolGroupItem = {
        id: `tool-group-${firstChild.id}`,
        type: 'tool-group',
        runId: firstChild.runId,
        seq: firstChild.seq,
        timestamp: firstChild.timestamp,
        isStreaming: children.some(child => child.isStreaming),
        toolName: firstChild.toolName,
        children,
        state: deriveGroupState(children),
      };
      groupedItems.push(groupedItem);
    }

    index = cursor;
  }

  return groupedItems;
}

function flattenTurnsToRenderItemsLegacy(turns: ChatTurn[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let globalSeq = 0;

  turns.forEach(turn => {
    const baseRunId = turn.runId;
    const isActive = turn.isActive;

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
        isStreaming: false,
      };
      items.push(item);
    });

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

    if (!turn.assistantMessages.length && turn.streamingAssistantText) {
      const item: AssistantMessageItem = {
        id: `${LEGACY_STREAMING_ASSISTANT_ITEM_ID_PREFIX}${baseRunId || turn.key}`,
        type: 'assistant-message',
        runId: baseRunId,
        seq: globalSeq++,
        timestamp: new Date().toISOString(),
        content: turn.streamingAssistantText,
        messageId: `${STREAMING_ASSISTANT_MESSAGE_ID_PREFIX}${baseRunId || turn.key}`,
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
 * ChatTurn 배열을 flat한 ChatRenderItem 배열로 변환
 * API 의존성(runId) 유지하면서 UI만 독립적으로 렌더링
 */
export function flattenTurnsToRenderItems(turns: ChatTurn[]): ChatRenderItem[] {
  try {
    const timelineItems = buildTimelineItemsFromTurns({
      turns: toTimelineTurns(turns),
      includeMessageEvents: true,
    });
    const renderItems = groupConsecutiveTools(toRenderItemsFromTimeline(timelineItems));
    if (renderItems.length > 0 || turns.length === 0) {
      return renderItems;
    }
  } catch (error) {
    // Preserve legacy path during migration.
    console.warn('[chatRenderUtils] Timeline reducer fallback to legacy render path', error);
  }
  return groupConsecutiveTools(flattenTurnsToRenderItemsLegacy(turns));
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
