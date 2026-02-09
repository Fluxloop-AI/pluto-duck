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
    segmentId: string;
    segmentOrder: number;
  }>;
  assert.equal(reasoningItems.length, 1);
  assert.equal(reasoningItems[0].content, 'first');
  assert.equal(reasoningItems[0].segmentId, 'evt-1');
  assert.equal(reasoningItems[0].segmentOrder, 0);
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

test('llm_start followed by llm_end without reasoning does not materialize thought', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-empty-span';
  const items = buildTimelineItemsFromEvents({
    activeRunId: runId,
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 1, event_id: 'evt-empty-start', phase: 'llm_start' },
        timestamp: '2026-02-09T00:15:01.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'end',
        content: { phase: 'llm_end' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-empty-end', phase: 'llm_end' },
        timestamp: '2026-02-09T00:15:02.000Z',
      },
    ],
  });

  const reasoningItems = items.filter((item: { type: string }) => item.type === 'reasoning');
  assert.equal(reasoningItems.length, 0);
});

test('same run creates segmented reasoning rows across llm_start/llm_end boundaries', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-segmented-reasoning';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 1, event_id: 'evt-seg-start-1', phase: 'llm_start' },
        timestamp: '2026-02-09T00:16:01.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'segment-one' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-seg-body-1', phase: 'llm_reasoning' },
        timestamp: '2026-02-09T00:16:02.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'end',
        content: { phase: 'llm_end' },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-seg-end-1', phase: 'llm_end' },
        timestamp: '2026-02-09T00:16:03.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 4, event_id: 'evt-seg-start-2', phase: 'llm_start' },
        timestamp: '2026-02-09T00:16:04.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'segment-two' },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-seg-body-2', phase: 'llm_reasoning' },
        timestamp: '2026-02-09T00:16:05.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'end',
        content: { phase: 'llm_end' },
        metadata: { run_id: runId, sequence: 6, event_id: 'evt-seg-end-2', phase: 'llm_end' },
        timestamp: '2026-02-09T00:16:06.000Z',
      },
    ],
  });

  const reasoningItems = items.filter((item: { type: string }) => item.type === 'reasoning') as Array<{
    content: string;
    segmentOrder: number;
  }>;
  assert.equal(reasoningItems.length, 2);
  assert.deepEqual(
    reasoningItems.map(item => [item.content, item.segmentOrder]),
    [
      ['segment-one', 0],
      ['segment-two', 1],
    ],
  );
});

test('segmented reasoning with same sequence keeps segmentOrder before id/timestamp tie-break', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-segment-order-tiebreak';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 1, event_id: 'evt-start-z', phase: 'llm_start' },
        timestamp: '2026-02-09T00:30:00.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'first-segment' },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-r2', phase: 'llm_reasoning' },
        timestamp: '2026-02-09T00:30:05.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'end',
        content: { phase: 'llm_end' },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-end-1', phase: 'llm_end' },
        timestamp: '2026-02-09T00:30:05.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'start',
        content: { phase: 'llm_start' },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-start-a', phase: 'llm_start' },
        timestamp: '2026-02-09T00:30:05.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { phase: 'llm_reasoning', reason: 'second-segment' },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-r1', phase: 'llm_reasoning' },
        timestamp: '2026-02-09T00:30:05.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'end',
        content: { phase: 'llm_end' },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-end-2', phase: 'llm_end' },
        timestamp: '2026-02-09T00:30:05.000Z',
      },
      {
        type: 'message',
        subtype: 'final',
        content: { text: 'done' },
        metadata: { run_id: runId, sequence: 6, event_id: 'evt-final' },
        timestamp: '2026-02-09T00:30:06.000Z',
      },
    ],
    messages: [
      {
        id: 'u-segment-order',
        role: 'user',
        content: { text: 'q' },
        created_at: '2026-02-09T00:30:00.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
  });

  const reasoningItems = items.filter((item: { type: string }) => item.type === 'reasoning') as Array<{
    content: string;
    segmentOrder: number;
    id: string;
  }>;
  assert.equal(reasoningItems.length, 2);
  assert.deepEqual(
    reasoningItems.map(item => [item.content, item.segmentOrder, item.id]),
    [
      ['first-segment', 0, 'evt-start-z'],
      ['second-segment', 1, 'evt-start-a'],
    ],
  );
});

