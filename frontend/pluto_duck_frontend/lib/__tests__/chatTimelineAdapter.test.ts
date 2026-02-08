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
    'assistant-message',
  ]);

  const toolItem = items.find((item: { type: string }) => item.type === 'tool') as {
    state: string;
    output?: unknown;
  };
  assert.equal(toolItem.state, 'completed');
  assert.deepEqual(toolItem.output, { rows: 3 });
});

test('segmented reasoning spans interleave with tool events in sequence order', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-segmented-interleave';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-r-start-1', phase: 'llm_start' },
        timestamp: '2026-02-10T10:00:02.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'first thought' },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-r-body-1', phase: 'llm_reasoning' },
        timestamp: '2026-02-10T10:00:03.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'end',
        content: { phase: 'llm_end' },
        metadata: { run_id: runId, sequence: 4, event_id: 'evt-r-end-1', phase: 'llm_end' },
        timestamp: '2026-02-10T10:00:04.000Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'search', input: { q: 'alpha' } },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-t-start', tool_call_id: 'tc-1' },
        timestamp: '2026-02-10T10:00:05.000Z',
      },
      {
        type: 'tool',
        subtype: 'end',
        content: { tool: 'search', output: { rows: 2 } },
        metadata: { run_id: runId, sequence: 6, event_id: 'evt-t-end', tool_call_id: 'tc-1' },
        timestamp: '2026-02-10T10:00:06.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 7, event_id: 'evt-r-start-2', phase: 'llm_start' },
        timestamp: '2026-02-10T10:00:07.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'second thought' },
        metadata: { run_id: runId, sequence: 8, event_id: 'evt-r-body-2', phase: 'llm_reasoning' },
        timestamp: '2026-02-10T10:00:08.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'end',
        content: { phase: 'llm_end' },
        metadata: { run_id: runId, sequence: 9, event_id: 'evt-r-end-2', phase: 'llm_end' },
        timestamp: '2026-02-10T10:00:09.000Z',
      },
      {
        type: 'message',
        subtype: 'final',
        content: { text: 'done' },
        metadata: { run_id: runId, sequence: 10, event_id: 'evt-m-final' },
        timestamp: '2026-02-10T10:00:10.000Z',
      },
    ],
    messages: [
      {
        id: 'u-segmented-interleave',
        role: 'user',
        content: { text: 'question' },
        created_at: '2026-02-10T10:00:01.000Z',
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

  const reasoningItems = items.filter((item: { type: string }) => item.type === 'reasoning') as Array<{
    content: string;
    segmentOrder: number;
  }>;
  assert.deepEqual(
    reasoningItems.map(item => [item.content, item.segmentOrder]),
    [
      ['first thought', 0],
      ['second thought', 1],
    ],
  );
});

test('llm_start -> llm_end without reasoning text drops span completely', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-empty-span-drop';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-empty-start', phase: 'llm_start' },
        timestamp: '2026-02-10T10:10:02.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'end',
        content: { phase: 'llm_end' },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-empty-end', phase: 'llm_end' },
        timestamp: '2026-02-10T10:10:03.000Z',
      },
    ],
    messages: [
      {
        id: 'u-empty-span-drop',
        role: 'user',
        content: { text: 'question' },
        created_at: '2026-02-10T10:10:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
    activeRunId: runId,
  });

  assert.equal(items.filter((item: { type: string }) => item.type === 'reasoning').length, 0);
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

