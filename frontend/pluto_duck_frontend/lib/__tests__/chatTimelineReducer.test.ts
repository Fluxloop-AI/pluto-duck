import assert from 'node:assert/strict';
import test from 'node:test';

const reducerModuleUrl = new URL('../chatTimelineReducer.ts', import.meta.url);

test('dedupes duplicate events by run_id:event_id in unified reducer', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-reducer-dedupe';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'first' },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-1' },
        timestamp: '2026-02-08T23:10:03.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'second should be deduped' },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-1' },
        timestamp: '2026-02-08T23:10:03.500Z',
      },
    ],
    messages: [
      {
        id: 'u-1',
        role: 'user',
        content: { text: 'q' },
        created_at: '2026-02-08T23:10:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
  });

  const reasoningItems = items.filter((item: { type: string }) => item.type === 'reasoning') as Array<{
    content: string;
  }>;
  assert.equal(reasoningItems.length, 1);
  assert.equal(reasoningItems[0].content, 'first');
});

test('phase-aware reasoning keeps single row and ignores llm_end/llm_usage content', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-phase-aware';
  const items = buildTimelineItemsFromEvents({
    activeRunId: runId,
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 1, event_id: 'evt-start', phase: 'llm_start' },
        timestamp: '2026-02-09T00:00:01.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'step alpha' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-reason', phase: 'llm_reasoning' },
        timestamp: '2026-02-09T00:00:02.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_usage', reason: 'token usage metadata' },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-usage', phase: 'llm_usage' },
        timestamp: '2026-02-09T00:00:03.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_end', reason: 'must not appear in thought' },
        metadata: { run_id: runId, sequence: 4, event_id: 'evt-end', phase: 'llm_end' },
        timestamp: '2026-02-09T00:00:04.000Z',
      },
    ],
    messages: [
      {
        id: 'u-phase',
        role: 'user',
        content: { text: 'q' },
        created_at: '2026-02-09T00:00:00.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
  });

  const reasoningItems = items.filter((item: { type: string }) => item.type === 'reasoning') as Array<{
    content: string;
    status: string;
  }>;
  assert.equal(reasoningItems.length, 1);
  assert.equal(reasoningItems[0].content, 'step alpha');
  assert.equal(reasoningItems[0].status, 'complete');
});

test('active run reasoning chunks are merged into one streaming row before llm_end', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-phase-streaming';
  const items = buildTimelineItemsFromEvents({
    activeRunId: runId,
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 1, event_id: 'evt-s1', phase: 'llm_start' },
        timestamp: '2026-02-09T00:10:01.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'draft' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-s2', phase: 'llm_reasoning' },
        timestamp: '2026-02-09T00:10:02.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'draft refined' },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-s3', phase: 'llm_reasoning' },
        timestamp: '2026-02-09T00:10:03.000Z',
      },
    ],
  });

  const reasoningItems = items.filter((item: { type: string }) => item.type === 'reasoning') as Array<{
    content: string;
    isStreaming: boolean;
    status: string;
  }>;
  assert.equal(reasoningItems.length, 1);
  assert.equal(reasoningItems[0].content, 'draft refined');
  assert.equal(reasoningItems[0].isStreaming, true);
  assert.equal(reasoningItems[0].status, 'streaming');
});
