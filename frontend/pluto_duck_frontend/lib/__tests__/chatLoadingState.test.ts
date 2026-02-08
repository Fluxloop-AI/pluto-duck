import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatRenderItem } from '../../types/chatRenderItem';

const loadingStateModuleUrl = new URL('../chatLoadingState.ts', import.meta.url);

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
    content: 'hello',
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

test('prioritizes session-loading over all other modes', async () => {
  const { computeChatLoadingMode } = await import(loadingStateModuleUrl.href);
  const value = computeChatLoadingMode({
    loading: true,
    isStreaming: true,
    renderItems: [userItem('u1'), reasoningItem('r1', 'thinking', true)],
    hasMaterializedReasoningSpan: true,
  });
  assert.equal(value, 'session-loading');
});

test('returns reasoning-streaming before fallback when reasoning is materialized', async () => {
  const { computeChatLoadingMode } = await import(loadingStateModuleUrl.href);
  const value = computeChatLoadingMode({
    loading: false,
    isStreaming: true,
    renderItems: [userItem('u1')],
    hasMaterializedReasoningSpan: true,
  });
  assert.equal(value, 'reasoning-streaming');
});

test('returns agent-streaming-fallback when waiting for first streaming row', async () => {
  const { computeChatLoadingMode } = await import(loadingStateModuleUrl.href);
  const value = computeChatLoadingMode({
    loading: false,
    isStreaming: true,
    renderItems: [assistantItem('a-prev', false), userItem('u-latest')],
    hasMaterializedReasoningSpan: false,
  });
  assert.equal(value, 'agent-streaming-fallback');
});

test('returns idle when no loading/streaming condition is active', async () => {
  const { computeChatLoadingMode } = await import(loadingStateModuleUrl.href);
  const value = computeChatLoadingMode({
    loading: false,
    isStreaming: false,
    renderItems: [assistantItem('a1', false)],
    hasMaterializedReasoningSpan: false,
  });
  assert.equal(value, 'idle');
});

test('hasMaterializedReasoningSpan ignores empty reasoning and accepts non-empty reasoning', async () => {
  const { hasMaterializedReasoningSpan } = await import(loadingStateModuleUrl.href);
  assert.equal(hasMaterializedReasoningSpan([reasoningItem('r-empty', '   ', true)]), false);
  assert.equal(hasMaterializedReasoningSpan([reasoningItem('r-full', 'step 1', true)]), true);
});

test('empty streaming reasoning row does not block fallback mode', async () => {
  const { computeChatLoadingMode, hasMaterializedReasoningSpan } = await import(loadingStateModuleUrl.href);
  const renderItems = [userItem('u1'), reasoningItem('r1', '   ', true)];
  const value = computeChatLoadingMode({
    loading: false,
    isStreaming: true,
    renderItems,
    hasMaterializedReasoningSpan: hasMaterializedReasoningSpan(renderItems),
  });
  assert.equal(value, 'agent-streaming-fallback');
});

test('agent fallback is hidden when assistant already exists after latest user', async () => {
  const { shouldShowAgentStreamingFallback } = await import(loadingStateModuleUrl.href);
  const value = shouldShowAgentStreamingFallback({
    isStreaming: true,
    renderItems: [userItem('u1'), assistantItem('a1', false)],
  });
  assert.equal(value, false);
});
