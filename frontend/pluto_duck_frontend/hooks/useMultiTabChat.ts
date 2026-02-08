import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createConversation,
  fetchChatSession,
  fetchChatSessions,
  appendMessage,
  deleteConversation,
  type AppendMessageResponse,
  type ChatSessionDetail,
  type ChatSessionSummary,
} from '../lib/chatApi';
import { useAgentStream } from './useAgentStream';
import { flattenTurnsToRenderItems } from '../lib/chatRenderUtils';
import type { ChatRenderItem } from '../types/chatRenderItem';
import {
  buildChatTurns,
  computeStreamUiState,
  type RunRenderState,
} from './useMultiTabChat.timeline';
import {
  appendOptimisticUserMessage,
  completeDetailLoading,
  createEmptyTabState,
  failDetailLoading,
  markRunSettling,
  markRunStreaming,
  setRunQueued,
  startDetailLoading,
  TabRequestTokenGuard,
  type TabChatState,
  type TabStateMap,
} from './useMultiTabChat.tabState';
import { planRestoredTabs, type SavedChatTabState } from './useMultiTabChat.restore';
import { planOpenSessionInTab } from './useMultiTabChat.tabLayout';
export type { ChatEvent, ChatTurn, DetailMessage, GroupedToolEvent } from './useMultiTabChat.timeline';

const MAX_PREVIEW_LENGTH = 160;
const MAX_TABS = 10;

export interface ChatTab {
  id: string;
  sessionId: string | null;
  title: string;
  createdAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function extractTextFromUnknown(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return extractTextFromUnknown(parsed);
    } catch {
      return trimmed;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = extractTextFromUnknown(item);
      if (result) return result;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const directKeys = ['final_answer', 'answer', 'text', 'summary', 'message', 'preview'];
    for (const key of directKeys) {
      const candidate = obj[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
      const nested = extractTextFromUnknown(candidate);
      if (nested) return nested;
    }
    if (obj.content !== undefined) {
      const contentText = extractTextFromUnknown(obj.content);
      if (contentText) return contentText;
    }
    if (Array.isArray(obj.messages)) {
      const assistantMessages = obj.messages.filter(
        item => item && typeof item === 'object' && (item as any).role === 'assistant',
      );
      for (const message of assistantMessages) {
        const preview = extractTextFromUnknown((message as any).content ?? message);
        if (preview) return preview;
      }
      const fallback = extractTextFromUnknown(obj.messages);
      if (fallback) return fallback;
    }
    for (const value of Object.values(obj)) {
      const result = extractTextFromUnknown(value);
      if (result) return result;
    }
  }
  return null;
}

function coercePreviewText(value: unknown): string | null {
  const text = extractTextFromUnknown(value);
  if (!text) return null;
  return text.length > MAX_PREVIEW_LENGTH ? text.slice(0, MAX_PREVIEW_LENGTH) : text;
}

function normalizePreview(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const parsedText = coercePreviewText(parsed);
    if (parsedText) return parsedText;
  } catch {
    // ignore parse errors
  }
  return coercePreviewText(trimmed);
}

function previewFromMessages(messages: ChatSessionDetail['messages'] | undefined): string | null {
  if (!messages) return null;
  for (const message of messages) {
    if (message.role === 'assistant') {
      const preview = coercePreviewText(message.content);
      if (preview) return preview;
    }
  }
  return null;
}

export interface UseMultiTabChatOptions {
  selectedModel: string;
  selectedDataSource?: string;
  backendReady: boolean;
  projectId?: string | null;
}

export type FeedbackType = 'like' | 'dislike' | null;

