'use client';

import { memo, useState } from 'react';
import {
  CopyIcon,
  CheckIcon,
  RefreshCcwIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  ClipboardPlusIcon,
} from 'lucide-react';
import { Response } from '../../ai-elements/response';
import { Actions, Action } from '../../ai-elements/actions';
import type { AssistantMessageItem } from '../../../types/chatRenderItem';
import {
  getAssistantActionsClassName,
  shouldShowAssistantActions,
} from './assistantActionsPolicy';

export type FeedbackType = 'like' | 'dislike' | null;

export interface AssistantMessageRendererProps {
  item: AssistantMessageItem;
  isLast?: boolean;
  feedback?: FeedbackType;
  onCopy?: (text: string) => void;
  onRegenerate?: (messageId: string) => void;
  onFeedback?: (messageId: string, type: 'like' | 'dislike') => void;
  onSendToBoard?: (messageId: string, content: string) => void;
}

export const AssistantMessageRenderer = memo(function AssistantMessageRenderer({
  item,
  isLast = false,
  feedback,
  onCopy,
  onRegenerate,
  onFeedback,
  onSendToBoard,
}: AssistantMessageRendererProps) {
  const [copied, setCopied] = useState(false);
  const showActions = shouldShowAssistantActions(item.isStreaming);
  const actionsClassName = getAssistantActionsClassName(item.isStreaming);

  const handleCopy = () => {
    if (onCopy) {
      onCopy(item.content);
    } else {
      void navigator.clipboard.writeText(item.content);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = () => {
    onRegenerate?.(item.messageId);
  };

  const handleLike = () => {
    onFeedback?.(item.messageId, 'like');
  };

  const handleDislike = () => {
    onFeedback?.(item.messageId, 'dislike');
  };

  const handleSendToBoard = () => {
    onSendToBoard?.(item.messageId, item.content);
  };

  return (
    <div className="group flex gap-4">
      <div className="flex-1 min-w-0">
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <Response>{item.content}</Response>
        </div>

        {showActions && (
          <Actions className={actionsClassName ?? undefined}>
            {/* Regenerate - only show on last message */}
            {isLast && onRegenerate && (
              <Action onClick={handleRegenerate} tooltip="Regenerate response">
                <RefreshCcwIcon className="size-3" />
              </Action>
            )}

            {/* Copy */}
            <Action onClick={handleCopy} tooltip={copied ? 'Copied!' : 'Copy'}>
              {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            </Action>

            {/* Like */}
            {onFeedback && (
              <Action
                onClick={handleLike}
                tooltip="Good response"
                className={feedback === 'like' ? 'text-green-600' : undefined}
              >
                <ThumbsUpIcon className="size-3" />
              </Action>
            )}

            {/* Dislike */}
            {onFeedback && (
              <Action
                onClick={handleDislike}
                tooltip="Poor response"
                className={feedback === 'dislike' ? 'text-red-600' : undefined}
              >
                <ThumbsDownIcon className="size-3" />
              </Action>
            )}

            {/* Send to Board */}
            <Action onClick={handleSendToBoard} tooltip="Send to board">
              <ClipboardPlusIcon className="size-3" />
            </Action>
          </Actions>
        )}
      </div>
    </div>
  );
});
