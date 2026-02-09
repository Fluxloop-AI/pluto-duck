export type PromptSubmitEligibilityInput = {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  nativeIsComposing: boolean;
  submitDisabled: boolean;
};

/**
 * Enter submits only when IME is idle, Shift is not pressed,
 * and the submit action is currently enabled.
 */
export const canSubmitPromptOnEnter = ({
  key,
  shiftKey,
  isComposing,
  nativeIsComposing,
  submitDisabled,
}: PromptSubmitEligibilityInput): boolean => {
  if (key !== "Enter") {
    return false;
  }
  if (shiftKey) {
    return false;
  }
  if (isComposing || nativeIsComposing) {
    return false;
  }
  return !submitDisabled;
};
