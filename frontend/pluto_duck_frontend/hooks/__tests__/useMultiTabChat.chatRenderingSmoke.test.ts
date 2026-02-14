import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ChatRenderItem } from '../../types/chatRenderItem';

const tempRoot = await mkdtemp(join(tmpdir(), 'pluto-duck-chat-render-smoke-'));
process.env.PLUTODUCK_DB_PATH = join(tempRoot, 'pluto_duck_chat_render_smoke.duckdb');

const storeModule = await import(new URL('../../app/api/v1/_server/store.ts', import.meta.url).href);
const { getSettings, resetDatabaseForTests } = storeModule;

const chatModule = await import(new URL('../../app/api/v1/_server/chat.ts', import.meta.url).href);
const { getConversationDetail, resetChatSchemaForTests } = chatModule;

const runtimeModule = await import(new URL('../../app/api/v1/_server/agentRuntime.ts', import.meta.url).href);
const {
  applyApprovalDecision,
  createAgentEventStream,
  listRunApprovals,
  resetAgentRuntimeForTests,
  startAgentRun,
} = runtimeModule;

const timelineModule = await import(new URL('../useMultiTabChat.timeline.ts', import.meta.url).href);
const { buildChatTurns, computeStreamUiState } = timelineModule;

const renderModule = await import(new URL('../../lib/chatRenderUtils.ts', import.meta.url).href);
const { flattenTurnsToRenderItems } = renderModule;

const loadingModule = await import(new URL('../../lib/chatLoadingState.ts', import.meta.url).href);
const { computeChatLoadingMode, hasMaterializedReasoningSpan } = loadingModule;

const streamingIdsModule = await import(new URL('../../lib/chatStreamingIds.ts', import.meta.url).href);
const { STREAMING_ASSISTANT_MESSAGE_ID_PREFIX } = streamingIdsModule;

type AgentEventPayload = {
  event_id?: string;
  sequence?: number;
  display_order?: number;
  run_id?: string | null;
  type?: string;
  subtype?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
  timestamp?: string;
};

interface ChatSessionLikeDetail {
  id: string;
  status: string;
  run_id: string | null;
  messages: Array<{
    id: string;
    role: string;
    content: unknown;
    created_at: string;
    seq: number;
    display_order?: number;
    run_id?: string | null;
  }>;
  events?: Array<{
    type: string;
    subtype: string;
    content: unknown;
    metadata: Record<string, unknown>;
    timestamp?: string;
    display_order?: number;
  }>;
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function toStreamEvent(payload: AgentEventPayload): Record<string, unknown> {
  return {
    type: payload.type ?? 'run',
    subtype: payload.subtype ?? 'chunk',
    content: payload.content ?? null,
    metadata: payload.metadata ?? {},
    timestamp: payload.timestamp ?? new Date().toISOString(),
    event_id: payload.event_id,
    sequence: payload.sequence,
    display_order: payload.display_order,
    run_id: payload.run_id,
  };
}

async function collectSseEvents(stream: ReadableStream<Uint8Array>): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const splitIndex = buffer.indexOf('\n\n');
      if (splitIndex < 0) {
        break;
      }

      const frame = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);

      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) {
          continue;
        }
        const text = line.slice(6).trim();
        if (!text) {
          continue;
        }
        const parsed = JSON.parse(text) as AgentEventPayload;
        events.push(toStreamEvent(parsed));
      }
    }
  }

  return events;
}

async function waitForApproval(runId: string): Promise<{ id: string }> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const approvals = (await listRunApprovals(runId)) as Array<{ id: string }>;
    if (approvals.length > 0) {
      return approvals[0] as { id: string };
    }
    await sleep(20);
  }
  throw new Error('Approval was not created in time');
}

