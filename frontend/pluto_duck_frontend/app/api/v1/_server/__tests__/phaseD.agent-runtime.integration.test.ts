import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tempRoot = await mkdtemp(join(tmpdir(), 'pluto-duck-phase-d-agent-'));
process.env.PLUTODUCK_DB_PATH = join(tempRoot, 'pluto_duck_phase_d_agent.duckdb');

const storeModule = await import(new URL('../store.ts', import.meta.url).href);
const { getSettings, resetDatabaseForTests } = storeModule;

const chatModule = await import(new URL('../chat.ts', import.meta.url).href);
const { resetChatSchemaForTests } = chatModule;

const runtimeModule = await import(new URL('../agentRuntime.ts', import.meta.url).href);
const {
  applyApprovalDecision,
  cancelAgentRun,
  createAgentEventStream,
  getRunResult,
  listRunApprovals,
  resetAgentRuntimeForTests,
  startAgentRun,
} = runtimeModule;

type AgentEventPayload = {
  type?: string;
  subtype?: string;
  content?: unknown;
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

async function waitForApproval(runId: string): Promise<string> {
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

test('Phase D: cancel transitions running run to cancelled state and emits run end', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const started = await startAgentRun({
    question: 'Need approval [approval]',
    scope_project_id: projectId,
    runtime_engine: 'langgraph_js',
  });

  const streamPromise = collectSseEvents(createAgentEventStream(started.run_id));
  await waitForApproval(started.run_id);

  const cancelled = await cancelAgentRun({
    run_id: started.run_id,
    reason: 'Cancelled in integration test',
    scope_project_id: projectId,
  });
  assert.equal(cancelled.status, 'cancellation_requested');

  const events = await streamPromise;
  const readyIndex = eventIndex(
    events,
    (event) =>
      event.type === 'reasoning' &&
      event.subtype === 'chunk' &&
      (event.content as { phase?: string; backend?: string; adapter?: string } | undefined)?.phase ===
        'langgraph_ready' &&
      (event.content as { backend?: string } | undefined)?.backend === 'module' &&
      (event.content as { adapter?: string } | undefined)?.adapter === 'deepagents_vendor',
    'langgraph ready(deepagents)'
  );
  const toolStartIndex = eventIndex(
    events,
    (event) => event.type === 'tool' && event.subtype === 'start',
    'tool start'
  );
  assert.ok(readyIndex < toolStartIndex);
  assert.ok(
    events.some((event) => {
      if (event.type !== 'run' || event.subtype !== 'end') {
        return false;
      }
      const content = event.content as { status?: string } | undefined;
      return content?.status === 'cancelled';
    })
  );

  const result = await getRunResult(started.run_id, projectId);
  assert.equal(result.status, 'cancelled');
});

test('Phase D: approval reject ends run safely without final assistant message', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const started = await startAgentRun({
    question: 'Reject branch [approval]',
    scope_project_id: projectId,
    runtime_engine: 'langgraph_js',
  });

  const streamPromise = collectSseEvents(createAgentEventStream(started.run_id));
  const approvalId = await waitForApproval(started.run_id);
  await applyApprovalDecision({
    run_id: started.run_id,
    approval_id: approvalId,
    decision: 'reject',
    scope_project_id: projectId,
  });

  const events = await streamPromise;
  const readyIndex = eventIndex(
    events,
    (event) =>
      event.type === 'reasoning' &&
      event.subtype === 'chunk' &&
      (event.content as { phase?: string; backend?: string; adapter?: string } | undefined)?.phase ===
        'langgraph_ready' &&
      (event.content as { backend?: string } | undefined)?.backend === 'module' &&
      (event.content as { adapter?: string } | undefined)?.adapter === 'deepagents_vendor',
    'langgraph ready(deepagents)'
  );
  const toolStartIndex = eventIndex(
    events,
    (event) => event.type === 'tool' && event.subtype === 'start',
    'approval tool start'
  );
  const toolEndIndex = eventIndex(
    events,
    (event) =>
      event.type === 'tool' &&
      event.subtype === 'end' &&
      (event.content as { decision?: string } | undefined)?.decision === 'reject',
    'approval tool end(reject)'
  );
  const runEndIndex = eventIndex(
    events,
    (event) => event.type === 'run' && event.subtype === 'end',
    'run end'
  );
  assert.ok(readyIndex < toolStartIndex);
  assert.ok(toolStartIndex < toolEndIndex);
  assert.ok(toolEndIndex < runEndIndex);
  assert.ok(
    events.some(
      (event) =>
        event.type === 'tool' &&
        event.subtype === 'end' &&
        (event.content as { decision?: string } | undefined)?.decision === 'reject'
    )
  );
  assert.ok(!events.some((event) => event.type === 'message' && event.subtype === 'final'));
  assert.ok(
    events.some((event) => {
      if (event.type !== 'run' || event.subtype !== 'end') {
        return false;
      }
      const content = event.content as { status?: string; code?: string } | undefined;
      return content?.status === 'cancelled' && content?.code === 'approval_rejected';
    })
  );

  const result = await getRunResult(started.run_id, projectId);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.code, 'approval_rejected');
});

