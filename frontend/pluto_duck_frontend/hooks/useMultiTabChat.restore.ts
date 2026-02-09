import type { ChatSessionSummary } from '../lib/chatApi';

export interface SavedChatTabState {
  id: string;
  order: number;
}

export interface RestoredChatTab {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
}

export interface RestorePlan {
  tabs: RestoredChatTab[];
  activeTabId: string | null;
}

interface RestorePlanInput {
  savedTabs: SavedChatTabState[];
  savedActiveTabId?: string;
  sessions: ChatSessionSummary[];
  maxTabs?: number;
}

interface RestoreFingerprintInput {
  projectId?: string | null;
  savedTabs?: SavedChatTabState[];
  savedActiveTabId?: string;
  sessions: ChatSessionSummary[];
}

const DEFAULT_MAX_TABS = 10;
const RESTORED_TAB_PREFIX = 'restored-session:';

export function buildRestoredTabId(sessionId: string): string {
  return `${RESTORED_TAB_PREFIX}${sessionId}`;
}

function normalizeSavedTabs(savedTabs: SavedChatTabState[]): SavedChatTabState[] {
  return [...savedTabs].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
}

function resolveCreatedAt(session: ChatSessionSummary, fallbackIndex: number): number {
  const parsedUpdatedAt = Date.parse(session.updated_at);
  if (Number.isFinite(parsedUpdatedAt)) return parsedUpdatedAt;
  const parsedCreatedAt = Date.parse(session.created_at);
  if (Number.isFinite(parsedCreatedAt)) return parsedCreatedAt;
  return fallbackIndex;
}

export function planRestoredTabs({
  savedTabs,
  savedActiveTabId,
  sessions,
  maxTabs = DEFAULT_MAX_TABS,
}: RestorePlanInput): RestorePlan {
  const sessionById = new Map(sessions.map(session => [session.id, session]));
  const sortedSavedTabs = normalizeSavedTabs(savedTabs);
  const seenSessionIds = new Set<string>();
  const plannedTabs: RestoredChatTab[] = [];

  for (const savedTab of sortedSavedTabs) {
    if (plannedTabs.length >= maxTabs) break;
    if (seenSessionIds.has(savedTab.id)) continue;

    const session = sessionById.get(savedTab.id);
    if (!session) continue;

    seenSessionIds.add(savedTab.id);
    plannedTabs.push({
      id: buildRestoredTabId(session.id),
      sessionId: session.id,
      title: session.title || 'Untitled',
      createdAt: resolveCreatedAt(session, plannedTabs.length),
    });
  }

  if (plannedTabs.length === 0) {
    return {
      tabs: [],
      activeTabId: null,
    };
  }

  const explicitActiveTabId = savedActiveTabId
    ? plannedTabs.find(tab => tab.sessionId === savedActiveTabId)?.id ?? null
    : null;

  return {
    tabs: plannedTabs,
    activeTabId: explicitActiveTabId ?? plannedTabs[0].id,
  };
}

export function buildRestoreFingerprint({
  projectId,
  savedTabs = [],
  savedActiveTabId,
  sessions,
}: RestoreFingerprintInput): string {
  const sortedSavedTabs = normalizeSavedTabs(savedTabs);
  const savedTabSnapshot = sortedSavedTabs.map(tab => `${tab.id}:${tab.order}`).join(',');
  const sessionSnapshot = [...sessions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(session => `${session.id}:${session.updated_at}:${session.status}`)
    .join(',');

  return `${projectId ?? ''}|${savedActiveTabId ?? ''}|${savedTabSnapshot}|${sessionSnapshot}`;
}
