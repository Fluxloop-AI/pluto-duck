import { randomUUID } from 'node:crypto';

import { dbExec, dbQuery, sqlString } from './db.ts';
import { StoreHttpError } from './store.ts';

type JsonMap = Record<string, unknown>;

interface RuntimeState {
  queue: Promise<void>;
  schemaReady: boolean;
}

const globalChatState = globalThis as typeof globalThis & {
  __plutoDuckChatState?: RuntimeState;
};

const runtimeState: RuntimeState = globalChatState.__plutoDuckChatState ?? {
  queue: Promise.resolve(),
  schemaReady: false,
};

if (!globalChatState.__plutoDuckChatState) {
  globalChatState.__plutoDuckChatState = runtimeState;
}

function withChatLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = runtimeState.queue.then(operation, operation);
  runtimeState.queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeId(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new StoreHttpError(400, `${fieldName} is required`);
  }
  return normalized;
}

function toInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function parseJsonValue<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (_error) {
    return fallback;
  }
}

function parseJsonMap(raw: string | null): JsonMap {
  const parsed = parseJsonValue<unknown>(raw, {});
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as JsonMap;
  }
  return {};
}

function assertJsonObject(
  value: unknown,
  fieldName: string,
  options?: { optional?: boolean; nullable?: boolean }
): asserts value is JsonMap | null | undefined {
  if (value === undefined && options?.optional) {
    return;
  }
  if (value === null && options?.nullable) {
    return;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StoreHttpError(400, `${fieldName} must be an object`);
  }
}

function toConversationTitle(question: string | null): string | null {
  if (!question) {
    return null;
  }
  const trimmed = question.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 80);
}

function toPreview(text: string | null): string | null {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 160);
}

function extractTextFromContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return toPreview(content);
  }
  if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
    const record = content as Record<string, unknown>;
    for (const key of ['text', 'final_answer', 'answer', 'summary', 'message', 'preview']) {
      const value = record[key];
      if (typeof value === 'string') {
        return toPreview(value);
      }
    }
  }
  return null;
}

interface ProjectRow {
  id: string;
}

async function assertProjectExists(projectId: string): Promise<void> {
  const rows = await dbQuery<ProjectRow>(
    `SELECT id FROM projects WHERE id = ${sqlString(projectId)} LIMIT 1;`
  );
  if (!rows[0]) {
    throw new StoreHttpError(404, 'Project not found');
  }
}

async function resolveDefaultProjectId(): Promise<string> {
  const settingsRows = await dbQuery<{ default_project_id: string | null }>(
    'SELECT default_project_id FROM settings WHERE id = 1 LIMIT 1;'
  );
  const candidate = settingsRows[0]?.default_project_id ?? null;
  if (candidate) {
    const exists = await dbQuery<{ id: string }>(
      `SELECT id FROM projects WHERE id = ${sqlString(candidate)} LIMIT 1;`
    );
    if (exists[0]) {
      return candidate;
    }
  }

  const firstProjectRows = await dbQuery<{ id: string }>(
    'SELECT id FROM projects ORDER BY created_at ASC, id ASC LIMIT 1;'
  );
  const projectId = firstProjectRows[0]?.id;
  if (!projectId) {
    throw new StoreHttpError(500, 'No project is available');
  }
  return projectId;
}

export async function resolveConversationProjectId(
  scopeProjectId: string | null,
  metadataProjectId?: string | null
): Promise<string> {
  if (metadataProjectId) {
    await assertProjectExists(metadataProjectId);
  }
  if (scopeProjectId) {
    await assertProjectExists(scopeProjectId);
  }

  if (scopeProjectId && metadataProjectId && scopeProjectId !== metadataProjectId) {
    throw new StoreHttpError(400, 'Project scope does not match metadata project id');
  }

  if (scopeProjectId) {
    return scopeProjectId;
  }
  if (metadataProjectId) {
    return metadataProjectId;
  }
  return resolveDefaultProjectId();
}

