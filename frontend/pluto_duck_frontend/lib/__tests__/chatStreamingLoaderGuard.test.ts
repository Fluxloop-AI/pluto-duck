import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatRenderItem } from '../../types/chatRenderItem';

const guardModuleUrl = new URL('../chatStreamingLoaderGuard.ts', import.meta.url);

function baseItem(id: string): Omit<ChatRenderItem, 'type'> {
  return {
    id,
    runId: 'run-1',
    seq: 0,
    timestamp: '2026-02-08T00:00:00.000Z',
    isStreaming: false,
  };
}

function userItem(id: string): ChatRenderItem {
  return {
    ...baseItem(id),
    type: 'user-message',
    content: 'hi',
    messageId: id,
  };
}

function assistantItem(id: string, isStreaming: boolean): ChatRenderItem {
  return {
    ...baseItem(id),
    type: 'assistant-message',
    content: isStreaming ? 'partial' : 'final',
    messageId: id,
    isStreaming,
  };
}

function reasoningItem(id: string, content: string, isStreaming: boolean): ChatRenderItem {
  return {
    ...baseItem(id),
    type: 'reasoning',
    content,
    phase: isStreaming ? 'streaming' : 'complete',
    isStreaming,
  };
}

test('returns false when stream is not active', async () => {
  const { shouldShowFallbackStreamingLoader } = await import(guardModuleUrl.href);
  const value = shouldShowFallbackStreamingLoader({
    isStreaming: false,
    renderItems: [userItem('u1')],
  });
  assert.equal(value, false);
});

test('returns true when waiting after latest user without assistant row', async () => {
  const { shouldShowFallbackStreamingLoader } = await import(guardModuleUrl.href);
  const value = shouldShowFallbackStreamingLoader({
    isStreaming: true,
    renderItems: [assistantItem('a-prev', false), userItem('u-latest')],
  });
  assert.equal(value, true);
});

test('returns false when inline streaming row exists', async () => {
  const { shouldShowFallbackStreamingLoader } = await import(guardModuleUrl.href);
  const value = shouldShowFallbackStreamingLoader({
    isStreaming: true,
    renderItems: [userItem('u1'), assistantItem('a1', true)],
  });
  assert.equal(value, false);
});

test('returns true when only empty streaming reasoning row exists', async () => {
  const { shouldShowFallbackStreamingLoader } = await import(guardModuleUrl.href);
  const value = shouldShowFallbackStreamingLoader({
    isStreaming: true,
    renderItems: [userItem('u1'), reasoningItem('r1', '   ', true)],
  });
  assert.equal(value, true);
});

test('returns false when assistant already exists after latest user (regression)', async () => {
  const { shouldShowFallbackStreamingLoader } = await import(guardModuleUrl.href);
  const value = shouldShowFallbackStreamingLoader({
    isStreaming: true,
    renderItems: [userItem('u1'), assistantItem('a1', false)],
  });
  assert.equal(value, false);
});