test('sequence collision with clock skew stays deterministic regardless input order', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-clock-skew-deterministic';
  const baseEvents = [
    {
      type: 'reasoning',
      subtype: 'start',
      content: { phase: 'llm_start' },
      metadata: { run_id: runId, sequence: 1, event_id: 'evt-start', phase: 'llm_start' },
      timestamp: '2026-02-09T00:40:01.000Z',
    },
    {
      type: 'tool',
      subtype: 'start',
      content: { tool: 'search', input: { q: 'alpha' } },
      metadata: { run_id: runId, sequence: 5, event_id: 'evt-tool-start', tool_call_id: 'tc-1' },
      timestamp: '2026-02-09T00:39:59.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'chunk',
      content: { phase: 'llm_reasoning', reason: 'clock-skew-thought' },
      metadata: { run_id: runId, sequence: 5, event_id: 'evt-reason', phase: 'llm_reasoning' },
      timestamp: '2026-02-09T00:40:05.000Z',
    },
    {
      type: 'tool',
      subtype: 'end',
      content: { tool: 'search', output: { rows: 1 } },
      metadata: { run_id: runId, sequence: 6, event_id: 'evt-tool-end', tool_call_id: 'tc-1' },
      timestamp: '2026-02-09T00:40:06.000Z',
    },
    {
      type: 'message',
      subtype: 'final',
      content: { text: 'done' },
      metadata: { run_id: runId, sequence: 7, event_id: 'evt-final' },
      timestamp: '2026-02-09T00:40:07.000Z',
    },
  ];

  const messages = [
    {
      id: 'u-clock-skew',
      role: 'user',
      content: { text: 'q' },
      created_at: '2026-02-09T00:40:00.000Z',
      seq: 1,
      run_id: runId,
    },
  ];

  const forward = buildTimelineItemsFromEvents({
    events: baseEvents,
    messages,
  });
  const reversed = buildTimelineItemsFromEvents({
    events: [...baseEvents].reverse(),
    messages,
  });

  const compact = (items: Array<{ type: string; runId: string | null; content?: string }>) =>
    items.map(item => {
      if (item.type === 'reasoning') return `${item.type}:${item.runId}:${item.content}`;
      return `${item.type}:${item.runId}`;
    });

  assert.deepEqual(compact(forward), compact(reversed));
});

test('dedupes final message event when persisted assistant message has null run_id', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-first-turn-final';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'message',
        subtype: 'final',
        content: { text: 'first final answer' },
        metadata: { run_id: runId, sequence: 4, event_id: 'evt-first-final' },
        timestamp: '2026-02-09T00:20:04.000Z',
      },
    ],
    messages: [
      {
        id: 'u-first-turn',
        role: 'user',
        content: { text: 'hello' },
        created_at: '2026-02-09T00:20:01.000Z',
        seq: 1,
        run_id: runId,
      },
      {
        id: 'a-first-turn',
        role: 'assistant',
        content: { text: 'first final answer' },
        created_at: '2026-02-09T00:20:05.000Z',
        seq: 2,
        run_id: null,
      },
    ],
  });

  const assistantItems = items.filter((item: { type: string }) => item.type === 'assistant-message') as Array<{
    content: string;
    messageId?: string;
  }>;
  assert.equal(assistantItems.length, 1);
  assert.equal(assistantItems[0].messageId, 'a-first-turn');
  assert.equal(assistantItems[0].content, 'first final answer');
});