async function ensureChatSchema(): Promise<void> {
  if (runtimeState.schemaReady) {
    return;
  }

  await dbExec(
    `
CREATE TABLE IF NOT EXISTS chat_conversations (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,
  title VARCHAR,
  status VARCHAR NOT NULL DEFAULT 'active',
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL,
  last_message_preview VARCHAR,
  run_id VARCHAR,
  metadata_json VARCHAR
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR PRIMARY KEY,
  conversation_id VARCHAR NOT NULL,
  role VARCHAR NOT NULL,
  content_json VARCHAR NOT NULL,
  created_at VARCHAR NOT NULL,
  seq INTEGER NOT NULL,
  run_id VARCHAR,
  display_order INTEGER
);

CREATE TABLE IF NOT EXISTS chat_events (
  id VARCHAR PRIMARY KEY,
  conversation_id VARCHAR NOT NULL,
  type VARCHAR NOT NULL,
  subtype VARCHAR,
  content_json VARCHAR,
  metadata_json VARCHAR,
  timestamp VARCHAR NOT NULL,
  display_order INTEGER,
  sequence INTEGER,
  run_id VARCHAR,
  tool_call_id VARCHAR,
  parent_event_id VARCHAR,
  phase VARCHAR
);

CREATE TABLE IF NOT EXISTS chat_approvals (
  id VARCHAR PRIMARY KEY,
  conversation_id VARCHAR NOT NULL,
  run_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  tool_name VARCHAR,
  tool_call_id VARCHAR,
  request_preview_json VARCHAR,
  decision VARCHAR,
  edited_args_json VARCHAR,
  created_at VARCHAR NOT NULL,
  decided_at VARCHAR
);
`
  );

  runtimeState.schemaReady = true;
}

interface ConversationRow {
  id: string;
  project_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_preview: string | null;
  run_id: string | null;
  metadata_json: string | null;
}

interface MessageRow {
  id: string;
  role: string;
  content_json: string;
  created_at: string;
  seq: number;
  run_id: string | null;
  display_order: number | null;
}

interface EventRow {
  id: string;
  type: string;
  subtype: string | null;
  content_json: string | null;
  metadata_json: string | null;
  timestamp: string;
  display_order: number | null;
  sequence: number | null;
  run_id: string | null;
  tool_call_id: string | null;
  parent_event_id: string | null;
  phase: string | null;
}

interface ApprovalRow {
  id: string;
  conversation_id: string;
  run_id: string;
  status: string;
  tool_name: string | null;
  tool_call_id: string | null;
  request_preview_json: string | null;
  decision: string | null;
  edited_args_json: string | null;
  created_at: string;
  decided_at: string | null;
}

function toConversationSummary(row: ConversationRow): ChatConversationSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_message_preview: row.last_message_preview,
    run_id: row.run_id,
    project_id: row.project_id,
    events_url: row.run_id ? `/api/v1/agent/${row.run_id}/events` : undefined,
  };
}

function toMessageRecord(row: MessageRow): ChatMessageRecord {
  const content = parseJsonValue<unknown>(row.content_json, {});
  const extractedDisplayOrder =
    typeof (content as { display_order?: unknown })?.display_order === 'number'
      ? toInteger((content as { display_order?: number }).display_order, row.seq)
      : row.display_order ?? row.seq;
  return {
    id: row.id,
    role: row.role,
    content,
    created_at: row.created_at,
    seq: toInteger(row.seq, 1),
    run_id: row.run_id,
    display_order: extractedDisplayOrder,
  };
}

function eventMetadataFromRow(row: EventRow): JsonMap {
  const metadata = parseJsonMap(row.metadata_json);
  metadata.event_id = row.id;
  metadata.sequence = row.sequence ?? 0;
  metadata.display_order = row.display_order ?? row.sequence ?? 0;
  metadata.run_id = row.run_id;
  if (row.tool_call_id) {
    metadata.tool_call_id = row.tool_call_id;
  }
  if (row.parent_event_id) {
    metadata.parent_event_id = row.parent_event_id;
  }
  if (row.phase) {
    metadata.phase = row.phase;
  }
  return metadata;
}