test('llm_start is non-visual and does not leave ghost thinking rows', async () => {
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
  assert.equal(activeRunItems.filter((item: { type: string }) => item.type === 'reasoning').length, 0);
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

test('llm_end reasoning text duplicated with final assistant is suppressed', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-llm-end-dedupe';
  const finalText = 'Okay — what would you like to try again?';
  const items = buildTimelineItemsFromEvents({
    messages: [
      {
        id: 'user-1',
        role: 'user',
        content: { text: 'retry' },
        created_at: '2026-02-08T18:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: { text: finalText },
        created_at: '2026-02-08T18:00:04.000Z',
        seq: 2,
        run_id: runId,
      },
    ],
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'clarifying' },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-r5', phase: 'llm_reasoning' },
        timestamp: '2026-02-08T18:00:03.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_end', text: finalText },
        metadata: { run_id: runId, sequence: 6, event_id: 'evt-r6', phase: 'llm_end' },
        timestamp: '2026-02-08T18:00:03.100Z',
      },
      {
        type: 'message',
        subtype: 'final',
        content: { text: finalText },
        metadata: { run_id: runId, sequence: 7, event_id: 'evt-m7' },
        timestamp: '2026-02-08T18:00:03.200Z',
      },
    ],
  });

  const reasoningItems = items.filter((item: { type: string }) => item.type === 'reasoning') as Array<{
    content: string;
  }>;
  assert.equal(reasoningItems.length, 1);
  assert.equal(reasoningItems[0].content, 'clarifying');

  const assistantItems = items.filter((item: { type: string }) => item.type === 'assistant-message');
  assert.equal(assistantItems.length, 1);
});

test('reasoning text duplicated with final assistant is suppressed even without phase', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-no-phase-dedupe';
  const finalText = 'Okay — what would you like to try again?';
  const items = buildTimelineItemsFromEvents({
    messages: [
      {
        id: 'user-2',
        role: 'user',
        content: { text: 'retry' },
        created_at: '2026-02-08T19:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: { text: finalText },
        created_at: '2026-02-08T19:00:04.000Z',
        seq: 2,
        run_id: runId,
      },
    ],
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: finalText },
        metadata: { run_id: runId, sequence: 6, event_id: 'evt-r-no-phase' },
        timestamp: '2026-02-08T19:00:03.100Z',
      },
      {
        type: 'message',
        subtype: 'final',
        content: { text: finalText },
        metadata: { run_id: runId, sequence: 7, event_id: 'evt-m-no-phase' },
        timestamp: '2026-02-08T19:00:03.200Z',
      },
    ],
  });

  const reasoningItems = items.filter((item: { type: string }) => item.type === 'reasoning');
  assert.equal(reasoningItems.length, 0);

  const assistantItems = items.filter((item: { type: string }) => item.type === 'assistant-message');
  assert.equal(assistantItems.length, 1);
});

test('empty streaming reasoning row is suppressed once final assistant exists for the run', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-empty-streaming-suppressed';
  const items = buildTimelineItemsFromEvents({
    messages: [
      {
        id: 'user-3',
        role: 'user',
        content: { text: 'hello' },
        created_at: '2026-02-08T20:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
      {
        id: 'assistant-3',
        role: 'assistant',
        content: { text: 'Hello! How can I help you today?' },
        created_at: '2026-02-08T20:00:04.000Z',
        seq: 2,
        run_id: runId,
      },
    ],
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-r-empty' },
        timestamp: '2026-02-08T20:00:03.000Z',
      },
      {
        type: 'message',
        subtype: 'final',
        content: { text: 'Hello! How can I help you today?' },
        metadata: { run_id: runId, sequence: 6, event_id: 'evt-m-final-2' },
        timestamp: '2026-02-08T20:00:03.200Z',
      },
    ],
    activeRunId: runId,
  });

  const reasoningItems = items.filter((item: { type: string }) => item.type === 'reasoning');
  assert.equal(reasoningItems.length, 0);
});

