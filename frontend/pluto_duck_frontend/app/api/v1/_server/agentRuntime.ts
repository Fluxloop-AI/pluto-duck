import { randomUUID } from 'node:crypto';

import { buildLangGraphPlan } from './langgraphRuntime.ts';
import { StoreHttpError } from './store.ts';
import {
  appendConversationMessage,
  createApproval,
  createConversation,
  decideApproval as persistApprovalDecision,
  getApproval,
  getConversationSummary,
  getNextDisplayOrder,
  insertConversationEvent,
  listApprovals,
  markConversationRunCompleted,
  markConversationRunStarted,
  type ChatApprovalRecord,
  type ChatEventRecord,
} from './chat.ts';

type JsonMap = Record<string, unknown>;

type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
type RunInterruptCode = 'cancelled' | 'timed_out';
type RunEngine = 'phase_c_stub' | 'langgraph_js';

interface RunUserContext {
  user_id?: string;
  session_id?: string;
  user_agent?: string;
}

interface RunState {
  run_id: string;
  conversation_id: string;
  question: string;
  model: string | null;
  metadata: JsonMap;
  scope_project_id: string | null;
  user_context: RunUserContext | null;
  started_at: string;
  timeout_ms: number;
  engine: RunEngine;
  status: RunStatus;
  result: JsonMap | null;
  sequence: number;
  display_order: number;
  events: ChatEventRecord[];
  listeners: Map<string, (event: ChatEventRecord) => void>;
  closeListeners: Map<string, () => void>;
  abortController: AbortController;
  pendingApprovals: Map<
    string,
    {
      tool_name: string;
      tool_call_id: string;
      resolve: (decision: 'approve' | 'reject' | 'edit', editedArgs?: JsonMap | null) => void;
    }
  >;
}

class RunInterruptError extends Error {
  readonly code: RunInterruptCode;

  constructor(code: RunInterruptCode, detail: string) {
    super(detail);
    this.code = code;
    this.name = 'RunInterruptError';
  }
}

const DEFAULT_RUN_TIMEOUT_MS = 2 * 60 * 1000;
const MIN_RUN_TIMEOUT_MS = 100;
const MAX_RUN_TIMEOUT_MS = 15 * 60 * 1000;
const RUN_RETENTION_MS = 10 * 60 * 1000;
const DEFAULT_RUN_ENGINE: RunEngine = 'langgraph_js';

const globalRuntime = globalThis as typeof globalThis & {
  __plutoDuckAgentRuntime?: {
    runs: Map<string, RunState>;
  };
};

const runtime =
  globalRuntime.__plutoDuckAgentRuntime ??
  (() => {
    const state = {
      runs: new Map<string, RunState>(),
    };
    globalRuntime.__plutoDuckAgentRuntime = state;
    return state;
  })();

function toRunInterruptError(reason: unknown): RunInterruptError {
  if (reason instanceof RunInterruptError) {
    return reason;
  }
  if (reason instanceof Error && reason.message.trim().length > 0) {
    return new RunInterruptError('cancelled', reason.message);
  }
  if (typeof reason === 'string' && reason.trim().length > 0) {
    return new RunInterruptError('cancelled', reason.trim());
  }
  return new RunInterruptError('cancelled', 'Run cancelled');
}

function assertRunActive(run: RunState): void {
  if (!run.abortController.signal.aborted) {
    return;
  }
  throw toRunInterruptError(run.abortController.signal.reason);
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, reject) => {
    if (signal?.aborted) {
      reject(toRunInterruptError(signal.reason));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolveDelay();
    }, milliseconds);

    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(toRunInterruptError(signal?.reason));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function sanitizeQuestion(value: string): string {
  const question = value.trim();
  if (question.length === 0) {
    throw new StoreHttpError(400, 'question is required');
  }
  return question;
}

function sanitizeRunTimeout(timeoutMs: number | null | undefined): number {
  if (timeoutMs == null) {
    return DEFAULT_RUN_TIMEOUT_MS;
  }
  if (!Number.isFinite(timeoutMs)) {
    throw new StoreHttpError(400, 'timeout_ms must be a finite number');
  }
  const normalized = Math.trunc(timeoutMs);
  if (normalized < MIN_RUN_TIMEOUT_MS || normalized > MAX_RUN_TIMEOUT_MS) {
    throw new StoreHttpError(
      400,
      `timeout_ms must be between ${MIN_RUN_TIMEOUT_MS} and ${MAX_RUN_TIMEOUT_MS}`
    );
  }
  return normalized;
}

