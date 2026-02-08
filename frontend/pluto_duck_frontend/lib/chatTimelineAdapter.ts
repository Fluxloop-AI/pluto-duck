import type { AgentEventAny } from '../types/agent';
import type {
  ApprovalTimelineItem,
  AssistantMessageTimelineItem,
  ReasoningTimelineItem,
  TimelineItem,
  TimelineItemStatus,
  ToolTimelineItem,
  UserMessageTimelineItem,
} from '../types/chatTimelineItem';

type AgentEventType = AgentEventAny['type'];
type AgentEventSubtype = AgentEventAny['subtype'];

export interface TimelineEventEnvelope {
  type: AgentEventType | string;
  subtype?: AgentEventSubtype | string;
  content: unknown;
  metadata?: Record<string, unknown> | null;
  timestamp?: string;
  event_id?: string;
  sequence?: number;
  run_id?: string | null;
  tool_call_id?: string | null;
  parent_event_id?: string | null;
  phase?: string;
}

export interface TimelineMessageEnvelope {
  id: string;
  role: string;
  content: unknown;
  created_at: string;
  seq?: number;
  run_id?: string | null;
}

export interface TimelineOrderingRule {
  primary: 'sequence';
  secondary: 'timestamp';
}

export interface TimelineCorrelationRule {
  toolCallIdField: 'tool_call_id';
  sequenceField: 'sequence';
}

export interface TimelinePresentationHints {
  includeRunLifecycle: boolean;
  emitPartialAssistantChunks: boolean;
}

export interface BuildTimelineItemsFromEventsParams {
  events: TimelineEventEnvelope[];
  messages?: TimelineMessageEnvelope[];
  activeRunId?: string | null;
  streamingChunkText?: string | null;
  streamingChunkIsFinal?: boolean;
  ordering?: TimelineOrderingRule;
  correlation?: TimelineCorrelationRule;
  presentationHints?: Partial<TimelinePresentationHints>;
  now?: () => string;
}

interface CanonicalEventMeta {
  eventId?: string;
  sequence?: number;
  runId?: string | null;
  toolCallId?: string | null;
  parentEventId?: string | null;
  phase?: string;
}

interface NormalizedEvent {
  event: TimelineEventEnvelope;
  meta: CanonicalEventMeta;
  index: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function toCanonicalMeta(event: TimelineEventEnvelope): CanonicalEventMeta {
  const metadata = event.metadata;
  const topLevel = {
    eventId: toOptionalString(event.event_id),
    sequence: toOptionalNumber(event.sequence),
    runId: toOptionalString(event.run_id) ?? null,
    toolCallId: toOptionalString(event.tool_call_id) ?? null,
    parentEventId: toOptionalString(event.parent_event_id) ?? null,
    phase: toOptionalString(event.phase),
  };
  if (!metadata) return topLevel;
  return {
    eventId: topLevel.eventId ?? toOptionalString(metadata.event_id),
    sequence: topLevel.sequence ?? toOptionalNumber(metadata.sequence),
    runId: topLevel.runId ?? toOptionalString(metadata.run_id) ?? null,
    toolCallId: topLevel.toolCallId ?? toOptionalString(metadata.tool_call_id) ?? null,
    parentEventId: topLevel.parentEventId ?? toOptionalString(metadata.parent_event_id) ?? null,
    phase: topLevel.phase ?? toOptionalString(metadata.phase),
  };
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.reason === 'string') return value.reason;
    if (value.content !== undefined) return extractText(value.content);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function extractReasoningText(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractReasoningText(item);
      if (text) return text;
    }
    return '';
  }
  if (isRecord(value)) {
    if (typeof value.reason === 'string') {
      const trimmed = value.reason.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value.text === 'string') {
      const trimmed = value.text.trim();
      if (trimmed) return trimmed;
    }
    if (value.content !== undefined) {
      return extractReasoningText(value.content);
    }
    return '';
  }
  return '';
}

