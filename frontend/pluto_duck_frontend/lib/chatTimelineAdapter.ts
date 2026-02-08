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

function toCanonicalMeta(metadata: TimelineEventEnvelope['metadata']): CanonicalEventMeta {
  if (!metadata) return {};
  return {
    eventId: toOptionalString(metadata.event_id),
    sequence: toOptionalNumber(metadata.sequence),
    runId: toOptionalString(metadata.run_id) ?? null,
    toolCallId: toOptionalString(metadata.tool_call_id) ?? null,
    parentEventId: toOptionalString(metadata.parent_event_id) ?? null,
    phase: toOptionalString(metadata.phase),
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

function buildMessageItems(params: BuildTimelineItemsFromEventsParams, now: () => string): TimelineItem[] {
  const messages = params.messages ?? [];
  const items: TimelineItem[] = [];
  for (const message of messages) {
    const sequence = typeof message.seq === 'number' ? message.seq : null;
    const runId = message.run_id ?? params.activeRunId ?? null;
    if (message.role === 'user') {
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

function buildReasoningItem(event: TimelineEventEnvelope, meta: CanonicalEventMeta, index: number, now: () => string): ReasoningTimelineItem {
  const status = resolveStatus(event.subtype);
  return {
    id: meta.eventId ?? `timeline-reasoning-${index}`,
    type: 'reasoning',
    runId: meta.runId ?? null,
    sequence: meta.sequence ?? null,
    timestamp: event.timestamp ?? now(),
    status,
    isStreaming: status === 'streaming',
    isPartial: event.subtype === 'chunk',
    content: extractText(event.content),
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
    id: meta.eventId ?? `timeline-tool-${meta.toolCallId ?? index}`,
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

function buildEventItems(params: BuildTimelineItemsFromEventsParams, now: () => string): TimelineItem[] {
  const items: TimelineItem[] = [];
  params.events.forEach((event, index) => {
    const meta = toCanonicalMeta(event.metadata);
    if (event.type === 'reasoning') {
      items.push(buildReasoningItem(event, meta, index, now));
      return;
    }
    if (event.type === 'tool') {
      items.push(buildToolItem(event, meta, index, now));
      return;
    }
    if (event.type === 'message') {
      items.push(buildAssistantEventItem(event, meta, index, now));
      return;
    }
    if (event.type === 'plan') {
      items.push(buildApprovalItem(event, meta, index, now));
    }
  });
  return items;
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
  const messageItems = buildMessageItems(params, now);
  const eventItems = buildEventItems(params, now);
  const streamingItem = buildStreamingItem(params, now);
  const items = streamingItem ? [...messageItems, ...eventItems, streamingItem] : [...messageItems, ...eventItems];
  return items.sort(compareTimelineItems);
}