function toEventRecord(row: EventRow): ChatEventRecord {
  const content = parseJsonValue<unknown>(row.content_json, null);
  const metadata = eventMetadataFromRow(row);

  return {
    event_id: row.id,
    sequence: row.sequence ?? 0,
    display_order: row.display_order ?? row.sequence ?? 0,
    run_id: row.run_id,
    tool_call_id: row.tool_call_id,
    parent_event_id: row.parent_event_id,
    phase: row.phase,
    type: row.type,
    subtype: row.subtype ?? undefined,
    content,
    metadata,
    timestamp: row.timestamp,
  };
}

function toApprovalRecord(row: ApprovalRow): ChatApprovalRecord {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    run_id: row.run_id,
    status: row.status,
    tool_name: row.tool_name,
    tool_call_id: row.tool_call_id,
    request_preview: parseJsonValue<unknown>(row.request_preview_json, null),
    decision: row.decision,
    edited_args: parseJsonValue<unknown>(row.edited_args_json, null),
    created_at: row.created_at,
    decided_at: row.decided_at,
  };
}

async function loadConversationRow(conversationId: string): Promise<ConversationRow> {
  const rows = await dbQuery<ConversationRow>(
    `
SELECT
  id,
  project_id,
  title,
  status,
  created_at,
  updated_at,
  last_message_preview,
  run_id,
  metadata_json
FROM chat_conversations
WHERE id = ${sqlString(conversationId)}
LIMIT 1;
`
  );
  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, 'Conversation not found');
  }
  return row;
}

function assertConversationScope(row: ConversationRow, scopeProjectId: string | null): void {
  if (scopeProjectId && row.project_id !== scopeProjectId) {
    throw new StoreHttpError(404, 'Conversation not found');
  }
}

async function nextMessageSeq(conversationId: string): Promise<number> {
  const rows = await dbQuery<{ next_seq: number }>(
    `
SELECT COALESCE(MAX(seq), 0)::INTEGER + 1 AS next_seq
FROM chat_messages
WHERE conversation_id = ${sqlString(conversationId)};
`
  );
  return rows[0]?.next_seq ?? 1;
}

async function nextEventSequence(conversationId: string): Promise<number> {
  const rows = await dbQuery<{ next_sequence: number }>(
    `
SELECT COALESCE(MAX(sequence), 0)::INTEGER + 1 AS next_sequence
FROM chat_events
WHERE conversation_id = ${sqlString(conversationId)};
`
  );
  return rows[0]?.next_sequence ?? 1;
}

export async function getNextDisplayOrder(conversationId: string): Promise<number> {
  const rows = await dbQuery<{ next_display_order: number }>(
    `
SELECT
  GREATEST(
    COALESCE((SELECT MAX(display_order) FROM chat_events WHERE conversation_id = ${sqlString(conversationId)}), 0),
    COALESCE((SELECT MAX(display_order) FROM chat_messages WHERE conversation_id = ${sqlString(conversationId)}), 0),
    COALESCE((SELECT MAX(seq) FROM chat_messages WHERE conversation_id = ${sqlString(conversationId)}), 0),
    COALESCE((SELECT MAX(sequence) FROM chat_events WHERE conversation_id = ${sqlString(conversationId)}), 0)
  )::INTEGER + 1 AS next_display_order;
`
  );
  return rows[0]?.next_display_order ?? 1;
}

async function touchConversation(
  conversationId: string,
  patch?: {
    status?: string;
    run_id?: string | null;
    last_message_preview?: string | null;
  }
): Promise<void> {
  const updates: string[] = [`updated_at = ${sqlString(nowIso())}`];
  if (patch?.status !== undefined) {
    updates.push(`status = ${sqlString(patch.status)}`);
  }
  if (patch?.run_id !== undefined) {
    updates.push(`run_id = ${sqlString(patch.run_id)}`);
  }
  if (patch?.last_message_preview !== undefined) {
    updates.push(`last_message_preview = ${sqlString(patch.last_message_preview)}`);
  }
  await dbExec(
    `
UPDATE chat_conversations
SET ${updates.join(', ')}
WHERE id = ${sqlString(conversationId)};
`
  );
}

export interface ChatConversationSummary {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_preview: string | null;
  run_id: string | null;
  events_url?: string;
  project_id: string;
}

export interface ChatMessageRecord {
  id: string;
  role: string;
  content: unknown;
  created_at: string;
  seq: number;
  display_order: number;
  run_id: string | null;
}