test('cross-run timeline ordering follows timestamp to prevent second-turn jump-to-top', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const run1 = 'run-cross-order-1';
  const run2 = 'run-cross-order-2';
  const items = buildTimelineItemsFromEvents({
    messages: [
      {
        id: 'u-1',
        role: 'user',
        content: { text: '안녕!' },
        created_at: '2026-02-08T21:00:01.000Z',
        seq: 1,
        run_id: run1,
      },
      {
        id: 'a-1',
        role: 'assistant',
        content: { text: 'Hello! How can I help you today?' },
        created_at: '2026-02-08T21:00:03.000Z',
        seq: 2,
        run_id: run1,
      },
      {
        id: 'u-2',
        role: 'user',
        content: { text: '음...' },
        created_at: '2026-02-08T21:00:05.000Z',
        seq: 1,
        run_id: run2,
      },
    ],
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'second run thought' },
        metadata: { run_id: run2, sequence: 1, event_id: 'evt-r2-body', phase: 'llm_reasoning' },
        timestamp: '2026-02-08T21:00:05.100Z',
      },
    ],
    activeRunId: run2,
  });

  const compactOrder = items.map((item: { type: string; messageId?: string; runId?: string | null }) => {
    if (item.type === 'user-message' || item.type === 'assistant-message') return `${item.type}:${item.messageId}`;
    return `${item.type}:${item.runId ?? 'orphan'}`;
  });

  assert.deepEqual(compactOrder, [
    'user-message:u-1',
    'assistant-message:a-1',
    'user-message:u-2',
    `reasoning:${run2}`,
  ]);
});

test('same-run mixed message/event sequence spaces keep user message before later reasoning by timestamp', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const run1 = 'run-mixed-seq-1';
  const run2 = 'run-mixed-seq-2';
  const items = buildTimelineItemsFromEvents({
    messages: [
      {
        id: 'u-1',
        role: 'user',
        content: { text: '첫 질문' },
        created_at: '2026-02-08T22:00:01.000Z',
        seq: 1,
        run_id: run1,
      },
      {
        id: 'a-1',
        role: 'assistant',
        content: { text: '첫 답변' },
        created_at: '2026-02-08T22:00:03.000Z',
        seq: 2,
        run_id: run1,
      },
      {
        id: 'u-2',
        role: 'user',
        content: { text: '두 번째 질문' },
        created_at: '2026-02-08T22:00:05.000Z',
        seq: 3,
        run_id: run2,
      },
    ],
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'second run thought' },
        metadata: { run_id: run2, sequence: 1, event_id: 'evt-r2-body', phase: 'llm_reasoning' },
        timestamp: '2026-02-08T22:00:05.100Z',
      },
    ],
    activeRunId: run2,
  });

  const compactOrder = items.map((item: { type: string; messageId?: string; runId?: string | null }) => {
    if (item.type === 'user-message' || item.type === 'assistant-message') return `${item.type}:${item.messageId}`;
    return `${item.type}:${item.runId ?? 'orphan'}`;
  });

  assert.deepEqual(compactOrder, [
    'user-message:u-1',
    'assistant-message:a-1',
    'user-message:u-2',
    `reasoning:${run2}`,
  ]);
});

test('run order remains stable when persisted and live timestamps use different clock bases', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const run1 = 'run-clock-skew-1';
  const run2 = 'run-clock-skew-2';
  const items = buildTimelineItemsFromEvents({
    messages: [
      {
        id: 'u-1',
        role: 'user',
        content: { text: '첫 질문' },
        created_at: '2026-02-08T17:07:13.451Z',
        seq: 1,
        run_id: run1,
      },
      {
        id: 'a-1',
        role: 'assistant',
        content: { text: '첫 답변' },
        created_at: '2026-02-08T17:07:20.482Z',
        seq: 2,
        run_id: run1,
      },
      {
        id: 'u-2-temp',
        role: 'user',
        content: { text: '두 번째 질문' },
        created_at: '2026-02-08T08:07:23.011Z',
        seq: 3,
        run_id: run2,
      },
    ],
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'second run thought' },
        metadata: { run_id: run2, sequence: 1, event_id: 'evt-r2-body', phase: 'llm_reasoning' },
        timestamp: '2026-02-08T08:07:23.320Z',
      },
    ],
    activeRunId: run2,
    streamingChunkText: '두 번째 답변 스트리밍',
    streamingChunkIsFinal: false,
  });

  const compactOrder = items.map((item: { type: string; messageId?: string; runId?: string | null }) => {
    if (item.type === 'user-message' || item.type === 'assistant-message') return `${item.type}:${item.messageId}`;
    return `${item.type}:${item.runId ?? 'orphan'}`;
  });

  assert.deepEqual(compactOrder, [
    'user-message:u-1',
    'assistant-message:a-1',
    'user-message:u-2-temp',
    `reasoning:${run2}`,
    'assistant-message:undefined',
  ]);
});

