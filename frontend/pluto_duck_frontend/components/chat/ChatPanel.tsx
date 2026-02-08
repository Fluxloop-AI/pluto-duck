'use client';

import { memo, useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Conversation, ConversationContent, ConversationScrollButton } from '../ai-elements/conversation';
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
import { ActivityLoader } from '../ai-elements/activity-loader';
import { MentionMenu } from './MentionMenu';
import { ChatOnboarding } from './ChatOnboarding';
import { RenderItem, type FeedbackType } from './renderers';
import { AssetEmbedTestButtons } from './AssetEmbedTestButtons';
import { type MentionItem } from '../../hooks/useAssetMentions';
import type { ChatSessionSummary } from '../../lib/chatApi';
import type { ChatRenderItem, AssistantMessageItem } from '../../types/chatRenderItem';
import { ALL_MODEL_OPTIONS } from '../../constants/models';
import type { AssetEmbedConfig } from '../editor/nodes/AssetEmbedNode';

const MODELS = ALL_MODEL_OPTIONS;

/**
 * Find the last assistant message item for action display
 */
function findLastAssistantMessageId(items: ChatRenderItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'assistant-message') {
      return (items[i] as AssistantMessageItem).messageId;
    }
  }
  return null;
}

/**
 * Check if runId changes between current and next item (for visual grouping)
 */
function isRunIdChanged(current: ChatRenderItem, next: ChatRenderItem | undefined): boolean {
  if (!next) return true;
  return current.runId !== next.runId;
}

// Memoized conversation messages using renderItems
interface ConversationMessagesProps {
  renderItems: ChatRenderItem[];
  loading: boolean;
  isStreaming: boolean;
  feedbackMap?: Map<string, FeedbackType>;
  onCopy: (text: string) => void;
  onRegenerate?: (messageId: string) => void;
  onEditUserMessage?: (messageId: string, content: string) => void;
  onFeedback?: (messageId: string, type: 'like' | 'dislike') => void;
  onSendToBoard?: (messageId: string, content: string) => void;
}

