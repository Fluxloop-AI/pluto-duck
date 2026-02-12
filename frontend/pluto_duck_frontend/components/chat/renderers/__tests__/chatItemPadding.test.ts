import assert from 'node:assert/strict';
import test from 'node:test';
import { getChatItemPadding } from '../chatItemPadding.ts';
import type { ChatRenderItem } from '../../../../types/chatRenderItem';

function buildItem(type: ChatRenderItem['type']): ChatRenderItem {
  const base = {
    id: `${type}-id`,
    runId: 'run-1',
    seq: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    isStreaming: false,
  };

  if (type === 'user-message') {
    return { ...base, type, content: 'hi', messageId: 'm-user' };
  }
  if (type === 'reasoning') {
    return { ...base, type, content: 'thinking', phase: 'complete' };
  }
  if (type === 'tool') {
    return { ...base, type, toolName: 'search', state: 'completed' };
  }
  if (type === 'tool-group') {
    return {
      ...base,
      type,
      toolName: 'search',
      state: 'completed',
      children: [{ ...base, id: 'tool-child-1', type: 'tool', toolName: 'search', state: 'completed' }],
    };
  }
  if (type === 'assistant-message') {
    return { ...base, type, content: 'hello', messageId: 'm-assistant' };
  }
  return { ...base, type, decision: 'pending', content: 'approval needed' };
}

test('keeps message-level spacing for user and assistant blocks', () => {
  assert.equal(getChatItemPadding(buildItem('user-message'), undefined), 'pl-[14px] pr-3 pt-0 pb-3');
  assert.equal(getChatItemPadding(buildItem('assistant-message'), undefined), 'pl-[14px] pr-3 pt-1 pb-3');
});

test('applies 2px bottom spacing between consecutive step items', () => {
  assert.equal(getChatItemPadding(buildItem('reasoning'), buildItem('tool')), 'px-0 pt-0 pb-0.5');
  assert.equal(getChatItemPadding(buildItem('tool'), buildItem('reasoning')), 'pl-0 pr-0 pt-0 pb-0.5');
  assert.equal(getChatItemPadding(buildItem('tool-group'), buildItem('reasoning')), 'pl-0 pr-0 pt-0 pb-0.5');
  assert.equal(getChatItemPadding(buildItem('reasoning'), buildItem('tool-group')), 'px-0 pt-0 pb-0.5');
});

test('removes extra bottom spacing when next item is not reasoning/tool', () => {
  assert.equal(getChatItemPadding(buildItem('reasoning'), buildItem('assistant-message')), 'px-0 pt-0 pb-0');
  assert.equal(getChatItemPadding(buildItem('tool'), undefined), 'pl-0 pr-0 pt-0 pb-0');
  assert.equal(getChatItemPadding(buildItem('tool-group'), buildItem('assistant-message')), 'pl-0 pr-0 pt-0 pb-0');
});

test('keeps approval spacing unchanged', () => {
  assert.equal(getChatItemPadding(buildItem('approval'), undefined), 'pl-2 pr-2 pt-3 pb-4');
});
