import assert from 'node:assert/strict';
import test from 'node:test';

const timelineModuleUrl = new URL('../useMultiTabChat.timeline.ts', import.meta.url);
const adapterModuleUrl = new URL('../../lib/chatTimelineAdapter.ts', import.meta.url);

test('SSE-like timeline input renders in golden order', async () => {
  const { buildChatTurns } = await import(timelineModuleUrl.href);
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-golden';
  const turns = buildChatTurns({
    detail: {
      id: 'session-1',
      status: 'active',
      run_id: runId,
      messages: [
        {
          id: 'msg-user-1',
          role: 'user',
          content: { text: 'question' },
          created_at: '2026-02-08T13:00:01.000Z',
          seq: 1,
          run_id: runId,
        },
      ],
      events: [],
    },
    streamEvents: [
      {
        type: 'reasoning',
        subtype: 'start',
        content: { reason: 'r1' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-r1' },
        timestamp: '2026-02-08T13:00:02.000Z',
      },
      {
        type: 'tool',
        subtype: 'start',
        content: { tool: 'search', input: { q: 'alpha' } },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-t1s', tool_call_id: 'tc-1' },
        timestamp: '2026-02-08T13:00:03.000Z',
      },
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'r2' },
        metadata: { run_id: runId, sequence: 4, event_id: 'evt-r2' },
        timestamp: '2026-02-08T13:00:04.000Z',
      },
    ],
    isStreaming: true,
    activeRunId: runId,
    chunkText: 'partial answer',
    chunkIsFinal: false,
    chunkRunId: runId,
  });

  const timelineItems = buildTimelineItemsFromEvents({
    events: turns.flatMap((turn: { events: unknown[] }) => turn.events),
    messages: turns.flatMap((turn: { userMessages: unknown[]; assistantMessages: unknown[] }) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
    ]),
    activeRunId: runId,
    streamingChunkText: 'partial answer',
    streamingChunkIsFinal: false,
  });
  assert.deepEqual(timelineItems.map((item: { type: string }) => item.type), [
    'user-message',
    'reasoning',
    'tool',
    'assistant-message',
  ]);
});

test('optimistic sequence and streaming completion transitions are deterministic', async () => {
  const { getNextOptimisticSeq, computeStreamUiState, buildChatTurns } = await import(timelineModuleUrl.href);

  const nextSeq = getNextOptimisticSeq([{ seq: 1 }, { seq: 10 }, { seq: 4 }]);
  assert.equal(nextSeq, 11);

  const runEndEvents = [
    {
      type: 'run',
      subtype: 'end',
      content: {},
      metadata: { run_id: 'run-end' },
      timestamp: '2026-02-08T14:00:03.000Z',
    },
  ];
  const streamUiState = computeStreamUiState('streaming', runEndEvents);
  assert.equal(streamUiState.isStreaming, false);
  assert.equal(streamUiState.status, 'ready');

  const turns = buildChatTurns({
    detail: {
      id: 'session-2',
      status: 'active',
      run_id: 'run-end',
      messages: [
        {
          id: 'msg-user-2',
          role: 'user',
          content: { text: 'hello' },
          created_at: '2026-02-08T14:00:01.000Z',
          seq: 1,
          run_id: 'run-end',
        },
      ],
      events: [],
    },
    streamEvents: runEndEvents,
    isStreaming: streamUiState.isStreaming,
    activeRunId: 'run-end',
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: 'run-end',
  });

  assert.equal(turns.length, 1);
  assert.equal(turns[0].events.length, 0);
});

test('buildChatTurns deduplicates stored and streaming events by metadata.event_id', async () => {
  const { buildChatTurns } = await import(timelineModuleUrl.href);

  const runId = 'run-dedupe';
  const duplicateEvent = {
    type: 'reasoning',
    subtype: 'start',
    content: { reason: 'once' },
    metadata: { run_id: runId, sequence: 2, event_id: 'evt-dup-1' },
    timestamp: '2026-02-08T16:00:02.000Z',
  } as const;

  const turns = buildChatTurns({
    detail: {
      id: 'session-dedupe',
      status: 'active',
      run_id: runId,
      messages: [
        {
          id: 'msg-user-dedupe',
          role: 'user',
          content: { text: 'question' },
          created_at: '2026-02-08T16:00:01.000Z',
          seq: 1,
          run_id: runId,
        },
      ],
      events: [duplicateEvent],
    },
    streamEvents: [duplicateEvent],
    isStreaming: true,
    activeRunId: runId,
    chunkText: '',
    chunkIsFinal: false,
    chunkRunId: runId,
  });

  assert.equal(turns.length, 1);
  assert.equal(turns[0].events.length, 1);
  assert.equal((turns[0].events[0].metadata as { event_id?: string } | null)?.event_id, 'evt-dup-1');
});
