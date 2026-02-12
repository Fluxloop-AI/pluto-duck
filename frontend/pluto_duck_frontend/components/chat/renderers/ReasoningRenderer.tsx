'use client';

import { memo, useEffect, useRef, useState } from 'react';
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '../../ai-elements/reasoning';
import type { ReasoningItem } from '../../../types/chatRenderItem';

/**
 * Convert bold-only lines to h3 headings and collapse the blank line after them.
 * Regular paragraph spacing (double newlines) is preserved.
 */
function formatReasoningContent(text: string): string {
  // Step 1: bold-only lines → h3
  let result = text.replace(/^\*\*(.+?)\*\*$/gm, '### $1');
  // Step 2: remove the extra blank line right after a heading
  result = result.replace(/^(### .+)\n\n/gm, '$1\n');
  return result;
}

export interface ReasoningRendererProps {
  item: ReasoningItem;
  isDismissing?: boolean;
}

export const ReasoningRenderer = memo(function ReasoningRenderer({
  item,
  isDismissing = false,
}: ReasoningRendererProps) {
  const isStreamingPhase = item.phase === 'streaming';
  const hasContent = item.content.trim().length > 0;
  const prevIsStreamingPhaseRef = useRef(isStreamingPhase);
  const [isLocallyDismissing, setIsLocallyDismissing] = useState(false);

  useEffect(() => {
    const wasStreaming = prevIsStreamingPhaseRef.current;
    if (!isDismissing && wasStreaming && !isStreamingPhase && !hasContent) {
      setIsLocallyDismissing(true);
    }
    prevIsStreamingPhaseRef.current = isStreamingPhase;
  }, [hasContent, isDismissing, isStreamingPhase]);

  useEffect(() => {
    if (isDismissing) {
      setIsLocallyDismissing(true);
      return;
    }
    if (hasContent || isStreamingPhase) {
      setIsLocallyDismissing(false);
    }
  }, [hasContent, isDismissing, isStreamingPhase]);

  const isRenderingDismissing = isDismissing || isLocallyDismissing;
  const isStreaming = isStreamingPhase && !isRenderingDismissing;

  // Don't render if no content and not streaming
  if (!hasContent && !isStreaming && !isRenderingDismissing) {
    return null;
  }

  return (
    <div
      className={isRenderingDismissing ? 'animate-reasoning-fade-out overflow-hidden' : undefined}
      onAnimationEnd={isRenderingDismissing ? () => setIsLocallyDismissing(false) : undefined}
    >
      <Reasoning isStreaming={isStreaming} defaultOpen={false}>
        <ReasoningTrigger />
        <ReasoningContent>{formatReasoningContent(item.content || '')}</ReasoningContent>
      </Reasoning>
    </div>
  );
});
