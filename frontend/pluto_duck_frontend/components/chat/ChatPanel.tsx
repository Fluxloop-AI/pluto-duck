'use client';

import { Fragment, memo, useCallback, useRef, useState } from 'react';
import { CopyIcon, RefreshCcwIcon, CheckIcon, XIcon } from 'lucide-react';
import type { ToolUIPart } from 'ai';
import { Conversation, ConversationContent, ConversationScrollButton } from '../ai-elements/conversation';
import { Response } from '../ai-elements/response';
import { Reasoning, ReasoningTrigger, ReasoningContent } from '../ai-elements/reasoning';
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  PromptInputModelSelect,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  type PromptInputMessage,
} from '../ai-elements/prompt-input';
import { Actions, Action } from '../ai-elements/actions';
import { Loader } from '../ai-elements/loader';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '../ai-elements/tool';
import {
  Queue,
  QueueList,
  QueueItem,
  QueueItemIndicator,
  QueueItemContent,
  type QueueTodo,
} from '../ai-elements/queue';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
} from '../ai-elements/confirmation';
import { MentionMenu } from './MentionMenu';
import { type MentionItem } from '../../hooks/useAssetMentions';
import type { ChatSessionSummary } from '../../lib/chatApi';
import type { ChatTurn, GroupedToolEvent } from '../../hooks/useMultiTabChat';
import { ALL_MODEL_OPTIONS } from '../../constants/models';

const suggestions = [
  'Show me top 5 products by revenue',
  'List customers from last month',
  'Analyze sales trends by region',
];

const MODELS = ALL_MODEL_OPTIONS;

