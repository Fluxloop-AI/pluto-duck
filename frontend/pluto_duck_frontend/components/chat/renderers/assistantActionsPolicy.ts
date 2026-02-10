export function shouldShowAssistantActions(isStreaming: boolean): boolean {
  return !isStreaming;
}

export function getAssistantActionsClassName(
  isStreaming: boolean
): string | null {
  return shouldShowAssistantActions(isStreaming) ? "mt-2 animate-step-in" : null;
}
