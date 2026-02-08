export type ChatSubmitEligibilityInput = {
  prompt: string;
  isStreaming: boolean;
};

export const canSubmitChatPrompt = ({
  prompt,
  isStreaming,
}: ChatSubmitEligibilityInput): boolean =>
  !isStreaming && prompt.trim().length > 0;
