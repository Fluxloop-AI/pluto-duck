import assert from 'node:assert/strict';
import test from 'node:test';

const tabStateModuleUrl = new URL('../useMultiTabChat.tabState.ts', import.meta.url);
const restoreModuleUrl = new URL('../useMultiTabChat.restore.ts', import.meta.url);

test('loadDetail success without preview still finalizes loading with persisted detail', async () => {
  const { startDetailLoading, completeDetailLoading } = await import(tabStateModuleUrl.href);

  const loadingState = startDetailLoading({
    detail: null,
    loading: false,
    activeRunId: null,
    runRenderState: 'persisted',
  });

  const nextState = completeDetailLoading(loadingState, {
    id: 'session-no-preview',
    status: 'completed',
    messages: [
      {
        id: 'm-user-1',
        role: 'user',
        content: { text: 'question' },
        created_at: '2026-02-10T00:00:00.000Z',
        seq: 1,
      },
    ],
    events: [],
  });

  assert.equal(nextState.loading, false);
  assert.equal(nextState.detail?.id, 'session-no-preview');
  assert.equal(nextState.runRenderState, 'persisted');
  assert.equal(nextState.activeRunId, null);
});

test('loadDetail failure keeps previous detail and clears loading', async () => {
  const { startDetailLoading, failDetailLoading } = await import(tabStateModuleUrl.href);

  const previousDetail = {
    id: 'session-prev',
    status: 'completed',
    messages: [],
    events: [],
  };

  const loadingState = startDetailLoading({
    detail: previousDetail,
    loading: false,
    activeRunId: null,
    runRenderState: 'persisted',
  });
  const nextState = failDetailLoading(loadingState);

  assert.equal(nextState.loading, false);
  assert.equal(nextState.detail?.id, 'session-prev');
});

test('optimistic submit state appends immediate user message for new tab path', async () => {
  const { appendOptimisticUserMessage } = await import(tabStateModuleUrl.href);

  const nextState = appendOptimisticUserMessage(null, {
    tabIdForPlaceholder: 'tab-new',
    tempMessageId: 'temp-user-1',
    prompt: 'hello world',
    createdAt: '2026-02-10T00:01:00.000Z',
  });

  assert.equal(nextState.loading, false);
  assert.equal(nextState.detail?.messages.length, 1);
  assert.equal(nextState.detail?.messages[0]?.role, 'user');
  assert.equal(nextState.runRenderState, 'persisted');
});

test('run refresh transition keeps settling before persisted final state', async () => {
  const { markRunSettling, completeDetailLoading } = await import(tabStateModuleUrl.href);

  const settlingState = markRunSettling({
    detail: {
      id: 'session-run',
      status: 'active',
      run_id: 'run-1',
      messages: [],
      events: [],
    },
    loading: false,
    activeRunId: 'run-1',
    runRenderState: 'streaming',
  });

  assert.equal(settlingState.runRenderState, 'settling');

  const persistedState = completeDetailLoading(settlingState, {
    id: 'session-run',
    status: 'completed',
    messages: [],
    events: [],
  });

  assert.equal(persistedState.runRenderState, 'persisted');
  assert.equal(persistedState.activeRunId, null);
});

test('stale guard rejects inactive tab response after tab switch', async () => {
  const { TabRequestTokenGuard } = await import(tabStateModuleUrl.href);

  const guard = new TabRequestTokenGuard();
  const tokenA = guard.begin('tab-a', 'session-a');
  const tokenB = guard.begin('tab-b', 'session-b');

  assert.equal(guard.canCommit(tokenB, 'tab-b'), true);
  assert.equal(guard.canCommit(tokenA, 'tab-b'), false);
});

test('stale guard accepts only latest token for same tab out-of-order responses', async () => {
  const { TabRequestTokenGuard } = await import(tabStateModuleUrl.href);

  const guard = new TabRequestTokenGuard();
  const token1 = guard.begin('tab-a', 'session-a');
  const token2 = guard.begin('tab-a', 'session-a');

  assert.equal(guard.canCommit(token1, 'tab-a'), false);
  assert.equal(guard.canCommit(token2, 'tab-a'), true);
});

test('restore planner keeps saved tab order deterministically', async () => {
  const { planRestoredTabs } = await import(restoreModuleUrl.href);
  const sessions = [
    {
      id: 'session-b',
      title: 'B',
      status: 'completed',
      created_at: '2026-02-10T00:00:01.000Z',
      updated_at: '2026-02-10T00:00:02.000Z',
      last_message_preview: null,
    },
    {
      id: 'session-a',
      title: 'A',
      status: 'completed',
      created_at: '2026-02-10T00:00:03.000Z',
      updated_at: '2026-02-10T00:00:04.000Z',
      last_message_preview: null,
    },
  ];

  const plan = planRestoredTabs({
    sessions,
    savedTabs: [
      { id: 'session-b', order: 2 },
      { id: 'session-a', order: 1 },
    ],
  });

  assert.deepEqual(
    plan.tabs.map((tab: { sessionId: string }) => tab.sessionId),
    ['session-a', 'session-b'],
  );
});

