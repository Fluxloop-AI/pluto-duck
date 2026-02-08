export type ChatStatus = 'submitted' | 'streaming' | 'error' | (string & {});

export type FileUIPart = {
  type: 'file';
  url: string;
  mediaType?: string;
  filename?: string;
  [key: string]: unknown;
};

export type UIMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type LanguageModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
};

export type GeneratedImageLike = {
  base64: string;
  mediaType: string;
  uint8Array?: Uint8Array;
  [key: string]: unknown;
};
