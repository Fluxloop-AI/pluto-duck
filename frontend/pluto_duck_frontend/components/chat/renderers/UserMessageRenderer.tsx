'use client';

import { memo } from 'react';
import type { UserMessageItem } from '../../../types/chatRenderItem';

/**
 * 텍스트에서 @mention을 하이라이트하여 렌더링
 */
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
      <span key={key++} className="text-primary font-medium">
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

export interface UserMessageRendererProps {
  item: UserMessageItem;
  onEdit?: (messageId: string, content: string) => void;
  onCopy?: (text: string) => void;
}

export const UserMessageRenderer = memo(function UserMessageRenderer({
  item,
}: UserMessageRendererProps) {
  return (
    <div className="flex justify-end">
      <div className="rounded-xl bg-muted px-4 py-2.5 text-foreground max-w-[80%]">
        <p className="text-sm whitespace-pre-wrap break-words">
          {renderTextWithMentions(item.content)}
        </p>
      </div>
    </div>
  );
});