export interface ChatEventRecord {
  event_id: string;
  sequence: number;
  display_order: number;
  run_id: string | null;
  tool_call_id: string | null;
  parent_event_id: string | null;
  phase: string | null;
  type: string;
  subtype?: string;
  content: unknown;
  metadata: JsonMap;
  timestamp: string;
}

export interface ChatConversationDetail {
  id: string;
  status: string;
  messages: ChatMessageRecord[];
  events?: ChatEventRecord[];
  run_id: string | null;
  events_url?: string;
}

export interface ChatApprovalRecord {
  id: string;
  conversation_id: string;
  run_id: string;
  status: string;
  tool_name: string | null;
  tool_call_id: string | null;
  request_preview: unknown;
  decision: string | null;
  edited_args: unknown;
  created_at: string;
  decided_at: string | null;
}

export async function listConversations(scopeProjectId: string | null): Promise<ChatConversationSummary[]> {
  return withChatLock(async () => {
    await ensureChatSchema();
    if (scopeProjectId) {
      await assertProjectExists(scopeProjectId);
    }

    const rows = await dbQuery<ConversationRow>(
      `
SELECT
  id,
  project_id,
  title,
  status,
  created_at,
  updated_at,
  last_message_preview,
  run_id,
  metadata_json
FROM chat_conversations
${scopeProjectId ? `WHERE project_id = ${sqlString(scopeProjectId)}` : ''}
ORDER BY updated_at DESC, created_at DESC, id DESC
LIMIT 200;
`
    );
    return rows.map(toConversationSummary);
  });
}

export async function createConversation(params: {
  question?: string | null;
  metadata?: JsonMap | null;
  conversation_id?: string | null;
  model?: string | null;
  scope_project_id?: string | null;
}): Promise<{
  id: string;
  project_id: string;
  created: boolean;
}> {
  return withChatLock(async () => {
    await ensureChatSchema();
    if (params.metadata !== undefined) {
      assertJsonObject(params.metadata, 'metadata', { optional: true, nullable: true });
    }

    const metadata = params.metadata ? { ...params.metadata } : {};
    if (params.model && !metadata.model) {
      metadata.model = params.model;
    }

    const metadataProjectId =
      typeof metadata.project_id === 'string' && metadata.project_id.trim().length > 0
        ? metadata.project_id.trim()
        : null;
    const projectId = await resolveConversationProjectId(
      params.scope_project_id ?? null,
      metadataProjectId
    );
    metadata.project_id = projectId;

    const requestedConversationId = params.conversation_id?.trim() || null;
    const conversationId = requestedConversationId ?? randomUUID();
    const now = nowIso();

    const existingRows = await dbQuery<{ id: string }>(
      `SELECT id FROM chat_conversations WHERE id = ${sqlString(conversationId)} LIMIT 1;`
    );
    if (existingRows[0]) {
      const existing = await loadConversationRow(conversationId);
      assertConversationScope(existing, params.scope_project_id ?? null);
      return {
        id: conversationId,
        project_id: existing.project_id,
        created: false,
      };
    }

    await dbExec(
      `
INSERT INTO chat_conversations (
  id,
  project_id,
  title,
  status,
  created_at,
  updated_at,
  last_message_preview,
  run_id,
  metadata_json
) VALUES (
  ${sqlString(conversationId)},
  ${sqlString(projectId)},
  ${sqlString(toConversationTitle(params.question?.trim() || null))},
  'active',
  ${sqlString(now)},
  ${sqlString(now)},
  ${sqlString(toPreview(params.question?.trim() || null))},
  NULL,
  ${sqlString(JSON.stringify(metadata))}
);
`
    );

    return {
      id: conversationId,
      project_id: projectId,
      created: true,
    };
  });
}

async function listConversationEventsUnlocked(conversationId: string): Promise<ChatEventRecord[]> {
  const rows = await dbQuery<EventRow>(
    `
SELECT
  id,
  type,
  subtype,
  content_json,
  metadata_json,
  timestamp,
  display_order,
  sequence,
  run_id,
  tool_call_id,
  parent_event_id,
  phase
FROM chat_events
WHERE conversation_id = ${sqlString(conversationId)}
ORDER BY
  COALESCE(display_order, sequence, 0) ASC,
  timestamp ASC,
  id ASC
LIMIT 500;
`
  );

  return rows.map(toEventRecord);
}

