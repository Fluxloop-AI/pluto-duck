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