function sanitizeUserContext(userContext: JsonMap | null | undefined): RunUserContext | null {
  if (!userContext) {
    return null;
  }

  const normalized: RunUserContext = {};
  const userIdRaw = userContext.user_id;
  if (typeof userIdRaw === 'string' && userIdRaw.trim().length > 0) {
    normalized.user_id = userIdRaw.trim();
  }

  const sessionIdRaw = userContext.session_id;
  if (typeof sessionIdRaw === 'string' && sessionIdRaw.trim().length > 0) {
    normalized.session_id = sessionIdRaw.trim();
  }

  const userAgentRaw = userContext.user_agent;
  if (typeof userAgentRaw === 'string' && userAgentRaw.trim().length > 0) {
    normalized.user_agent = userAgentRaw.trim();
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function toRunEngine(value: unknown): RunEngine | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'phase_c_stub' || normalized === 'stub') {
    return 'phase_c_stub';
  }
  if (normalized === 'langgraph_js' || normalized === 'langgraph') {
    return 'langgraph_js';
  }
  return null;
}

function resolveRunEngine(params: { runtime_engine?: string | null; metadata?: JsonMap | null }): RunEngine {
  const explicit = toRunEngine(params.runtime_engine);
  if (explicit) {
    return explicit;
  }

  const metadataEngine = toRunEngine(params.metadata?.runtime_engine);
  if (metadataEngine) {
    return metadataEngine;
  }

  const envEngine = toRunEngine(process.env.PLUTODUCK_AGENT_RUNTIME_ENGINE);
  if (envEngine) {
    return envEngine;
  }
  return DEFAULT_RUN_ENGINE;
}

function splitIntoChunks(text: string, chunkSize = 24): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }
  return chunks;
}

function buildAssistantAnswer(question: string, model: string | null): string {
  const normalized = question.trim();
  const prefix = model ? `[${model}] ` : '';
  return `${prefix}${normalized}\n\n(Phase D Node SSE stub response)`;
}

function toSsePayload(event: ChatEventRecord): string {
  return `data: ${JSON.stringify({
    event_id: event.event_id,
    sequence: event.sequence,
    display_order: event.display_order,
    run_id: event.run_id,
    tool_call_id: event.tool_call_id,
    parent_event_id: event.parent_event_id,
    phase: event.phase,
    type: event.type,
    subtype: event.subtype,
    content: event.content,
    metadata: event.metadata,
    timestamp: event.timestamp,
  })}\n\n`;
}

function requireRun(runIdInput: string, scopeProjectId?: string | null): RunState {
  const runId = runIdInput.trim();
  if (!runId) {
    throw new StoreHttpError(400, 'Run id is required');
  }

  const run = runtime.runs.get(runId);
  if (!run) {
    throw new StoreHttpError(404, 'Run not found');
  }

  if (
    scopeProjectId &&
    run.scope_project_id &&
    scopeProjectId.trim().length > 0 &&
    run.scope_project_id !== scopeProjectId
  ) {
    throw new StoreHttpError(404, 'Run not found');
  }

  return run;
}

