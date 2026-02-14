import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tempRoot = await mkdtemp(join(tmpdir(), 'pluto-duck-phase-d-contract-'));
process.env.PLUTODUCK_DB_PATH = join(tempRoot, 'pluto_duck_phase_d_contract.duckdb');

const storeModule = await import(new URL('../store.ts', import.meta.url).href);
const { getSettings, resetDatabaseForTests } = storeModule;

const chatModule = await import(new URL('../chat.ts', import.meta.url).href);
const { resetChatSchemaForTests } = chatModule;

const runtimeModule = await import(new URL('../agentRuntime.ts', import.meta.url).href);
const { applyApprovalDecision, createAgentEventStream, listRunApprovals, resetAgentRuntimeForTests, startAgentRun } =
  runtimeModule;

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
  await new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForApprovalId(runId: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const approvals = await listRunApprovals(runId);
    if (approvals.length > 0) {
      return approvals[0].id;
    }
    await sleep(10);
  }
  throw new Error('Approval was not created in time');
}

function eventIndex(
  events: AgentEventPayload[],
  predicate: (event: AgentEventPayload) => boolean,
  label: string
): number {
  const index = events.findIndex(predicate);
  assert.ok(index >= 0, `${label} event must exist`);
  return index;
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

test('Phase D contract: canonical stream fields and ordering remain stable', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const started = await startAgentRun({
    question: 'D2 ordering contract baseline',
    scope_project_id: projectId,
  });

  const events = await collectSseEvents(createAgentEventStream(started.run_id));
  assert.ok(events.length > 0);

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    assert.ok(typeof event.event_id === 'string' && event.event_id.length > 0);
    assert.ok(typeof event.sequence === 'number');
    assert.ok(typeof event.display_order === 'number');
    assert.equal(event.run_id, started.run_id);

    const metadata = event.metadata ?? {};
    assert.equal(metadata.event_id, event.event_id);
    assert.equal(metadata.sequence, event.sequence);
    assert.equal(metadata.display_order, event.display_order);
    assert.equal(metadata.run_id, started.run_id);
    assert.equal(metadata.runtime_engine, 'langgraph_js');

    if (index > 0) {
      const previous = events[index - 1];
      assert.equal(event.sequence, (previous.sequence as number) + 1);
      assert.equal(event.display_order, (previous.display_order as number) + 1);
    }
  }

  const reasoningStart = eventIndex(
    events,
    (event) => event.type === 'reasoning' && event.subtype === 'start',
    'reasoning start'
  );
  const langgraphEntry = eventIndex(
    events,
    (event) =>
      event.type === 'reasoning' &&
      event.subtype === 'chunk' &&
      (event.content as { phase?: string; runner?: string } | undefined)?.phase === 'langgraph_entry' &&
      (event.content as { runner?: string } | undefined)?.runner === 'langgraph_js',
    'langgraph entry'
  );
  const langgraphReady = eventIndex(
    events,
    (event) =>
      event.type === 'reasoning' &&
      event.subtype === 'chunk' &&
      (event.content as { phase?: string; runner?: string } | undefined)?.phase === 'langgraph_ready' &&
      (event.content as { runner?: string } | undefined)?.runner === 'langgraph_js',
    'langgraph ready'
  );
  const toolStart = eventIndex(events, (event) => event.type === 'tool' && event.subtype === 'start', 'tool start');
  const toolEnd = eventIndex(events, (event) => event.type === 'tool' && event.subtype === 'end', 'tool end');
  const messageChunk = eventIndex(
    events,
    (event) => event.type === 'message' && event.subtype === 'chunk',
    'message chunk'
  );
  const messageFinal = eventIndex(
    events,
    (event) => event.type === 'message' && event.subtype === 'final',
    'message final'
  );
  const runEnd = eventIndex(events, (event) => event.type === 'run' && event.subtype === 'end', 'run end');

  const readyContent = events[langgraphReady].content as
    | { backend?: string; adapter?: string; fallback_reason?: string | null }
    | undefined;
  assert.equal(readyContent?.backend, 'module');
  assert.equal(readyContent?.adapter, 'deepagents_vendor');
  assert.ok('fallback_reason' in (readyContent ?? {}));

  assert.ok(langgraphEntry < langgraphReady);
  assert.ok(langgraphReady < reasoningStart);
  assert.ok(reasoningStart < toolStart);
  assert.ok(toolStart < toolEnd);
  assert.ok(toolEnd < messageChunk);
  assert.ok(messageChunk < messageFinal);
  assert.ok(messageFinal < runEnd);

  const runEndContent = events[runEnd].content as { status?: string } | undefined;
  assert.equal(runEndContent?.status, 'completed');
});

