'use client';

import { Fragment, useCallback, useRef, useState } from 'react';
import { AtSignIcon, CopyIcon, RefreshCcwIcon, ChevronRightIcon } from 'lucide-react';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  MessageAvatar,
  Response,
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
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
  Actions,
  Action,
  Loader,
  Suggestions,
  Suggestion,
  type PromptInputMessage,
} from '../ai-elements';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import type { ChatSessionDetail, ChatSessionSummary } from '../../lib/chatApi';
import type { DataSource, DataSourceTable } from '../../lib/dataSourcesApi';
import type { AgentEventAny } from '../../types/agent';

const suggestions = [
  'Show me top 5 products by revenue',
  'List customers from last month',
  'Analyze sales trends by region',
];

const MODELS = [
  { id: 'gpt-5', name: 'GPT-5' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
];

interface ChatPanelProps {
  activeSession: ChatSessionSummary | null;
  detail: ChatSessionDetail | null;
  loading: boolean;
  isStreaming: boolean;
  status: 'ready' | 'streaming' | 'error';
  reasoningEvents: AgentEventAny[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  dataSources: DataSource[];
  allTables: DataSourceTable[];
  onSubmit: (prompt: string) => Promise<void>;
}

export function ChatPanel({
  activeSession,
  detail,
  loading,
  isStreaming,
  status,
  reasoningEvents,
  selectedModel,
  onModelChange,
  dataSources,
  allTables,
  onSubmit,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [showTableSelector, setShowTableSelector] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = detail?.messages || [];
  const hasReasoning = reasoningEvents.length > 0;
  const reasoningText = reasoningEvents
    .map(event => {
      const content = event.content as any;
      return content && typeof content === 'object' && content.reason ? String(content.reason) : '';
    })
    .filter(Boolean)
    .join('\n\n');

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setInput(suggestion);
    textareaRef.current?.focus();
  }, []);

  const handleTableMentionAll = useCallback(() => {
    const allTableNames = allTables.map(t => t.target_table);
    const mentions = allTableNames.map(t => `@${t}`).join(' ');
    const currentInput = input;
    const newInput = currentInput ? `${currentInput} ${mentions}` : mentions;
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
    const newInput = currentInput ? `${currentInput} ${mentions}` : mentions;
    setInput(newInput);
    setShowTableSelector(false);
    
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [input, allTables]);

  const handleTableMentionSingle = useCallback((tableName: string) => {
    const currentInput = input;
    const newInput = currentInput ? `${currentInput} @${tableName}` : `@${tableName}`;
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
      <div className="flex-1 overflow-hidden">
        <Conversation>
          <ConversationContent className="flex flex-col min-h-full">
            {loading && (
              <div className="px-4 py-6">
                <div className="mx-auto">
                  <Loader />
                </div>
              </div>
            )}

            {messages.map((message, messageIndex) => (
              <div key={message.id} className="group px-4 py-6">
                <div>
                  {message.role === 'user' ? (
                    /* User message - simple bubble */
                    <div className="flex justify-end">
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
                  ) : (
                    /* Assistant message - streaming response with avatar */
                    <div className="flex gap-4">
                      <MessageAvatar name="Agent" src="https://github.com/openai.png" />
                      <div className="flex-1 space-y-4">
                        {/* Show reasoning for assistant messages */}
                        {hasReasoning && messageIndex === messages.length - 1 && (
                          <Reasoning isStreaming={isStreaming} defaultOpen={true}>
                            <ReasoningTrigger />
                            <ReasoningContent>{reasoningText}</ReasoningContent>
                          </Reasoning>
                        )}

                        {/* Message content - no bubble, just text */}
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <Response>
                            {typeof message.content === 'object' && message.content?.text
                              ? message.content.text
                              : typeof message.content === 'string'
                                ? message.content
                                : JSON.stringify(message.content)}
                          </Response>
                        </div>

                        {/* Actions for last assistant message */}
                        {messageIndex === messages.length - 1 && (
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
                  )}
                </div>
              </div>
            ))}

            {/* Loading indicator during streaming */}
            {isStreaming && messages.length > 0 && (
              <div className="px-4 py-6">
                <div className="mx-auto">
                  <Loader />
                </div>
              </div>
            )}

            {/* Empty state */}
            {/* {!loading && messages.length === 0 && (
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
                  <PromptInputModelSelectTrigger>
                    <PromptInputModelSelectValue />
                  </PromptInputModelSelectTrigger>
                  <PromptInputModelSelectContent>
                    {MODELS.map(model => (
                      <PromptInputModelSelectItem key={model.id} value={model.id}>
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
                      className="h-8 gap-1 border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground"
                      title="Insert table mention"
                    >
                      <AtSignIcon className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64 max-h-96 overflow-y-auto">
                    <DropdownMenuItem onSelect={handleTableMentionAll}>
                      <span className="font-medium">All sources</span>
                      <span className="ml-auto text-xs text-muted-foreground">
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
                            className="font-medium"
                          >
                            {source.name}
                            <span className="ml-auto text-xs text-muted-foreground">
                              {source.table_count}
                            </span>
                          </DropdownMenuItem>
                          {sourceTables.map(table => (
                            <DropdownMenuItem
                              key={table.id}
                              onSelect={() => handleTableMentionSingle(table.target_table)}
                              className="pl-6 text-sm"
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
              <PromptInputSubmit disabled={!input.trim() || isStreaming} status={status} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