async function emitEvent(
  run: RunState,
  event: {
    type: string;
    subtype?: string;
    content?: unknown;
    metadata?: JsonMap;
    tool_call_id?: string | null;
    parent_event_id?: string | null;
    phase?: string | null;
    persist?: boolean;
  }
): Promise<ChatEventRecord> {
  const eventId = randomUUID();
  const metadata = { ...(event.metadata ?? {}) };
  metadata.event_id = eventId;
  metadata.run_id = run.run_id;
  metadata.sequence = run.sequence;
  metadata.display_order = run.display_order;
  metadata.runtime_engine = run.engine;
  if (event.tool_call_id) {
    metadata.tool_call_id = event.tool_call_id;
  }
  if (event.parent_event_id) {
    metadata.parent_event_id = event.parent_event_id;
  }
  if (event.phase) {
    metadata.phase = event.phase;
  }

  const baseEvent: ChatEventRecord = {
    event_id: eventId,
    sequence: run.sequence,
    display_order: run.display_order,
    run_id: run.run_id,
    tool_call_id: event.tool_call_id ?? null,
    parent_event_id: event.parent_event_id ?? null,
    phase: event.phase ?? null,
    type: event.type,
    subtype: event.subtype,
    content: event.content ?? null,
    metadata,
    timestamp: new Date().toISOString(),
  };

  const record =
    event.persist === false
      ? baseEvent
      : await insertConversationEvent({
          event_id: eventId,
          conversation_id: run.conversation_id,
          type: event.type,
          subtype: event.subtype,
          content: event.content,
          metadata,
          timestamp: baseEvent.timestamp,
          run_id: run.run_id,
          sequence: run.sequence,
          display_order: run.display_order,
          tool_call_id: event.tool_call_id ?? null,
          parent_event_id: event.parent_event_id ?? null,
          phase: event.phase ?? null,
        });

  run.events.push(record);
  for (const notify of run.listeners.values()) {
    notify(record);
  }

  run.sequence += 1;
  run.display_order += 1;
  return record;
}

function closeRunStreams(run: RunState): void {
  for (const close of run.closeListeners.values()) {
    close();
  }
}

function shouldRequireApproval(question: string): boolean {
  const normalized = question.toLowerCase();
  return normalized.includes('approval_required:yes') || normalized.includes('[approval]');
}

async function waitForApprovalDecision(
  run: RunState,
  approvalId: string,
  toolName: string,
  toolCallId: string
): Promise<{ decision: 'approve' | 'reject' | 'edit'; edited_args?: JsonMap | null }> {
  return new Promise((resolve, reject) => {
    if (run.abortController.signal.aborted) {
      reject(toRunInterruptError(run.abortController.signal.reason));
      return;
    }

    const onAbort = () => {
      run.pendingApprovals.delete(approvalId);
      reject(toRunInterruptError(run.abortController.signal.reason));
    };
    run.abortController.signal.addEventListener('abort', onAbort, { once: true });

    run.pendingApprovals.set(approvalId, {
      tool_name: toolName,
      tool_call_id: toolCallId,
      resolve: (decision, editedArgs) => {
        run.pendingApprovals.delete(approvalId);
        run.abortController.signal.removeEventListener('abort', onAbort);
        resolve({
          decision,
          edited_args: editedArgs ?? null,
        });
      },
    });
  });
}