test('restore planner activates exact saved active session when present', async () => {
  const { planRestoredTabs, buildRestoredTabId } = await import(restoreModuleUrl.href);
  const sessions = [
    {
      id: 'session-a',
      title: 'A',
      status: 'completed',
      created_at: '2026-02-10T00:00:01.000Z',
      updated_at: '2026-02-10T00:00:02.000Z',
      last_message_preview: null,
    },
    {
      id: 'session-b',
      title: 'B',
      status: 'completed',
      created_at: '2026-02-10T00:00:03.000Z',
      updated_at: '2026-02-10T00:00:04.000Z',
      last_message_preview: null,
    },
  ];

  const plan = planRestoredTabs({
    sessions,
    savedTabs: [
      { id: 'session-a', order: 0 },
      { id: 'session-b', order: 1 },
    ],
    savedActiveTabId: 'session-b',
  });

  assert.equal(plan.activeTabId, buildRestoredTabId('session-b'));
});

test('restore planner falls back to first tab when saved active session is missing', async () => {
  const { planRestoredTabs, buildRestoredTabId } = await import(restoreModuleUrl.href);
  const sessions = [
    {
      id: 'session-a',
      title: 'A',
      status: 'completed',
      created_at: '2026-02-10T00:00:01.000Z',
      updated_at: '2026-02-10T00:00:02.000Z',
      last_message_preview: null,
    },
    {
      id: 'session-b',
      title: 'B',
      status: 'completed',
      created_at: '2026-02-10T00:00:03.000Z',
      updated_at: '2026-02-10T00:00:04.000Z',
      last_message_preview: null,
    },
  ];

  const plan = planRestoredTabs({
    sessions,
    savedTabs: [
      { id: 'session-a', order: 0 },
      { id: 'session-b', order: 1 },
    ],
    savedActiveTabId: 'session-z',
  });

  assert.equal(plan.activeTabId, buildRestoredTabId('session-a'));
});

test('restore planner safely skips sessions that do not exist anymore', async () => {
  const { planRestoredTabs } = await import(restoreModuleUrl.href);
  const sessions = [
    {
      id: 'session-a',
      title: 'A',
      status: 'completed',
      created_at: '2026-02-10T00:00:01.000Z',
      updated_at: '2026-02-10T00:00:02.000Z',
      last_message_preview: null,
    },
  ];

  const plan = planRestoredTabs({
    sessions,
    savedTabs: [
      { id: 'session-a', order: 0 },
      { id: 'session-missing', order: 1 },
    ],
    savedActiveTabId: 'session-missing',
  });

  assert.deepEqual(
    plan.tabs.map((tab: { sessionId: string }) => tab.sessionId),
    ['session-a'],
  );
  assert.equal(plan.activeTabId, plan.tabs[0].id);
});

test('restore planner is idempotent for identical inputs', async () => {
  const { planRestoredTabs } = await import(restoreModuleUrl.href);
  const sessions = [
    {
      id: 'session-a',
      title: 'A',
      status: 'completed',
      created_at: '2026-02-10T00:00:01.000Z',
      updated_at: '2026-02-10T00:00:02.000Z',
      last_message_preview: null,
    },
    {
      id: 'session-b',
      title: 'B',
      status: 'completed',
      created_at: '2026-02-10T00:00:03.000Z',
      updated_at: '2026-02-10T00:00:04.000Z',
      last_message_preview: null,
    },
  ];
  const input = {
    sessions,
    savedTabs: [
      { id: 'session-a', order: 0 },
      { id: 'session-b', order: 1 },
    ],
    savedActiveTabId: 'session-b',
  };

  const first = planRestoredTabs(input);
  const second = planRestoredTabs(input);
  assert.deepEqual(first, second);
});

test('restore planner remains deterministic across 10 repeated runs', async () => {
  const { planRestoredTabs } = await import(restoreModuleUrl.href);
  const sessions = [
    {
      id: 'session-a',
      title: 'A',
      status: 'completed',
      created_at: '2026-02-10T00:00:01.000Z',
      updated_at: '2026-02-10T00:00:02.000Z',
      last_message_preview: null,
    },
    {
      id: 'session-b',
      title: 'B',
      status: 'completed',
      created_at: '2026-02-10T00:00:03.000Z',
      updated_at: '2026-02-10T00:00:04.000Z',
      last_message_preview: null,
    },
  ];
  const input = {
    sessions,
    savedTabs: [
      { id: 'session-a', order: 0 },
      { id: 'session-b', order: 1 },
    ],
    savedActiveTabId: 'session-b',
  };
  const baseline = planRestoredTabs(input);

  for (let index = 0; index < 10; index += 1) {
    assert.deepEqual(planRestoredTabs(input), baseline);
  }
});

test('restore fingerprint is stable for same input and order-insensitive sessions', async () => {
  const { buildRestoreFingerprint } = await import(restoreModuleUrl.href);
  const sessionsA = [
    {
      id: 'session-a',
      title: 'A',
      status: 'completed',
      created_at: '2026-02-10T00:00:01.000Z',
      updated_at: '2026-02-10T00:00:02.000Z',
      last_message_preview: null,
    },
    {
      id: 'session-b',
      title: 'B',
      status: 'completed',
      created_at: '2026-02-10T00:00:03.000Z',
      updated_at: '2026-02-10T00:00:04.000Z',
      last_message_preview: null,
    },
  ];
  const sessionsB = [sessionsA[1], sessionsA[0]];
  const input = {
    projectId: 'project-1',
    savedTabs: [
      { id: 'session-b', order: 1 },
      { id: 'session-a', order: 0 },
    ],
    savedActiveTabId: 'session-b',
  };

  const fingerprintA = buildRestoreFingerprint({ ...input, sessions: sessionsA });
  const fingerprintB = buildRestoreFingerprint({ ...input, sessions: sessionsB });
  assert.equal(fingerprintA, fingerprintB);
});