test('optimistic user message without run_id keeps conversation seq order despite timestamp skew', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const run1 = 'run-optimistic-order-1';
  const items = buildTimelineItemsFromEvents({
    messages: [
      {
        id: 'u-1',
        role: 'user',
        content: { text: '첫 질문' },
        created_at: '2026-02-08T17:10:01.000Z',
        seq: 1,
        run_id: run1,
      },
      {
        id: 'a-1',
        role: 'assistant',
        content: { text: '첫 답변' },
        created_at: '2026-02-08T17:10:04.000Z',
        seq: 2,
        run_id: run1,
      },
      {
        id: 'u-2-temp',
        role: 'user',
        content: { text: '두 번째 질문(optimistic)' },
        created_at: '2026-02-08T08:10:05.000Z',
        seq: 3,
        run_id: null,
      },
    ],
    events: [],
  });

  const order = items.map((item: { type: string; messageId?: string }) => `${item.type}:${item.messageId}`);
  assert.deepEqual(order, [
    'user-message:u-1',
    'assistant-message:a-1',
    'user-message:u-2-temp',
  ]);
});

test('run1 final event stays above runless optimistic user message before run2 is materialized', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const run1 = 'run-transient-order-1';
  const items = buildTimelineItemsFromEvents({
    messages: [
      {
        id: 'u-1',
        role: 'user',
        content: { text: '첫 질문' },
        created_at: '2026-02-08T17:20:01.000Z',
        seq: 1,
        run_id: run1,
      },
      {
        id: 'u-2-temp',
        role: 'user',
        content: { text: '두 번째 질문(optimistic)' },
        created_at: '2026-02-08T08:20:03.000Z',
        seq: 3,
        run_id: null,
      },
    ],
    events: [
      {
        type: 'message',
        subtype: 'final',
        content: { text: '첫 답변(이벤트 기반)' },
        metadata: { run_id: run1, sequence: 27, event_id: 'evt-run1-final' },
        timestamp: '2026-02-08T08:20:02.000Z',
      },
    ],
  });

  const order = items.map((item: { type: string; messageId?: string }) => `${item.type}:${item.messageId}`);
  assert.deepEqual(order, [
    'user-message:u-1',
    'assistant-message:undefined',
    'user-message:u-2-temp',
  ]);
});