async function executeRun(run: RunState): Promise<void> {
  const timeoutHandle = setTimeout(() => {
    if (run.status !== 'running' || run.abortController.signal.aborted) {
      return;
    }
    run.abortController.abort(
      new RunInterruptError('timed_out', `Run timed out after ${run.timeout_ms}ms`)
    );
  }, run.timeout_ms);
  if (typeof (timeoutHandle as { unref?: () => void }).unref === 'function') {
    (timeoutHandle as { unref: () => void }).unref();
  }

  try {
    const requiresApproval = shouldRequireApproval(run.question);
    let plannedAnswer = buildAssistantAnswer(run.question, run.model);
    let toolName = requiresApproval ? 'write_file' : 'search';
    let toolInput: JsonMap = requiresApproval
      ? { description: 'Approve file write' }
      : { input: run.question };

    if (run.engine === 'langgraph_js') {
      await emitEvent(run, {
        type: 'reasoning',
        subtype: 'chunk',
        content: {
          phase: 'langgraph_entry',
          runner: 'langgraph_js',
          adapter: 'deepagents_vendor',
          fallback_adapter: 'langgraph_minimal',
        },
        phase: 'langgraph_entry',
      });

      const graphPlan = await buildLangGraphPlan({
        question: run.question,
        model: run.model,
        approval_required: requiresApproval,
      });
      plannedAnswer = graphPlan.answer;
      toolName = graphPlan.tool_name;
      toolInput = graphPlan.tool_input;

      await emitEvent(run, {
        type: 'reasoning',
        subtype: 'chunk',
        content: {
          phase: 'langgraph_ready',
          runner: 'langgraph_js',
          backend: graphPlan.backend,
          adapter: graphPlan.adapter,
          fallback_reason: graphPlan.fallback_reason ?? null,
        },
        phase: 'langgraph_ready',
      });
    }

    assertRunActive(run);
    await emitEvent(run, {
      type: 'reasoning',
      subtype: 'start',
      content: { phase: 'llm_start' },
      phase: 'llm_start',
    });
    await sleep(20, run.abortController.signal);

    assertRunActive(run);
    await emitEvent(run, {
      type: 'reasoning',
      subtype: 'chunk',
      content: {
        phase: 'llm_reasoning',
        reason: `Analyzing: ${run.question}`,
      },
      phase: 'llm_reasoning',
    });

    if (requiresApproval) {
      const approvalId = randomUUID();
      const toolCallId = randomUUID();

      assertRunActive(run);
      await createApproval({
        approval_id: approvalId,
        conversation_id: run.conversation_id,
        run_id: run.run_id,
        tool_name: toolName,
        tool_call_id: toolCallId,
        request_preview: {
          description: String(toolInput.description ?? 'Approve tool action'),
        },
      });

      await emitEvent(run, {
        type: 'tool',
        subtype: 'start',
        content: {
          tool: toolName,
          approval_required: true,
          approval_id: approvalId,
          preview: {
            description: String(toolInput.description ?? 'Approve tool action'),
          },
        },
        tool_call_id: toolCallId,
      });

      const applied = await waitForApprovalDecision(run, approvalId, toolName, toolCallId);
      assertRunActive(run);
      await emitEvent(run, {
        type: 'tool',
        subtype: 'end',
        content: {
          tool: toolName,
          approval_id: approvalId,
          decision: applied.decision,
          effective_args: applied.edited_args ?? null,
        },
        tool_call_id: toolCallId,
      });
      if (applied.decision === 'reject') {
        const detail = 'Approval rejected by user';
        const rejectedResult = {
          status: 'cancelled',
          code: 'approval_rejected',
          error: detail,
          engine: run.engine,
        };
        await emitEvent(run, {
          type: 'run',
          subtype: 'end',
          content: rejectedResult,
        });
        await markConversationRunCompleted(run.conversation_id, 'cancelled', detail);
        run.status = 'cancelled';
        run.result = rejectedResult;
        return;
      }
    } else {
      const toolCallId = randomUUID();
      await emitEvent(run, {
        type: 'tool',
        subtype: 'start',
        content: {
          tool: toolName,
          input: toolInput,
        },
        tool_call_id: toolCallId,
      });
      await sleep(15, run.abortController.signal);
      assertRunActive(run);
      await emitEvent(run, {
        type: 'tool',
        subtype: 'end',
        content: {
          tool: toolName,
          output: { ok: true },
        },
        tool_call_id: toolCallId,
      });
    }

    const answer = plannedAnswer;
    const chunks = splitIntoChunks(answer);
    for (const chunk of chunks) {
      assertRunActive(run);
      await emitEvent(run, {
        type: 'message',
        subtype: 'chunk',
        content: {
          text_delta: chunk,
          is_final: false,
        },
        persist: false,
      });
      await sleep(15, run.abortController.signal);
    }

    assertRunActive(run);
    await emitEvent(run, {
      type: 'reasoning',
      subtype: 'chunk',
      content: {
        phase: 'llm_end',
        text: answer,
      },
      phase: 'llm_end',
    });

    await emitEvent(run, {
      type: 'reasoning',
      subtype: 'chunk',
      content: {
        phase: 'llm_usage',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
        model: run.model ?? 'gpt-5-mini',
      },
      phase: 'llm_usage',
    });

    assertRunActive(run);
    await appendConversationMessage({
      conversation_id: run.conversation_id,
      role: 'assistant',
      content: {
        text: answer,
      },
      run_id: run.run_id,
    });

    await emitEvent(run, {
      type: 'message',
      subtype: 'final',
      content: {
        text: answer,
      },
    });

    const finalResult = {
      status: 'completed',
      finished: true,
      answer,
      engine: run.engine,
    };
    await emitEvent(run, {
      type: 'run',
      subtype: 'end',
      content: finalResult,
    });

    await markConversationRunCompleted(run.conversation_id, 'completed', answer);
    run.status = 'completed';
    run.result = finalResult;
  } catch (error) {
    const interrupted =
      error instanceof RunInterruptError
        ? error
        : run.abortController.signal.aborted
          ? toRunInterruptError(run.abortController.signal.reason)
          : null;

    if (interrupted) {
      const interruptedStatus: RunStatus = interrupted.code === 'timed_out' ? 'timed_out' : 'cancelled';
      await emitEvent(run, {
        type: 'run',
        subtype: 'error',
        content: {
          status: interruptedStatus,
          code: interrupted.code,
          error: interrupted.message,
        },
      });
      const interruptedResult = {
        status: interruptedStatus,
        code: interrupted.code,
        error: interrupted.message,
        engine: run.engine,
      };
      await emitEvent(run, {
        type: 'run',
        subtype: 'end',
        content: interruptedResult,
      });
      await markConversationRunCompleted(run.conversation_id, interruptedStatus, interrupted.message);
      run.status = interruptedStatus;
      run.result = interruptedResult;
      return;
    }

    const detail = error instanceof Error ? error.message : 'Unknown run error';
    await emitEvent(run, {
      type: 'run',
      subtype: 'error',
      content: {
        status: 'failed',
        error: detail,
      },
    });
    const failedResult = {
      status: 'failed',
      error: detail,
      engine: run.engine,
    };
    await emitEvent(run, {
      type: 'run',
      subtype: 'end',
      content: failedResult,
    });
    await markConversationRunCompleted(run.conversation_id, 'failed', detail);
    run.status = 'failed';
    run.result = failedResult;
  } finally {
    clearTimeout(timeoutHandle);
    closeRunStreams(run);
    const cleanupHandle = setTimeout(() => {
      runtime.runs.delete(run.run_id);
    }, RUN_RETENTION_MS);
    if (typeof (cleanupHandle as { unref?: () => void }).unref === 'function') {
      (cleanupHandle as { unref: () => void }).unref();
    }
  }
}

