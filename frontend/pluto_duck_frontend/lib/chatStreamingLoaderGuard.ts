import type { ChatRenderItem } from '../types/chatRenderItem';

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

export function shouldShowFallbackStreamingLoader(params: {
  isStreaming: boolean;
  renderItems: ChatRenderItem[];
}): boolean {
  const { isStreaming, renderItems } = params;
  if (!isStreaming || renderItems.length === 0) {
    return false;
  }

  const hasInlineStreamingItem = renderItems.some(item => item.isStreaming);
  if (hasInlineStreamingItem) {
    return false;
  }

  if (hasAssistantAfterLatestUser(renderItems)) {
    return false;
  }

  return true;
}