function extractMentions(text: string): string[] {
  const mentionRegex = /@([\w-]+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

function resolveStatus(subtype?: string): TimelineItemStatus {
  if (subtype === 'error') return 'error';
  if (subtype === 'chunk' || subtype === 'start') return 'streaming';
  if (subtype === 'end' || subtype === 'final') return 'complete';
  return 'pending';
}

function compareTimelineItems(a: TimelineItem, b: TimelineItem): number {
  const sequenceA = a.sequence ?? Number.MAX_SAFE_INTEGER;
  const sequenceB = b.sequence ?? Number.MAX_SAFE_INTEGER;
  if (sequenceA !== sequenceB) return sequenceA - sequenceB;

  const tsA = Date.parse(a.timestamp);
  const tsB = Date.parse(b.timestamp);
  if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsA !== tsB) {
    return tsA - tsB;
  }

  return a.id.localeCompare(b.id);
}

function compareNormalizedEvents(a: NormalizedEvent, b: NormalizedEvent): number {
  const sequenceA = a.meta.sequence ?? Number.MAX_SAFE_INTEGER;
  const sequenceB = b.meta.sequence ?? Number.MAX_SAFE_INTEGER;
  if (sequenceA !== sequenceB) return sequenceA - sequenceB;

  const tsA = Date.parse(a.event.timestamp ?? '');
  const tsB = Date.parse(b.event.timestamp ?? '');
  if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsA !== tsB) {
    return tsA - tsB;
  }
  return a.index - b.index;
}

function normalizeEvents(events: TimelineEventEnvelope[]): NormalizedEvent[] {
  return events
    .map((event, index) => ({
      event,
      meta: toCanonicalMeta(event),
      index,
    }))
    .sort(compareNormalizedEvents);
}

function buildAssistantSequenceHintsByRun(normalizedEvents: NormalizedEvent[]): Map<string, number> {
  const hintsByRun = new Map<string, number>();
  const maxSequenceByRun = new Map<string, number>();

  for (const normalizedEvent of normalizedEvents) {
    const runId = normalizedEvent.meta.runId ?? null;
    const sequence = normalizedEvent.meta.sequence;
    if (!runId || typeof sequence !== 'number') continue;

    const prevMax = maxSequenceByRun.get(runId) ?? Number.MIN_SAFE_INTEGER;
    if (sequence > prevMax) {
      maxSequenceByRun.set(runId, sequence);
    }

    if (normalizedEvent.event.type !== 'message') continue;
    if (normalizedEvent.event.subtype !== 'final' && normalizedEvent.event.subtype !== 'end') continue;
    const prevHint = hintsByRun.get(runId) ?? Number.MIN_SAFE_INTEGER;
    if (sequence > prevHint) {
      hintsByRun.set(runId, sequence);
    }
  }

  for (const [runId, maxSequence] of maxSequenceByRun) {
    if (!hintsByRun.has(runId)) {
      hintsByRun.set(runId, maxSequence);
    }
  }

  return hintsByRun;
}

function buildMessageItems(
  params: BuildTimelineItemsFromEventsParams,
  now: () => string,
  assistantSequenceHintsByRun: Map<string, number>,
): TimelineItem[] {
  const messages = params.messages ?? [];
  const items: TimelineItem[] = [];
  for (const message of messages) {
    const runId = message.run_id ?? params.activeRunId ?? null;
    if (message.role === 'user') {
      const sequence = typeof message.seq === 'number' ? message.seq : null;
      const content = extractText(message.content);
      const userItem: UserMessageTimelineItem = {
        id: `timeline-user-${message.id}`,
        type: 'user-message',
        runId,
        sequence,
        timestamp: message.created_at || now(),
        status: 'complete',
        isStreaming: false,
        isPartial: false,
        content,
        mentions: extractMentions(content),
        messageId: message.id,
      };
      items.push(userItem);
      continue;
    }
    if (message.role === 'assistant') {
      const messageSequence = typeof message.seq === 'number' ? message.seq : null;
      const hintedSequence = runId ? assistantSequenceHintsByRun.get(runId) : undefined;
      const sequence =
        typeof hintedSequence === 'number'
          ? messageSequence === null
            ? hintedSequence
            : Math.max(messageSequence, hintedSequence)
          : messageSequence;
      const assistantItem: AssistantMessageTimelineItem = {
        id: `timeline-assistant-${message.id}`,
        type: 'assistant-message',
        runId,
        sequence,
        timestamp: message.created_at || now(),
        status: 'complete',
        isStreaming: false,
        isPartial: false,
        content: extractText(message.content),
        messageId: message.id,
      };
      items.push(assistantItem);
    }
  }
  return items;
}