export async function getConversationDetail(
  conversationIdInput: string,
  scopeProjectId: string | null,
  includeEvents: boolean
): Promise<ChatConversationDetail> {
  return withChatLock(async () => {
    await ensureChatSchema();
    const conversationId = normalizeId(conversationIdInput, 'Conversation id');
    const conversation = await loadConversationRow(conversationId);
    assertConversationScope(conversation, scopeProjectId);

    const messageRows = await dbQuery<MessageRow>(
      `
SELECT
  id,
  role,
  content_json,
  created_at,
  seq,
  run_id,
  display_order
FROM chat_messages
WHERE conversation_id = ${sqlString(conversationId)}
ORDER BY seq ASC, id ASC;
`
    );

    const detail: ChatConversationDetail = {
      id: conversation.id,
      status: conversation.status,
      messages: messageRows.map(toMessageRecord),
      run_id: conversation.run_id,
      events_url: conversation.run_id ? `/api/v1/agent/${conversation.run_id}/events` : undefined,
    };

    if (includeEvents) {
      detail.events = await listConversationEventsUnlocked(conversationId);
    }

    return detail;
  });
}

export async function appendConversationMessage(params: {
  conversation_id: string;
  role: string;
  content: unknown;
  run_id?: string | null;
}): Promise<ChatMessageRecord> {
  return withChatLock(async () => {
    await ensureChatSchema();

    const conversationId = normalizeId(params.conversation_id, 'Conversation id');
    await loadConversationRow(conversationId);

    const role = params.role.trim().toLowerCase();
    if (role.length === 0) {
      throw new StoreHttpError(400, 'role is required');
    }

    const seq = await nextMessageSeq(conversationId);
    const displayOrder = await getNextDisplayOrder(conversationId);
    const createdAt = nowIso();
    const messageId = randomUUID();
    const content =
      typeof params.content === 'object' && params.content !== null
        ? ({ ...(params.content as JsonMap), display_order: displayOrder } as JsonMap)
        : { text: String(params.content ?? ''), display_order: displayOrder };

    await dbExec(
      `
INSERT INTO chat_messages (
  id,
  conversation_id,
  role,
  content_json,
  created_at,
  seq,
  run_id,
  display_order
) VALUES (
  ${sqlString(messageId)},
  ${sqlString(conversationId)},
  ${sqlString(role)},
  ${sqlString(JSON.stringify(content))},
  ${sqlString(createdAt)},
  ${seq},
  ${sqlString(params.run_id ?? null)},
  ${displayOrder}
);
`
    );

    await touchConversation(conversationId, {
      status: 'active',
      last_message_preview: extractTextFromContent(content),
    });

    return {
      id: messageId,
      role,
      content,
      created_at: createdAt,
      seq,
      display_order: displayOrder,
      run_id: params.run_id ?? null,
    };
  });
}

export async function markConversationRunStarted(
  conversationIdInput: string,
  runId: string,
  preview: string | null
): Promise<void> {
  return withChatLock(async () => {
    await ensureChatSchema();
    const conversationId = normalizeId(conversationIdInput, 'Conversation id');
    await loadConversationRow(conversationId);

    await touchConversation(conversationId, {
      status: 'active',
      run_id: runId,
      last_message_preview: toPreview(preview),
    });
  });
}

export async function markConversationRunCompleted(
  conversationIdInput: string,
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out',
  finalPreview: string | null
): Promise<void> {
  return withChatLock(async () => {
    await ensureChatSchema();
    const conversationId = normalizeId(conversationIdInput, 'Conversation id');
    await loadConversationRow(conversationId);
    await touchConversation(conversationId, {
      status,
      last_message_preview: toPreview(finalPreview),
    });
  });
}

