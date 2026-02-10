const ASSISTANT_PROSE_BASE_CLASS = 'prose prose-sm dark:prose-invert max-w-none';

export function getAssistantMessageProseClassName(isStreaming: boolean): string {
  if (!isStreaming) {
    return ASSISTANT_PROSE_BASE_CLASS;
  }
  return `${ASSISTANT_PROSE_BASE_CLASS} prose-streaming`;
}