test('llm_reasoning/llm_end/llm_usage/final sequence keeps a stable single thought row', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-phase4-thought-stability';
  const baseEvents = [
    {
      type: 'reasoning',
      subtype: 'start',
      content: { phase: 'llm_start' },
      metadata: { run_id: runId, sequence: 2, event_id: 'evt-r-start', phase: 'llm_start' },
      timestamp: '2026-02-09T02:00:02.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'chunk',
      content: { phase: 'llm_reasoning', reason: 'thought body' },
      metadata: { run_id: runId, sequence: 3, event_id: 'evt-r-body', phase: 'llm_reasoning' },
      timestamp: '2026-02-09T02:00:03.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'chunk',
      content: { phase: 'llm_usage', reason: 'usage should not render' },
      metadata: { run_id: runId, sequence: 4, event_id: 'evt-r-usage', phase: 'llm_usage' },
      timestamp: '2026-02-09T02:00:04.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'chunk',
      content: { phase: 'llm_end', reason: 'end marker should not duplicate thought' },
      metadata: { run_id: runId, sequence: 5, event_id: 'evt-r-end', phase: 'llm_end' },
      timestamp: '2026-02-09T02:00:05.000Z',
    },
    {
      type: 'message',
      subtype: 'final',
      content: { text: 'final answer' },
      metadata: { run_id: runId, sequence: 6, event_id: 'evt-m-final' },
      timestamp: '2026-02-09T02:00:06.000Z',
    },
  ];

  const settlingItems = buildTimelineItemsFromEvents({
    events: baseEvents,
    messages: [
      {
        id: 'u-phase4',
        role: 'user',
        content: { text: 'q' },
        created_at: '2026-02-09T02:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
    activeRunId: runId,
  });
  const settlingThought = settlingItems.filter((item: { type: string }) => item.type === 'reasoning') as Array<{
    content: string;
  }>;
  assert.equal(settlingThought.length, 1);
  assert.equal(settlingThought[0].content, 'thought body');

  const persistedItems = buildTimelineItemsFromEvents({
    events: baseEvents,
    messages: [
      {
        id: 'u-phase4',
        role: 'user',
        content: { text: 'q' },
        created_at: '2026-02-09T02:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
      {
        id: 'a-phase4',
        role: 'assistant',
        content: { text: 'final answer' },
        created_at: '2026-02-09T02:00:07.000Z',
        seq: 2,
        run_id: runId,
      },
    ],
    activeRunId: runId,
  });
  const persistedThought = persistedItems.filter((item: { type: string }) => item.type === 'reasoning') as Array<{
    content: string;
  }>;
  assert.equal(persistedThought.length, 1);
  assert.equal(persistedThought[0].content, 'thought body');
});

test('message.final transitions cleanly to persisted assistant without duplication', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-phase4-reconcile';
  const events = [
    {
      type: 'reasoning',
      subtype: 'chunk',
      content: { phase: 'llm_reasoning', reason: 'thinking' },
      metadata: { run_id: runId, sequence: 2, event_id: 'evt-r1', phase: 'llm_reasoning' },
      timestamp: '2026-02-09T02:10:02.000Z',
    },
    {
      type: 'message',
      subtype: 'final',
      content: { text: 'answer text' },
      metadata: { run_id: runId, sequence: 3, event_id: 'evt-m1' },
      timestamp: '2026-02-09T02:10:03.000Z',
    },
  ];

  const settlingItems = buildTimelineItemsFromEvents({
    events,
    messages: [
      {
        id: 'u-reconcile',
        role: 'user',
        content: { text: 'hello' },
        created_at: '2026-02-09T02:10:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
    activeRunId: runId,
  });
  const settlingAssistant = settlingItems.filter((item: { type: string }) => item.type === 'assistant-message');
  assert.equal(settlingAssistant.length, 1);

  const persistedItems = buildTimelineItemsFromEvents({
    events,
    messages: [
      {
        id: 'u-reconcile',
        role: 'user',
        content: { text: 'hello' },
        created_at: '2026-02-09T02:10:01.000Z',
        seq: 1,
        run_id: runId,
      },
      {
        id: 'a-reconcile',
        role: 'assistant',
        content: { text: 'answer text' },
        created_at: '2026-02-09T02:10:04.000Z',
        seq: 2,
        run_id: runId,
      },
    ],
    activeRunId: runId,
  });
  const persistedAssistant = persistedItems.filter((item: { type: string }) => item.type === 'assistant-message') as Array<{
    messageId?: string;
  }>;
  assert.equal(persistedAssistant.length, 1);
  assert.equal(persistedAssistant[0].messageId, 'a-reconcile');
});

test('message chunk deltas are not rendered as raw assistant rows', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-chunk-suppressed';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'message',
        subtype: 'chunk',
        content: { text_delta: 'hello ', is_final: false },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-c1' },
        timestamp: '2026-02-09T03:00:02.000Z',
      },
      {
        type: 'message',
        subtype: 'chunk',
        content: { text_delta: 'world', is_final: false },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-c2' },
        timestamp: '2026-02-09T03:00:03.000Z',
      },
    ],
    messages: [
      {
        id: 'u-chunk',
        role: 'user',
        content: { text: 'q' },
        created_at: '2026-02-09T03:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
    activeRunId: runId,
    streamingChunkText: 'hello world',
    streamingChunkIsFinal: false,
  });

  const assistantItems = items.filter((item: { type: string }) => item.type === 'assistant-message') as Array<{
    content: string;
  }>;
  assert.equal(assistantItems.length, 1);
  assert.equal(assistantItems[0].content, 'hello world');
});

