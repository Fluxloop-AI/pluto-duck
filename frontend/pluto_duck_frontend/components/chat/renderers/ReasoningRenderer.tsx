'use client';

import { memo } from 'react';
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '../../ai-elements/reasoning';
import type { ReasoningItem } from '../../../types/chatRenderItem';

export interface ReasoningRendererProps {
  item: ReasoningItem;
}

export const ReasoningRenderer = memo(function ReasoningRenderer({
  item,
}: ReasoningRendererProps) {
  const isStreaming = item.phase === 'streaming';

  // Don't render if no content and not streaming
  if (!item.content && !isStreaming) {
    return null;
  }

  return (
    <Reasoning isStreaming={isStreaming} defaultOpen={false}>
      <ReasoningTrigger />
      <ReasoningContent>{item.content || ''}</ReasoningContent>
    </Reasoning>
  );
});
