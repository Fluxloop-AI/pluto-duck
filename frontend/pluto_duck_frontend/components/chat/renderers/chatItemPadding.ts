import type { ChatRenderItem } from '../../../types/chatRenderItem';

function isCompactStepItem(item: ChatRenderItem | undefined): boolean {
  if (!item) {
    return false;
  }
  return item.type === 'reasoning' || item.type === 'tool';
}

export function getChatItemPadding(
  item: ChatRenderItem,
  nextItem: ChatRenderItem | undefined
): string {
  if (item.type === 'user-message') {
    return 'pl-[14px] pr-3 pt-0 pb-3';
  }
  if (item.type === 'tool') {
    return `pl-0 pr-0 pt-0 ${isCompactStepItem(nextItem) ? 'pb-0.5' : 'pb-0'}`;
  }
  if (item.type === 'reasoning') {
    return `px-0 pt-0 ${isCompactStepItem(nextItem) ? 'pb-0.5' : 'pb-0'}`;
  }
  if (item.type === 'assistant-message') {
    return 'pl-[14px] pr-3 pt-1 pb-3';
  }
  if (item.type === 'approval') {
    return 'pl-2 pr-2 pt-2 pb-4';
  }
  return 'pl-[14px] pr-3 pt-0 pb-2';
}
