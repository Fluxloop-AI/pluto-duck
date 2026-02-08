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
    runRenderState: 'streaming',
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
    runRenderState: 'persisted',
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
    runRenderState: 'streaming',
    activeRunId: runId,
    chunkText: '',
    chunkIsFinal: false,
    chunkRunId: runId,
  });

  assert.equal(turns.length, 1);
  assert.equal(turns[0].events.length, 1);
  assert.equal((turns[0].events[0].metadata as { event_id?: string } | null)?.event_id, 'evt-dup-1');
});

test('buildChatTurns keeps stream snapshot during settling transition', async () => {
  const { buildChatTurns } = await import(timelineModuleUrl.href);

  const runId = 'run-settling-snapshot';
  const turns = buildChatTurns({
    detail: {
      id: 'session-settling',
      status: 'active',
      run_id: runId,
      messages: [
        {
          id: 'msg-user-settling',
          role: 'user',
          content: { text: 'question' },
          created_at: '2026-02-09T01:00:01.000Z',
          seq: 1,
          run_id: runId,
        },
      ],
      events: [],
    },
    streamEvents: [
      {
        type: 'reasoning',
        subtype: 'chunk',
        content: { reason: 'thinking...' },
        metadata: { run_id: runId, sequence: 2, event_id: 'evt-settle-r1', phase: 'llm_reasoning' },
        timestamp: '2026-02-09T01:00:02.000Z',
      },
      {
        type: 'message',
        subtype: 'final',
        content: { text: 'final answer from event' },
        metadata: { run_id: runId, sequence: 3, event_id: 'evt-settle-m1' },
        timestamp: '2026-02-09T01:00:03.000Z',
      },
    ],
    runRenderState: 'settling',
    activeRunId: runId,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: runId,
  });

  assert.equal(turns.length, 1);
  assert.equal(turns[0].events.length, 2);
});

test('streaming -> settling -> persisted transition keeps timeline order stable', async () => {
  const { buildChatTurns } = await import(timelineModuleUrl.href);
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-phase4-transition';
  const streamEvents = [
    {
      type: 'reasoning',
      subtype: 'chunk',
      content: { phase: 'llm_reasoning', reason: 'thinking' },
      metadata: { run_id: runId, sequence: 2, event_id: 'evt-r1', phase: 'llm_reasoning' },
      timestamp: '2026-02-09T02:20:02.000Z',
    },
    {
      type: 'tool',
      subtype: 'start',
      content: { tool: 'search', input: { q: 'alpha' } },
      metadata: { run_id: runId, sequence: 3, event_id: 'evt-t1', tool_call_id: 'tc-1' },
      timestamp: '2026-02-09T02:20:03.000Z',
    },
    {
      type: 'tool',
      subtype: 'end',
      content: { tool: 'search', output: { rows: 1 } },
      metadata: { run_id: runId, sequence: 4, event_id: 'evt-t2', tool_call_id: 'tc-1' },
      timestamp: '2026-02-09T02:20:04.000Z',
    },
    {
      type: 'message',
      subtype: 'final',
      content: { text: 'final answer' },
      metadata: { run_id: runId, sequence: 5, event_id: 'evt-m1' },
      timestamp: '2026-02-09T02:20:05.000Z',
    },
  ];

  const detailStreaming = {
    id: 'session-phase4-transition',
    status: 'active',
    run_id: runId,
    messages: [
      {
        id: 'u-phase4-transition',
        role: 'user',
        content: { text: 'question' },
        created_at: '2026-02-09T02:20:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
    events: [],
  };

  const streamingTurns = buildChatTurns({
    detail: detailStreaming,
    streamEvents,
    runRenderState: 'streaming',
    activeRunId: runId,
    chunkText: 'partial',
    chunkIsFinal: false,
    chunkRunId: runId,
  });
  const streamingItems = buildTimelineItemsFromEvents({
    events: streamingTurns.flatMap((turn: { events: unknown[] }) => turn.events),
    messages: streamingTurns.flatMap((turn: { userMessages: unknown[]; assistantMessages: unknown[] }) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
    ]),
    activeRunId: runId,
    streamingChunkText: 'partial',
    streamingChunkIsFinal: false,
  });

  const settlingTurns = buildChatTurns({
    detail: detailStreaming,
    streamEvents,
    runRenderState: 'settling',
    activeRunId: runId,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: runId,
  });
  const settlingItems = buildTimelineItemsFromEvents({
    events: settlingTurns.flatMap((turn: { events: unknown[] }) => turn.events),
    messages: settlingTurns.flatMap((turn: { userMessages: unknown[]; assistantMessages: unknown[] }) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
    ]),
    activeRunId: runId,
  });

  const persistedTurns = buildChatTurns({
    detail: {
      ...detailStreaming,
      status: 'completed',
      run_id: null,
      messages: [
        ...detailStreaming.messages,
        {
          id: 'a-phase4-transition',
          role: 'assistant',
          content: { text: 'final answer' },
          created_at: '2026-02-09T02:20:06.000Z',
          seq: 2,
          run_id: runId,
        },
      ],
      events: streamEvents,
    },
    streamEvents,
    runRenderState: 'persisted',
    activeRunId: runId,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: runId,
  });
  const persistedItems = buildTimelineItemsFromEvents({
    events: persistedTurns.flatMap((turn: { events: unknown[] }) => turn.events),
    messages: persistedTurns.flatMap((turn: { userMessages: unknown[]; assistantMessages: unknown[] }) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
    ]),
    activeRunId: runId,
  });

  assert.equal(streamingItems.filter((item: { type: string }) => item.type === 'reasoning').length, 1);
  assert.equal(settlingItems.filter((item: { type: string }) => item.type === 'reasoning').length, 1);
  assert.equal(persistedItems.filter((item: { type: string }) => item.type === 'reasoning').length, 1);
  assert.equal(settlingItems.filter((item: { type: string }) => item.type === 'assistant-message').length, 1);
  assert.equal(persistedItems.filter((item: { type: string }) => item.type === 'assistant-message').length, 1);
});

