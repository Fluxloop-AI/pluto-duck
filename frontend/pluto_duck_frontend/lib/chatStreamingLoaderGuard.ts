import type { ChatRenderItem } from '../types/chatRenderItem';
import { shouldShowAgentStreamingFallback } from './chatLoadingState.ts';

export function shouldShowFallbackStreamingLoader(params: {
  isStreaming: boolean;
  renderItems: ChatRenderItem[];
}): boolean {
  return shouldShowAgentStreamingFallback(params);
}
