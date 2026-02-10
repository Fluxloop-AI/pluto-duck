type AssistantActionPolicyParams = {
  id: string;
  messageId: string;
  isStreaming: boolean;
};

function isTransientStreamingMessage(params: AssistantActionPolicyParams): boolean {
  return (
    params.messageId.startsWith('stream-') ||
    params.id.startsWith('assistant-stream-') ||
    params.id.startsWith('timeline-streaming-')
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
  return shouldShowAssistantActions(params) ? "mt-2 animate-step-in" : null;
}
