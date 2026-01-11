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
import type { AgentEventAny } from '../types/agent';

const MAX_PREVIEW_LENGTH = 160;
const MAX_TABS = 3;

export interface ChatTab {
  id: string;
  sessionId: string | null;
  title: string;
  createdAt: number;
}

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
  content: any;
  metadata?: Record<string, any> | null;
  timestamp?: string;
}

export interface GroupedToolEvent {
  toolName: string;
  state: 'pending' | 'completed' | 'error';
  input?: string;
  output?: any;
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
  otherMessages: DetailMessage[];
  events: ChatEvent[];
  reasoningText: string;
  toolEvents: ChatEvent[];
  groupedToolEvents: GroupedToolEvent[];
  isActive: boolean;
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
  projectId?: string | null;
}

export function useMultiTabChat({ selectedModel, selectedDataSource, backendReady, projectId }: UseMultiTabChatOptions) {
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
    tabStatesRef.current.clear();
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
      const currentState = tabStatesRef.current.get(currentTabId);
      if (currentState?.detail?.id === sessionId && !currentState.loading) {
        // Already loaded
        return;
      }

      try {
        tabStatesRef.current.set(currentTabId, {
          detail: currentState?.detail ?? null,
          loading: true,
          activeRunId: currentState?.activeRunId ?? null,
        });

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
            detail: currentState?.detail ?? null,
            loading: false,
            activeRunId: currentState?.activeRunId ?? null,
          });
        }
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [activeTab?.id, activeTab?.sessionId, fetchDetail, updateSessionPreview]);

  const runHasEndedStream = useMemo(
    () =>
      streamEvents.some(event =>
        (event.type === 'run' && event.subtype === 'end') ||
        (event.type === 'message' && event.subtype === 'final'),
      ),
    [streamEvents],
  );

  const isStreaming = (streamStatus === 'streaming' || streamStatus === 'connecting') && !runHasEndedStream;
  const status: 'ready' | 'streaming' | 'error' = streamStatus === 'error' ? 'error' : isStreaming ? 'streaming' : 'ready';

  // Build turns from messages and events
  const turns = useMemo<ChatTurn[]>(() => {
    const detail = activeTabState?.detail;
    if (!detail) return [];

    const messages = (detail.messages as DetailMessage[]) || [];
    
    // Normalize stored events
    const storedEvents: ChatEvent[] = (detail.events || []).map(evt => ({
      type: evt.type,
      subtype: evt.subtype,
      content: evt.content,
      metadata: evt.metadata ?? null,
      timestamp: evt.timestamp,
    }));

    // Build event map by run_id
    const eventsByRunId = new Map<string, ChatEvent[]>();

    const addEvent = (event: ChatEvent) => {
      const runId = event.metadata?.run_id;
      if (!runId) return;
      if (!eventsByRunId.has(runId)) {
        eventsByRunId.set(runId, []);
      }
      eventsByRunId.get(runId)!.push(event);
    };

    storedEvents.forEach(addEvent);

    // Add live stream events if streaming
    if (isStreaming) {
      streamEvents.forEach(event => {
        const normalized: ChatEvent = {
          type: event.type as string,
          subtype: event.subtype,
          content: event.content,
          metadata: event.metadata as Record<string, any> | null,
          timestamp: event.timestamp,
        };
        addEvent(normalized);
      });
    }

    // Group messages by run_id
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
      } else {
        // Legacy message without run_id
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
      }
    });

    // Add empty turn for active streaming run if not in messages yet
    if (isStreaming && activeRunId && !runs.has(activeRunId)) {
      runs.set(activeRunId, {
        key: `run-${activeRunId}`,
        runId: activeRunId,
        seq: Number.MAX_SAFE_INTEGER,
        userMessages: [],
        assistantMessages: [],
        otherMessages: [],
        events: [],
        reasoningText: '',
        toolEvents: [],
        groupedToolEvents: [],
        isActive: true,
      });
      result.push(runs.get(activeRunId)!);
    }

    // Attach events to each run and extract reasoning/tools
    runs.forEach(turn => {
      if (turn.runId) {
        turn.events = [...(eventsByRunId.get(turn.runId) ?? [])];
        turn.isActive = isStreaming && turn.runId === activeRunId;
        
        // Extract reasoning text
        turn.reasoningText = turn.events
          .filter(event => event.type === 'reasoning')
          .map(event => {
            const content = event.content as any;
            return content && typeof content === 'object' && content.reason ? String(content.reason) : '';
          })
          .filter(Boolean)
          .join('\n\n');
        
        // Extract tool events
        turn.toolEvents = turn.events.filter(event => event.type === 'tool');
        
        // Group tool events by tool name (match start with end)
        const toolMap = new Map<string, GroupedToolEvent>();
        const toolOrder: string[] = [];
        
        turn.toolEvents.forEach(event => {
          const content = event.content as any;
          const toolName = content?.tool || 'tool';
          const subtype = event.subtype;
          
          if (subtype === 'start') {
            const key = `${toolName}-${toolOrder.filter(k => k.startsWith(toolName)).length}`;
            toolOrder.push(key);
            toolMap.set(key, {
              toolName,
              state: 'pending',
              input: content?.input,
              startEvent: event,
            });
          } else if (subtype === 'end' || subtype === 'error') {
            // Find the most recent pending tool with this name
            const pendingKey = [...toolOrder].reverse().find(key => {
              const tool = toolMap.get(key);
              return tool && tool.toolName === toolName && tool.state === 'pending';
            });
            
            if (pendingKey) {
              const tool = toolMap.get(pendingKey)!;
              tool.state = subtype === 'error' ? 'error' : 'completed';
              tool.output = content?.output;
              tool.error = subtype === 'error' ? (content?.error || content?.message) : undefined;
              tool.endEvent = event;
            } else {
              // No matching start, create standalone entry
              const key = `${toolName}-orphan-${Date.now()}`;
              toolOrder.push(key);
              toolMap.set(key, {
                toolName,
                state: subtype === 'error' ? 'error' : 'completed',
                output: content?.output,
                error: subtype === 'error' ? (content?.error || content?.message) : undefined,
                endEvent: event,
              });
            }
          }
        });
        
        turn.groupedToolEvents = toolOrder.map(key => toolMap.get(key)!);
      }
    });

    result.sort((a, b) => a.seq - b.seq);
    return result;
  }, [activeTabState?.detail, streamEvents, isStreaming, activeRunId]);

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
        tabStatesRef.current.set(tabId, {
          detail: null,
          loading: false,
          activeRunId: null,
        });
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
          
          // Show user message immediately in UI
          const tempUserMessage = {
            id: `temp-user-${Date.now()}`,
            role: 'user',
            content: { text: prompt },
            created_at: new Date().toISOString(),
            seq: 1,
            run_id: null,
          };
          
          tabStatesRef.current.set(tabId, {
            detail: {
              id: tabId,
              status: 'active',
              messages: [tempUserMessage],
              events: [],
            },
            loading: false,
            activeRunId: null,
          });
          
          // Start loading indicator
          setIsCreatingConversation(true);
          
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
          const placeholderState = tabStatesRef.current.get(tabId);
          tabStatesRef.current.set(tabId, {
            detail: placeholderState?.detail ?? null,
            loading: true,
            activeRunId: response.run_id ?? null,
          });

          setIsCreatingConversation(false);
          void loadSessions();
          return;
        }

        // Append to existing conversation
        console.info('[MultiTabChat] Appending message to existing conversation', currentTab.sessionId);
        
        // Show user message immediately in UI
        const currentState = tabStatesRef.current.get(tabId);
        const tempUserMessage = {
          id: `temp-${Date.now()}`,
          role: 'user',
          content: { text: prompt },
          created_at: new Date().toISOString(),
          seq: currentState?.detail?.messages.length ?? 0 + 1,
          run_id: null,
        };
        
        if (currentState?.detail) {
          tabStatesRef.current.set(tabId, {
            ...currentState,
            detail: {
              ...currentState.detail,
              messages: [...currentState.detail.messages, tempUserMessage],
            },
          });
        }
        
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
        
        const nextRunId = response.run_id ?? currentState?.activeRunId ?? null;
        
        // Update with run_id
        tabStatesRef.current.set(tabId, {
          detail: currentState?.detail ? {
            ...currentState.detail,
            messages: [...currentState.detail.messages, tempUserMessage],
          } : null,
          loading: false,
          activeRunId: nextRunId,
        });
        
        void loadSessions();
      } catch (error) {
        console.error('Failed to submit message', error);
      }
    },
    [activeTabId, tabs, selectedModel, selectedDataSource, projectId, loadSessions, resetStream, addTab],
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

  const restoreTabs = useCallback(
    async (savedTabs: Array<{ id: string; order: number }>, savedActiveTabId?: string) => {
      console.log('[MultiTabChat] Restoring tabs', savedTabs, 'active:', savedActiveTabId);
      
      // Clear existing tabs first
      setTabs([]);
      setActiveTabId(null);
      tabStatesRef.current.clear();
      
      // Sort by order
      const sortedTabs = [...savedTabs].sort((a, b) => a.order - b.order);
      
      // Restore each tab and collect their IDs
      const restoredTabIds: string[] = [];
      
      for (const savedTab of sortedTabs) {
        try {
          const session = sessions.find(s => s.id === savedTab.id);
          if (session) {
            await openSessionInTab(session);
            // openSessionInTab creates a new tab with a unique ID
            // We need to track which tab corresponds to which session
            restoredTabIds.push(savedTab.id);
          }
        } catch (error) {
          console.error(`Failed to restore tab ${savedTab.id}`, error);
        }
      }
      
      // Restore active tab - need to find the tab that was created for this session
      if (savedActiveTabId && restoredTabIds.length > 0) {
        // Give tabs time to be added to state
        setTimeout(() => {
          setTabs(currentTabs => {
            // Find the tab with the matching sessionId
            const activeTab = currentTabs.find(t => t.sessionId === savedActiveTabId);
            if (activeTab) {
              console.log('[MultiTabChat] Setting active tab to', activeTab.id);
              setActiveTabId(activeTab.id);
            } else if (currentTabs.length > 0) {
              // Fallback to first tab if saved active tab not found
              console.log('[MultiTabChat] Active tab not found, using first tab');
              setActiveTabId(currentTabs[0].id);
            }
            return currentTabs;
          });
        }, 50);
      }
    },
    [sessions, openSessionInTab]
  );

  return {
    // Sessions
    sessions,
    
    // Tabs
    tabs,
    activeTabId,
    activeTab,
    
    // Active tab state
    turns,
    lastAssistantMessageId,
    loading: activeTabState?.loading || false,
    isStreaming,
    status,
    
    // Handlers
    addTab,
    closeTab,
    switchTab,
    openSessionInTab,
    handleNewConversation,
    handleSubmit,
    handleDeleteSession,
    loadSessions,
    restoreTabs,
  };
}