function toUiDetail(rawDetail: {
  id: string;
  status: string;
  run_id: string | null;
  messages: Array<{
    id: string;
    role: string;
    content: unknown;
    created_at: string;
    seq: number;
    display_order?: number;
    run_id?: string | null;
  }>;
  events?: Array<{
    type: string;
    subtype?: string;
    content: unknown;
    metadata: Record<string, unknown>;
    timestamp?: string;
    display_order?: number;
  }>;
}): ChatSessionLikeDetail {
  return {
    id: rawDetail.id,
    status: rawDetail.status,
    run_id: rawDetail.run_id,
    messages: rawDetail.messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      created_at: message.created_at,
      seq: message.seq,
      display_order: message.display_order,
      run_id: message.run_id ?? null,
    })),
    events: (rawDetail.events ?? []).map(event => ({
      type: event.type,
      subtype: event.subtype ?? 'chunk',
      content: event.content,
      metadata: event.metadata ?? {},
      timestamp: event.timestamp,
      display_order: event.display_order,
    })),
  };
}

function renderItemsFromState(params: {
  detail: ChatSessionLikeDetail;
  streamEvents: Array<Record<string, unknown>>;
  runRenderState: 'streaming' | 'settling' | 'persisted';
  activeRunId: string;
  chunkText: string;
  chunkIsFinal: boolean;
  chunkRunId: string;
}) {
  const turns = buildChatTurns({
    detail: params.detail as any,
    streamEvents: params.streamEvents as any,
    runRenderState: params.runRenderState,
    activeRunId: params.activeRunId,
    chunkText: params.chunkText,
    chunkIsFinal: params.chunkIsFinal,
    chunkRunId: params.chunkRunId,
  });
  return flattenTurnsToRenderItems(turns);
}

test.beforeEach(async () => {
  await resetDatabaseForTests();
  resetChatSchemaForTests();
  resetAgentRuntimeForTests();
});

test.after(async () => {
  await resetDatabaseForTests();
  await rm(tempRoot, { recursive: true, force: true });
});

