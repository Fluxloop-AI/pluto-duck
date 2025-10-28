import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { AgentEventAny } from '../types/agent';

const MAX_PREVIEW_LENGTH = 160;
const MAX_TABS = 3;

export interface ChatTab {
  id: string;
  sessionId: string | null;
  title: string;
  createdAt: number;
}

interface TabChatState {
  detail: ChatSessionDetail | null;
  loading: boolean;
  activeRunId: string | null;
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
}

export function useMultiTabChat({ selectedModel, selectedDataSource, backendReady }: UseMultiTabChatOptions) {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabStatesRef = useRef<Map<string, TabChatState>>(new Map());
  const lastRunIdRef = useRef<string | null>(null);
  const lastCompletedRunRef = useRef<string | null>(null);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);

  const activeTab = tabs.find(t => t.id === activeTabId) || null;
  const activeTabState = activeTabId ? tabStatesRef.current.get(activeTabId) : null;
  const activeRunId = activeTabState?.activeRunId || null;

  const { events: streamEvents, status: streamStatus, reset: resetStream } = useAgentStream({
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
      console.info('[MultiTabChat] Loading sessions');
      const data = await fetchChatSessions();
      const normalizedSessions = data.map(session => ({
        ...session,
        last_message_preview: normalizePreview(session.last_message_preview),
      }));
      setSessions(normalizedSessions);
    } catch (error) {
      console.error('Failed to load sessions', error);
    }
  }, []);

  const fetchDetail = useCallback(async (sessionId: string, includeEvents: boolean = true) => {
    console.info('[MultiTabChat] Fetching session detail', sessionId, { includeEvents });
    const response = await fetchChatSession(sessionId, includeEvents);
    console.info('[MultiTabChat] Session detail response', response);
    return response;
  }, []);

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
      const currentState = tabStatesRef.current.get(currentTabId);
      if (currentState?.detail?.id === sessionId) {
        // Already loaded
        return;
      }

      try {
        const newState: TabChatState = {
          detail: null,
          loading: true,
          activeRunId: null,
        };
        tabStatesRef.current.set(currentTabId, newState);

        const response = await fetchDetail(sessionId, true);
        
        if (!cancelled) {
          const detailPreview = previewFromMessages(response.messages);
          if (detailPreview) {
            updateSessionPreview(sessionId, detailPreview);
          }
          
          const nextRunId = response.status === 'active' ? response.run_id ?? null : null;
          
          tabStatesRef.current.set(currentTabId, {
            detail: response,
            loading: false,
            activeRunId: nextRunId,
          });
        }
      } catch (error) {
        console.error('[MultiTabChat] Failed to load detail', error);
        if (!cancelled) {
          tabStatesRef.current.set(currentTabId, {
            detail: null,
            loading: false,
            activeRunId: null,
          });
        }
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [activeTab?.id, activeTab?.sessionId, fetchDetail, updateSessionPreview]);

  const events = streamEvents;
  const reasoningEvents = events.filter(e => e.type === 'reasoning');
  const runHasEnded = events.some(event =>
    (event.type === 'run' && event.subtype === 'end') ||
    (event.type === 'message' && event.subtype === 'final'),
  );

  const isStreaming = (streamStatus === 'streaming' || streamStatus === 'connecting') && !runHasEnded;
  const status: 'ready' | 'streaming' | 'error' = streamStatus === 'error' ? 'error' : isStreaming ? 'streaming' : 'ready';

  useEffect(() => {
    if (!activeRunId) {
      lastRunIdRef.current = null;
      lastCompletedRunRef.current = null;
      return;
    }
    if (activeRunId !== lastRunIdRef.current) {
      lastRunIdRef.current = activeRunId;
      lastCompletedRunRef.current = null;
      resetStream();
    }
  }, [activeRunId, resetStream]);

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
      console.info('[MultiTabChat] Run completed, refreshing session detail');
      
      void (async () => {
        if (!activeTab.sessionId) return;
        
        try {
          const response = await fetchDetail(activeTab.sessionId, true);
          const detailPreview = previewFromMessages(response.messages);
          if (detailPreview) {
            updateSessionPreview(activeTab.sessionId, detailPreview);
          }
          const nextRunId = response.status === 'active' ? response.run_id ?? activeRunId : null;
          
          if (activeTabId) {
            tabStatesRef.current.set(activeTabId, {
              detail: response,
              loading: false,
              activeRunId: nextRunId,
            });
          }
          
          void loadSessions();
        } catch (error) {
          console.error('[MultiTabChat] Failed to refresh detail after run end', error);
        }
      })();
    }
  }, [activeTab, activeTabId, activeRunId, fetchDetail, loadSessions, streamEvents, updateSessionPreview]);

  // Tab management
  const addTab = useCallback(() => {
    if (tabs.length >= MAX_TABS) {
      alert(`최대 ${MAX_TABS}개 탭까지만 열 수 있습니다.`);
      return;
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
    tabStatesRef.current.delete(tabId);
  }, [activeTabId]);

  const switchTab = useCallback((tabId: string) => {
    if (activeTabId === tabId) return;
    
    resetStream();
    setActiveTabId(tabId);
  }, [activeTabId, resetStream]);

  const openSessionInTab = useCallback((session: ChatSessionSummary) => {
    // Check if session is already open in a tab
    const existingTab = tabs.find(t => t.sessionId === session.id);
    if (existingTab) {
      switchTab(existingTab.id);
      return;
    }

    // Check tab limit
    if (tabs.length >= MAX_TABS) {
      // Close oldest tab
      const oldestTab = tabs[0];
      closeTab(oldestTab.id);
    }

    // Create new tab
    const newTab: ChatTab = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      title: session.title || 'Untitled',
      createdAt: Date.now(),
    };
    
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    resetStream();
  }, [tabs, switchTab, closeTab, resetStream]);

  const handleNewConversation = useCallback(() => {
    addTab();
  }, [addTab]);

  const handleSubmit = useCallback(
    async (prompt: string) => {
      if (!prompt.trim()) return;
      if (!activeTabId) return;

      resetStream();

      try {
        const currentTab = tabs.find(t => t.id === activeTabId);
        if (!currentTab) return;

        if (!currentTab.sessionId) {
          // Create new conversation
          console.info('[MultiTabChat] Creating conversation for prompt', prompt);
          setIsCreatingConversation(false);
          
          const metadata: Record<string, any> = { model: selectedModel };
          if (selectedDataSource && selectedDataSource !== 'all') {
            metadata.data_source = selectedDataSource;
          }
          
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
            t.id === activeTabId 
              ? { ...t, sessionId: conversationId, title }
              : t
          ));
          
          // Update tab state
          tabStatesRef.current.set(activeTabId, {
            detail: null,
            loading: true,
            activeRunId: response.run_id ?? null,
          });
          
          void loadSessions();
          return;
        }

        // Append to existing conversation
        console.info('[MultiTabChat] Appending message to existing conversation', currentTab.sessionId);
        const response: AppendMessageResponse = await appendMessage(currentTab.sessionId, { 
          role: 'user', 
          content: { text: prompt }, 
          model: selectedModel 
        });
        console.info('[MultiTabChat] Follow-up queued', response);
        
        const currentState = tabStatesRef.current.get(activeTabId);
        const nextRunId = response.run_id ?? currentState?.activeRunId ?? null;
        
        tabStatesRef.current.set(activeTabId, {
          detail: currentState?.detail ? {
            ...currentState.detail,
            messages: [
              ...currentState.detail.messages,
              {
                id: `temp-${Date.now()}`,
                role: 'user',
                content: { text: prompt },
                created_at: new Date().toISOString(),
                seq: currentState.detail.messages.length + 1,
              },
            ],
          } : null,
          loading: false,
          activeRunId: nextRunId,
        });
        
        void loadSessions();
      } catch (error) {
        console.error('Failed to submit message', error);
      }
    },
    [activeTabId, tabs, selectedModel, selectedDataSource, loadSessions, resetStream],
  );

  const handleDeleteSession = useCallback(
    async (session: ChatSessionSummary) => {
      try {
        await deleteConversation(session.id);
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
    [activeTab, loadSessions],
  );

  return {
    // Sessions
    sessions,
    
    // Tabs
    tabs,
    activeTabId,
    activeTab,
    
    // Active tab state
    detail: activeTabState?.detail || null,
    loading: activeTabState?.loading || false,
    isStreaming,
    status,
    reasoningEvents,
    
    // Handlers
    addTab,
    closeTab,
    switchTab,
    openSessionInTab,
    handleNewConversation,
    handleSubmit,
    handleDeleteSession,
    loadSessions,
  };
}