test('final event suppresses duplicate completed streaming chunk row', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-final-no-dup-stream';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'message',
        subtype: 'final',
        content: { text: 'final answer' },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-final' },
        timestamp: '2026-02-09T03:10:03.000Z',
      },
    ],
    messages: [
      {
        id: 'u-final-no-dup',
        role: 'user',
        content: { text: 'q' },
        created_at: '2026-02-09T03:10:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
    activeRunId: runId,
    streamingChunkText: 'final answer',
    streamingChunkIsFinal: true,
  });

  const assistantItems = items.filter((item: { type: string }) => item.type === 'assistant-message');
  assert.equal(assistantItems.length, 1);
});

test('approval event is preserved after final assistant in interleaved timeline', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-approval-interleave';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-r-start', phase: 'llm_start' },
        timestamp: '2026-02-10T11:00:02.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'plan first' },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-r-body', phase: 'llm_reasoning' },
        timestamp: '2026-02-10T11:00:03.000Z',
      },
      {
        type: 'tool',
        subtype: 'end',
        content: { tool: 'search', output: { rows: 1 } },
        metadata: { run_id: runId, sequence: 4, event_id: 'evt-tool-end', tool_call_id: 'tc-approval' },
        timestamp: '2026-02-10T11:00:04.000Z',
      },
      {
        type: 'message',
        subtype: 'final',
        content: { text: 'final answer before approval' },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-final' },
        timestamp: '2026-02-10T11:00:05.000Z',
      },
      {
        type: 'plan',
        subtype: 'start',
        content: { description: 'Approve file write', decision: 'pending' },
        metadata: { run_id: runId, sequence: 6, event_id: 'evt-approval' },
        timestamp: '2026-02-10T11:00:06.000Z',
      },
    ],
    messages: [
      {
        id: 'u-approval-interleave',
        role: 'user',
        content: { text: 'run tool' },
        created_at: '2026-02-10T11:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
  });

  assert.deepEqual(items.map((item: { type: string }) => item.type), [
    'user-message',
    'reasoning',
    'tool',
    'assistant-message',
    'approval',
  ]);

  const lastItem = items[items.length - 1] as { type: string; decision?: string; content?: string };
  assert.equal(lastItem.type, 'approval');
  assert.equal(lastItem.decision, 'pending');
  assert.equal(lastItem.content, 'Approve file write');
});

test('approval stays visible after final assistant is persisted on refetch', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-approval-persist';
  const events = [
    {
      type: 'message',
      subtype: 'final',
      content: { text: 'final answer before approval' },
      metadata: { run_id: runId, sequence: 3, event_id: 'evt-final' },
      timestamp: '2026-02-10T11:10:03.000Z',
    },
    {
      type: 'plan',
      subtype: 'start',
      content: { description: 'Approve operation', decision: 'pending' },
      metadata: { run_id: runId, sequence: 4, event_id: 'evt-approval' },
      timestamp: '2026-02-10T11:10:04.000Z',
    },
  ];

  const settlingItems = buildTimelineItemsFromEvents({
    events,
    messages: [
      {
        id: 'u-approval-persist',
        role: 'user',
        content: { text: 'go' },
        created_at: '2026-02-10T11:10:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
    activeRunId: runId,
  });
  assert.equal(settlingItems.filter((item: { type: string }) => item.type === 'approval').length, 1);

  const persistedItems = buildTimelineItemsFromEvents({
    events,
    messages: [
      {
        id: 'u-approval-persist',
        role: 'user',
        content: { text: 'go' },
        created_at: '2026-02-10T11:10:01.000Z',
        seq: 1,
        run_id: runId,
      },
      {
        id: 'a-approval-persist',
        role: 'assistant',
        content: { text: 'final answer before approval' },
        created_at: '2026-02-10T11:10:05.000Z',
        seq: 2,
        run_id: runId,
      },
    ],
    activeRunId: runId,
  });

  assert.deepEqual(persistedItems.map((item: { type: string }) => item.type), [
    'user-message',
    'assistant-message',
    'approval',
  ]);
});
