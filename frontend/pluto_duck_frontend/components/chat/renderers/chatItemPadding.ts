import type { ChatRenderItem } from '../../../types/chatRenderItem';

function isCompactStepItem(item: ChatRenderItem | undefined): boolean {
  if (!item) {
    return false;
  }
  return item.type === 'reasoning' || item.type === 'tool';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled chat item type: ${String(value)}`);
}

export function getChatItemPadding(
  item: ChatRenderItem,
  nextItem: ChatRenderItem | undefined
): string {
  switch (item.type) {
    case 'user-message':
      return 'pl-[14px] pr-3 pt-0 pb-3';
    case 'tool':
      return `pl-0 pr-0 pt-0 ${isCompactStepItem(nextItem) ? 'pb-0.5' : 'pb-0'}`;
    case 'reasoning':
      return `px-0 pt-0 ${isCompactStepItem(nextItem) ? 'pb-0.5' : 'pb-0'}`;
    case 'assistant-message':
      return 'pl-[14px] pr-3 pt-1 pb-3';
    case 'approval':
      return 'pl-2 pr-2 pt-3 pb-4';
    default:
      return assertNever(item);
  }
}