export async function deleteConversation(
  conversationIdInput: string,
  scopeProjectId: string | null
): Promise<void> {
  return withChatLock(async () => {
    await ensureChatSchema();
    const conversationId = normalizeId(conversationIdInput, 'Conversation id');
    const conversation = await loadConversationRow(conversationId);
    assertConversationScope(conversation, scopeProjectId);

    await dbExec(
      `
DELETE FROM chat_approvals WHERE conversation_id = ${sqlString(conversationId)};
DELETE FROM chat_events WHERE conversation_id = ${sqlString(conversationId)};
DELETE FROM chat_messages WHERE conversation_id = ${sqlString(conversationId)};
DELETE FROM chat_conversations WHERE id = ${sqlString(conversationId)};
`
    );
  });
}

export async function insertConversationEvent(event: {
  event_id?: string;
  conversation_id: string;
  type: string;
  subtype?: string;
  content?: unknown;
  metadata?: JsonMap;
  timestamp?: string;
  run_id?: string | null;
  sequence?: number;
  display_order?: number;
  tool_call_id?: string | null;
  parent_event_id?: string | null;
  phase?: string | null;
}): Promise<ChatEventRecord> {
  return withChatLock(async () => {
    await ensureChatSchema();

    const conversationId = normalizeId(event.conversation_id, 'Conversation id');
    const conversation = await loadConversationRow(conversationId);

    const eventId = event.event_id?.trim() || randomUUID();
    const sequence = event.sequence ?? (await nextEventSequence(conversationId));
    const displayOrder = event.display_order ?? (await getNextDisplayOrder(conversationId));
    const runId = event.run_id ?? conversation.run_id;
    const timestamp = event.timestamp ?? nowIso();
    const metadata = { ...(event.metadata ?? {}) };
    metadata.event_id = eventId;
    metadata.sequence = sequence;
    metadata.display_order = displayOrder;
    metadata.run_id = runId;
    if (event.tool_call_id) {
      metadata.tool_call_id = event.tool_call_id;
    }
    if (event.parent_event_id) {
      metadata.parent_event_id = event.parent_event_id;
    }
    if (event.phase) {
      metadata.phase = event.phase;
    }

    await dbExec(
      `
INSERT INTO chat_events (
  id,
  conversation_id,
  type,
  subtype,
  content_json,
  metadata_json,
  timestamp,
  display_order,
  sequence,
  run_id,
  tool_call_id,
  parent_event_id,
  phase
) VALUES (
  ${sqlString(eventId)},
  ${sqlString(conversationId)},
  ${sqlString(event.type)},
  ${sqlString(event.subtype ?? null)},
  ${sqlString(event.content !== undefined ? JSON.stringify(event.content) : null)},
  ${sqlString(JSON.stringify(metadata))},
  ${sqlString(timestamp)},
  ${displayOrder},
  ${sequence},
  ${sqlString(runId ?? null)},
  ${sqlString(event.tool_call_id ?? null)},
  ${sqlString(event.parent_event_id ?? null)},
  ${sqlString(event.phase ?? null)}
);
`
    );

    await touchConversation(conversationId);

    return {
      event_id: eventId,
      sequence,
      display_order: displayOrder,
      run_id: runId ?? null,
      tool_call_id: event.tool_call_id ?? null,
      parent_event_id: event.parent_event_id ?? null,
      phase: event.phase ?? null,
      type: event.type,
      subtype: event.subtype,
      content: event.content ?? null,
      metadata,
      timestamp,
    };
  });
}

export async function listConversationEvents(conversationIdInput: string): Promise<ChatEventRecord[]> {
  return withChatLock(async () => {
    await ensureChatSchema();
    const conversationId = normalizeId(conversationIdInput, 'Conversation id');
    await loadConversationRow(conversationId);
    return listConversationEventsUnlocked(conversationId);
  });
}

