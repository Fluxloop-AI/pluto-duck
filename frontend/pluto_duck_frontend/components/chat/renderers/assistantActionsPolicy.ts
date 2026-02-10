import {
  LEGACY_STREAMING_ASSISTANT_ITEM_ID_PREFIX,
  STREAMING_ASSISTANT_MESSAGE_ID_PREFIX,
  TIMELINE_STREAMING_ASSISTANT_ITEM_ID_PREFIX,
} from '../../../lib/chatStreamingIds.ts';

type AssistantActionPolicyParams = {
  id: string;
  messageId: string;
  isStreaming: boolean;
};

function isTransientStreamingMessage(params: AssistantActionPolicyParams): boolean {
  return (
    params.messageId.startsWith(STREAMING_ASSISTANT_MESSAGE_ID_PREFIX) ||
    params.id.startsWith(LEGACY_STREAMING_ASSISTANT_ITEM_ID_PREFIX) ||
    params.id.startsWith(TIMELINE_STREAMING_ASSISTANT_ITEM_ID_PREFIX)
  );
}

export function shouldShowAssistantActions(
  params: AssistantActionPolicyParams
): boolean {
  if (params.isStreaming) {
    return false;
  }
  if (isTransientStreamingMessage(params)) {
    return false;
  }
  return true;
}

export function getAssistantActionsClassName(
  params: AssistantActionPolicyParams
): string | null {
  // Keep mt-2 + animate-step-in stable until phase-5 visual integration review.
  return shouldShowAssistantActions(params) ? "mt-2 animate-step-in" : null;
}
