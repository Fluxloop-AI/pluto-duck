import assert from 'node:assert/strict';
import test from 'node:test';

const adapterModuleUrl = new URL('../chatTimelineAdapter.ts', import.meta.url);

test('persisted assistant append does not reorder existing control card', async () => {
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-control-append-stable';
  const baseEvents = [
    {
      type: 'tool',
      subtype: 'start',
      content: { tool: 'write_file', input: { path: '/tmp/a.txt' } },
      metadata: { run_id: runId, sequence: 3, event_id: 'evt-tool-start', tool_call_id: 'tc-write' },
      timestamp: '2026-02-14T10:00:03.000Z',
    },
    {
      type: 'tool',
      subtype: 'start',
      content: { tool: 'write_file', approval_required: true, approval_id: 'approval-stable-1' },
      metadata: { run_id: runId, sequence: 4, event_id: 'evt-approval-start', tool_call_id: 'tc-approval' },
      timestamp: '2026-02-14T10:00:04.000Z',
    },
  ];

  const settlingItems = buildTimelineItemsFromEvents({
    events: baseEvents,
    messages: [
      {
        id: 'u-control-append',
        role: 'user',
        content: { text: 'save it' },
        created_at: '2026-02-14T10:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
    activeRunId: runId,
  });

  const persistedItems = buildTimelineItemsFromEvents({
    events: baseEvents,
    messages: [
      {
        id: 'u-control-append',
        role: 'user',
        content: { text: 'save it' },
        created_at: '2026-02-14T10:00:01.000Z',
        seq: 1,
        run_id: runId,
      },
      {
        id: 'a-control-append',
        role: 'assistant',
        content: { text: 'ok, waiting for approval' },
        created_at: '2026-02-14T10:00:05.000Z',
        seq: 2,
        run_id: runId,
      },
    ],
    activeRunId: runId,
  });

  assert.deepEqual(settlingItems.map((item: { type: string }) => item.type), ['user-message', 'tool', 'approval']);
  assert.deepEqual(persistedItems.map((item: { type: string }) => item.type), [
    'user-message',
    'tool',
    'approval',
    'assistant-message',
  ]);
});
