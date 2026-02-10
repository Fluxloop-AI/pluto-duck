'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { LoadingDots } from '../ai-elements/loading-dots';
import { MentionMenu } from './MentionMenu';
import { ChatOnboarding } from './ChatOnboarding';
import { RenderItem, type FeedbackType } from './renderers';
import { AssetEmbedTestButtons } from './AssetEmbedTestButtons';
import { type MentionItem } from '../../hooks/useAssetMentions';
import type { ChatSessionSummary } from '../../lib/chatApi';
import type { ChatRenderItem, AssistantMessageItem, ReasoningItem } from '../../types/chatRenderItem';
import { ALL_MODEL_OPTIONS } from '../../constants/models';
import type { AssetEmbedConfig } from '../editor/nodes/AssetEmbedNode';
import { type ChatLoadingMode } from '../../lib/chatLoadingState';
import { SessionSkeleton } from './SessionSkeleton';
import { canSubmitChatPrompt } from './chatSubmitEligibility';
import {
  clearReasoningDismissTimers,
  scheduleReasoningDismissTimers,
} from './reasoningDismissTimers';
import { getChatItemPadding } from './renderers/chatItemPadding';

const MODELS = ALL_MODEL_OPTIONS;
const ENABLE_SESSION_LOADING_SKELETON = false;
const REASONING_DISMISS_DURATION_MS = 450;

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

// Memoized conversation messages using renderItems
interface ConversationMessagesProps {
  renderItems: ChatRenderItem[];
  chatLoadingMode: ChatLoadingMode;
  feedbackMap?: Map<string, FeedbackType>;
  onCopy: (text: string) => void;
  onRegenerate?: (messageId: string) => void;
  onEditUserMessage?: (messageId: string, content: string) => void;
  onFeedback?: (messageId: string, type: 'like' | 'dislike') => void;
  onSendToBoard?: (messageId: string, content: string) => void;
  onApprovalDecision?: (approvalEventId: string, runId: string | null, decision: 'approved' | 'rejected') => void;
}

interface ExitingReasoningEntry {
  id: string;
  anchorId: string | null;
  item: ReasoningItem;
}

interface RenderQueueEntry {
  key: string;
  item: ChatRenderItem;
  isDismissingReasoning: boolean;
}