test('streaming -> settling -> persisted keeps segmented reasoning span count and order stable', async () => {
  const { buildChatTurns } = await import(timelineModuleUrl.href);
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-phase4-segmented-transition';
  const streamEvents = [
    {
      type: 'reasoning',
      subtype: 'start',
      content: { phase: 'llm_start' },
      metadata: { run_id: runId, sequence: 2, event_id: 'evt-r-start-1', phase: 'llm_start' },
      timestamp: '2026-02-10T11:20:02.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'chunk',
      content: { phase: 'llm_reasoning', reason: 'first thought' },
      metadata: { run_id: runId, sequence: 3, event_id: 'evt-r-body-1', phase: 'llm_reasoning' },
      timestamp: '2026-02-10T11:20:03.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'end',
      content: { phase: 'llm_end' },
      metadata: { run_id: runId, sequence: 4, event_id: 'evt-r-end-1', phase: 'llm_end' },
      timestamp: '2026-02-10T11:20:04.000Z',
    },
    {
      type: 'tool',
      subtype: 'start',
      content: { tool: 'search', input: { q: 'alpha' } },
      metadata: { run_id: runId, sequence: 5, event_id: 'evt-t-start', tool_call_id: 'tc-1' },
      timestamp: '2026-02-10T11:20:05.000Z',
    },
    {
      type: 'tool',
      subtype: 'end',
      content: { tool: 'search', output: { rows: 1 } },
      metadata: { run_id: runId, sequence: 6, event_id: 'evt-t-end', tool_call_id: 'tc-1' },
      timestamp: '2026-02-10T11:20:06.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'start',
      content: { phase: 'llm_start' },
      metadata: { run_id: runId, sequence: 7, event_id: 'evt-r-start-2', phase: 'llm_start' },
      timestamp: '2026-02-10T11:20:07.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'chunk',
      content: { phase: 'llm_reasoning', reason: 'second thought' },
      metadata: { run_id: runId, sequence: 8, event_id: 'evt-r-body-2', phase: 'llm_reasoning' },
      timestamp: '2026-02-10T11:20:08.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'end',
      content: { phase: 'llm_end' },
      metadata: { run_id: runId, sequence: 9, event_id: 'evt-r-end-2', phase: 'llm_end' },
      timestamp: '2026-02-10T11:20:09.000Z',
    },
    {
      type: 'message',
      subtype: 'final',
      content: { text: 'final answer' },
      metadata: { run_id: runId, sequence: 10, event_id: 'evt-m-final' },
      timestamp: '2026-02-10T11:20:10.000Z',
    },
  ];

  const detailStreaming = {
    id: 'session-phase4-segmented-transition',
    status: 'active',
    run_id: runId,
    messages: [
      {
        id: 'u-phase4-segmented-transition',
        role: 'user',
        content: { text: 'question' },
        created_at: '2026-02-10T11:20:01.000Z',
        seq: 1,
        run_id: runId,
      },
    ],
    events: [],
  };

  const toReasoningCompact = (items: Array<{ type: string; content?: string; segmentOrder?: number }>) =>
    items
      .filter(item => item.type === 'reasoning')
      .map(item => `${item.segmentOrder}:${item.content ?? ''}`);

  const streamingTurns = buildChatTurns({
    detail: detailStreaming,
    streamEvents,
    runRenderState: 'streaming',
    activeRunId: runId,
    chunkText: 'partial',
    chunkIsFinal: false,
    chunkRunId: runId,
  });
  const streamingItems = buildTimelineItemsFromEvents({
    events: streamingTurns.flatMap((turn: { events: unknown[] }) => turn.events),
    messages: streamingTurns.flatMap((turn: { userMessages: unknown[]; assistantMessages: unknown[] }) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
    ]),
    activeRunId: runId,
    streamingChunkText: 'partial',
    streamingChunkIsFinal: false,
  });

  const settlingTurns = buildChatTurns({
    detail: detailStreaming,
    streamEvents,
    runRenderState: 'settling',
    activeRunId: runId,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: runId,
  });
  const settlingItems = buildTimelineItemsFromEvents({
    events: settlingTurns.flatMap((turn: { events: unknown[] }) => turn.events),
    messages: settlingTurns.flatMap((turn: { userMessages: unknown[]; assistantMessages: unknown[] }) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
    ]),
    activeRunId: runId,
  });

  const persistedTurns = buildChatTurns({
    detail: {
      ...detailStreaming,
      status: 'completed',
      run_id: null,
      messages: [
        ...detailStreaming.messages,
        {
          id: 'a-phase4-segmented-transition',
          role: 'assistant',
          content: { text: 'final answer' },
          created_at: '2026-02-10T11:20:11.000Z',
          seq: 2,
          run_id: runId,
        },
      ],
      events: streamEvents,
    },
    streamEvents,
    runRenderState: 'persisted',
    activeRunId: runId,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: runId,
  });
  const persistedItems = buildTimelineItemsFromEvents({
    events: persistedTurns.flatMap((turn: { events: unknown[] }) => turn.events),
    messages: persistedTurns.flatMap((turn: { userMessages: unknown[]; assistantMessages: unknown[] }) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
    ]),
    activeRunId: runId,
  });

  assert.deepEqual(toReasoningCompact(streamingItems), ['0:first thought', '1:second thought']);
  assert.deepEqual(toReasoningCompact(settlingItems), ['0:first thought', '1:second thought']);
  assert.deepEqual(toReasoningCompact(persistedItems), ['0:first thought', '1:second thought']);
});