export async function startAgentRun(params: {
  question: string;
  conversation_id?: string | null;
  model?: string | null;
  metadata?: JsonMap | null;
  scope_project_id?: string | null;
  user_context?: JsonMap | null;
  timeout_ms?: number | null;
  runtime_engine?: string | null;
}): Promise<{
  conversation_id: string;
  run_id: string;
  events_url: string;
}> {
  const question = sanitizeQuestion(params.question);
  const runTimeoutMs = sanitizeRunTimeout(params.timeout_ms);
  const userContext = sanitizeUserContext(params.user_context);
  const runEngine = resolveRunEngine({
    runtime_engine: params.runtime_engine,
    metadata: params.metadata ?? null,
  });
  const conversation = await createConversation({
    question,
    metadata: params.metadata ?? null,
    conversation_id: params.conversation_id ?? null,
    model: params.model ?? null,
    scope_project_id: params.scope_project_id ?? null,
  });
  const conversationId = conversation.id;

  if (params.scope_project_id) {
    const summary = await getConversationSummary(conversationId);
    if (!summary || summary.project_id !== params.scope_project_id) {
      throw new StoreHttpError(404, 'Conversation not found');
    }
  }

  const runId = randomUUID();
  const startingDisplayOrder = await getNextDisplayOrder(conversationId);

  await appendConversationMessage({
    conversation_id: conversationId,
    role: 'user',
    content: {
      text: question,
      metadata: params.metadata ?? {},
    },
    run_id: runId,
  });
  await markConversationRunStarted(conversationId, runId, question);

  const run: RunState = {
    run_id: runId,
    conversation_id: conversationId,
    question,
    model: params.model ?? null,
    metadata: params.metadata ?? {},
    scope_project_id: params.scope_project_id ?? null,
    user_context: userContext,
    started_at: new Date().toISOString(),
    timeout_ms: runTimeoutMs,
    engine: runEngine,
    status: 'running',
    result: null,
    sequence: 1,
    display_order: startingDisplayOrder,
    events: [],
    listeners: new Map(),
    closeListeners: new Map(),
    abortController: new AbortController(),
    pendingApprovals: new Map(),
  };
  runtime.runs.set(runId, run);
  void executeRun(run);

  return {
    conversation_id: conversationId,
    run_id: runId,
    events_url: `/api/v1/agent/${runId}/events`,
  };
}

