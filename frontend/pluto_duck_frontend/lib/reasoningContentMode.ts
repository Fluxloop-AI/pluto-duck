const STRUCTURED_HEADING_PATTERN = /(^|\n)#{1,6}\s+\S/;

const STRUCTURED_REASONING_RESPONSE_CLASS_NAME = "reasoning-structured grid gap-0.5";
const PLAIN_REASONING_RESPONSE_CLASS_NAME = "grid gap-2";

export function isStructuredReasoningContent(content: string): boolean {
  return STRUCTURED_HEADING_PATTERN.test(content);
}

export function getReasoningResponseClassName(content: string): string {
  if (isStructuredReasoningContent(content)) {
    return STRUCTURED_REASONING_RESPONSE_CLASS_NAME;
  }
  return PLAIN_REASONING_RESPONSE_CLASS_NAME;
}
