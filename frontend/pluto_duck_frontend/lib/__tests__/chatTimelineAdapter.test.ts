import assert from 'node:assert/strict';
import test from 'node:test';

const adapterModuleUrl = new URL('../chatTimelineAdapter.ts', import.meta.url);

test('interleaved reasoning/tool events keep sequential order', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-interleave';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { reason: 'step 1' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-r1' },
        timestamp: '2026-02-08T10:00:02.000Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'search', input: { q: 'alpha' } },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-t1s', tool_call_id: 'tc-1' },
        timestamp: '2026-02-08T10:00:03.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'step 2' },
        metadata: { run_id: runId, sequence: 4, event_id: 'evt-r2' },
        timestamp: '2026-02-08T10:00:04.000Z',
      },
      {
        type: 'tool',
        subtype: 'end',
        content: { tool: 'search', output: { rows: 3 } },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-t1e', tool_call_id: 'tc-1' },
        timestamp: '2026-02-08T10:00:05.000Z',
      },
      {
        type: 'message',
        subtype: 'final',
        content: { text: 'done' },
        metadata: { run_id: runId, sequence: 6, event_id: 'evt-m1' },
        timestamp: '2026-02-08T10:00:06.000Z',
      },
    ],
    messages: [
      {
        id: 'msg-user',
        role: 'user',
        content: { text: 'question' },
        created_at: '2026-02-08T10:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
  });

  assert.deepEqual(items.map((item: { type: string }) => item.type), [
    'user-message',
    'reasoning',
    'tool',
    'reasoning',
    'assistant-message',
  ]);

  const toolItem = items.find((item: { type: string }) => item.type === 'tool') as {
    state: string;
    output?: unknown;
  };
  assert.equal(toolItem.state, 'completed');
  assert.deepEqual(toolItem.output, { rows: 3 });
});

test('duplicate tool names are correlated by tool_call_id', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-tool-repeat';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'search', input: { q: 'A' } },
        metadata: { run_id: runId, sequence: 1, tool_call_id: 'tc-A' },
        timestamp: '2026-02-08T11:00:01.000Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'search', input: { q: 'B' } },
        metadata: { run_id: runId, sequence: 2, tool_call_id: 'tc-B' },
        timestamp: '2026-02-08T11:00:02.000Z',
      },
      {
        type: 'tool',
        subtype: 'end',
        content: { tool: 'search', output: { key: 'B' } },
        metadata: { run_id: runId, sequence: 3, tool_call_id: 'tc-B' },
        timestamp: '2026-02-08T11:00:03.000Z',
      },
      {
        type: 'tool',
        subtype: 'end',
        content: { tool: 'search', output: { key: 'A' } },
        metadata: { run_id: runId, sequence: 4, tool_call_id: 'tc-A' },
        timestamp: '2026-02-08T11:00:04.000Z',
      },
    ],
  });

  const toolItems = items.filter((item: { type: string }) => item.type === 'tool') as Array<{
    toolCallId?: string | null;
    output?: unknown;
    state: string;
  }>;
  assert.equal(toolItems.length, 2);
  assert.deepEqual(toolItems.map(item => item.toolCallId), ['tc-A', 'tc-B']);

  const first = toolItems.find(item => item.toolCallId === 'tc-A');
  const second = toolItems.find(item => item.toolCallId === 'tc-B');
  assert.equal(first?.state, 'completed');
  assert.equal(second?.state, 'completed');
  assert.deepEqual(first?.output, { key: 'A' });
  assert.deepEqual(second?.output, { key: 'B' });
});

test('missing sequence/tool_call_id falls back without rendering failure', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { reason: 'fallback reason' },
        timestamp: '2026-02-08T12:00:01.000Z',
      },
      {
        type: 'tool',
        subtype: 'error',
        content: { tool: 'search', message: 'failed' },
        timestamp: '2026-02-08T12:00:02.000Z',
      },
    ],
  });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item: { type: string }) => item.type), ['reasoning', 'tool']);
  const toolItem = items[1] as { state: string; error?: string };
  assert.equal(toolItem.state, 'error');
  assert.equal(toolItem.error, 'failed');
});

test('inactive run empty reasoning start does not leave ghost thinking rows', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const oldRunItems = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: 'run-old', sequence: 1, event_id: 'evt-old-r1', phase: 'llm_start' },
        timestamp: '2026-02-08T15:00:01.000Z',
      },
    ],
    activeRunId: 'run-active',
  });
  assert.equal(oldRunItems.filter((item: { type: string }) => item.type === 'reasoning').length, 0);

  const activeRunItems = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: 'run-active', sequence: 1, event_id: 'evt-active-r1', phase: 'llm_start' },
        timestamp: '2026-02-08T15:00:01.000Z',
      },
    ],
    activeRunId: 'run-active',
  });
  const reasoning = activeRunItems.find((item: { type: string }) => item.type === 'reasoning') as
    | { isStreaming: boolean; status: string }
    | undefined;
  assert.equal(Boolean(reasoning), true);
  assert.equal(reasoning?.isStreaming, true);
  assert.equal(reasoning?.status, 'streaming');
});

test('persisted assistant message is ordered using event sequence and message events are not duplicated', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-order-fix';
  const items = buildTimelineItemsFromEvents({
    messages: [
      {
        id: 'm-user',
        role: 'user',
        content: { text: 'hello' },
        created_at: '2026-02-08T17:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
      {
        id: 'm-assistant',
        role: 'assistant',
        content: { text: 'Hello! How can I help you today?' },
        created_at: '2026-02-08T17:00:05.000Z',
        seq: 2,
        run_id: runId,
      },
    ],
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 1, event_id: 'evt-r-start' },
        timestamp: '2026-02-08T17:00:01.100Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'intermediate thought' },
        metadata: { run_id: runId, sequence: 6, event_id: 'evt-r-chunk' },
        timestamp: '2026-02-08T17:00:04.900Z',
      },
      {
        type: 'message',
        subtype: 'final',
        content: { text: 'Hello! How can I help you today?' },
        metadata: { run_id: runId, sequence: 7, event_id: 'evt-m-final' },
        timestamp: '2026-02-08T17:00:05.100Z',
      },
    ],
  });

  const assistantItems = items.filter((item: { type: string }) => item.type === 'assistant-message') as Array<{
    sequence: number | null;
    messageId?: string;
  }>;
  assert.equal(assistantItems.length, 1);
  assert.equal(assistantItems[0].messageId, 'm-assistant');
  assert.equal(assistantItems[0].sequence, 7);

  const lastItemType = items[items.length - 1]?.type;
  assert.equal(lastItemType, 'assistant-message');
});