test('detail refetch preserves item count and order after settling', async () => {
  const { buildChatTurns } = await import(timelineModuleUrl.href);
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-phase4-refetch';
  const streamEvents = [
    {
      type: 'reasoning',
      subtype: 'chunk',
      content: { phase: 'llm_reasoning', reason: 'reasoning text' },
      metadata: { run_id: runId, sequence: 2, event_id: 'evt-r1', phase: 'llm_reasoning' },
      timestamp: '2026-02-09T02:30:02.000Z',
    },
    {
      type: 'tool',
      subtype: 'start',
      content: { tool: 'search', input: { q: 'alpha' } },
      metadata: { run_id: runId, sequence: 3, event_id: 'evt-t1', tool_call_id: 'tc-1' },
      timestamp: '2026-02-09T02:30:03.000Z',
    },
    {
      type: 'tool',
      subtype: 'end',
      content: { tool: 'search', output: { rows: 1 } },
      metadata: { run_id: runId, sequence: 4, event_id: 'evt-t2', tool_call_id: 'tc-1' },
      timestamp: '2026-02-09T02:30:04.000Z',
    },
    {
      type: 'message',
      subtype: 'final',
      content: { text: 'final answer' },
      metadata: { run_id: runId, sequence: 5, event_id: 'evt-m1' },
      timestamp: '2026-02-09T02:30:05.000Z',
    },
  ];

  const settlingTurns = buildChatTurns({
    detail: {
      id: 'session-phase4-refetch',
      status: 'active',
      run_id: runId,
      messages: [
        {
          id: 'u-phase4-refetch',
          role: 'user',
          content: { text: 'question' },
          created_at: '2026-02-09T02:30:01.000Z',
          seq: 1,
          run_id: runId,
        },
      ],
      events: [],
    },
    streamEvents,
    runRenderState: 'settling',
    activeRunId: runId,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: runId,
  });
  const settlingItems = buildTimelineItemsFromEvents({
    events: settlingTurns.flatMap((turn: { events: unknown[] }) => turn.events),
    messages: settlingTurns.flatMap((turn: { userMessages: unknown[]; assistantMessages: unknown[] }) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
    ]),
    activeRunId: runId,
  });

  const persistedTurns = buildChatTurns({
    detail: {
      id: 'session-phase4-refetch',
      status: 'completed',
      run_id: null,
      messages: [
        {
          id: 'u-phase4-refetch',
          role: 'user',
          content: { text: 'question' },
          created_at: '2026-02-09T02:30:01.000Z',
          seq: 1,
          run_id: runId,
        },
        {
          id: 'a-phase4-refetch',
          role: 'assistant',
          content: { text: 'final answer' },
          created_at: '2026-02-09T02:30:06.000Z',
          seq: 2,
          run_id: runId,
        },
      ],
      events: streamEvents,
    },
    streamEvents,
    runRenderState: 'persisted',
    activeRunId: runId,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: runId,
  });
  const persistedItems = buildTimelineItemsFromEvents({
    events: persistedTurns.flatMap((turn: { events: unknown[] }) => turn.events),
    messages: persistedTurns.flatMap((turn: { userMessages: unknown[]; assistantMessages: unknown[] }) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
    ]),
    activeRunId: runId,
  });

  const compact = (items: Array<{ type: string }>) => items.map(item => item.type);
  assert.deepEqual(compact(persistedItems), compact(settlingItems));
  assert.equal(persistedItems.length, settlingItems.length);
});