function buildReasoningItem(
  event: TimelineEventEnvelope,
  meta: CanonicalEventMeta,
  index: number,
  now: () => string,
  activeRunId?: string | null,
): ReasoningTimelineItem | null {
  const rawStatus = resolveStatus(event.subtype);
  const runId = meta.runId ?? null;
  const isActiveRun = Boolean(activeRunId && runId && runId === activeRunId);
  const status: TimelineItemStatus = rawStatus === 'streaming' && !isActiveRun ? 'complete' : rawStatus;
  const content = extractReasoningText(event.content);
  const isStreaming = status === 'streaming';
  if (!content && !isStreaming) {
    return null;
  }
  return {
    id: meta.eventId ?? `timeline-reasoning-${index}`,
    type: 'reasoning',
    runId,
    sequence: meta.sequence ?? null,
    timestamp: event.timestamp ?? now(),
    status,
    isStreaming,
    isPartial: event.subtype === 'chunk',
    content,
    phase: meta.phase,
    eventId: meta.eventId,
    parentEventId: meta.parentEventId,
  };
}

function buildToolItem(event: TimelineEventEnvelope, meta: CanonicalEventMeta, index: number, now: () => string): ToolTimelineItem {
  const status = resolveStatus(event.subtype);
  const content = isRecord(event.content) ? event.content : {};
  const errorText = status === 'error' ? toOptionalString(content.error) ?? toOptionalString(content.message) : undefined;
  return {
    id: meta.eventId ?? `timeline-tool-${meta.runId ?? 'orphan'}-${meta.toolCallId ?? index}`,
    type: 'tool',
    runId: meta.runId ?? null,
    sequence: meta.sequence ?? null,
    timestamp: event.timestamp ?? now(),
    status,
    isStreaming: status === 'streaming',
    isPartial: event.subtype === 'chunk',
    toolName: toOptionalString(content.tool) ?? 'tool',
    toolCallId: meta.toolCallId,
    state: status === 'error' ? 'error' : status === 'complete' ? 'completed' : 'pending',
    input: content.input,
    output: content.output,
    error: errorText,
    eventId: meta.eventId,
    parentEventId: meta.parentEventId,
  };
}

function buildToolCorrelationKey(event: TimelineEventEnvelope, meta: CanonicalEventMeta): string | null {
  const content = isRecord(event.content) ? event.content : {};
  const contentToolCallId = toOptionalString(content.tool_call_id);
  const toolCallId = meta.toolCallId ?? contentToolCallId;
  if (!toolCallId) return null;
  const runId = meta.runId ?? 'orphan-run';
  return `${runId}:${toolCallId}`;
}

function correlateToolEvents(events: NormalizedEvent[], now: () => string): ToolTimelineItem[] {
  const items: ToolTimelineItem[] = [];
  const pendingByKey = new Map<string, ToolTimelineItem>();

  for (const normalizedEvent of events) {
    if (normalizedEvent.event.type !== 'tool') continue;
    const { event, meta, index } = normalizedEvent;
    const key = buildToolCorrelationKey(event, meta);
    const current = buildToolItem(event, meta, index, now);

    if (!key) {
      items.push(current);
      continue;
    }

    const pending = pendingByKey.get(key);

    if (event.subtype === 'start') {
      pendingByKey.set(key, current);
      items.push(current);
      continue;
    }

    if ((event.subtype === 'end' || event.subtype === 'error') && pending) {
      pending.state = current.state;
      pending.status = current.status;
      pending.isStreaming = false;
      pending.isPartial = false;
      if (current.output !== undefined) {
        pending.output = current.output;
      }
      if (current.error !== undefined) {
        pending.error = current.error;
      }
      pendingByKey.delete(key);
      continue;
    }

    if (event.subtype === 'chunk' && pending) {
      if (current.output !== undefined) {
        pending.output = current.output;
      }
      pending.status = 'streaming';
      pending.isStreaming = true;
      pending.isPartial = true;
      continue;
    }

    pendingByKey.set(key, current);
    items.push(current);
  }

  return items;
}

function buildAssistantEventItem(
  event: TimelineEventEnvelope,
  meta: CanonicalEventMeta,
  index: number,
  now: () => string,
): AssistantMessageTimelineItem {
  const status = resolveStatus(event.subtype);
  return {
    id: meta.eventId ?? `timeline-assistant-event-${index}`,
    type: 'assistant-message',
    runId: meta.runId ?? null,
    sequence: meta.sequence ?? null,
    timestamp: event.timestamp ?? now(),
    status,
    isStreaming: status === 'streaming',
    isPartial: event.subtype === 'chunk',
    content: extractText(event.content),
    eventId: meta.eventId,
    parentEventId: meta.parentEventId,
  };
}

