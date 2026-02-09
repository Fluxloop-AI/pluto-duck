import type { ChatRenderItem, ReasoningItem } from '../types/chatRenderItem';

export type ChatLoadingMode =
  | 'session-loading'
  | 'agent-streaming-fallback'
  | 'reasoning-streaming'
  | 'idle';

export interface ComputeChatLoadingModeParams {
  loading: boolean;
  isStreaming: boolean;
  renderItems: ChatRenderItem[];
  hasMaterializedReasoningSpan: boolean;
}

function hasAssistantAfterLatestUser(renderItems: ChatRenderItem[]): boolean {
  let latestUserIndex = -1;
  for (let index = renderItems.length - 1; index >= 0; index -= 1) {
    if (renderItems[index].type === 'user-message') {
      latestUserIndex = index;
      break;
    }
  }

  if (latestUserIndex === -1) {
    return false;
  }

  for (let index = latestUserIndex + 1; index < renderItems.length; index += 1) {
    if (renderItems[index].type === 'assistant-message') {
      return true;
    }
  }

  return false;
}

function isMaterializedReasoningItem(item: ChatRenderItem): item is ReasoningItem {
  return item.type === 'reasoning' && item.content.trim().length > 0;
}

function hasBlockingInlineStreamingItem(renderItems: ChatRenderItem[]): boolean {
  return renderItems.some(item => {
    if (!item.isStreaming) {
      return false;
    }

    // Ignore placeholder reasoning rows with empty content.
    if (item.type === 'reasoning' && !isMaterializedReasoningItem(item)) {
      return false;
    }

    return true;
  });
}

export function hasMaterializedReasoningSpan(renderItems: ChatRenderItem[]): boolean {
  return renderItems.some(item => isMaterializedReasoningItem(item));
}

export function shouldShowAgentStreamingFallback(params: {
  isStreaming: boolean;
  renderItems: ChatRenderItem[];
}): boolean {
  const { isStreaming, renderItems } = params;
  if (!isStreaming || renderItems.length === 0) {
    return false;
  }

  if (hasBlockingInlineStreamingItem(renderItems)) {
    return false;
  }

  if (hasAssistantAfterLatestUser(renderItems)) {
    return false;
  }

  return true;
}

export function computeChatLoadingMode(params: ComputeChatLoadingModeParams): ChatLoadingMode {
  const {
    loading,
    isStreaming,
    renderItems,
    hasMaterializedReasoningSpan: hasMaterializedReasoning,
  } = params;

  if (loading) {
    return 'session-loading';
  }

  if (isStreaming && hasMaterializedReasoning) {
    return 'reasoning-streaming';
  }

  if (shouldShowAgentStreamingFallback({ isStreaming, renderItems })) {
    return 'agent-streaming-fallback';
  }

  return 'idle';
}