test('detail refetch keeps segmented reasoning order after settling', async () => {
  const { buildChatTurns } = await import(timelineModuleUrl.href);
  const { buildTimelineItemsFromEvents } = await import(adapterModuleUrl.href);

  const runId = 'run-phase4-segmented-refetch';
  const streamEvents = [
    {
      type: 'reasoning',
      subtype: 'start',
      content: { phase: 'llm_start' },
      metadata: { run_id: runId, sequence: 2, event_id: 'evt-r-start-1', phase: 'llm_start' },
      timestamp: '2026-02-10T11:30:02.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'chunk',
      content: { phase: 'llm_reasoning', reason: 'first thought' },
      metadata: { run_id: runId, sequence: 3, event_id: 'evt-r-body-1', phase: 'llm_reasoning' },
      timestamp: '2026-02-10T11:30:03.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'end',
      content: { phase: 'llm_end' },
      metadata: { run_id: runId, sequence: 4, event_id: 'evt-r-end-1', phase: 'llm_end' },
      timestamp: '2026-02-10T11:30:04.000Z',
    },
    {
      type: 'tool',
      subtype: 'start',
      content: { tool: 'search', input: { q: 'alpha' } },
      metadata: { run_id: runId, sequence: 5, event_id: 'evt-t-start', tool_call_id: 'tc-1' },
      timestamp: '2026-02-10T11:30:05.000Z',
    },
    {
      type: 'tool',
      subtype: 'end',
      content: { tool: 'search', output: { rows: 1 } },
      metadata: { run_id: runId, sequence: 6, event_id: 'evt-t-end', tool_call_id: 'tc-1' },
      timestamp: '2026-02-10T11:30:06.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'start',
      content: { phase: 'llm_start' },
      metadata: { run_id: runId, sequence: 7, event_id: 'evt-r-start-2', phase: 'llm_start' },
      timestamp: '2026-02-10T11:30:07.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'chunk',
      content: { phase: 'llm_reasoning', reason: 'second thought' },
      metadata: { run_id: runId, sequence: 8, event_id: 'evt-r-body-2', phase: 'llm_reasoning' },
      timestamp: '2026-02-10T11:30:08.000Z',
    },
    {
      type: 'reasoning',
      subtype: 'end',
      content: { phase: 'llm_end' },
      metadata: { run_id: runId, sequence: 9, event_id: 'evt-r-end-2', phase: 'llm_end' },
      timestamp: '2026-02-10T11:30:09.000Z',
    },
    {
      type: 'message',
      subtype: 'final',
      content: { text: 'final answer' },
      metadata: { run_id: runId, sequence: 10, event_id: 'evt-m-final' },
      timestamp: '2026-02-10T11:30:10.000Z',
    },
  ];

  const toCompact = (items: Array<{ type: string; content?: string }>) =>
    items
      .map(item => {
        if (item.type === 'reasoning') return `${item.type}:${item.content ?? ''}`;
        return item.type;
      })
      .join('|');

  const settlingTurns = buildChatTurns({
    detail: {
      id: 'session-phase4-segmented-refetch',
      status: 'active',
      run_id: runId,
      messages: [
        {
          id: 'u-phase4-segmented-refetch',
          role: 'user',
          content: { text: 'question' },
          created_at: '2026-02-10T11:30:01.000Z',
          seq: 1,
          run_id: runId,
        },
      ],
      events: [],
    },
    streamEvents,
    runRenderState: 'settling',
    activeRunId: runId,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: runId,
  });
  const settlingItems = buildTimelineItemsFromEvents({
    events: settlingTurns.flatMap((turn: { events: unknown[] }) => turn.events),
    messages: settlingTurns.flatMap((turn: { userMessages: unknown[]; assistantMessages: unknown[] }) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
    ]),
    activeRunId: runId,
  });

  const persistedTurns = buildChatTurns({
    detail: {
      id: 'session-phase4-segmented-refetch',
      status: 'completed',
      run_id: null,
      messages: [
        {
          id: 'u-phase4-segmented-refetch',
          role: 'user',
          content: { text: 'question' },
          created_at: '2026-02-10T11:30:01.000Z',
          seq: 1,
          run_id: runId,
        },
        {
          id: 'a-phase4-segmented-refetch',
          role: 'assistant',
          content: { text: 'final answer' },
          created_at: '2026-02-10T11:30:11.000Z',
          seq: 2,
          run_id: runId,
        },
      ],
      events: streamEvents,
    },
    streamEvents,
    runRenderState: 'persisted',
    activeRunId: runId,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: runId,
  });
  const persistedItems = buildTimelineItemsFromEvents({
    events: persistedTurns.flatMap((turn: { events: unknown[] }) => turn.events),
    messages: persistedTurns.flatMap((turn: { userMessages: unknown[]; assistantMessages: unknown[] }) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
    ]),
    activeRunId: runId,
  });

  assert.equal(toCompact(persistedItems), toCompact(settlingItems));
});
