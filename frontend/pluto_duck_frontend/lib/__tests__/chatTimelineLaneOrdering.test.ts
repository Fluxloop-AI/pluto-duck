import assert from 'node:assert/strict';
import test from 'node:test';

const adapterModuleUrl = new URL('../chatTimelineAdapter.ts', import.meta.url);

test('same-run same-sequence ordering follows lane rank contract', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-lane-rank-order';
  const items = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'thinking', phase: 'llm_reasoning' },
        metadata: { run_id: runId, sequence: 3, display_order: 3, event_id: 'evt-reason', phase: 'llm_reasoning' },
        timestamp: '2026-02-13T10:00:03.100Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'search', input: { q: 'lane rank' } },
        metadata: {
          run_id: runId,
          sequence: 3,
          display_order: 3,
          event_id: 'evt-tool-start',
          tool_call_id: 'tc-exec',
        },
        timestamp: '2026-02-13T10:00:03.000Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'write_file', approval_required: true, approval_id: 'approval-rank' },
        metadata: {
          run_id: runId,
          sequence: 3,
          display_order: 3,
          event_id: 'evt-approval-start',
          tool_call_id: 'tc-approval',
        },
        timestamp: '2026-02-13T10:00:03.300Z',
      },
      {
        type: 'message',
        subtype: 'final',
        content: { text: 'done' },
        metadata: { run_id: runId, sequence: 3, display_order: 3, event_id: 'evt-final' },
        timestamp: '2026-02-13T10:00:03.200Z',
      },
    ],
    messages: [
      {
        id: 'u-lane-rank',
        role: 'user',
        content: { text: 'run lane order', display_order: 1 },
        created_at: '2026-02-13T10:00:01.000Z',
        seq: 1,
        display_order: 1,
        run_id: runId,
      },
    ],
  });

  const indexOfType = (type: string): number => items.findIndex((item: { type: string }) => item.type === type);
  const userIndex = indexOfType('user-message');
  const reasoningIndex = indexOfType('reasoning');
  const toolIndex = indexOfType('tool');
  const assistantIndex = indexOfType('assistant-message');
  const approvalIndex = indexOfType('approval');

  assert.ok(userIndex >= 0);
  assert.ok(reasoningIndex >= 0);
  assert.ok(toolIndex >= 0);
  assert.ok(assistantIndex >= 0);
  assert.ok(approvalIndex >= 0);

  assert.ok(userIndex < reasoningIndex);
  assert.ok(userIndex < toolIndex);
  assert.ok(Math.max(reasoningIndex, toolIndex) < assistantIndex);
  assert.ok(assistantIndex < approvalIndex);
});

test('multi-approval transition keeps execution/control relative order stable', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-multi-approval-stable';
  const baseEvents = [
    {
      type: 'tool',
      subtype: 'start',
      content: { tool: 'read_file' },
      metadata: { run_id: runId, sequence: 2, display_order: 2, event_id: 'evt-read-start', tool_call_id: 'tc-read' },
      timestamp: '2026-02-13T11:00:02.000Z',
    },
    {
      type: 'tool',
      subtype: 'end',
      content: { tool: 'read_file', output: { bytes: 10 } },
      metadata: { run_id: runId, sequence: 3, display_order: 3, event_id: 'evt-read-end', tool_call_id: 'tc-read' },
      timestamp: '2026-02-13T11:00:03.000Z',
    },
    {
      type: 'tool',
      subtype: 'end',
      content: { tool: 'write_file', approval_id: 'approval-a', decision: 'approve' },
      metadata: {
        run_id: runId,
        sequence: 4,
        display_order: 4,
        event_id: 'evt-approval-a-end',
        tool_call_id: 'tc-approval-a',
      },
      timestamp: '2026-02-13T11:00:04.000Z',
    },
    {
      type: 'tool',
      subtype: 'start',
      content: { tool: 'edit_file' },
      metadata: { run_id: runId, sequence: 5, display_order: 5, event_id: 'evt-edit-start', tool_call_id: 'tc-edit' },
      timestamp: '2026-02-13T11:00:05.000Z',
    },
    {
      type: 'tool',
      subtype: 'error',
      content: { tool: 'edit_file', error: 'validation failed' },
      metadata: { run_id: runId, sequence: 6, display_order: 6, event_id: 'evt-edit-error', tool_call_id: 'tc-edit' },
      timestamp: '2026-02-13T11:00:06.000Z',
    },
    {
      type: 'tool',
      subtype: 'end',
      content: { tool: 'edit_file', approval_id: 'approval-b', decision: 'reject' },
      metadata: {
        run_id: runId,
        sequence: 7,
        display_order: 7,
        event_id: 'evt-approval-b-end',
        tool_call_id: 'tc-approval-b',
      },
      timestamp: '2026-02-13T11:00:07.000Z',
    },
    {
      type: 'message',
      subtype: 'final',
      content: { text: 'final answer' },
      metadata: { run_id: runId, sequence: 8, display_order: 8, event_id: 'evt-final' },
      timestamp: '2026-02-13T11:00:08.000Z',
    },
  ];

  const settlingItems = buildTimelineItemsFromEvents({
    events: baseEvents,
    messages: [
      {
        id: 'u-multi-approval',
        role: 'user',
        content: { text: 'process files', display_order: 1 },
        created_at: '2026-02-13T11:00:01.000Z',
        seq: 1,
        display_order: 1,
        run_id: runId,
      },
    ],
    activeRunId: runId,
  });

  const persistedItems = buildTimelineItemsFromEvents({
    events: [
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'write_file', approval_required: true, approval_id: 'approval-a' },
        metadata: {
          run_id: runId,
          sequence: 1,
          display_order: 40,
          event_id: 'evt-approval-a-start',
          tool_call_id: 'tc-approval-a',
        },
        timestamp: '2026-02-13T11:00:01.500Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'edit_file', approval_required: true, approval_id: 'approval-b' },
        metadata: {
          run_id: runId,
          sequence: 0,
          display_order: 41,
          event_id: 'evt-approval-b-start',
          tool_call_id: 'tc-approval-b',
        },
        timestamp: '2026-02-13T11:00:01.000Z',
      },
      ...baseEvents,
    ],
    messages: [
      {
        id: 'u-multi-approval',
        role: 'user',
        content: { text: 'process files', display_order: 1 },
        created_at: '2026-02-13T11:00:01.000Z',
        seq: 1,
        display_order: 1,
        run_id: runId,
      },
      {
        id: 'a-multi-approval',
        role: 'assistant',
        content: { text: 'final answer', display_order: 9 },
        created_at: '2026-02-13T11:00:09.000Z',
        seq: 2,
        display_order: 9,
        run_id: runId,
      },
    ],
    activeRunId: runId,
  });

  const projectExecutionControlOrder = (timelineItems: Array<{ type: string; id: string; toolCallId?: string | null }>) =>
    timelineItems
      .filter(item => item.type === 'tool' || item.type === 'approval')
      .map(item => (item.type === 'tool' ? `tool:${item.toolCallId ?? item.id}` : `approval:${item.id}`));

  assert.deepEqual(projectExecutionControlOrder(settlingItems), projectExecutionControlOrder(persistedItems));
});