test('UI timeline smoke: backend SSE renders stably through streaming -> settling -> persisted', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const started = await startAgentRun({
    question: 'Phase C chat rendering smoke',
    scope_project_id: projectId,
  });

  const allStreamEvents = await collectSseEvents(createAgentEventStream(started.run_id));
  assert.ok(allStreamEvents.length > 0);

  const persistedDetailRaw = await getConversationDetail(started.conversation_id, projectId, true);
  const persistedDetail = toUiDetail(persistedDetailRaw);

  const userOnlyDetail: ChatSessionLikeDetail = {
    id: persistedDetail.id,
    status: 'active',
    run_id: started.run_id,
    messages: persistedDetail.messages.filter(message => message.role === 'user'),
    events: [],
  };

  const finalEventIndex = allStreamEvents.findIndex(
    event => event.type === 'message' && event.subtype === 'final'
  );
  const streamingEvents =
    finalEventIndex > 0 ? allStreamEvents.slice(0, finalEventIndex) : allStreamEvents.slice(0, Math.max(1, allStreamEvents.length - 1));
  const lastChunk = [...streamingEvents]
    .reverse()
    .find(event => event.type === 'message' && event.subtype === 'chunk');
  const chunkText =
    typeof (lastChunk?.content as { text_delta?: unknown } | undefined)?.text_delta === 'string'
      ? ((lastChunk?.content as { text_delta: string }).text_delta as string)
      : '';

  const streamingRenderItems = renderItemsFromState({
    detail: userOnlyDetail,
    streamEvents: streamingEvents,
    runRenderState: 'streaming',
    activeRunId: started.run_id,
    chunkText,
    chunkIsFinal: false,
    chunkRunId: started.run_id,
  });

  assert.ok(streamingRenderItems.some((item: ChatRenderItem) => item.type === 'user-message'));
  assert.ok(streamingRenderItems.some((item: ChatRenderItem) => item.type === 'assistant-message'));

  const streamingUiState = computeStreamUiState(
    'streaming',
    streamingEvents as any,
  );
  const streamingMode = computeChatLoadingMode({
    loading: false,
    isStreaming: streamingUiState.isStreaming,
    renderItems: streamingRenderItems,
    hasMaterializedReasoningSpan: hasMaterializedReasoningSpan(streamingRenderItems),
  });
  assert.equal(streamingMode, 'reasoning-streaming');

  const settlingRenderItems = renderItemsFromState({
    detail: userOnlyDetail,
    streamEvents: allStreamEvents,
    runRenderState: 'settling',
    activeRunId: started.run_id,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: started.run_id,
  });
  assert.ok(settlingRenderItems.some((item: ChatRenderItem) => item.type === 'assistant-message'));

  const persistedRenderItems = renderItemsFromState({
    detail: persistedDetail,
    streamEvents: allStreamEvents,
    runRenderState: 'persisted',
    activeRunId: started.run_id,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: started.run_id,
  });

  const userCount = persistedRenderItems.filter((item: ChatRenderItem) => item.type === 'user-message').length;
  const assistantItems = persistedRenderItems.filter(
    (item: ChatRenderItem) => item.type === 'assistant-message'
  );
  assert.equal(userCount, 1);
  assert.equal(assistantItems.length, 1);

  const hasTransientAssistant = assistantItems.some((item: ChatRenderItem) => {
    if (!('messageId' in item)) {
      return false;
    }
    const messageId = item.messageId;
    return typeof messageId === 'string' && messageId.startsWith(STREAMING_ASSISTANT_MESSAGE_ID_PREFIX);
  });
  assert.equal(hasTransientAssistant, false);

  const firstUserIndex = persistedRenderItems.findIndex((item: ChatRenderItem) => item.type === 'user-message');
  const firstAssistantIndex = persistedRenderItems.findIndex(
    (item: ChatRenderItem) => item.type === 'assistant-message'
  );
  assert.ok(firstUserIndex >= 0);
  assert.ok(firstAssistantIndex > firstUserIndex);

  const persistedMode = computeChatLoadingMode({
    loading: false,
    isStreaming: false,
    renderItems: persistedRenderItems,
    hasMaterializedReasoningSpan: hasMaterializedReasoningSpan(persistedRenderItems),
  });
  assert.equal(persistedMode, 'idle');
});

test('UI timeline smoke: approval-required stream renders approval card before and after decision', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const started = await startAgentRun({
    question: 'Please run with [approval] before tool execution',
    scope_project_id: projectId,
  });

  const collector = collectSseEvents(createAgentEventStream(started.run_id));
  const approval = await waitForApproval(started.run_id);

  const detailBeforeRaw = await getConversationDetail(started.conversation_id, projectId, true);
  const detailBefore = toUiDetail(detailBeforeRaw);

  const preDecisionRenderItems = renderItemsFromState({
    detail: detailBefore,
    streamEvents: [],
    runRenderState: 'settling',
    activeRunId: started.run_id,
    chunkText: '',
    chunkIsFinal: false,
    chunkRunId: started.run_id,
  });

  await applyApprovalDecision({
    run_id: started.run_id,
    approval_id: approval.id,
    decision: 'approve',
  });

  const completedStreamEvents = await collector;
  const detailAfterRaw = await getConversationDetail(started.conversation_id, projectId, true);
  const detailAfter = toUiDetail(detailAfterRaw);

  const postDecisionRenderItems = renderItemsFromState({
    detail: detailAfter,
    streamEvents: completedStreamEvents,
    runRenderState: 'persisted',
    activeRunId: started.run_id,
    chunkText: '',
    chunkIsFinal: true,
    chunkRunId: started.run_id,
  });

  // Pending snapshot may race; the persisted timeline must reliably include approval and assistant.
  assert.ok(preDecisionRenderItems.some((item: ChatRenderItem) => item.type === 'approval'));
  assert.ok(postDecisionRenderItems.some((item: ChatRenderItem) => item.type === 'approval'));
  assert.ok(postDecisionRenderItems.some((item: ChatRenderItem) => item.type === 'assistant-message'));
});
