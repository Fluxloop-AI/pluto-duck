import type { AgentEventAny } from '../types/agent';
import {
  classifyTimelineEvent,
  resolveApprovalDecision,
  type TimelineEventClassification,
} from './eventIntentRegistry.ts';
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

export interface TimelineTurnEventEnvelope {
  type: AgentEventType | string;
  subtype?: AgentEventSubtype | string;
  content: unknown;
  metadata?: Record<string, unknown> | null;
  timestamp?: string;
}

export interface TimelineTurnMessageEnvelope {
  id: string;
  role: string;
  content: unknown;
  created_at: string;
  seq?: number;
  run_id?: string | null;
}

export interface TimelineTurnEnvelope {
  runId: string | null;
  userMessages: TimelineTurnMessageEnvelope[];
  assistantMessages: TimelineTurnMessageEnvelope[];
  events: TimelineTurnEventEnvelope[];
  isActive: boolean;
  streamingAssistantText?: string | null;
  streamingAssistantFinal?: boolean;
}

export interface BuildTimelineItemsFromTurnsParams {
  turns: TimelineTurnEnvelope[];
  includeMessageEvents?: boolean;
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

interface ClassifiedEvent extends NormalizedEvent {
  classification: TimelineEventClassification;
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
    if (typeof value.description === 'string') return value.description;
    if (typeof value.message === 'string') return value.message;
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

function extractApprovalDisplayContent(content: Record<string, unknown>): string {
  const direct = extractText(content).trim();
  if (direct) {
    return direct;
  }
  const tool = toOptionalString(content.tool);
  const requiresApproval = content.approval_required === true;
  if (tool && requiresApproval) {
    return `${tool} requires approval.`;
  }
  if (tool) {
    return `Approval for ${tool}.`;
  }
  return 'Approval required before continuing.';
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

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function resolveStatus(subtype?: string): TimelineItemStatus {
  if (subtype === 'error') return 'error';
  if (subtype === 'chunk' || subtype === 'start') return 'streaming';
  if (subtype === 'end' || subtype === 'final') return 'complete';
  return 'pending';
}

function isPersistedMessageTimelineItem(item: TimelineItem): boolean {
  if (item.type === 'user-message') return true;
  if (item.type !== 'assistant-message') return false;
  return typeof item.messageId === 'string' && item.messageId.trim().length > 0;
}

function getConversationMessageSequence(item: TimelineItem): number | null {
  if (!isPersistedMessageTimelineItem(item)) return null;
  if (typeof item.sequence !== 'number' || !Number.isFinite(item.sequence)) return null;
  return item.sequence;
}

function getInRunTypeRank(item: TimelineItem): number {
  if (item.type === 'user-message') return 0;
  if (item.type === 'approval') return 3;
  if (item.type === 'assistant-message') return 2;
  return 1;
}

function setMinSequence(map: Map<string, number>, key: string, value: number): void {
  const prev = map.get(key);
  if (prev === undefined || value < prev) {
    map.set(key, value);
  }
}

function buildRunOrderByRun(items: TimelineItem[]): Map<string, number> {
  const userSeqByRun = new Map<string, number>();
  const messageSeqByRun = new Map<string, number>();
  const firstAppearanceIndexByRun = new Map<string, number>();
  let maxRunlessMessageSeq = 0;

  items.forEach((item, index) => {
    const runId = item.runId;
    const sequence = item.sequence;
    if (!runId) {
      const runlessMessageSequence = getConversationMessageSequence(item);
      if (runlessMessageSequence !== null && runlessMessageSequence > maxRunlessMessageSeq) {
        maxRunlessMessageSeq = runlessMessageSequence;
      }
      return;
    }
    if (!firstAppearanceIndexByRun.has(runId)) {
      firstAppearanceIndexByRun.set(runId, index);
    }
    if (typeof sequence !== 'number' || !Number.isFinite(sequence)) return;

    if (item.type === 'user-message') {
      setMinSequence(userSeqByRun, runId, sequence);
      return;
    }
    if (item.type === 'assistant-message') {
      setMinSequence(messageSeqByRun, runId, sequence);
    }
  });

  const order = new Map<string, number>();
  userSeqByRun.forEach((seq, runId) => order.set(runId, seq));
  messageSeqByRun.forEach((seq, runId) => {
    if (!order.has(runId)) {
      order.set(runId, seq);
    }
  });

  const maxExplicitOrder = [...order.values()].reduce((max, value) => Math.max(max, value), 0);
  const maxExplicitOrRunless = Math.max(maxExplicitOrder, maxRunlessMessageSeq);
  let nextSyntheticOrder = maxExplicitOrder + 1;
  if (nextSyntheticOrder <= maxExplicitOrRunless) {
    nextSyntheticOrder = maxExplicitOrRunless + 1;
  }
  [...firstAppearanceIndexByRun.entries()]
    .sort((a, b) => a[1] - b[1])
    .forEach(([runId]) => {
      if (!order.has(runId)) {
        order.set(runId, nextSyntheticOrder++);
      }
    });

  return order;
}

function compareTimelineItems(a: TimelineItem, b: TimelineItem, runOrderByRun: Map<string, number>): number {
  const runIdA = a.runId ?? null;
  const runIdB = b.runId ?? null;
  if (runIdA && runIdB && runIdA !== runIdB) {
    const runOrderA = runOrderByRun.get(runIdA);
    const runOrderB = runOrderByRun.get(runIdB);
    if (typeof runOrderA === 'number' && typeof runOrderB === 'number' && runOrderA !== runOrderB) {
      return runOrderA - runOrderB;
    }
  }

  if (runIdA && !runIdB) {
    const runOrderA = runOrderByRun.get(runIdA);
    const messageSequenceB = getConversationMessageSequence(b);
    if (typeof runOrderA === 'number' && messageSequenceB !== null && runOrderA !== messageSequenceB) {
      return runOrderA - messageSequenceB;
    }
  }
  if (!runIdA && runIdB) {
    const messageSequenceA = getConversationMessageSequence(a);
    const runOrderB = runOrderByRun.get(runIdB);
    if (messageSequenceA !== null && typeof runOrderB === 'number' && messageSequenceA !== runOrderB) {
      return messageSequenceA - runOrderB;
    }
  }

  // Optimistic messages can be run-less before append API resolves run_id.
  // Keep conversation message order deterministic by seq in that transient window.
  if (runIdA === null || runIdB === null) {
    const conversationSeqA = getConversationMessageSequence(a);
    const conversationSeqB = getConversationMessageSequence(b);
    if (conversationSeqA !== null && conversationSeqB !== null && conversationSeqA !== conversationSeqB) {
      return conversationSeqA - conversationSeqB;
    }
  }

  const sameRun = (a.runId ?? null) === (b.runId ?? null);
  if (sameRun) {
    const sequenceA = a.sequence;
    const sequenceB = b.sequence;
    const hasComparableSequenceA = typeof sequenceA === 'number' && Number.isFinite(sequenceA);
    const hasComparableSequenceB = typeof sequenceB === 'number' && Number.isFinite(sequenceB);

    // Message seq is conversation-wide, event sequence is run-local.
    // Sequence ordering is safe only within the same domain.
    const sameDomain =
      isPersistedMessageTimelineItem(a) === isPersistedMessageTimelineItem(b);
    if (sameDomain) {
      const normalizedSequenceA = sequenceA ?? Number.MAX_SAFE_INTEGER;
      const normalizedSequenceB = sequenceB ?? Number.MAX_SAFE_INTEGER;
      if (normalizedSequenceA !== normalizedSequenceB) return normalizedSequenceA - normalizedSequenceB;
      if (a.type === 'reasoning' && b.type === 'reasoning') {
        const segmentOrderA = a.segmentOrder ?? 0;
        const segmentOrderB = b.segmentOrder ?? 0;
        if (segmentOrderA !== segmentOrderB) return segmentOrderA - segmentOrderB;
      }
    } else {
      const hasUserMessage = a.type === 'user-message' || b.type === 'user-message';
      // Cross-domain sequence compare is only safe when no user-message is involved.
      // User message sequence uses conversation-space seq and must keep rank precedence.
      if (!hasUserMessage && hasComparableSequenceA && hasComparableSequenceB && sequenceA !== sequenceB) {
        return sequenceA - sequenceB;
      }
      const rankA = getInRunTypeRank(a);
      const rankB = getInRunTypeRank(b);
      if (rankA !== rankB) return rankA - rankB;
    }
  }

  const tsA = Date.parse(a.timestamp);
  const tsB = Date.parse(b.timestamp);
  if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsA !== tsB) {
    return tsA - tsB;
  }

  if (!sameRun) {
    const sequenceA = a.sequence ?? Number.MAX_SAFE_INTEGER;
    const sequenceB = b.sequence ?? Number.MAX_SAFE_INTEGER;
    if (sequenceA !== sequenceB) return sequenceA - sequenceB;
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
  const sorted = events
    .map((event, index) => ({
      event,
      meta: toCanonicalMeta(event),
      index,
    }))
    .sort(compareNormalizedEvents);
  const seenByRunEvent = new Set<string>();
  const deduped: NormalizedEvent[] = [];
  for (const normalizedEvent of sorted) {
    const runId = normalizedEvent.meta.runId ?? null;
    const eventId = normalizedEvent.meta.eventId;
    if (runId && eventId) {
      const dedupeKey = `${runId}:${eventId}`;
      if (seenByRunEvent.has(dedupeKey)) {
        continue;
      }
      seenByRunEvent.add(dedupeKey);
    }
    deduped.push(normalizedEvent);
  }
  return deduped;
}

function classifyNormalizedEvents(normalizedEvents: NormalizedEvent[]): ClassifiedEvent[] {
  return normalizedEvents.map(normalizedEvent => ({
    ...normalizedEvent,
    classification: classifyTimelineEvent(normalizedEvent.event, normalizedEvent.meta),
  }));
}

function selectExecutionToolEvents(classifiedEvents: ClassifiedEvent[]): ClassifiedEvent[] {
  return classifiedEvents.filter(
    classifiedEvent =>
      classifiedEvent.event.type === 'tool' && classifiedEvent.classification.intent === 'execution',
  );
}

function buildAssistantSequenceHintsByRun(classifiedEvents: ClassifiedEvent[]): Map<string, number> {
  const hintsByRun = new Map<string, number>();
  const maxSequenceByRun = new Map<string, number>();

  for (const classifiedEvent of classifiedEvents) {
    const runId = classifiedEvent.meta.runId ?? null;
    const sequence = classifiedEvent.meta.sequence;
    if (!runId || typeof sequence !== 'number') continue;

    const prevMax = maxSequenceByRun.get(runId) ?? Number.MIN_SAFE_INTEGER;
    if (sequence > prevMax) {
      maxSequenceByRun.set(runId, sequence);
    }

    if (classifiedEvent.event.type !== 'message') continue;
    if (classifiedEvent.event.subtype !== 'final' && classifiedEvent.event.subtype !== 'end') continue;
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

function collectAssistantFinalTextByRun(
  params: BuildTimelineItemsFromEventsParams,
  classifiedEvents: ClassifiedEvent[],
): Map<string, string> {
  const textsByRun = new Map<string, string>();

  for (const message of params.messages ?? []) {
    if (message.role !== 'assistant') continue;
    const runId = message.run_id ?? null;
    if (!runId) continue;
    const text = normalizeComparableText(extractText(message.content));
    if (!text) continue;
    textsByRun.set(runId, text);
  }

  for (const classifiedEvent of classifiedEvents) {
    if (classifiedEvent.event.type !== 'message') continue;
    if (classifiedEvent.event.subtype !== 'final' && classifiedEvent.event.subtype !== 'end') continue;
    const runId = classifiedEvent.meta.runId ?? null;
    if (!runId) continue;
    const text = normalizeComparableText(extractText(classifiedEvent.event.content));
    if (!text) continue;
    textsByRun.set(runId, text);
  }

  return textsByRun;
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
        intent: 'message',
        lane: 'user',
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
        intent: 'message',
        lane: 'assistant',
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

type ReasoningPhase = 'llm_start' | 'llm_reasoning' | 'llm_end' | 'llm_usage' | 'unknown';
type ReasoningLifecycleState = 'opened' | 'materialized' | 'closed' | 'dropped';
interface ActiveReasoningSpan {
  runKey: string;
  runId: string | null;
  segmentOrder: number;
  segmentId: string;
  lifecycle: ReasoningLifecycleState;
  item: ReasoningTimelineItem | null;
}

function resolveReasoningPhase(event: TimelineEventEnvelope, meta: CanonicalEventMeta): ReasoningPhase {
  const content = isRecord(event.content) ? event.content : null;
  const contentPhase = content ? toOptionalString(content.phase) : undefined;
  const phase = (meta.phase ?? contentPhase ?? '').trim();
  if (phase === 'llm_start') return 'llm_start';
  if (phase === 'llm_reasoning') return 'llm_reasoning';
  if (phase === 'llm_end') return 'llm_end';
  if (phase === 'llm_usage') return 'llm_usage';
  return 'unknown';
}

function getReasoningRunKey(meta: CanonicalEventMeta, index: number): string {
  if (meta.runId) return `run:${meta.runId}`;
  if (meta.eventId) return `event:${meta.eventId}`;
  return `index:${index}`;
}

function buildReasoningSegmentId(meta: CanonicalEventMeta, runKey: string, index: number, segmentOrder: number): string {
  if (meta.eventId) return meta.eventId;
  const normalizedRunKey = runKey.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `timeline-reasoning-${normalizedRunKey}-${segmentOrder}-${index}`;
}

function mergeReasoningText(existing: string, incoming: string): string {
  const current = existing.trim();
  const next = incoming.trim();
  if (!next) return current;
  if (!current) return next;
  if (next === current) return current;
  if (next.startsWith(current)) return next;
  if (current.startsWith(next)) return current;
  if (current.includes(next)) return current;
  if (next.includes(current)) return next;
  return `${current}\n${next}`;
}

function createReasoningItem(
  event: TimelineEventEnvelope,
  meta: CanonicalEventMeta,
  segmentId: string,
  segmentOrder: number,
  now: () => string,
): ReasoningTimelineItem {
  return {
    id: segmentId,
    type: 'reasoning',
    intent: 'reasoning',
    lane: 'reasoning',
    runId: meta.runId ?? null,
    sequence: meta.sequence ?? null,
    timestamp: event.timestamp ?? now(),
    status: 'pending',
    isStreaming: false,
    isPartial: false,
    segmentId,
    segmentOrder,
    content: '',
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
    intent: 'execution',
    lane: 'tool',
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

function correlateToolEvents(events: ClassifiedEvent[], now: () => string): ToolTimelineItem[] {
  const items: ToolTimelineItem[] = [];
  const pendingByKey = new Map<string, ToolTimelineItem>();

  for (const classifiedEvent of events) {
    const { event, meta, index } = classifiedEvent;
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
    intent: 'message',
    lane: 'assistant',
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

function buildApprovalItem(
  event: TimelineEventEnvelope,
  meta: CanonicalEventMeta,
  index: number,
  now: () => string,
  classification?: TimelineEventClassification,
): ApprovalTimelineItem {
  const status = resolveStatus(event.subtype);
  const content = isRecord(event.content) ? event.content : {};
  const decision = classification?.approvalDecision ?? resolveApprovalDecision(content.decision);
  const resolvedDecision = decision ?? (content.approval_required === true ? 'pending' : undefined);
  const approvalIdFromContent = toOptionalString(content.approval_id);
  const approvalId = approvalIdFromContent ?? classification?.approvalId;
  return {
    id: approvalId ?? meta.eventId ?? `timeline-approval-${index}`,
    type: 'approval',
    intent: 'approval-control',
    lane: 'control',
    runId: meta.runId ?? null,
    sequence: meta.sequence ?? null,
    timestamp: event.timestamp ?? now(),
    status,
    isStreaming: status === 'streaming',
    isPartial: event.subtype === 'chunk',
    content: extractApprovalDisplayContent(content),
    decision: resolvedDecision,
    eventId: meta.eventId,
    parentEventId: meta.parentEventId,
  };
}

function isTerminalApprovalDecision(decision: ApprovalTimelineItem['decision']): boolean {
  return decision === 'approved' || decision === 'rejected';
}

function mergeApprovalDecision(
  existing: ApprovalTimelineItem['decision'],
  candidate: ApprovalTimelineItem['decision'],
): ApprovalTimelineItem['decision'] {
  if (!candidate) return existing;
  if (!existing) return candidate;
  if (isTerminalApprovalDecision(existing) && !isTerminalApprovalDecision(candidate)) {
    return existing;
  }
  return candidate;
}

function mergeApprovalSequence(existing: ApprovalTimelineItem, candidate: ApprovalTimelineItem): number | null {
  const candidateSequence = typeof candidate.sequence === 'number' && Number.isFinite(candidate.sequence) ? candidate.sequence : null;
  const existingSequence = typeof existing.sequence === 'number' && Number.isFinite(existing.sequence) ? existing.sequence : null;

  if (candidateSequence === null) {
    return existingSequence;
  }
  if (isTerminalApprovalDecision(candidate.decision)) {
    return candidateSequence;
  }
  if (isTerminalApprovalDecision(existing.decision)) {
    return existingSequence;
  }
  if (existingSequence === null || candidateSequence < existingSequence) {
    return candidateSequence;
  }
  return existingSequence;
}

function mergeApprovalItem(existing: ApprovalTimelineItem, candidate: ApprovalTimelineItem): void {
  existing.sequence = mergeApprovalSequence(existing, candidate);

  if (candidate.status !== existing.status) {
    existing.status = candidate.status;
  }
  existing.isStreaming = candidate.isStreaming;
  existing.isPartial = candidate.isPartial;
  existing.decision = mergeApprovalDecision(existing.decision, candidate.decision);
  if (candidate.content.trim()) {
    existing.content = candidate.content;
  }
  if (candidate.eventId) {
    existing.eventId = candidate.eventId;
  }
  if (candidate.parentEventId) {
    existing.parentEventId = candidate.parentEventId;
  }
}

function isMessageDeltaChunk(event: TimelineEventEnvelope): boolean {
  if (event.subtype === 'chunk') {
    return true;
  }
  const content = isRecord(event.content) ? event.content : null;
  return Boolean(content && typeof content.text_delta === 'string');
}

function buildEventItems(
  params: BuildTimelineItemsFromEventsParams,
  now: () => string,
  classifiedEvents: ClassifiedEvent[],
  assistantFinalTextByRun: Map<string, string>,
): TimelineItem[] {
  const persistedAssistantMessages = (params.messages ?? []).filter(message => message.role === 'assistant');
  const runlessPersistedAssistantFinalTexts = new Set(
    persistedAssistantMessages
      .filter(message => message.run_id === null || message.run_id === undefined)
      .map(message => normalizeComparableText(extractText(message.content)))
      .filter(Boolean),
  );
  const toolItems = correlateToolEvents(selectExecutionToolEvents(classifiedEvents), now);
  const toolItemsById = new Map(toolItems.map(item => [item.id, item]));
  const runsWithPersistedAssistantMessage = new Set(
    persistedAssistantMessages
      .filter(message => typeof message.run_id === 'string' && message.run_id.trim())
      .map(message => message.run_id as string),
  );
  const items: TimelineItem[] = [];
  const approvalItemsById = new Map<string, ApprovalTimelineItem>();
  const activeSpanByRun = new Map<string, ActiveReasoningSpan>();
  const nextSegmentOrderByRun = new Map<string, number>();

  function allocateSegmentOrder(runKey: string): number {
    const next = nextSegmentOrderByRun.get(runKey) ?? 0;
    nextSegmentOrderByRun.set(runKey, next + 1);
    return next;
  }

  function openSpan(meta: CanonicalEventMeta, index: number): ActiveReasoningSpan {
    const runKey = getReasoningRunKey(meta, index);
    const segmentOrder = allocateSegmentOrder(runKey);
    const segmentId = buildReasoningSegmentId(meta, runKey, index, segmentOrder);
    const span: ActiveReasoningSpan = {
      runKey,
      runId: meta.runId ?? null,
      segmentOrder,
      segmentId,
      lifecycle: 'opened',
      item: null,
    };
    activeSpanByRun.set(runKey, span);
    return span;
  }

  function closeSpan(runKey: string): void {
    const span = activeSpanByRun.get(runKey);
    if (!span) return;
    if (span.item) {
      span.lifecycle = 'closed';
      span.item.status = 'complete';
      span.item.isStreaming = false;
      span.item.isPartial = false;
    } else {
      span.lifecycle = 'dropped';
    }
    activeSpanByRun.delete(runKey);
  }

  function materializeSpan(
    span: ActiveReasoningSpan,
    event: TimelineEventEnvelope,
    meta: CanonicalEventMeta,
    now: () => string,
  ): ReasoningTimelineItem {
    if (span.item) return span.item;
    const item = createReasoningItem(event, meta, span.segmentId, span.segmentOrder, now);
    span.item = item;
    span.lifecycle = 'materialized';
    items.push(item);
    return item;
  }

  classifiedEvents.forEach(({ event, meta, index, classification }) => {
    if (event.type === 'reasoning') {
      const runKey = getReasoningRunKey(meta, index);
      const runId = meta.runId ?? null;
      const isActiveRun = Boolean(params.activeRunId && runId && runId === params.activeRunId);
      const phase = resolveReasoningPhase(event, meta);
      if (phase === 'llm_usage') {
        return;
      }
      if (phase === 'llm_start') {
        // lifecycle: opened (non-visual), materialized on first non-empty llm_reasoning,
        // then closed (or dropped when never materialized) at llm_end.
        closeSpan(runKey);
        openSpan(meta, index);
        return;
      }
      if (phase === 'llm_end') {
        closeSpan(runKey);
        return;
      }

      let activeSpan = activeSpanByRun.get(runKey);
      if (!activeSpan) {
        activeSpan = openSpan(meta, index);
      }

      const reasoningText = extractReasoningText(event.content);
      if (!reasoningText) {
        return;
      }

      const reasoningItem = materializeSpan(activeSpan, event, meta, now);
      if (typeof meta.sequence === 'number') {
        if (reasoningItem.sequence === null || meta.sequence < reasoningItem.sequence) {
          reasoningItem.sequence = meta.sequence;
        }
      }
      reasoningItem.phase = phase === 'unknown' ? meta.phase : phase;
      if (meta.parentEventId) reasoningItem.parentEventId = meta.parentEventId;
      if (meta.eventId) reasoningItem.eventId = meta.eventId;
      reasoningItem.content = mergeReasoningText(reasoningItem.content, reasoningText);

      if (phase === 'llm_reasoning') {
        reasoningItem.status = isActiveRun ? 'streaming' : 'complete';
      } else {
        const rawStatus = resolveStatus(event.subtype);
        const status: TimelineItemStatus = rawStatus === 'streaming' && !isActiveRun ? 'complete' : rawStatus;
        reasoningItem.status = status;
      }
      reasoningItem.isStreaming = reasoningItem.status === 'streaming';
      reasoningItem.isPartial = event.subtype === 'chunk';
      return;
    }
    if (event.type === 'tool') {
      const isApprovalControl = classification.intent === 'approval-control';

      if (!isApprovalControl) {
        const candidateToolItem = buildToolItem(event, meta, index, now);
        const deduped = toolItemsById.get(candidateToolItem.id);
        if (deduped) {
          toolItemsById.delete(candidateToolItem.id);
          items.push(deduped);
        }
      }

      if (classification.hasApprovalSignal) {
        const candidateApproval = buildApprovalItem(event, meta, index, now, classification);
        const existingApproval = approvalItemsById.get(candidateApproval.id);
        if (!existingApproval) {
          items.push(candidateApproval);
          approvalItemsById.set(candidateApproval.id, candidateApproval);
        } else {
          mergeApprovalItem(existingApproval, candidateApproval);
        }
      }
      return;
    }
    if (event.type === 'message') {
      if (isMessageDeltaChunk(event)) {
        return;
      }
      if (meta.runId && runsWithPersistedAssistantMessage.has(meta.runId)) {
        return;
      }
      // First-turn transition guard: persisted assistant message may exist before run_id is backfilled.
      // In that transient window, suppress duplicated message.final event by normalized final text.
      if (meta.runId && (event.subtype === 'final' || event.subtype === 'end')) {
        const normalizedEventText = normalizeComparableText(extractText(event.content));
        if (normalizedEventText && runlessPersistedAssistantFinalTexts.has(normalizedEventText)) {
          return;
        }
      }
      items.push(buildAssistantEventItem(event, meta, index, now));
      return;
    }
    if (event.type === 'plan') {
      const approvalItem = buildApprovalItem(event, meta, index, now, classification);
      const existing = approvalItemsById.get(approvalItem.id);
      if (!existing) {
        items.push(approvalItem);
        approvalItemsById.set(approvalItem.id, approvalItem);
      } else {
        mergeApprovalItem(existing, approvalItem);
      }
    }
  });
  return items.filter(item => {
    if (item.type !== 'reasoning') {
      return true;
    }
    if (item.runId) {
      const assistantFinalText = assistantFinalTextByRun.get(item.runId);
      if (assistantFinalText) {
        const normalizedReasoningText = normalizeComparableText(item.content);
        if (normalizedReasoningText && normalizedReasoningText === assistantFinalText) {
          return false;
        }
        if (!normalizedReasoningText && item.isStreaming) {
          return false;
        }
      }
    }
    return item.isStreaming || item.content.trim().length > 0;
  });
}

function buildStreamingItem(
  params: BuildTimelineItemsFromEventsParams,
  now: () => string,
  hasFinalMessageEventForActiveRun: boolean,
): AssistantMessageTimelineItem | null {
  if (!params.streamingChunkText) return null;
  if (params.streamingChunkIsFinal && hasFinalMessageEventForActiveRun) {
    return null;
  }
  return {
    id: `timeline-streaming-${params.activeRunId ?? 'orphan'}`,
    type: 'assistant-message',
    intent: 'message',
    lane: 'assistant',
    runId: params.activeRunId ?? null,
    sequence: null,
    timestamp: now(),
    status: params.streamingChunkIsFinal ? 'complete' : 'streaming',
    isStreaming: !params.streamingChunkIsFinal,
    isPartial: !params.streamingChunkIsFinal,
    content: params.streamingChunkText,
  };
}

function toTimelineEventEnvelope(
  turnEvent: TimelineTurnEventEnvelope,
  fallbackRunId: string | null,
  includeMessageEvents: boolean,
): TimelineEventEnvelope | null {
  if (!includeMessageEvents && turnEvent.type === 'message') {
    return null;
  }
  const raw = turnEvent as unknown as Record<string, unknown>;
  const metadata = isRecord(turnEvent.metadata) ? turnEvent.metadata : null;
  const topLevelRunId = toOptionalString(raw.run_id);
  const metadataRunId = metadata ? toOptionalString(metadata.run_id) : undefined;
  return {
    type: turnEvent.type,
    subtype: turnEvent.subtype,
    content: turnEvent.content,
    metadata: turnEvent.metadata ?? null,
    timestamp: turnEvent.timestamp,
    event_id: toOptionalString(raw.event_id) ?? (metadata ? toOptionalString(metadata.event_id) : undefined),
    sequence: toOptionalNumber(raw.sequence) ?? (metadata ? toOptionalNumber(metadata.sequence) : undefined),
    run_id: topLevelRunId ?? metadataRunId ?? fallbackRunId,
    tool_call_id:
      toOptionalString(raw.tool_call_id) ?? (metadata ? toOptionalString(metadata.tool_call_id) : undefined),
    parent_event_id:
      toOptionalString(raw.parent_event_id) ?? (metadata ? toOptionalString(metadata.parent_event_id) : undefined),
    phase: toOptionalString(raw.phase) ?? (metadata ? toOptionalString(metadata.phase) : undefined),
  };
}

export function buildTimelineItemsFromTurns(params: BuildTimelineItemsFromTurnsParams): TimelineItem[] {
  const events: TimelineEventEnvelope[] = [];
  const messages: TimelineMessageEnvelope[] = [];
  for (const turn of params.turns) {
    const runId = turn.runId;
    for (const message of turn.userMessages) {
      messages.push({
        id: message.id,
        role: message.role,
        content: message.content,
        created_at: message.created_at,
        seq: message.seq,
        run_id: message.run_id ?? runId,
      });
    }
    for (const message of turn.assistantMessages) {
      messages.push({
        id: message.id,
        role: message.role,
        content: message.content,
        created_at: message.created_at,
        seq: message.seq,
        run_id: message.run_id ?? runId,
      });
    }
    for (const turnEvent of turn.events) {
      const eventEnvelope = toTimelineEventEnvelope(turnEvent, runId, params.includeMessageEvents ?? false);
      if (eventEnvelope) {
        events.push(eventEnvelope);
      }
    }
  }

  const activeTurn = params.turns.find(turn => turn.isActive);
  const streamingTurn = params.turns.find(turn => turn.isActive && turn.streamingAssistantText);
  return buildTimelineItemsFromEvents({
    events,
    messages,
    activeRunId: activeTurn?.runId ?? null,
    streamingChunkText: streamingTurn?.streamingAssistantText ?? null,
    streamingChunkIsFinal: streamingTurn?.streamingAssistantFinal,
    ordering: {
      primary: 'sequence',
      secondary: 'timestamp',
    },
    correlation: {
      toolCallIdField: 'tool_call_id',
      sequenceField: 'sequence',
    },
    now: params.now,
  });
}

export function buildTimelineItemsFromEvents(params: BuildTimelineItemsFromEventsParams): TimelineItem[] {
  const now = params.now ?? (() => new Date().toISOString());
  const normalizedEvents = normalizeEvents(params.events);
  const classifiedEvents = classifyNormalizedEvents(normalizedEvents);
  const assistantSequenceHintsByRun = buildAssistantSequenceHintsByRun(classifiedEvents);
  const assistantFinalTextByRun = collectAssistantFinalTextByRun(params, classifiedEvents);
  const messageItems = buildMessageItems(params, now, assistantSequenceHintsByRun);
  const eventItems = buildEventItems(params, now, classifiedEvents, assistantFinalTextByRun);
  const hasFinalMessageEventForActiveRun = Boolean(
    params.activeRunId &&
      classifiedEvents.some(
        ({ event, meta }) =>
          event.type === 'message' &&
          (event.subtype === 'final' || event.subtype === 'end') &&
          meta.runId === params.activeRunId,
      ),
  );
  const streamingItem = buildStreamingItem(params, now, hasFinalMessageEventForActiveRun);
  const items = streamingItem ? [...messageItems, ...eventItems, streamingItem] : [...messageItems, ...eventItems];
  const runOrderByRun = buildRunOrderByRun(items);
  return items.sort((a, b) => compareTimelineItems(a, b, runOrderByRun));
}
