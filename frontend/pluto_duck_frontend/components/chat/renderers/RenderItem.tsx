'use client';

import { memo } from 'react';
import type { ChatRenderItem } from '../../../types/chatRenderItem';
import { UserMessageRenderer } from './UserMessageRenderer';
import { ReasoningRenderer } from './ReasoningRenderer';
import { ToolRenderer } from './ToolRenderer';
import { AssistantMessageRenderer, type FeedbackType } from './AssistantMessageRenderer';
import { ApprovalRenderer } from './ApprovalRenderer';

export interface RenderItemProps {
  item: ChatRenderItem;
  isDismissingReasoning?: boolean;
  isLastAssistant?: boolean;
  feedback?: FeedbackType;
  onEditUserMessage?: (messageId: string, content: string) => void;
  onCopy?: (text: string) => void;
  onRegenerate?: (messageId: string) => void;
  onFeedback?: (messageId: string, type: 'like' | 'dislike') => void;
  onSendToBoard?: (messageId: string, content: string) => void;
  onApprovalDecision?: (approvalEventId: string, runId: string | null, decision: 'approved' | 'rejected') => void;
}

export const RenderItem = memo(function RenderItem({
  item,
  isDismissingReasoning,
  isLastAssistant,
  feedback,
  onEditUserMessage,
  onCopy,
  onRegenerate,
  onFeedback,
  onSendToBoard,
  onApprovalDecision,
}: RenderItemProps) {
  switch (item.type) {
    case 'user-message':
      return (
        <UserMessageRenderer
          item={item}
          onEdit={onEditUserMessage}
          onCopy={onCopy}
        />
      );

    case 'reasoning':
      return (
        <ReasoningRenderer
          item={item}
          isDismissing={isDismissingReasoning}
        />
      );

    case 'tool':
      return <ToolRenderer item={item} />;

    case 'assistant-message':
      return (
        <AssistantMessageRenderer
          item={item}
          isLast={isLastAssistant}
          feedback={feedback}
          onCopy={onCopy}
          onRegenerate={onRegenerate}
          onFeedback={onFeedback}
          onSendToBoard={onSendToBoard}
        />
      );

    case 'approval':
      return (
        <ApprovalRenderer
          item={item}
          onDecision={onApprovalDecision}
        />
      );

    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = item;
      return null;
  }
});