test('approval-control tool event stays in control lane without creating tool row', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-approval-control';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'tool',
        subtype: 'start',
        content: {
          tool: 'write_file',
          approval_required: true,
          approval_id: 'approval-control-1',
        },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-approval-control-start' },
        timestamp: '2026-02-09T00:50:03.000Z',
      },
    ],
  });

  const toolItems = items.filter((item: { type: string }) => item.type === 'tool');
  const approvalItems = items.filter((item: { type: string }) => item.type === 'approval') as Array<{
    intent?: string;
    lane?: string;
    decision?: string;
  }>;

  assert.equal(toolItems.length, 0);
  assert.equal(approvalItems.length, 1);
  assert.equal(approvalItems[0].intent, 'approval-control');
  assert.equal(approvalItems[0].lane, 'control');
  assert.equal(approvalItems[0].decision, 'pending');
});

test('late pending approval signal does not override approved decision anchor', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-approval-decision-anchor';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'tool',
        subtype: 'end',
        content: {
          tool: 'write_file',
          approval_id: 'approval-anchor-1',
          decision: 'approve',
        },
        metadata: { run_id: runId, sequence: 5, event_id: 'evt-approval-end', tool_call_id: 'tc-anchor' },
        timestamp: '2026-02-12T12:00:05.000Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: {
          tool: 'write_file',
          approval_required: true,
          approval_id: 'approval-anchor-1',
        },
        metadata: { run_id: runId, event_id: 'evt-approval-start-late', tool_call_id: 'tc-anchor' },
        timestamp: '2026-02-12T12:00:06.000Z',
      },
    ],
  });

  const approvalItems = items.filter((item: { type: string }) => item.type === 'approval') as Array<{
    id: string;
    decision?: string;
    sequence: number | null;
  }>;
  assert.equal(approvalItems.length, 1);
  assert.equal(approvalItems[0].id, 'approval-anchor-1');
  assert.equal(approvalItems[0].decision, 'approved');
  assert.equal(approvalItems[0].sequence, 5);
});

test('display_order sorts mixed message and event items in global order', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runA = 'run-display-a';
  const runB = 'run-display-b';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'r-b' },
        metadata: { run_id: runB, sequence: 1, display_order: 2, event_id: 'evt-display-r' },
        timestamp: '2026-02-20T01:00:02.000Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'search', input: { q: 'k' } },
        metadata: { run_id: runA, sequence: 99, display_order: 3, event_id: 'evt-display-t', tool_call_id: 'tc-1' },
        timestamp: '2026-02-20T01:00:03.000Z',
      },
    ],
    messages: [
      {
        id: 'u-display-1',
        role: 'user',
        content: { text: 'q1', display_order: 1 },
        created_at: '2026-02-20T01:00:01.000Z',
        seq: 1,
        run_id: runA,
        display_order: 1,
      },
      {
        id: 'a-display-1',
        role: 'assistant',
        content: { text: 'a1' },
        created_at: '2026-02-20T01:00:04.000Z',
        seq: 2,
        run_id: runB,
        display_order: 4,
      },
    ],
  });

  assert.deepEqual(items.map((item: { type: string }) => item.type), [
    'user-message',
    'reasoning',
    'tool',
    'assistant-message',
  ]);
});

test('items missing display_order keep legacy ordering path', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-legacy-fallback';
  const base = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'reasoning-first' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-legacy-r' },
        timestamp: '2026-02-20T02:00:02.000Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'search', input: { q: 'legacy' } },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-legacy-t', tool_call_id: 'tc-legacy' },
        timestamp: '2026-02-20T02:00:03.000Z',
      },
    ],
    messages: [
      {
        id: 'u-legacy',
        role: 'user',
        content: { text: 'legacy-q' },
        created_at: '2026-02-20T02:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
  });

  const mixed = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'reasoning-first' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-legacy-r' },
        timestamp: '2026-02-20T02:00:02.000Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'search', input: { q: 'legacy' } },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-legacy-t', tool_call_id: 'tc-legacy' },
        timestamp: '2026-02-20T02:00:03.000Z',
      },
    ],
    messages: [
      {
        id: 'u-legacy',
        role: 'user',
        content: { text: 'legacy-q', display_order: 1 },
        created_at: '2026-02-20T02:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
  });

  assert.deepEqual(
    mixed.map((item: { id: string; type: string }) => `${item.type}:${item.id}`),
    base.map((item: { id: string; type: string }) => `${item.type}:${item.id}`),
  );
});