test('Phase D: approval edit resumes run and carries effective args to tool end event', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const started = await startAgentRun({
    question: 'Edit branch [approval]',
    scope_project_id: projectId,
    runtime_engine: 'langgraph_js',
  });

  const streamPromise = collectSseEvents(createAgentEventStream(started.run_id));
  const approvalId = await waitForApproval(started.run_id);
  const editedArgs = { path: '/tmp/edited.md', overwrite: false };
  await applyApprovalDecision({
    run_id: started.run_id,
    approval_id: approvalId,
    decision: 'edit',
    edited_args: editedArgs,
    scope_project_id: projectId,
  });

  const events = await streamPromise;
  const readyIndex = eventIndex(
    events,
    (event) =>
      event.type === 'reasoning' &&
      event.subtype === 'chunk' &&
      (event.content as { phase?: string; backend?: string; adapter?: string } | undefined)?.phase ===
        'langgraph_ready' &&
      (event.content as { backend?: string } | undefined)?.backend === 'module' &&
      (event.content as { adapter?: string } | undefined)?.adapter === 'deepagents_vendor',
    'langgraph ready(deepagents)'
  );
  const toolStartIndex = eventIndex(
    events,
    (event) => event.type === 'tool' && event.subtype === 'start',
    'approval tool start'
  );
  const toolEndIndex = eventIndex(
    events,
    (event) =>
      event.type === 'tool' &&
      event.subtype === 'end' &&
      (event.content as { decision?: string } | undefined)?.decision === 'edit',
    'approval tool end(edit)'
  );
  const messageFinalIndex = eventIndex(
    events,
    (event) => event.type === 'message' && event.subtype === 'final',
    'message final'
  );
  const runEndIndex = eventIndex(
    events,
    (event) => event.type === 'run' && event.subtype === 'end',
    'run end'
  );
  assert.ok(readyIndex < toolStartIndex);
  assert.ok(toolStartIndex < toolEndIndex);
  assert.ok(toolEndIndex < messageFinalIndex);
  assert.ok(messageFinalIndex < runEndIndex);
  assert.ok(
    events.some((event) => {
      if (event.type !== 'tool' || event.subtype !== 'end') {
        return false;
      }
      const content = event.content as { decision?: string; effective_args?: unknown } | undefined;
      return content?.decision === 'edit' && JSON.stringify(content.effective_args) === JSON.stringify(editedArgs);
    })
  );
  assert.ok(events.some((event) => event.type === 'message' && event.subtype === 'final'));
  assert.ok(
    events.some((event) => {
      if (event.type !== 'run' || event.subtype !== 'end') {
        return false;
      }
      const content = event.content as { status?: string } | undefined;
      return content?.status === 'completed';
    })
  );
});

test('Phase D: timeout transitions run to timed_out state and emits run end', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const started = await startAgentRun({
    question: 'Timeout scenario',
    scope_project_id: projectId,
    timeout_ms: 100,
  });

  const events = await collectSseEvents(createAgentEventStream(started.run_id));
  assert.ok(
    events.some((event) => {
      if (event.type !== 'run' || event.subtype !== 'end') {
        return false;
      }
      const content = event.content as { status?: string } | undefined;
      return content?.status === 'timed_out';
    })
  );

  const result = await getRunResult(started.run_id, projectId);
  assert.equal(result.status, 'timed_out');
});