const ConversationMessages = memo(function ConversationMessages({
  renderItems,
  chatLoadingMode,
  feedbackMap,
  onCopy,
  onRegenerate,
  onEditUserMessage,
  onFeedback,
  onSendToBoard,
  onApprovalDecision,
}: ConversationMessagesProps) {
  const previousRenderItemsRef = useRef<ChatRenderItem[]>(renderItems);
  const [exitingReasoningEntries, setExitingReasoningEntries] = useState<ExitingReasoningEntry[]>([]);
  const dismissTimerByIdRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timersById = dismissTimerByIdRef.current;
    return () => {
      clearReasoningDismissTimers(timersById);
    };
  }, []);

  useEffect(() => {
    const previousItems = previousRenderItemsRef.current;
    previousRenderItemsRef.current = renderItems;

    if (previousItems.length === 0) {
      return;
    }

    const currentItemIds = new Set(renderItems.map(item => item.id));
    const discoveredEntries: ExitingReasoningEntry[] = [];

    previousItems.forEach((previousItem, index) => {
      if (previousItem.type !== 'reasoning') {
        return;
      }
      if (currentItemIds.has(previousItem.id)) {
        return;
      }
      if (previousItem.content.trim().length > 0) {
        return;
      }
      if (!previousItem.isStreaming && previousItem.phase !== 'streaming') {
        return;
      }

      const anchorId = previousItems
        .slice(index + 1)
        .map(item => item.id)
        .find(id => currentItemIds.has(id)) ?? null;

      discoveredEntries.push({
        id: previousItem.id,
        anchorId,
        item: {
          ...previousItem,
          phase: 'complete',
          isStreaming: false,
        },
      });
    });

    if (discoveredEntries.length === 0) {
      return;
    }

    setExitingReasoningEntries(previousEntries => {
      const existingIds = new Set(previousEntries.map(entry => entry.id));
      const mergedEntries = [...previousEntries];
      discoveredEntries.forEach(entry => {
        if (!existingIds.has(entry.id)) {
          mergedEntries.push(entry);
        }
      });
      return mergedEntries;
    });
    scheduleReasoningDismissTimers({
      ids: discoveredEntries.map(entry => entry.id),
      delayMs: REASONING_DISMISS_DURATION_MS,
      timersById: dismissTimerByIdRef.current,
      onDismiss: dismissedId => {
        setExitingReasoningEntries(previousEntries =>
          previousEntries.filter(entry => entry.id !== dismissedId),
        );
      },
    });
  }, [renderItems]);

  const renderQueue = useMemo<RenderQueueEntry[]>(() => {
    if (exitingReasoningEntries.length === 0) {
      return renderItems.map(item => ({
        key: item.id,
        item,
        isDismissingReasoning: false,
      }));
    }

    const currentItemIds = new Set(renderItems.map(item => item.id));
    const anchoredEntriesByItemId = new Map<string, ExitingReasoningEntry[]>();
    const trailingEntries: ExitingReasoningEntry[] = [];

    exitingReasoningEntries.forEach(entry => {
      if (entry.anchorId && currentItemIds.has(entry.anchorId)) {
        const anchoredEntries = anchoredEntriesByItemId.get(entry.anchorId) ?? [];
        anchoredEntries.push(entry);
        anchoredEntriesByItemId.set(entry.anchorId, anchoredEntries);
      } else {
        trailingEntries.push(entry);
      }
    });

    const queue: RenderQueueEntry[] = [];

    renderItems.forEach(item => {
      const anchoredEntries = anchoredEntriesByItemId.get(item.id) ?? [];
      anchoredEntries.forEach(entry => {
        queue.push({
          key: `reasoning-dismiss-${entry.id}`,
          item: entry.item,
          isDismissingReasoning: true,
        });
      });
      queue.push({
        key: item.id,
        item,
        isDismissingReasoning: false,
      });
    });

    trailingEntries.forEach(entry => {
      queue.push({
        key: `reasoning-dismiss-${entry.id}`,
        item: entry.item,
        isDismissingReasoning: true,
      });
    });

    return queue;
  }, [exitingReasoningEntries, renderItems]);

  const lastAssistantId = findLastAssistantMessageId(renderItems);

  return (
    <>
      {chatLoadingMode === 'session-loading' && ENABLE_SESSION_LOADING_SKELETON && (
        <div className="px-4 py-6">
          <SessionSkeleton />
        </div>
      )}

      {renderQueue.map((queueEntry, idx) => {
        const { item, isDismissingReasoning, key } = queueEntry;
        const nextItem = renderQueue[idx + 1]?.item;
        const isLastAssistant = !isDismissingReasoning && item.type === 'assistant-message' &&
          (item as AssistantMessageItem).messageId === lastAssistantId;
        const feedback = !isDismissingReasoning && item.type === 'assistant-message'
          ? feedbackMap?.get((item as AssistantMessageItem).messageId)
          : undefined;

        return (
          <div
            key={key}
            className={cn(
              'group',
              getChatItemPadding(item, nextItem)
            )}
          >
            <RenderItem
              item={item}
              isDismissingReasoning={isDismissingReasoning}
              isLastAssistant={isLastAssistant}
              feedback={feedback}
              onCopy={onCopy}
              onRegenerate={onRegenerate}
              onEditUserMessage={onEditUserMessage}
              onFeedback={onFeedback}
              onSendToBoard={onSendToBoard}
              onApprovalDecision={onApprovalDecision}
            />
          </div>
        );
      })}

      {chatLoadingMode === 'agent-streaming-fallback' && (
        <div aria-live="polite" aria-atomic="true">
          <span className="sr-only">에이전트가 응답을 생성하고 있습니다</span>
          <LoadingDots className="animate-step-in" />
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
  chatLoadingMode: ChatLoadingMode;
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
  onApprovalDecision?: (approvalEventId: string, runId: string | null, decision: 'approved' | 'rejected') => void;
  onEmbedAssetToBoard?: (analysisId: string, config: AssetEmbedConfig) => void;
  feedbackMap?: Map<string, FeedbackType>;
}

export function ChatPanel({
  activeSession,
  renderItems,
  loading,
  isStreaming,
  chatLoadingMode,
  status,
  selectedModel,
  onModelChange,
  onSubmit,
  projectId,
  onRegenerate,
  onEditUserMessage,
  onFeedback,
  onSendToBoard,
  onApprovalDecision,
  onEmbedAssetToBoard,
  feedbackMap,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [isOnboardingExiting, setIsOnboardingExiting] = useState(false);
  const activeMentionsRef = useRef<Map<string, MentionItem>>(new Map());
  const onboardingSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => {
      if (onboardingSubmitTimerRef.current) {
        clearTimeout(onboardingSubmitTimerRef.current);
        onboardingSubmitTimerRef.current = null;
      }
    };
  }, []);

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
    const prompt = message.text?.trim() ?? '';
    if (!canSubmitChatPrompt({ prompt, isStreaming })) return;

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
  }, [isStreaming, onSubmit]);

  const handleOnboardingSelect = useCallback((prompt: string) => {
    setIsOnboardingExiting(true);
    // Delay submission to allow fade-out animation to complete
    if (onboardingSubmitTimerRef.current) {
      clearTimeout(onboardingSubmitTimerRef.current);
    }
    onboardingSubmitTimerRef.current = setTimeout(() => {
      onboardingSubmitTimerRef.current = null;
      void onSubmit({ prompt });
    }, 200);
  }, [onSubmit]);

  const showOnboarding = renderItems.length === 0 && chatLoadingMode === 'idle' && !isOnboardingExiting;
  const isSubmitDisabled = !input.trim() || isStreaming;

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
                  chatLoadingMode={chatLoadingMode}
                  feedbackMap={feedbackMap}
                  onCopy={handleCopy}
                  onRegenerate={onRegenerate}
                  onEditUserMessage={onEditUserMessage}
                  onFeedback={onFeedback}
                  onSendToBoard={onSendToBoard}
                  onApprovalDecision={onApprovalDecision}
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
                disabled={isSubmitDisabled}
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
