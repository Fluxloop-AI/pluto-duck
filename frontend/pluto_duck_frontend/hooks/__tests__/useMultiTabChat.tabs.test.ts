import assert from 'node:assert/strict';
import test from 'node:test';

const tabStateModuleUrl = new URL('../useMultiTabChat.tabState.ts', import.meta.url);

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
