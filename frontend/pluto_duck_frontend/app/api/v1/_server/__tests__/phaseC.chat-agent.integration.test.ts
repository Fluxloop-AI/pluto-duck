import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tempRoot = await mkdtemp(join(tmpdir(), 'pluto-duck-phase-c-chat-'));
process.env.PLUTODUCK_DB_PATH = join(tempRoot, 'pluto_duck_phase_c_chat.duckdb');

const storeModule = await import(new URL('../store.ts', import.meta.url).href);
const { getSettings, resetDatabaseForTests } = storeModule;

const chatModule = await import(new URL('../chat.ts', import.meta.url).href);
const { getConversationDetail, resetChatSchemaForTests } = chatModule;

const runtimeModule = await import(new URL('../agentRuntime.ts', import.meta.url).href);
const {
  applyApprovalDecision,
  createAgentEventStream,
  listRunApprovals,
  resetAgentRuntimeForTests,
  startAgentRun,
} = runtimeModule;

type AgentEventPayload = {
  event_id?: string;
  sequence?: number;
  display_order?: number;
  run_id?: string | null;
  type?: string;
  subtype?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
};

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function collectSseEvents(stream: ReadableStream<Uint8Array>): Promise<AgentEventPayload[]> {
  const events: AgentEventPayload[] = [];
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
        const jsonText = line.slice(6).trim();
        if (!jsonText) {
          continue;
        }
        events.push(JSON.parse(jsonText) as AgentEventPayload);
      }
    }
  }

  return events;
}

async function waitForApproval(runId: string): Promise<{ id: string }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const approvals = (await listRunApprovals(runId)) as Array<{ id: string }>;
    if (approvals.length > 0) {
      return approvals[0] as { id: string };
    }
    await sleep(20);
  }
  throw new Error('Approval was not created in time');
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

test('Agent SSE stream emits canonical event fields and persists final conversation state', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const started = await startAgentRun({
    question: 'Phase C SSE schema smoke test',
    scope_project_id: projectId,
  });

  const stream = createAgentEventStream(started.run_id);
  const events = await collectSseEvents(stream);

  assert.ok(events.length > 0);
  for (const event of events) {
    assert.ok(typeof event.event_id === 'string' && event.event_id.length > 0);
    assert.ok(typeof event.sequence === 'number' && event.sequence > 0);
    assert.ok(typeof event.display_order === 'number' && event.display_order > 0);
    assert.equal(event.run_id, started.run_id);

    const metadata = event.metadata ?? {};
    assert.equal(metadata.event_id, event.event_id);
    assert.equal(metadata.sequence, event.sequence);
    assert.equal(metadata.display_order, event.display_order);
    assert.equal(metadata.run_id, started.run_id);
  }

  assert.ok(events.some(event => event.type === 'message' && event.subtype === 'chunk'));
  assert.ok(events.some(event => event.type === 'message' && event.subtype === 'final'));
  assert.ok(events.some(event => event.type === 'run' && event.subtype === 'end'));

  const detail = await getConversationDetail(started.conversation_id, projectId, true);
  assert.equal(detail.id, started.conversation_id);
  assert.ok((detail.messages ?? []).some((message: { role: string }) => message.role === 'assistant'));
  assert.ok(
    (detail.events ?? []).some(
      (event: { type: string; subtype?: string }) => event.type === 'run' && event.subtype === 'end'
    )
  );
});

test('Approval decision endpoint resumes paused run and emits decision event', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const started = await startAgentRun({
    question: 'Please proceed with [approval] flow',
    scope_project_id: projectId,
  });

  const streamPromise = collectSseEvents(createAgentEventStream(started.run_id));
  const approval = await waitForApproval(started.run_id);

  await applyApprovalDecision({
    run_id: started.run_id,
    approval_id: approval.id,
    decision: 'approve',
  });

  const events = await streamPromise;
  assert.ok(
    events.some(
      event =>
        event.type === 'tool' &&
        event.subtype === 'start' &&
        typeof (event.content as { approval_id?: string } | undefined)?.approval_id === 'string'
    )
  );
  assert.ok(
    events.some(
      event =>
        event.type === 'tool' &&
        event.subtype === 'end' &&
        (event.content as { decision?: string } | undefined)?.decision === 'approve'
    )
  );
  assert.ok(events.some(event => event.type === 'run' && event.subtype === 'end'));
});