export async function createApproval(params: {
  approval_id: string;
  conversation_id: string;
  run_id: string;
  tool_name?: string | null;
  tool_call_id?: string | null;
  request_preview?: unknown;
}): Promise<void> {
  return withChatLock(async () => {
    await ensureChatSchema();
    const conversationId = normalizeId(params.conversation_id, 'Conversation id');
    await loadConversationRow(conversationId);

    const existing = await dbQuery<{ id: string }>(
      `SELECT id FROM chat_approvals WHERE id = ${sqlString(params.approval_id)} LIMIT 1;`
    );
    if (existing[0]) {
      return;
    }

    await dbExec(
      `
INSERT INTO chat_approvals (
  id,
  conversation_id,
  run_id,
  status,
  tool_name,
  tool_call_id,
  request_preview_json,
  decision,
  edited_args_json,
  created_at,
  decided_at
) VALUES (
  ${sqlString(params.approval_id)},
  ${sqlString(conversationId)},
  ${sqlString(params.run_id)},
  'pending',
  ${sqlString(params.tool_name ?? null)},
  ${sqlString(params.tool_call_id ?? null)},
  ${sqlString(params.request_preview !== undefined ? JSON.stringify(params.request_preview) : null)},
  NULL,
  NULL,
  ${sqlString(nowIso())},
  NULL
);
`
    );
  });
}

export async function listApprovals(runIdInput: string): Promise<ChatApprovalRecord[]> {
  return withChatLock(async () => {
    await ensureChatSchema();
    const runId = normalizeId(runIdInput, 'Run id');
    const rows = await dbQuery<ApprovalRow>(
      `
SELECT
  id,
  conversation_id,
  run_id,
  status,
  tool_name,
  tool_call_id,
  request_preview_json,
  decision,
  edited_args_json,
  created_at,
  decided_at
FROM chat_approvals
WHERE run_id = ${sqlString(runId)}
ORDER BY created_at DESC, id DESC
LIMIT 100;
`
    );
    return rows.map(toApprovalRecord);
  });
}

export async function getApproval(
  runIdInput: string,
  approvalIdInput: string
): Promise<ChatApprovalRecord | null> {
  return withChatLock(async () => {
    await ensureChatSchema();
    const runId = normalizeId(runIdInput, 'Run id');
    const approvalId = normalizeId(approvalIdInput, 'Approval id');
    const rows = await dbQuery<ApprovalRow>(
      `
SELECT
  id,
  conversation_id,
  run_id,
  status,
  tool_name,
  tool_call_id,
  request_preview_json,
  decision,
  edited_args_json,
  created_at,
  decided_at
FROM chat_approvals
WHERE id = ${sqlString(approvalId)}
  AND run_id = ${sqlString(runId)}
LIMIT 1;
`
    );
    const row = rows[0];
    return row ? toApprovalRecord(row) : null;
  });
}

export async function decideApproval(params: {
  run_id: string;
  approval_id: string;
  decision: 'approve' | 'reject' | 'edit';
  edited_args?: JsonMap | null;
}): Promise<void> {
  return withChatLock(async () => {
    await ensureChatSchema();
    const runId = normalizeId(params.run_id, 'Run id');
    const approvalId = normalizeId(params.approval_id, 'Approval id');
    if (params.edited_args !== undefined) {
      assertJsonObject(params.edited_args, 'edited_args', { optional: true, nullable: true });
    }

    const statusMap: Record<'approve' | 'reject' | 'edit', string> = {
      approve: 'approved',
      reject: 'rejected',
      edit: 'edited',
    };

    const existing = await dbQuery<{ id: string }>(
      `
SELECT id
FROM chat_approvals
WHERE id = ${sqlString(approvalId)}
  AND run_id = ${sqlString(runId)}
LIMIT 1;
`
    );
    if (!existing[0]) {
      return;
    }

    await dbExec(
      `
UPDATE chat_approvals
SET
  status = ${sqlString(statusMap[params.decision])},
  decision = ${sqlString(params.decision)},
  edited_args_json = ${sqlString(params.edited_args ? JSON.stringify(params.edited_args) : null)},
  decided_at = ${sqlString(nowIso())}
WHERE id = ${sqlString(approvalId)}
  AND run_id = ${sqlString(runId)};
`
    );
  });
}

export async function getConversationSummary(
  conversationIdInput: string
): Promise<ChatConversationSummary | null> {
  return withChatLock(async () => {
    await ensureChatSchema();
    const conversationId = normalizeId(conversationIdInput, 'Conversation id');
    const rows = await dbQuery<ConversationRow>(
      `
SELECT
  id,
  project_id,
  title,
  status,
  created_at,
  updated_at,
  last_message_preview,
  run_id,
  metadata_json
FROM chat_conversations
WHERE id = ${sqlString(conversationId)}
LIMIT 1;
`
    );
    const row = rows[0];
    return row ? toConversationSummary(row) : null;
  });
}