const ConversationMessages = memo(function ConversationMessages({
  renderItems,
  loading,
  isStreaming,
  feedbackMap,
  onCopy,
  onRegenerate,
  onEditUserMessage,
  onFeedback,
  onSendToBoard,
}: ConversationMessagesProps) {
  const lastAssistantId = findLastAssistantMessageId(renderItems);

  return (
    <>
      {/* Keep top loader for detail fetch only; streaming loader stays at bottom. */}
      {loading && !isStreaming && (
        <div className="px-4 py-6">
          <div className="mx-auto">
            <ActivityLoader />
          </div>
        </div>
      )}

      {renderItems.map((item, idx) => {
        const nextItem = renderItems[idx + 1];
        const isLastOfRun = isRunIdChanged(item, nextItem);
        const isLastAssistant = item.type === 'assistant-message' &&
          (item as AssistantMessageItem).messageId === lastAssistantId;
        const feedback = item.type === 'assistant-message'
          ? feedbackMap?.get((item as AssistantMessageItem).messageId)
          : undefined;

        // 아이템 타입별 여백
        const getPadding = () => {
          if (item.type === 'user-message') return 'pl-[14px] pr-1 pt-0 pb-6';     // 좌 14px, 하 24px
          if (item.type === 'tool') return 'pl-1 pr-1 pt-0 pb-0';                  // 좌 4px, 하 0px
          if (item.type === 'reasoning') return 'px-1 py-0';                       // 좌우 4px, 상하 0px
          if (item.type === 'assistant-message') return 'pl-2 pr-2 pt-3 pb-6';    // 상 12px, 좌우 8px, 하 24px
          return `pl-[14px] pr-1 pt-0 ${isLastOfRun ? 'pb-6' : 'pb-2'}`;           // 기존 로직
        };

        return (
          <div
            key={item.id}
            className={cn(
              'group',
              getPadding()
            )}
          >
            <RenderItem
              item={item}
              isLastAssistant={isLastAssistant}
              feedback={feedback}
              onCopy={onCopy}
              onRegenerate={onRegenerate}
              onEditUserMessage={onEditUserMessage}
              onFeedback={onFeedback}
              onSendToBoard={onSendToBoard}
            />
          </div>
        );
      })}

      {/* Loading indicator during streaming */}
      {isStreaming && renderItems.length > 0 && (
        <div className="px-2.5 py-2.5">
          <ActivityLoader />
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
  renderItems: ChatRenderItem[];
  loading: boolean;
  isStreaming: boolean;
  status: 'ready' | 'streaming' | 'error';
  selectedModel: string;
  onModelChange: (model: string) => void;
  onSubmit: (payload: SubmitPayload) => Promise<void>;
  projectId?: string;
  // Optional action callbacks
  onRegenerate?: (messageId: string) => void;
  onEditUserMessage?: (messageId: string, content: string) => void;
  onFeedback?: (messageId: string, type: 'like' | 'dislike') => void;
  onSendToBoard?: (messageId: string, content: string) => void;
  onEmbedAssetToBoard?: (analysisId: string, config: AssetEmbedConfig) => void;
  feedbackMap?: Map<string, FeedbackType>;
}

export function ChatPanel({
  activeSession,
  renderItems,
  loading,
  isStreaming,
  status,
  selectedModel,
  onModelChange,
  onSubmit,
  projectId,
  onRegenerate,
  onEditUserMessage,
  onFeedback,
  onSendToBoard,
  onEmbedAssetToBoard,
  feedbackMap,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [isOnboardingExiting, setIsOnboardingExiting] = useState(false);
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

  const handleOnboardingSelect = useCallback((prompt: string) => {
    setIsOnboardingExiting(true);
    // Delay submission to allow fade-out animation to complete
    setTimeout(() => {
      void onSubmit({ prompt });
    }, 200);
  }, [onSubmit]);

  const showOnboarding = renderItems.length === 0 && !loading && !isStreaming && !isOnboardingExiting;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Messages area */}
      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait">
          {showOnboarding ? (
            <motion.div
              key="onboarding"
              className="flex h-full items-center justify-center"
              initial={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <ChatOnboarding onSelect={handleOnboardingSelect} />
            </motion.div>
          ) : (
            <Conversation className="h-full">
              <ConversationContent>
                <ConversationMessages
                  renderItems={renderItems}
                  loading={loading}
                  isStreaming={isStreaming}
                  feedbackMap={feedbackMap}
                  onCopy={handleCopy}
                  onRegenerate={onRegenerate}
                  onEditUserMessage={onEditUserMessage}
                  onFeedback={onFeedback}
                  onSendToBoard={onSendToBoard}
                />
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          )}
        </AnimatePresence>
      </div>

      {/* Input area */}
      <div className="shrink-0">
        <div className="w-full px-4 pb-4">
          {/* Test buttons for Asset Embed (development only) */}
          {process.env.NODE_ENV === 'development' && onEmbedAssetToBoard && (
            <div className="mb-2">
              <AssetEmbedTestButtons onEmbed={onEmbedAssetToBoard} />
            </div>
          )}
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                value={input}
                onChange={event => setInput(event.target.value)}
                ref={textareaRef}
                placeholder={activeSession ? 'Continue this conversation...' : 'ask a question...'}
                className="pt-3 pb-0 pl-4 pr-3"
              />
            </PromptInputBody>

            <PromptInputFooter className="pt-0.5">
              <PromptInputTools>
                {/* Context mention */}
                {projectId && (
                  <MentionMenu
                    projectId={projectId}
                    open={mentionOpen}
                    onOpenChange={setMentionOpen}
                    onSelect={handleMentionSelect}
                  />
                )}
                {/* Model selection */}
                <PromptInputModelSelect value={selectedModel} onValueChange={onModelChange}>
                  <PromptInputModelSelectTrigger className="h-6 px-1 text-xs gap-1">
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
              </PromptInputTools>

              {/* Submit button - 원 안에 화살표 */}
              <PromptInputSubmit
                disabled={!input.trim() || isStreaming}
                status={status}
                variant="default"
                className="h-6 w-6 rounded-full bg-foreground text-background hover:bg-foreground/90 disabled:bg-muted-foreground/40 disabled:text-background/70 [&>svg]:size-3"
              >
                <ArrowUpIcon />
              </PromptInputSubmit>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
