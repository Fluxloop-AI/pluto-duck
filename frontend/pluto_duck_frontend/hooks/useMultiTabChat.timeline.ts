import type { ChatSessionDetail } from '../lib/chatApi';
import type { AgentEventAny } from '../types/agent';

export interface DetailMessage {
  id: string;
  role: string;
  content: any;
  created_at: string;
  seq: number;
  run_id?: string | null;
}

export interface ChatEvent {
  type: string;
  subtype?: string;
  content: unknown;
  metadata?: Record<string, unknown> | null;
  timestamp?: string;
}

export interface GroupedToolEvent {
  toolName: string;
  state: 'pending' | 'completed' | 'error';
  input?: unknown;
  output?: unknown;
  error?: string;
  startEvent?: ChatEvent;
  endEvent?: ChatEvent;
}

export interface ChatTurn {
  key: string;
  runId: string | null;
  seq: number;
  userMessages: DetailMessage[];
  assistantMessages: DetailMessage[];
  streamingAssistantText?: string | null;
  streamingAssistantFinal?: boolean;
  otherMessages: DetailMessage[];
  events: ChatEvent[];
  reasoningText: string;
  toolEvents: ChatEvent[];
  groupedToolEvents: GroupedToolEvent[];
  isActive: boolean;
}

export type RunRenderState = 'streaming' | 'settling' | 'persisted';

export function getMetadataRunId(metadata: ChatEvent['metadata']): string | null {
  if (!metadata) return null;
  const runId = metadata.run_id;
  return typeof runId === 'string' && runId.trim() ? runId : null;
}

function getMetadataEventId(metadata: ChatEvent['metadata']): string | null {
  if (!metadata) return null;
  const eventId = metadata.event_id;
  return typeof eventId === 'string' && eventId.trim() ? eventId : null;
}

export function getNextOptimisticSeq(messages: Array<{ seq: number }> | undefined): number {
  if (!messages || messages.length === 0) {
    return 1;
  }
  let maxSeq = 0;
  for (const message of messages) {
    if (typeof message.seq === 'number' && Number.isFinite(message.seq) && message.seq > maxSeq) {
      maxSeq = message.seq;
    }
  }
  return maxSeq + 1;
}

function toChatEvent(event: AgentEventAny): ChatEvent {
  return {
    type: event.type,
    subtype: event.subtype,
    content: event.content,
    metadata: event.metadata ?? null,
    timestamp: event.timestamp,
  };
}

export function computeStreamUiState(
  streamStatus: 'idle' | 'connecting' | 'streaming' | 'error',
  streamEvents: AgentEventAny[],
): {
  isStreaming: boolean;
  status: 'ready' | 'streaming' | 'error';
  runHasEndedStream: boolean;
} {
  const runHasEndedStream = streamEvents.some(
    event => (event.type === 'run' && event.subtype === 'end') || (event.type === 'message' && event.subtype === 'final'),
  );
  const isStreaming = (streamStatus === 'streaming' || streamStatus === 'connecting') && !runHasEndedStream;
  const status: 'ready' | 'streaming' | 'error' = streamStatus === 'error' ? 'error' : isStreaming ? 'streaming' : 'ready';
  return { isStreaming, status, runHasEndedStream };
}

export interface BuildChatTurnsParams {
  detail: ChatSessionDetail | null | undefined;
  streamEvents: AgentEventAny[];
  runRenderState: RunRenderState;
  activeRunId: string | null;
  chunkText: string;
  chunkIsFinal: boolean;
  chunkRunId: string | null;
}

function shouldIncludeStreamSnapshot(runRenderState: RunRenderState): boolean {
  return runRenderState === 'streaming' || runRenderState === 'settling';
}