export async function getRunResult(runIdInput: string, scope_project_id?: string | null): Promise<JsonMap> {
  const run = requireRun(runIdInput, scope_project_id);
  return (
    run.result ?? {
      status: run.status,
      started_at: run.started_at,
      timeout_ms: run.timeout_ms,
      engine: run.engine,
    }
  );
}

export function createAgentEventStream(
  runIdInput: string,
  abortSignal?: AbortSignal,
  scope_project_id?: string | null
): ReadableStream<Uint8Array> {
  const run = requireRun(runIdInput, scope_project_id);

  const encoder = new TextEncoder();
  const subscriberId = randomUUID();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const safeClose = () => {
        if (closed) {
          return;
        }
        closed = true;
        run.listeners.delete(subscriberId);
        run.closeListeners.delete(subscriberId);
        abortSignal?.removeEventListener('abort', safeClose);
        try {
          controller.close();
        } catch (_error) {
          // ignore close race
        }
      };

      run.listeners.set(subscriberId, (event) => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(toSsePayload(event)));
      });
      run.closeListeners.set(subscriberId, safeClose);

      for (const event of run.events) {
        controller.enqueue(encoder.encode(toSsePayload(event)));
      }

      if (run.status !== 'running') {
        safeClose();
        return;
      }

      abortSignal?.addEventListener('abort', safeClose);
    },
    cancel() {
      run.listeners.delete(subscriberId);
      run.closeListeners.delete(subscriberId);
    },
  });
}

export async function listRunApprovals(
  runIdInput: string,
  scope_project_id?: string | null
): Promise<ChatApprovalRecord[]> {
  const run = requireRun(runIdInput, scope_project_id);
  const runId = run.run_id;
  return listApprovals(runId);
}

export async function getRunApproval(
  runIdInput: string,
  approvalIdInput: string,
  scope_project_id?: string | null
): Promise<ChatApprovalRecord> {
  const run = requireRun(runIdInput, scope_project_id);
  const runId = run.run_id;
  const approvalId = approvalIdInput.trim();
  if (!runId || !approvalId) {
    throw new StoreHttpError(400, 'Run id and approval id are required');
  }
  const approval = await getApproval(runId, approvalId);
  if (!approval) {
    throw new StoreHttpError(404, 'Approval not found');
  }
  return approval;
}

export async function applyApprovalDecision(params: {
  run_id: string;
  approval_id: string;
  decision: 'approve' | 'reject' | 'edit';
  edited_args?: JsonMap | null;
  scope_project_id?: string | null;
}): Promise<void> {
  const run = requireRun(params.run_id, params.scope_project_id);
  const runId = run.run_id;
  const approvalId = params.approval_id.trim();
  if (!runId || !approvalId) {
    throw new StoreHttpError(400, 'Run id and approval id are required');
  }

  await persistApprovalDecision({
    run_id: runId,
    approval_id: approvalId,
    decision: params.decision,
    edited_args: params.edited_args ?? null,
  });

  const pending = run.pendingApprovals.get(approvalId);
  if (pending) {
    pending.resolve(params.decision, params.edited_args ?? null);
  }
}

export async function cancelAgentRun(params: {
  run_id: string;
  reason?: string | null;
  scope_project_id?: string | null;
}): Promise<{ run_id: string; status: 'cancellation_requested' | 'already_finished' }> {
  const run = requireRun(params.run_id, params.scope_project_id);
  if (run.status !== 'running') {
    return {
      run_id: run.run_id,
      status: 'already_finished',
    };
  }

  const reason = params.reason?.trim() || 'Run cancelled by user';
  run.abortController.abort(new RunInterruptError('cancelled', reason));
  return {
    run_id: run.run_id,
    status: 'cancellation_requested',
  };
}

export function resetAgentRuntimeForTests(): void {
  for (const run of runtime.runs.values()) {
    if (run.status === 'running' && !run.abortController.signal.aborted) {
      run.abortController.abort(new RunInterruptError('cancelled', 'Agent runtime reset'));
    }
  }
  runtime.runs.clear();
}
