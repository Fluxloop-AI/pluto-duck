'use client';

import { Fragment, useCallback, useRef, useState } from 'react';
import { AtSignIcon, CopyIcon, RefreshCcwIcon, ChevronRightIcon, CheckIcon, XIcon } from 'lucide-react';
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
import { Suggestions, Suggestion } from '../ai-elements/suggestion';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '../ai-elements/tool';
import {
  Plan,
  PlanHeader,
  PlanTitle,
  PlanAction,
  PlanTrigger,
  PlanContent,
} from '../ai-elements/plan';
import {
  Task,
  TaskTrigger,
  TaskContent,
  TaskItem,
} from '../ai-elements/task';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
} from '../ai-elements/confirmation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import type { ChatSessionSummary } from '../../lib/chatApi';
import type { DataSource, DataSourceTable } from '../../lib/dataSourcesApi';
import type { ChatTurn } from '../../hooks/useMultiTabChat';
import { ALL_MODEL_OPTIONS } from '../../constants/models';

const suggestions = [
  'Show me top 5 products by revenue',
  'List customers from last month',
  'Analyze sales trends by region',
];

const MODELS = ALL_MODEL_OPTIONS;

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

function getPlanData(event: any): { title: string; description?: string; tasks: string[] } {
  const content = event.content;
  if (!content || typeof content !== 'object') {
    return { title: 'Plan', tasks: [] };
  }
  
  const tasks = content.tasks || content.steps || [];
  const taskArray = Array.isArray(tasks) ? tasks : [];
  
  return {
    title: content.title || content.name || 'Plan',
    description: content.description || content.summary,
    tasks: taskArray.map((task: any) => 
      task.title || task.name || task.description || String(task)
    ),
  };
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

interface ChatPanelProps {
  activeSession: ChatSessionSummary | null;
  turns: ChatTurn[];
  lastAssistantMessageId: string | null;
  loading: boolean;
  isStreaming: boolean;
  status: 'ready' | 'streaming' | 'error';
  selectedModel: string;
  onModelChange: (model: string) => void;
  dataSources: DataSource[];
  allTables: DataSourceTable[];
  onSubmit: (prompt: string) => Promise<void>;
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
  dataSources,
  allTables,
  onSubmit,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [showTableSelector, setShowTableSelector] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setInput(suggestion);
    textareaRef.current?.focus();
  }, []);

  const handleTableMentionAll = useCallback(() => {
    const allTableNames = allTables.map(t => t.target_table);
    const mentions = allTableNames.map(t => `@${t}`).join(' ');
    const currentInput = input;
    const newInput = currentInput ? `${currentInput} ${mentions} ` : `${mentions} `;
    setInput(newInput);
    setShowTableSelector(false);
    
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [input, allTables]);

  const handleTableMentionSource = useCallback((sourceId: string) => {
    const sourceTables = allTables
      .filter(t => t.data_source_id === sourceId)
      .map(t => t.target_table);
    const mentions = sourceTables.map(t => `@${t}`).join(' ');
    const currentInput = input;
    const newInput = currentInput ? `${currentInput} ${mentions} ` : `${mentions} `;
    setInput(newInput);
    setShowTableSelector(false);
    
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [input, allTables]);

  const handleTableMentionSingle = useCallback((tableName: string) => {
    const currentInput = input;
    const newInput = currentInput ? `${currentInput} @${tableName} ` : `@${tableName} `;
    setInput(newInput);
    setShowTableSelector(false);
    
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
    
    setInput('');
    await onSubmit(prompt);
  }, [onSubmit]);

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Messages area */}
      <div className="flex-1 min-h-0">
        <Conversation className="h-full">
          <ConversationContent>
            {loading && (
              <div className="px-4 py-6">
                <div className="mx-auto">
                  <Loader />
                </div>
              </div>
            )}

            {turns.map(turn => (
                <div key={turn.key} className="group px-4 py-6 space-y-4">
                  {turn.userMessages.map(message => (
                    <div key={message.id} className="flex justify-end">
                      <div className="rounded-2xl bg-primary px-4 py-3 text-primary-foreground">
                        <p className="text-sm">
                          {typeof message.content === 'object' && message.content?.text
                            ? message.content.text
                            : typeof message.content === 'string'
                              ? message.content
                              : JSON.stringify(message.content)}
                        </p>
                      </div>
                    </div>
                  ))}

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

                  {turn.toolEvents.length > 0 && (
                    <div className="space-y-2">
                      {turn.toolEvents.map((event, index) => {
                        // Handle tool events
                        if (event.type === 'tool') {
                          const toolState = getToolState(event);
                          const toolType = getToolType(event);
                          const toolInput = getToolInput(event);
                          const toolOutput = getToolOutput(event);
                          const errorText = getToolError(event);
                          const approval = getToolApproval(event);

                          return (
                            <Tool key={`${turn.key}-tool-${index}`} defaultOpen>
                              <ToolHeader
                                state={toolState}
                                type={toolType}
                                title={event.subtype}
                              />
                              <ToolContent>
                                {toolInput && <ToolInput input={toolInput} />}
                                
                                {/* Approval workflow */}
                                <Confirmation approval={approval} state={toolState}>
                                  <ConfirmationTitle>
                                    <ConfirmationRequest>
                                      This tool requires your approval to execute.
                                    </ConfirmationRequest>
                                    <ConfirmationAccepted>
                                      <CheckIcon className="size-4 text-green-600 dark:text-green-400" />
                                      <span>Approved</span>
                                    </ConfirmationAccepted>
                                    <ConfirmationRejected>
                                      <XIcon className="size-4 text-destructive" />
                                      <span>
                                        Rejected
                                        {approval?.reason && `: ${approval.reason}`}
                                      </span>
                                    </ConfirmationRejected>
                                  </ConfirmationTitle>
                                  <ConfirmationActions>
                                    <ConfirmationAction
                                      onClick={() => {
                                        // TODO: Implement approval rejection
                                        console.log('Tool rejected');
                                      }}
                                      variant="outline"
                                    >
                                      Reject
                                    </ConfirmationAction>
                                    <ConfirmationAction
                                      onClick={() => {
                                        // TODO: Implement approval acceptance
                                        console.log('Tool approved');
                                      }}
                                      variant="default"
                                    >
                                      Approve
                                    </ConfirmationAction>
                                  </ConfirmationActions>
                                </Confirmation>

                                {(toolOutput || errorText) && (
                                  <ToolOutput output={toolOutput} errorText={errorText} />
                                )}
                              </ToolContent>
                            </Tool>
                          );
                        }
                        
                        // Handle plan events
                        if (event.type === 'plan') {
                          const planData = getPlanData(event);
                          const isStreaming = event.subtype === 'start' || event.subtype === 'chunk';
                          
                          return (
                            <Plan key={`${turn.key}-plan-${index}`} defaultOpen isStreaming={isStreaming}>
                              <PlanHeader>
                                <div className="flex-1">
                                  <PlanTitle>{planData.title}</PlanTitle>
                                  {planData.description && (
                                    <p className="text-sm text-muted-foreground mt-1">{planData.description}</p>
                                  )}
                                </div>
                                <PlanAction>
                                  <PlanTrigger />
                                </PlanAction>
                              </PlanHeader>
                              <PlanContent>
                                <div className="space-y-2">
                                  {planData.tasks.map((taskText, taskIndex) => (
                                    <TaskItem key={taskIndex}>
                                      {taskIndex + 1}. {taskText}
                                    </TaskItem>
                                  ))}
                                </div>
                              </PlanContent>
                            </Plan>
                          );
                        }

                        // Fallback for other event types
                        return (
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
                        );
                      })}
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
                            <Action onClick={handleRegenerate} label="Retry">
                              <RefreshCcwIcon className="size-3" />
                            </Action>
                            <Action
                              onClick={() => {
                                const text =
                                  typeof message.content === 'object' && message.content?.text
                                    ? message.content.text
                                    : JSON.stringify(message.content);
                                handleCopy(text);
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

            {/* Empty state */}
            {/* {!loading && turns.length === 0 && (
              <div className="flex flex-1 items-center justify-center px-4">
                <div className="mx-auto text-center space-y-6">
                  <p className="text-sm text-muted-foreground">
                    {activeSession ? 'No messages yet.' : 'Start a new conversation below.'}
                  </p>
                  {!activeSession && (
                    <Suggestions>
                      {suggestions.map(suggestion => (
                        <Suggestion key={suggestion} onClick={() => handleSuggestionClick(suggestion)} suggestion={suggestion} />
                      ))}
                    </Suggestions>
                  )}
                </div>
              </div>
            )} */}
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
                
                {/* @ Table mention button */}
                <DropdownMenu open={showTableSelector} onOpenChange={setShowTableSelector}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 border-none bg-transparent text-xs font-medium text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground"
                      title="Insert table mention"
                    >
                      <AtSignIcon className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-y-auto">
                    <DropdownMenuItem onSelect={handleTableMentionAll} className="text-xs">
                      <span className="font-medium">All sources</span>
                      <span className="ml-auto text-muted-foreground">
                        {allTables.length} tables
                      </span>
                    </DropdownMenuItem>
                    
                    {dataSources.length > 0 && <DropdownMenuSeparator />}
                    
                    {dataSources.map(source => {
                      const sourceTables = allTables.filter(t => t.data_source_id === source.id);
                      
                      return (
                        <Fragment key={source.id}>
                          <DropdownMenuItem 
                            onSelect={() => handleTableMentionSource(source.id)}
                            className="text-xs font-medium"
                          >
                            {source.name}
                            <span className="ml-auto text-muted-foreground">
                              {source.table_count}
                            </span>
                          </DropdownMenuItem>
                          {sourceTables.map(table => (
                            <DropdownMenuItem
                              key={table.id}
                              onSelect={() => handleTableMentionSingle(table.target_table)}
                              className="text-xs pl-6"
                            >
                              <ChevronRightIcon className="h-3 w-3 mr-1" />
                              {table.target_table}
                            </DropdownMenuItem>
                          ))}
                        </Fragment>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
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