export function buildChatTurns({
  detail,
  streamEvents,
  runRenderState,
  activeRunId,
  chunkText,
  chunkIsFinal,
  chunkRunId,
}: BuildChatTurnsParams): ChatTurn[] {
  if (!detail) return [];

  const messages = (detail.messages as DetailMessage[]) || [];
  const storedEvents: ChatEvent[] = (detail.events || []).map(evt => ({
    type: evt.type,
    subtype: evt.subtype,
    content: evt.content,
    metadata: evt.metadata ?? null,
    timestamp: evt.timestamp,
  }));

  const eventsByRunId = new Map<string, ChatEvent[]>();
  const seenEventIdsByRun = new Set<string>();
  const addEvent = (event: ChatEvent) => {
    const runId = getMetadataRunId(event.metadata);
    if (!runId) return;
    const eventId = getMetadataEventId(event.metadata);
    if (eventId) {
      const dedupeKey = `${runId}:${eventId}`;
      if (seenEventIdsByRun.has(dedupeKey)) {
        return;
      }
      seenEventIdsByRun.add(dedupeKey);
    }
    if (!eventsByRunId.has(runId)) {
      eventsByRunId.set(runId, []);
    }
    eventsByRunId.get(runId)!.push(event);
  };

  storedEvents.forEach(addEvent);

  const includeStreamSnapshot = shouldIncludeStreamSnapshot(runRenderState);
  if (includeStreamSnapshot) {
    streamEvents.forEach(event => addEvent(toChatEvent(event)));
  }

  const runs = new Map<string, ChatTurn>();
  const result: ChatTurn[] = [];

  const ensureRunTurn = (runId: string, seq: number) => {
    let turn = runs.get(runId);
    if (!turn) {
      turn = {
        key: `run-${runId}`,
        runId,
        seq,
        userMessages: [],
        assistantMessages: [],
        otherMessages: [],
        events: [],
        reasoningText: '',
        toolEvents: [],
        groupedToolEvents: [],
        isActive: false,
      };
      runs.set(runId, turn);
      result.push(turn);
    } else if (seq < turn.seq) {
      turn.seq = seq;
    }
    return turn;
  };

  messages.forEach(message => {
    const seq = typeof message.seq === 'number' ? message.seq : Number.MAX_SAFE_INTEGER;
    const runId = message.run_id ?? null;

    if (runId) {
      const turn = ensureRunTurn(runId, seq);
      if (message.role === 'user') {
        turn.userMessages.push(message);
      } else if (message.role === 'assistant') {
        turn.assistantMessages.push(message);
      } else {
        turn.otherMessages.push(message);
      }
      return;
    }

    result.push({
      key: `message-${message.id}`,
      runId: null,
      seq,
      userMessages: message.role === 'user' ? [message] : [],
      assistantMessages: message.role === 'assistant' ? [message] : [],
      otherMessages: message.role !== 'user' && message.role !== 'assistant' ? [message] : [],
      events: [],
      reasoningText: '',
      toolEvents: [],
      groupedToolEvents: [],
      isActive: false,
    });
  });

  const streamingRunId = chunkRunId ?? activeRunId;
  if (includeStreamSnapshot && streamingRunId && !runs.has(streamingRunId)) {
    runs.set(streamingRunId, {
      key: `run-${streamingRunId}`,
      runId: streamingRunId,
      seq: Number.MAX_SAFE_INTEGER,
      userMessages: [],
      assistantMessages: [],
      otherMessages: [],
      events: [],
      reasoningText: '',
      toolEvents: [],
      groupedToolEvents: [],
      isActive: streamingRunId === activeRunId,
    });
    result.push(runs.get(streamingRunId)!);
  }

  runs.forEach(turn => {
    if (!turn.runId) return;
    turn.events = [...(eventsByRunId.get(turn.runId) ?? [])];
    turn.isActive = includeStreamSnapshot && turn.runId === activeRunId;
    if (includeStreamSnapshot && streamingRunId && turn.runId === streamingRunId && chunkText && turn.assistantMessages.length === 0) {
      turn.streamingAssistantText = chunkText;
      turn.streamingAssistantFinal = chunkIsFinal;
    }
  });

  result.sort((a, b) => a.seq - b.seq);
  return result;
}
