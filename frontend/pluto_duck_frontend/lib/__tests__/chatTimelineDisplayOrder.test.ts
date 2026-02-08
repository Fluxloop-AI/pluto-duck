import assert from 'node:assert/strict';
import test from 'node:test';

const reducerModuleUrl = new URL('../chatTimelineReducer.ts', import.meta.url);

test('display_order keeps cross-run items in global order', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runA = 'run-display-order-a';
  const runB = 'run-display-order-b';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'reasoning-a' },
        metadata: { run_id: runA, sequence: 99, display_order: 2, event_id: 'evt-display-order-a' },
        timestamp: '2026-02-22T10:00:02.000Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'search', input: { q: 'display' } },
        metadata: {
          run_id: runB,
          sequence: 1,
          display_order: 3,
          event_id: 'evt-display-order-b',
          tool_call_id: 'tc-display-order-b',
        },
        timestamp: '2026-02-22T10:00:03.000Z',
      },
    ],
    messages: [
      {
        id: 'u-display-order',
        role: 'user',
        content: { text: 'question', display_order: 1 },
        created_at: '2026-02-22T10:00:01.000Z',
        seq: 1,
        display_order: 1,
        run_id: runA,
      },
      {
        id: 'a-display-order',
        role: 'assistant',
        content: { text: 'answer', display_order: 4 },
        created_at: '2026-02-22T10:00:04.000Z',
        seq: 2,
        display_order: 4,
        run_id: runB,
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

test('same-run same display_order uses lane rank ordering', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runId = 'run-display-order-lane-rank';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'thinking' },
        metadata: { run_id: runId, sequence: 2, display_order: 7, event_id: 'evt-lane-reasoning' },
        timestamp: '2026-02-22T11:00:02.000Z',
      },
      {
        type: 'message',
        subtype: 'final',
        content: { text: 'final from event' },
        metadata: { run_id: runId, sequence: 3, display_order: 7, event_id: 'evt-lane-final' },
        timestamp: '2026-02-22T11:00:03.000Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'write_file', approval_required: true, approval_id: 'approval-lane-rank' },
        metadata: {
          run_id: runId,
          sequence: 4,
          display_order: 7,
          event_id: 'evt-lane-approval',
          tool_call_id: 'tc-lane-approval',
        },
        timestamp: '2026-02-22T11:00:04.000Z',
      },
    ],
    messages: [
      {
        id: 'u-lane-rank-display',
        role: 'user',
        content: { text: 'question', display_order: 7 },
        created_at: '2026-02-22T11:00:01.000Z',
        seq: 1,
        display_order: 7,
        run_id: runId,
      },
    ],
  });

  const indexOfType = (type: string) => items.findIndex((item: { type: string }) => item.type === type);
  const userIndex = indexOfType('user-message');
  const reasoningIndex = indexOfType('reasoning');
  const assistantIndex = indexOfType('assistant-message');
  const approvalIndex = indexOfType('approval');

  assert.ok(userIndex >= 0);
  assert.ok(reasoningIndex >= 0);
  assert.ok(assistantIndex >= 0);
  assert.ok(approvalIndex >= 0);
  assert.ok(userIndex < reasoningIndex);
  assert.ok(reasoningIndex < assistantIndex);
  assert.ok(assistantIndex < approvalIndex);
});

test('missing display_order keeps legacy comparator behavior', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const run1 = 'run-legacy-1';
  const run2 = 'run-legacy-2';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'r1' },
        metadata: { run_id: run1, sequence: 2, event_id: 'evt-legacy-1' },
        timestamp: '2026-02-22T12:00:10.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'r2' },
        metadata: { run_id: run2, sequence: 2, event_id: 'evt-legacy-2' },
        timestamp: '2026-02-22T12:00:01.000Z',
      },
    ],
    messages: [
      {
        id: 'u-legacy-1',
        role: 'user',
        content: { text: 'first' },
        created_at: '2026-02-22T12:00:10.000Z',
        seq: 1,
        run_id: run1,
      },
      {
        id: 'u-legacy-2',
        role: 'user',
        content: { text: 'second' },
        created_at: '2026-02-22T12:00:00.000Z',
        seq: 2,
        run_id: run2,
      },
    ],
  });

  assert.deepEqual(
    items.map((item: { runId?: string | null }) => item.runId ?? null),
    [run1, run1, run2, run2],
  );
});

test('mixed legacy/new data remains deterministic with dual-path comparator', async () => {
  const { buildTimelineItemsFromEvents } = await import(reducerModuleUrl.href);

  const runLegacy = 'run-mixed-legacy';
  const runNew = 'run-mixed-new';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'read_file' },
        metadata: { run_id: runLegacy, sequence: 2, event_id: 'evt-mixed-legacy' },
        timestamp: '2026-02-22T13:00:03.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'new path' },
        metadata: { run_id: runNew, sequence: 1, display_order: 21, event_id: 'evt-mixed-new' },
        timestamp: '2026-02-22T13:00:02.000Z',
      },
    ],
    messages: [
      {
        id: 'u-mixed-legacy',
        role: 'user',
        content: { text: 'legacy first' },
        created_at: '2026-02-22T13:00:01.000Z',
        seq: 1,
        run_id: runLegacy,
      },
      {
        id: 'u-mixed-new',
        role: 'user',
        content: { text: 'new second', display_order: 20 },
        created_at: '2026-02-22T13:00:00.000Z',
        seq: 2,
        display_order: 20,
        run_id: runNew,
      },
    ],
  });

  assert.deepEqual(
    items.map((item: { type: string }) => item.type),
    ['user-message', 'tool', 'user-message', 'reasoning'],
  );
  assert.deepEqual(
    items.map((item: { runId?: string | null }) => item.runId ?? null),
    [runLegacy, runLegacy, runNew, runNew],
  );
});