test('Phase D contract: approval stream ordering is stable from request to resume completion', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const started = await startAgentRun({
    question: 'D2 approval ordering [approval]',
    scope_project_id: projectId,
  });

  const streamPromise = collectSseEvents(createAgentEventStream(started.run_id));
  const approvalId = await waitForApprovalId(started.run_id);
  await applyApprovalDecision({
    run_id: started.run_id,
    approval_id: approvalId,
    decision: 'approve',
    scope_project_id: projectId,
  });
  const events = await streamPromise;

  const approvalStart = eventIndex(
    events,
    (event) =>
      event.type === 'tool' &&
      event.subtype === 'start' &&
      (event.content as { approval_id?: string } | undefined)?.approval_id === approvalId,
    'approval tool start'
  );
  const approvalEnd = eventIndex(
    events,
    (event) =>
      event.type === 'tool' &&
      event.subtype === 'end' &&
      (event.content as { approval_id?: string; decision?: string } | undefined)?.approval_id === approvalId &&
      (event.content as { decision?: string } | undefined)?.decision === 'approve',
    'approval tool end'
  );
  const messageFinal = eventIndex(
    events,
    (event) => event.type === 'message' && event.subtype === 'final',
    'message final'
  );
  const runEnd = eventIndex(events, (event) => event.type === 'run' && event.subtype === 'end', 'run end');

  assert.ok(approvalStart < approvalEnd);
  assert.ok(approvalEnd < messageFinal);
  assert.ok(messageFinal < runEnd);
});

test('Phase D contract: LangGraph JS deepagents entrypoint preserves schema and emits adapter marker', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const started = await startAgentRun({
    question: 'D1 langgraph entry bootstrap',
    scope_project_id: projectId,
    runtime_engine: 'langgraph_js',
  });

  const events = await collectSseEvents(createAgentEventStream(started.run_id));
  assert.ok(events.length > 0);

  const entryEventIndex = eventIndex(
    events,
    (event) =>
      event.type === 'reasoning' &&
      event.subtype === 'chunk' &&
      (event.content as { phase?: string; runner?: string } | undefined)?.phase === 'langgraph_entry' &&
      (event.content as { runner?: string } | undefined)?.runner === 'langgraph_js',
    'langgraph entry bootstrap'
  );
  const readyEventIndex = eventIndex(
    events,
    (event) =>
      event.type === 'reasoning' &&
      event.subtype === 'chunk' &&
      (event.content as { phase?: string; runner?: string } | undefined)?.phase === 'langgraph_ready' &&
      (event.content as { runner?: string } | undefined)?.runner === 'langgraph_js',
    'langgraph ready marker'
  );
  const llmStartIndex = eventIndex(
    events,
    (event) =>
      event.type === 'reasoning' &&
      event.subtype === 'start' &&
      (event.content as { phase?: string } | undefined)?.phase === 'llm_start',
    'llm start'
  );
  const runEndIndex = eventIndex(events, (event) => event.type === 'run' && event.subtype === 'end', 'run end');
  const runEndContent = events[runEndIndex].content as { status?: string; engine?: string } | undefined;

  assert.ok(entryEventIndex < readyEventIndex);
  assert.ok(readyEventIndex < llmStartIndex);
  const readyContent = events[readyEventIndex].content as
    | { backend?: string; adapter?: string; fallback_reason?: string | null }
    | undefined;
  assert.equal(readyContent?.backend, 'module');
  assert.equal(readyContent?.adapter, 'deepagents_vendor');
  assert.equal(readyContent?.fallback_reason ?? null, null);
  assert.equal(runEndContent?.status, 'completed');
  assert.equal(runEndContent?.engine, 'langgraph_js');
  for (const event of events) {
    const metadata = event.metadata ?? {};
    assert.equal(metadata.runtime_engine, 'langgraph_js');
  }
});