export async function getChatSettings(): Promise<{
  data_sources: unknown;
  dbt_project: unknown;
  ui_preferences: unknown;
  llm_provider: string;
}> {
  return withChatLock(async () => {
    await ensureChatSchema();
    const rows = await dbQuery<{
      data_sources_json: string | null;
      dbt_project_json: string | null;
      ui_preferences_json: string | null;
      llm_provider: string | null;
    }>(
      `
SELECT
  data_sources_json,
  dbt_project_json,
  ui_preferences_json,
  llm_provider
FROM settings
WHERE id = 1
LIMIT 1;
`
    );
    const row = rows[0];
    if (!row) {
      throw new StoreHttpError(500, 'Settings row not initialized');
    }
    return {
      data_sources: parseJsonValue<unknown>(row.data_sources_json, null),
      dbt_project: parseJsonValue<unknown>(row.dbt_project_json, null),
      ui_preferences: parseJsonValue<unknown>(row.ui_preferences_json, { theme: 'dark' }),
      llm_provider: row.llm_provider ?? 'openai',
    };
  });
}

export async function updateChatSettings(payload: {
  data_sources?: unknown;
  dbt_project?: unknown;
  ui_preferences?: unknown;
  llm_provider?: string;
}): Promise<{
  data_sources: unknown;
  dbt_project: unknown;
  ui_preferences: unknown;
  llm_provider: string;
}> {
  return withChatLock(async () => {
    await ensureChatSchema();

    if (payload.data_sources !== undefined) {
      assertJsonObject(payload.data_sources, 'data_sources', { optional: true, nullable: true });
    }
    if (payload.dbt_project !== undefined) {
      assertJsonObject(payload.dbt_project, 'dbt_project', { optional: true, nullable: true });
    }
    if (payload.ui_preferences !== undefined) {
      assertJsonObject(payload.ui_preferences, 'ui_preferences', { optional: true, nullable: true });
    }
    if (payload.llm_provider !== undefined && payload.llm_provider !== 'openai') {
      throw new StoreHttpError(400, "Currently only 'openai' provider is supported");
    }

    const existing = await dbQuery<{
      data_sources_json: string | null;
      dbt_project_json: string | null;
      ui_preferences_json: string | null;
      llm_provider: string | null;
    }>(
      `
SELECT
  data_sources_json,
  dbt_project_json,
  ui_preferences_json,
  llm_provider
FROM settings
WHERE id = 1
LIMIT 1;
`
    );
    const current = existing[0];
    if (!current) {
      throw new StoreHttpError(500, 'Settings row not initialized');
    }

    const dataSources =
      payload.data_sources !== undefined
        ? payload.data_sources
        : parseJsonValue<unknown>(current.data_sources_json, null);
    const dbtProject =
      payload.dbt_project !== undefined
        ? payload.dbt_project
        : parseJsonValue<unknown>(current.dbt_project_json, null);
    const uiPreferences =
      payload.ui_preferences !== undefined
        ? payload.ui_preferences
        : parseJsonValue<unknown>(current.ui_preferences_json, { theme: 'dark' });
    const llmProvider = payload.llm_provider ?? current.llm_provider ?? 'openai';

    await dbExec(
      `
UPDATE settings
SET
  data_sources_json = ${sqlString(dataSources ? JSON.stringify(dataSources) : null)},
  dbt_project_json = ${sqlString(dbtProject ? JSON.stringify(dbtProject) : null)},
  ui_preferences_json = ${sqlString(uiPreferences ? JSON.stringify(uiPreferences) : '{"theme":"dark"}')},
  llm_provider = ${sqlString(llmProvider)},
  updated_at = ${sqlString(nowIso())}
WHERE id = 1;
`
    );

    return {
      data_sources: dataSources,
      dbt_project: dbtProject,
      ui_preferences: uiPreferences,
      llm_provider: llmProvider,
    };
  });
}

export function resetChatSchemaForTests(): void {
  runtimeState.schemaReady = false;
}
