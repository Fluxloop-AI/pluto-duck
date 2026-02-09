import type { ChatSessionSummary } from '../lib/chatApi';

export interface TabLayoutItem {
  id: string;
  sessionId: string | null;
  title: string;
  createdAt: number;
}

export interface OpenSessionPlan {
  tabs: TabLayoutItem[];
  activeTabId: string;
}

interface OpenSessionInTabInput {
  tabs: TabLayoutItem[];
  session: ChatSessionSummary;
  maxTabs: number;
  idFactory: () => string;
  now: () => number;
}

export function planOpenSessionInTab({
  tabs,
  session,
  maxTabs,
  idFactory,
  now,
}: OpenSessionInTabInput): OpenSessionPlan {
  const existingTab = tabs.find(tab => tab.sessionId === session.id);
  if (existingTab) {
    return {
      tabs,
      activeTabId: existingTab.id,
    };
  }

  const nextTabs = tabs.length >= maxTabs ? tabs.slice(1) : tabs;
  const nextTab: TabLayoutItem = {
    id: idFactory(),
    sessionId: session.id,
    title: session.title || 'Untitled',
    createdAt: now(),
  };

  return {
    tabs: [...nextTabs, nextTab],
    activeTabId: nextTab.id,
  };
}