function buildApprovalItem(event: TimelineEventEnvelope, meta: CanonicalEventMeta, index: number, now: () => string): ApprovalTimelineItem {
  const status = resolveStatus(event.subtype);
  const content = isRecord(event.content) ? event.content : {};
  const decision = toOptionalString(content.decision) as ApprovalTimelineItem['decision'];
  return {
    id: meta.eventId ?? `timeline-approval-${index}`,
    type: 'approval',
    runId: meta.runId ?? null,
    sequence: meta.sequence ?? null,
    timestamp: event.timestamp ?? now(),
    status,
    isStreaming: status === 'streaming',
    isPartial: event.subtype === 'chunk',
    content: extractText(content),
    decision,
    eventId: meta.eventId,
    parentEventId: meta.parentEventId,
  };
}

function buildEventItems(
  params: BuildTimelineItemsFromEventsParams,
  now: () => string,
  normalizedEvents: NormalizedEvent[],
): TimelineItem[] {
  const toolItems = correlateToolEvents(normalizedEvents, now);
  const toolItemsById = new Map(toolItems.map(item => [item.id, item]));
  const runsWithPersistedAssistantMessage = new Set(
    (params.messages ?? [])
      .filter(message => message.role === 'assistant' && typeof message.run_id === 'string' && message.run_id.trim())
      .map(message => message.run_id as string),
  );
  const items: TimelineItem[] = [];
  normalizedEvents.forEach(({ event, meta, index }) => {
    if (event.type === 'reasoning') {
      const reasoningItem = buildReasoningItem(event, meta, index, now, params.activeRunId);
      if (reasoningItem) {
        items.push(reasoningItem);
      }
      return;
    }
    if (event.type === 'tool') {
      const candidateToolItem = buildToolItem(event, meta, index, now);
      const deduped = toolItemsById.get(candidateToolItem.id);
      if (deduped) {
        toolItemsById.delete(candidateToolItem.id);
        items.push(deduped);
      }
      return;
    }
    if (event.type === 'message') {
      if (meta.runId && runsWithPersistedAssistantMessage.has(meta.runId)) {
        return;
      }
      items.push(buildAssistantEventItem(event, meta, index, now));
      return;
    }
    if (event.type === 'plan') {
      items.push(buildApprovalItem(event, meta, index, now));
    }
  });
  const latestStreamingReasoningByRun = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.type !== 'reasoning' || !item.isStreaming || !item.runId) return;
    latestStreamingReasoningByRun.set(item.runId, index);
  });
  items.forEach((item, index) => {
    if (item.type !== 'reasoning' || !item.isStreaming || !item.runId) return;
    if (latestStreamingReasoningByRun.get(item.runId) === index) return;
    item.isStreaming = false;
    item.status = 'complete';
  });
  return items.filter(item => item.type !== 'reasoning' || item.isStreaming || item.content.trim().length > 0);
}

function buildStreamingItem(params: BuildTimelineItemsFromEventsParams, now: () => string): AssistantMessageTimelineItem | null {
  if (!params.streamingChunkText) return null;
  return {
    id: `timeline-streaming-${params.activeRunId ?? 'orphan'}`,
    type: 'assistant-message',
    runId: params.activeRunId ?? null,
    sequence: null,
    timestamp: now(),
    status: params.streamingChunkIsFinal ? 'complete' : 'streaming',
    isStreaming: !params.streamingChunkIsFinal,
    isPartial: !params.streamingChunkIsFinal,
    content: params.streamingChunkText,
  };
}

// Adapter skeleton for Phase 1; sequencing/correlation hooks are fixed in the contract.
export function buildTimelineItemsFromEvents(params: BuildTimelineItemsFromEventsParams): TimelineItem[] {
  const now = params.now ?? (() => new Date().toISOString());
  const normalizedEvents = normalizeEvents(params.events);
  const assistantSequenceHintsByRun = buildAssistantSequenceHintsByRun(normalizedEvents);
  const messageItems = buildMessageItems(params, now, assistantSequenceHintsByRun);
  const eventItems = buildEventItems(params, now, normalizedEvents);
  const streamingItem = buildStreamingItem(params, now);
  const items = streamingItem ? [...messageItems, ...eventItems, streamingItem] : [...messageItems, ...eventItems];
  return items.sort(compareTimelineItems);
}