// Render text with @mentions highlighted
function renderTextWithMentions(text: string): React.ReactNode {
  const mentionRegex = /@([\w-]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = mentionRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={key++} className="text-primary-foreground/60 font-medium">
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

// Helper functions to extract tool data from events
function getToolState(event: any): ToolUIPart['state'] {
  const subtype = event.subtype;
  if (subtype === 'start' || subtype === 'chunk') return 'input-streaming';
  if (subtype === 'error') return 'output-error';
  if (subtype === 'end' || subtype === 'final') return 'output-available';
  return 'input-available';
}

function getToolType(event: any): `tool-${string}` {
  const content = event.content;
  if (content && typeof content === 'object') {
    if (content.tool_name) return `tool-${content.tool_name}`;
    if (content.name) return `tool-${content.name}`;
  }
  return 'tool-unknown' as `tool-${string}`;
}

function getToolInput(event: any): Record<string, any> | undefined {
  const content = event.content;
  if (content && typeof content === 'object') {
    if (content.input) return content.input;
    if (content.parameters) return content.parameters;
    if (content.args) return content.args;
  }
  return undefined;
}

function getToolOutput(event: any): any {
  const content = event.content;
  if (content && typeof content === 'object') {
    if (content.output !== undefined) return content.output;
    if (content.result !== undefined) return content.result;
  }
  return undefined;
}

function getToolError(event: any): string | undefined {
  const content = event.content;
  if (event.subtype === 'error') {
    if (typeof content === 'string') return content;
    if (content && typeof content === 'object') {
      if (content.error) return String(content.error);
      if (content.message) return String(content.message);
    }
    return 'An error occurred';
  }
  return undefined;
}

// Parse todos from write_todos tool output
function parseTodosFromOutput(output: any): QueueTodo[] {
  if (!output) return [];
  
  // Try to parse if string
  let parsed = output;
  if (typeof output === 'string') {
    try {
      parsed = JSON.parse(output);
    } catch {
      return [];
    }
  }
  
  // Handle various formats
  const todos = parsed.todos || parsed.items || parsed;
  if (!Array.isArray(todos)) return [];
  
  return todos.map((todo: any, index: number) => ({
    id: todo.id || String(index),
    title: todo.content || todo.title || todo.name || String(todo),
    description: todo.description,
    status: todo.status === 'completed' ? 'completed' : 'pending',
  }));
}

function getToolApproval(event: any): { id: string; approved?: boolean; reason?: string } | undefined {
  const content = event.content;
  if (content && typeof content === 'object') {
    if (content.approval) return content.approval;
    // Check if approval is in metadata
    if (event.metadata?.approval) return event.metadata.approval;
  }
  return undefined;
}

// Memoized conversation messages to prevent re-renders on input change
interface ConversationMessagesProps {
  turns: ChatTurn[];
  lastAssistantMessageId: string | null;
  loading: boolean;
  isStreaming: boolean;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
}

const ConversationMessages = memo(function ConversationMessages({
  turns,
  lastAssistantMessageId,
  loading,
  isStreaming,
  onCopy,
  onRegenerate,
}: ConversationMessagesProps) {
  return (
    <>
      {loading && (
        <div className="px-4 py-6">
          <div className="mx-auto">
            <Loader />
          </div>
        </div>
      )}

      {turns.map(turn => (
        <div key={turn.key} className="group px-4 py-6 space-y-4">
          {turn.userMessages.map(message => {
            const text = typeof message.content === 'object' && message.content?.text
              ? message.content.text
              : typeof message.content === 'string'
                ? message.content
                : JSON.stringify(message.content);
            
            return (
              <div key={message.id} className="flex justify-end">
                <div className="rounded-2xl bg-primary px-4 py-3 text-primary-foreground">
                  <p className="text-sm">
                    {renderTextWithMentions(text)}
                  </p>
                </div>
              </div>
            );
          })}

          {turn.otherMessages.map(message => (
            <div key={message.id} className="rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground">
              {typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}
            </div>
          ))}

          {turn.runId && (turn.isActive || turn.reasoningText) && (
            <Reasoning isStreaming={turn.isActive} defaultOpen={true}>
              <ReasoningTrigger />
              <ReasoningContent>{turn.reasoningText || ''}</ReasoningContent>
            </Reasoning>
          )}

          {/* Grouped Tool Events */}
          {turn.groupedToolEvents.length > 0 && (
            <div className="space-y-2">
              {turn.groupedToolEvents.map((grouped, index) => {
                // Special handling for write_todos tool
                if (grouped.toolName === 'write_todos') {
                  const todos = parseTodosFromOutput(grouped.output);
                  const completedCount = todos.filter(t => t.status === 'completed').length;
                  const isLoading = grouped.state === 'pending';
                  
                  return (
                    <Queue key={`${turn.key}-todo-${index}`}>
                      <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
                        <span className="font-medium">
                          {isLoading ? 'Updating todos...' : `Tasks (${completedCount}/${todos.length})`}
                        </span>
                      </div>
                      {todos.length > 0 && (
                        <QueueList>
                          {todos.map((todo) => (
                            <QueueItem key={todo.id} className="flex-row items-start gap-2">
                              <QueueItemIndicator completed={todo.status === 'completed'} />
                              <QueueItemContent completed={todo.status === 'completed'}>
                                {todo.title}
                              </QueueItemContent>
                            </QueueItem>
                          ))}
                        </QueueList>
                      )}
                      {grouped.error && (
                        <div className="text-xs text-destructive px-1">{grouped.error}</div>
                      )}
                    </Queue>
                  );
                }
                
                // Default tool rendering
                const toolState = grouped.state === 'pending' ? 'input-streaming' 
                  : grouped.state === 'error' ? 'output-error' 
                  : 'output-available';
                const isDefaultOpen = grouped.state === 'pending';
                
                return (
                  <Tool key={`${turn.key}-tool-${index}-${grouped.state}`} defaultOpen={isDefaultOpen}>
                    <ToolHeader
                      state={toolState}
                      type={`tool-${grouped.toolName}`}
                      title={grouped.toolName}
                    />
                    <ToolContent>
                      {grouped.input && <ToolInput input={grouped.input} />}
                      {(grouped.output || grouped.error) && (
                        <ToolOutput 
                          output={grouped.output ? JSON.stringify(grouped.output, null, 2) : undefined} 
                          errorText={grouped.error} 
                        />
                      )}
                    </ToolContent>
                  </Tool>
                );
              })}
            </div>
          )}

          {/* Other Events (fallback) - hide system events like message, run */}
          {turn.events.filter(e => 
            e.type !== 'tool' && 
            e.type !== 'reasoning' && 
            e.type !== 'text' &&
            e.type !== 'message' &&
            e.type !== 'run'
          ).length > 0 && (
            <div className="space-y-2">
              {turn.events.filter(e => 
                e.type !== 'tool' && 
                e.type !== 'reasoning' && 
                e.type !== 'text' &&
                e.type !== 'message' &&
                e.type !== 'run'
              ).map((event, index) => (
                <div
                  key={`${turn.key}-event-${index}`}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-100"
                >
                  <header className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                    <span>
                      {event.type}.{event.subtype ?? 'event'}
                    </span>
                    {event.timestamp && (
                      <time className="font-normal text-slate-500">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </time>
                    )}
                  </header>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px]">
                    {typeof event.content === 'string'
                      ? event.content
                      : JSON.stringify(event.content, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {turn.assistantMessages.map(message => (
            <div key={message.id} className="flex gap-4">
              <div className="flex-1 space-y-4">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Response>
                    {typeof message.content === 'object' && message.content?.text
                      ? message.content.text
                      : typeof message.content === 'string'
                        ? message.content
                        : JSON.stringify(message.content)}
                  </Response>
                </div>

                {message.id === lastAssistantMessageId && (
                  <Actions className="opacity-0 transition-opacity group-hover:opacity-100">
                    <Action onClick={onRegenerate} label="Retry">
                      <RefreshCcwIcon className="size-3" />
                    </Action>
                    <Action
                      onClick={() => {
                        const text =
                          typeof message.content === 'object' && message.content?.text
                            ? message.content.text
                            : JSON.stringify(message.content);
                        onCopy(text);
                      }}
                      label="Copy"
                    >
                      <CopyIcon className="size-3" />
                    </Action>
                  </Actions>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Loading indicator during streaming */}
      {isStreaming && turns.length > 0 && (
        <div className="px-4 py-6">
          <div className="mx-auto">
            <Loader />
          </div>
        </div>
      )}
    </>
  );
});

interface SubmitPayload {
  prompt: string;
  contextAssets?: string;
}

interface ChatPanelProps {
  activeSession: ChatSessionSummary | null;
  turns: ChatTurn[];
  lastAssistantMessageId: string | null;
  loading: boolean;
  isStreaming: boolean;
  status: 'ready' | 'streaming' | 'error';
  selectedModel: string;
  onModelChange: (model: string) => void;
  onSubmit: (payload: SubmitPayload) => Promise<void>;
  projectId?: string;
}

export function ChatPanel({
  activeSession,
  turns,
  lastAssistantMessageId,
  loading,
  isStreaming,
  status,
  selectedModel,
  onModelChange,
  onSubmit,
  projectId,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const activeMentionsRef = useRef<Map<string, MentionItem>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleMentionSelect = useCallback((item: MentionItem) => {
    const currentInput = input;
    const mentionText = `@${item.name}`;
    
    // Store in ref for context injection later
    activeMentionsRef.current.set(item.name, item);
    
    const newInput = currentInput 
      ? `${currentInput}${currentInput.endsWith(' ') ? '' : ' '}${mentionText} `
      : `${mentionText} `;
      
    setInput(newInput);
    setMentionOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [input]);

  const handleRegenerate = useCallback(() => {
    console.log('Regenerate clicked');
  }, []);

  const handleCopy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
  }, []);

  const handleSubmit = useCallback(async (message: PromptInputMessage) => {
    const prompt = message.text?.trim();
    if (!prompt) return;
    
    // Build context string for active mentions present in the prompt (not appended to message)
    const mentions = Array.from(activeMentionsRef.current.values());
    const usedMentions = mentions.filter(m => prompt.includes(`@${m.name}`));
    
    let contextAssets: string | undefined;
    if (usedMentions.length > 0) {
      contextAssets = usedMentions
        .map(m => `- Asset: ${m.name} (Type: ${m.type}, ID: ${m.id})`)
        .join('\n');
    }
    
    // Clear mentions after submit
    activeMentionsRef.current.clear();
    setInput('');
    await onSubmit({ prompt, contextAssets });
  }, [onSubmit]);

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Messages area - using memoized component to prevent re-renders on input change */}
      <div className="flex-1 min-h-0">
        <Conversation className="h-full">
          <ConversationContent>
            <ConversationMessages
              turns={turns}
              lastAssistantMessageId={lastAssistantMessageId}
              loading={loading}
              isStreaming={isStreaming}
              onCopy={handleCopy}
              onRegenerate={handleRegenerate}
            />
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border pt-4">
        <div className="w-full px-4 pb-4">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                value={input}
                onChange={event => setInput(event.target.value)}
                ref={textareaRef}
                placeholder={activeSession ? 'Continue this conversation...' : 'Ask a question...'}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                {/* Model selection */}
                <PromptInputModelSelect value={selectedModel} onValueChange={onModelChange}>
                  <PromptInputModelSelectTrigger className="h-7 text-xs">
                    <PromptInputModelSelectValue />
                  </PromptInputModelSelectTrigger>
                  <PromptInputModelSelectContent>
                    {MODELS.map(model => (
                      <PromptInputModelSelectItem key={model.id} value={model.id} className="text-xs">
                        {model.name}
                      </PromptInputModelSelectItem>
                    ))}
                  </PromptInputModelSelectContent>
                </PromptInputModelSelect>
                
                {/* Asset Mention Menu */}
                {projectId ? (
                  <MentionMenu
                    projectId={projectId}
                    open={mentionOpen}
                    onOpenChange={setMentionOpen}
                    onSelect={handleMentionSelect}
                  />
                ) : null}
              </PromptInputTools>
              <PromptInputSubmit 
                disabled={!input.trim() || isStreaming} 
                status={status} 
                className="h-7 w-7"
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

