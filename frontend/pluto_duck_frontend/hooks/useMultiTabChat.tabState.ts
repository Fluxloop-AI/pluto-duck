import type { ChatSessionDetail } from '../lib/chatApi';

type RunRenderState = 'persisted' | 'streaming' | 'settling';

export interface TabChatState {
  detail: ChatSessionDetail | null;
  loading: boolean;
  activeRunId: string | null;
  runRenderState: RunRenderState;
}

export type TabStateMap = Record<string, TabChatState>;

export interface TabRequestToken {
  tabId: string;
  sessionId: string;
  sequence: number;
}

function defaultRunRenderState(activeRunId: string | null | undefined): RunRenderState {
  return activeRunId ? 'streaming' : 'persisted';
}

function getNextOptimisticSeq(messages: ChatSessionDetail['messages'] | undefined): number {
  if (!messages || messages.length === 0) return 1;
  let nextSeq = 1;
  for (const message of messages) {
    if (Number.isFinite(message.seq)) {
      nextSeq = Math.max(nextSeq, message.seq + 1);
    }
  }
  return nextSeq;
}

export function createEmptyTabState(): TabChatState {
  return {
    detail: null,
    loading: false,
    activeRunId: null,
    runRenderState: 'persisted',
  };
}

export function startDetailLoading(previous: TabChatState | null | undefined): TabChatState {
  const base = previous ?? createEmptyTabState();
  return {
    detail: base.detail,
    loading: true,
    activeRunId: base.activeRunId,
    runRenderState: base.runRenderState ?? defaultRunRenderState(base.activeRunId),
  };
}

export function completeDetailLoading(
  previous: TabChatState | null | undefined,
  detail: ChatSessionDetail,
): TabChatState {
  const fallbackRunId = previous?.activeRunId ?? null;
  const nextRunId = detail.status === 'active' ? detail.run_id ?? fallbackRunId : null;

  return {
    detail,
    loading: false,
    activeRunId: nextRunId,
    runRenderState: defaultRunRenderState(nextRunId),
  };
}

export function failDetailLoading(previous: TabChatState | null | undefined): TabChatState {
  const base = previous ?? createEmptyTabState();
  return {
    detail: base.detail,
    loading: false,
    activeRunId: base.activeRunId,
    runRenderState: base.runRenderState ?? defaultRunRenderState(base.activeRunId),
  };
}

export function markRunStreaming(previous: TabChatState | null | undefined): TabChatState {
  const base = previous ?? createEmptyTabState();
  return {
    ...base,
    runRenderState: 'streaming',
  };
}

export function markRunSettling(previous: TabChatState | null | undefined): TabChatState {
  const base = previous ?? createEmptyTabState();
  return {
    ...base,
    runRenderState: 'settling',
  };
}

export function setRunQueued(previous: TabChatState | null | undefined, runId: string | null): TabChatState {
  const base = previous ?? createEmptyTabState();
  return {
    ...base,
    loading: false,
    activeRunId: runId,
    runRenderState: defaultRunRenderState(runId),
  };
}

interface OptimisticMessageParams {
  tabIdForPlaceholder: string;
  tempMessageId: string;
  prompt: string;
  createdAt: string;
}

export function appendOptimisticUserMessage(
  previous: TabChatState | null | undefined,
  params: OptimisticMessageParams,
): TabChatState {
  const base = previous ?? createEmptyTabState();
  const optimisticMessage = {
    id: params.tempMessageId,
    role: 'user',
    content: { text: params.prompt },
    created_at: params.createdAt,
    seq: getNextOptimisticSeq(base.detail?.messages),
    run_id: null,
  };

  const detail = base.detail
    ? {
        ...base.detail,
        messages: [...base.detail.messages, optimisticMessage],
      }
    : {
        id: params.tabIdForPlaceholder,
        status: 'active',
        messages: [optimisticMessage],
        events: [],
      };

  return {
    ...base,
    detail,
    loading: false,
    runRenderState: base.activeRunId ? base.runRenderState : 'persisted',
  };
}

export class TabRequestTokenGuard {
  private sequence = 0;

  private latestByTab = new Map<string, TabRequestToken>();

  begin(tabId: string, sessionId: string): TabRequestToken {
    this.sequence += 1;
    const token: TabRequestToken = {
      tabId,
      sessionId,
      sequence: this.sequence,
    };
    this.latestByTab.set(tabId, token);
    return token;
  }

  isLatest(token: TabRequestToken): boolean {
    const latest = this.latestByTab.get(token.tabId);
    if (!latest) return false;
    return latest.sequence === token.sequence && latest.sessionId === token.sessionId;
  }

  canCommit(token: TabRequestToken): boolean {
    return this.isLatest(token);
  }

  clearTab(tabId: string): void {
    this.latestByTab.delete(tabId);
  }

  clearAll(): void {
    this.latestByTab.clear();
  }
}