export function useMultiTabChat({ selectedModel, selectedDataSource, backendReady, projectId }: UseMultiTabChatOptions) {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabStates, setTabStates] = useState<TabStateMap>({});
  const tabStatesSnapshotRef = useRef<TabStateMap>({});
  const activeTabIdRef = useRef<string | null>(null);
  const detailRequestGuardRef = useRef(new TabRequestTokenGuard());
  const lastRunIdRef = useRef<string | null>(null);
  const lastCompletedRunRef = useRef<string | null>(null);
  // Feedback state: messageId -> feedback type (stored locally per session)
  const [feedbackMap, setFeedbackMap] = useState<Map<string, FeedbackType>>(new Map());

  const setTabState = useCallback(
    (tabId: string, updater: (current: TabChatState | undefined) => TabChatState | undefined) => {
      setTabStates(prev => {
        const current = prev[tabId];
        const next = updater(current);
        if (!next) {
          if (!(tabId in prev)) return prev;
          const { [tabId]: _removed, ...rest } = prev;
          return rest;
        }
        return {
          ...prev,
          [tabId]: next,
        };
      });
    },
    [],
  );

  useEffect(() => {
    tabStatesSnapshotRef.current = tabStates;
  }, [tabStates]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const activeTab = tabs.find(t => t.id === activeTabId) || null;
  const activeTabState = activeTabId ? tabStates[activeTabId] ?? null : null;
  const activeRunId = activeTabState?.activeRunId || null;
  const runRenderState: RunRenderState =
    activeTabState?.runRenderState ?? (activeRunId ? 'streaming' : 'persisted');

  const {
    events: streamEvents,
    status: streamStatus,
    chunkText,
    chunkIsFinal,
    chunkRunId,
    reset: resetStream,
  } = useAgentStream({
    runId: activeRunId ?? undefined,
    eventsPath: activeRunId ? `/api/v1/agent/${activeRunId}/events` : undefined,
    enabled: !!activeTabId && !!activeRunId,
    autoReconnect: false,
  });

  const updateSessionPreview = useCallback((sessionId: string, preview: string | null | undefined) => {
    if (!preview) return;
    setSessions(prev =>
      prev.map(session => (session.id === sessionId ? { ...session, last_message_preview: preview } : session)),
    );
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      console.info('[MultiTabChat] Loading sessions for project', projectId);
      const data = await fetchChatSessions(projectId || undefined);
      const normalizedSessions = data.map(session => ({
        ...session,
        last_message_preview: normalizePreview(session.last_message_preview),
      }));
      
      // Additional client-side filter as backup (in case backend doesn't filter)
      const filtered = projectId 
        ? normalizedSessions.filter(s => s.project_id === projectId)
        : normalizedSessions;
      
      setSessions(filtered);
    } catch (error) {
      console.error('Failed to load sessions', error);
    }
  }, [projectId]);

  const fetchDetail = useCallback(async (sessionId: string, includeEvents: boolean = true) => {
    console.info('[MultiTabChat] Fetching session detail', sessionId, { includeEvents });
    const response = await fetchChatSession(sessionId, includeEvents);
    console.info('[MultiTabChat] Session detail response', response);
    return response;
  }, []);

  // Reset tabs when projectId changes
  useEffect(() => {
    setTabs([]);
    setActiveTabId(null);
    setTabStates({});
    detailRequestGuardRef.current.clearAll();
  }, [projectId]);

  useEffect(() => {
    if (backendReady) {
      void loadSessions();
    }
  }, [loadSessions, backendReady]);

  // Load detail for active tab
  useEffect(() => {
    if (!activeTab || !activeTab.sessionId) {
      return;
    }

    const currentTabId = activeTab.id;
    const sessionId = activeTab.sessionId;
    let cancelled = false;

    async function loadDetail() {
      const currentState = tabStatesSnapshotRef.current[currentTabId];
      if (currentState?.detail?.id === sessionId && !currentState.loading) {
        // Already loaded
        return;
      }

      const requestToken = detailRequestGuardRef.current.begin(currentTabId, sessionId);
      setTabState(currentTabId, previous => startDetailLoading(previous));

      try {
        const response = await fetchDetail(sessionId, true);
        if (!cancelled && detailRequestGuardRef.current.canCommit(requestToken, activeTabIdRef.current)) {
          const detailPreview = previewFromMessages(response.messages);
          if (detailPreview) {
            updateSessionPreview(sessionId, detailPreview);
          }
          setTabState(currentTabId, previous => completeDetailLoading(previous, response));
        }
      } catch (error) {
        console.error('[MultiTabChat] Failed to load detail', error);
        if (!cancelled && detailRequestGuardRef.current.canCommit(requestToken, activeTabIdRef.current)) {
          setTabState(currentTabId, previous => failDetailLoading(previous));
        }
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [activeTab?.id, activeTab?.sessionId, fetchDetail, setTabState, updateSessionPreview]);

  const { isStreaming, status } = useMemo(
    () => computeStreamUiState(streamStatus, streamEvents),
    [streamStatus, streamEvents],
  );

  // Build turns from messages and events
  const turns = useMemo(
    () =>
      buildChatTurns({
        detail: activeTabState?.detail,
        streamEvents,
        runRenderState,
        activeRunId,
        chunkText,
        chunkIsFinal,
        chunkRunId,
      }),
    [activeTabState?.detail, streamEvents, runRenderState, activeRunId, chunkText, chunkIsFinal, chunkRunId],
  );

  // Convert turns to flat render items for independent rendering
  const renderItems = useMemo<ChatRenderItem[]>(
    () => flattenTurnsToRenderItems(turns),
    [turns]
  );

  // Find last assistant message ID
  const lastAssistantMessageId = useMemo(() => {
    const detail = activeTabState?.detail;
    if (!detail?.messages) return null;
    
    for (let i = detail.messages.length - 1; i >= 0; i--) {
      const message = detail.messages[i];
      if (message.role === 'assistant') {
        return message.id;
      }
    }
    return null;
  }, [activeTabState?.detail?.messages]);

  useEffect(() => {
    if (!activeRunId) {
      lastRunIdRef.current = null;
      lastCompletedRunRef.current = null;
      return;
    }
    if (activeRunId !== lastRunIdRef.current) {
      lastRunIdRef.current = activeRunId;
      lastCompletedRunRef.current = null;
      if (activeTabId) {
        setTabState(activeTabId, previous => markRunStreaming(previous));
      }
      resetStream();
    }
  }, [activeRunId, activeTabId, resetStream, setTabState]);

  // Handle run completion
  useEffect(() => {
    if (!activeTab || !activeRunId || streamEvents.length === 0) {
      return;
    }
    const latest = streamEvents[streamEvents.length - 1];
    if (
      (latest.type === 'run' && latest.subtype === 'end') ||
      (latest.type === 'message' && latest.subtype === 'final')
    ) {
      if (lastCompletedRunRef.current === activeRunId) {
        return;
      }
      lastCompletedRunRef.current = activeRunId;
      if (activeTabId) {
        setTabState(activeTabId, previous => markRunSettling(previous));
      }
      console.info('[MultiTabChat] Run completed, refreshing session detail');
      
      void (async () => {
        if (!activeTab.sessionId || !activeTabId) return;
        const requestToken = detailRequestGuardRef.current.begin(activeTabId, activeTab.sessionId);
        
        try {
          const response = await fetchDetail(activeTab.sessionId, true);
          if (!detailRequestGuardRef.current.canCommit(requestToken, activeTabIdRef.current)) {
            return;
          }
          const detailPreview = previewFromMessages(response.messages);
          if (detailPreview) {
            updateSessionPreview(activeTab.sessionId, detailPreview);
          }
          setTabState(activeTabId, previous => completeDetailLoading(previous, response));
          
          void loadSessions();
        } catch (error) {
          console.error('[MultiTabChat] Failed to refresh detail after run end', error);
        }
      })();
    }
  }, [activeTab, activeTabId, activeRunId, fetchDetail, loadSessions, setTabState, streamEvents, updateSessionPreview]);

  // Tab management
  const addTab = useCallback(() => {
    if (tabs.length >= MAX_TABS) {
      alert(`최대 ${MAX_TABS}개 탭까지만 열 수 있습니다.`);
      return null;
    }
    
    const newTab: ChatTab = {
      id: crypto.randomUUID(),
      sessionId: null,
      title: 'New Chat',
      createdAt: Date.now(),
    };
    
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    resetStream();
    
    return newTab;
  }, [tabs.length, resetStream]);

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      
      // If closing active tab, switch to the last remaining tab
      if (activeTabId === tabId) {
        if (filtered.length > 0) {
          setActiveTabId(filtered[filtered.length - 1].id);
        } else {
          setActiveTabId(null);
        }
      }
      
      return filtered;
    });
    
    // Clean up tab state
    setTabState(tabId, () => undefined);
    detailRequestGuardRef.current.clearTab(tabId);
  }, [activeTabId, setTabState]);

  const switchTab = useCallback((tabId: string) => {
    if (activeTabId === tabId) return;
    
    resetStream();
    setActiveTabId(tabId);
  }, [activeTabId, resetStream]);

  const openSessionInTab = useCallback((session: ChatSessionSummary) => {
    let nextActiveTabId: string | null = null;
    setTabs(prev => {
      const plan = planOpenSessionInTab({
        tabs: prev,
        session,
        maxTabs: MAX_TABS,
        idFactory: () => crypto.randomUUID(),
        now: () => Date.now(),
      });
      nextActiveTabId = plan.activeTabId;
      return plan.tabs;
    });

    if (nextActiveTabId && nextActiveTabId !== activeTabId) {
      resetStream();
      setActiveTabId(nextActiveTabId);
    }
  }, [activeTabId, resetStream]);

  const handleNewConversation = useCallback(() => {
    addTab();
  }, [addTab]);

  const handleSubmit = useCallback(
    async (payload: { prompt: string; contextAssets?: string }) => {
      const { prompt, contextAssets } = payload;
      if (!prompt.trim()) return;
      
      // If no tab exists, create one automatically
      let tabId = activeTabId;
      let currentTab: ChatTab | undefined;
      
      if (!tabId) {
        const newTab = addTab();
        if (!newTab) return; // Max tabs reached
        tabId = newTab.id;
        currentTab = newTab;
        
        // Initialize tab state for the new tab
        setTabState(tabId, () => createEmptyTabState());
      } else {
        currentTab = tabs.find(t => t.id === tabId);
      }

      resetStream();

      try {
        if (!currentTab) return;

        // Ensure conversation view scrolls to bottom when user submits a message
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('stick-to-bottom:scroll-to-bottom'));
        }

        if (!currentTab.sessionId) {
          // Create new conversation
          console.info('[MultiTabChat] Creating conversation for prompt', prompt);
          
          const metadata: Record<string, any> = { model: selectedModel };
          if (selectedDataSource && selectedDataSource !== 'all') {
            metadata.data_source = selectedDataSource;
          }
          if (projectId) {
            metadata.project_id = projectId;
          }
          if (contextAssets) {
            metadata.context_assets = contextAssets;
          }
          const tempUserMessageId = `temp-user-${Date.now()}`;
          const createdAt = new Date().toISOString();
          setTabState(tabId, previous =>
            appendOptimisticUserMessage(previous, {
              tabIdForPlaceholder: tabId,
              tempMessageId: tempUserMessageId,
              prompt,
              createdAt,
            }),
          );
          
          const response = await createConversation({ 
            question: prompt, 
            model: selectedModel,
            metadata,
          });
          console.info('[MultiTabChat] Conversation created', response);
          
          const conversationId = response.conversation_id ?? response.id;
          const title = prompt.slice(0, 30);
          
          // Update tab with session ID and title
          setTabs(prev => prev.map(t => 
            t.id === tabId 
              ? { ...t, sessionId: conversationId, title }
              : t
          ));
          
          // Update tab state - keep optimistic detail until real data arrives
          setTabState(tabId, previous => setRunQueued(previous, response.run_id ?? null));

          void loadSessions();
          return;
        }

        // Append to existing conversation
        console.info('[MultiTabChat] Appending message to existing conversation', currentTab.sessionId);
        const tempUserMessageId = `temp-${Date.now()}`;
        const createdAt = new Date().toISOString();
        setTabState(tabId, previous =>
          appendOptimisticUserMessage(previous, {
            tabIdForPlaceholder: tabId,
            tempMessageId: tempUserMessageId,
            prompt,
            createdAt,
          }),
        );
        
        const appendMetadata: Record<string, any> = {};
        if (contextAssets) {
          appendMetadata.context_assets = contextAssets;
        }
        
        const response: AppendMessageResponse = await appendMessage(currentTab.sessionId, { 
          role: 'user', 
          content: { text: prompt }, 
          model: selectedModel,
          metadata: Object.keys(appendMetadata).length > 0 ? appendMetadata : undefined,
        });
        console.info('[MultiTabChat] Follow-up queued', response);
        setTabState(tabId, previous => setRunQueued(previous, response.run_id ?? previous?.activeRunId ?? null));
        
        void loadSessions();
      } catch (error) {
        console.error('Failed to submit message', error);
      }
    },
    [activeTabId, tabs, selectedModel, selectedDataSource, projectId, loadSessions, resetStream, addTab, setTabState],
  );

  const handleDeleteSession = useCallback(
    async (session: ChatSessionSummary) => {
      try {
        await deleteConversation(session.id, projectId || undefined);
        setSessions(prev => prev.filter(item => item.id !== session.id));
        
        // Close any tabs with this session
        setTabs(prev => {
          const updatedTabs = prev.filter(tab => tab.sessionId !== session.id);
          if (updatedTabs.length !== prev.length && activeTab?.sessionId === session.id) {
            // Active tab was removed
            if (updatedTabs.length > 0) {
              setActiveTabId(updatedTabs[updatedTabs.length - 1].id);
            } else {
              setActiveTabId(null);
            }
          }
          return updatedTabs;
        });
        
        void loadSessions();
      } catch (error) {
        console.error('[MultiTabChat] Failed to delete conversation', error);
      }
    },
    [activeTab, loadSessions, projectId],
  );

  const handleFeedback = useCallback((messageId: string, type: 'like' | 'dislike') => {
    setFeedbackMap(prev => {
      const newMap = new Map(prev);
      const currentFeedback = newMap.get(messageId);

      // Toggle: if same feedback type, remove it; otherwise set it
      if (currentFeedback === type) {
        newMap.delete(messageId);
      } else {
        newMap.set(messageId, type);
      }

      return newMap;
    });
    // TODO: Add API call to persist feedback when backend endpoint is available
  }, []);

  const restoreTabs = useCallback((savedTabs: SavedChatTabState[], savedActiveTabId?: string) => {
    const restorePlan = planRestoredTabs({
      savedTabs,
      savedActiveTabId,
      sessions,
      maxTabs: MAX_TABS,
    });

    setTabStates({});
    detailRequestGuardRef.current.clearAll();
    setTabs(restorePlan.tabs);
    setActiveTabId(restorePlan.activeTabId);
  }, [sessions]);

  return {
    // Sessions
    sessions,

    // Tabs
    tabs,
    activeTabId,
    activeTab,

    // Active tab state
    turns,
    renderItems,
    lastAssistantMessageId,
    loading: activeTabState?.loading || false,
    isStreaming,
    runRenderState,
    status,
    
    // Handlers
    addTab,
    closeTab,
    switchTab,
    openSessionInTab,
    handleNewConversation,
    handleSubmit,
    handleDeleteSession,
    handleFeedback,
    loadSessions,
    restoreTabs,

    // Feedback
    feedbackMap,
  };
}
