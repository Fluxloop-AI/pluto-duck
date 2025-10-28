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

export interface UseChatSessionOptions {
  selectedModel: string;
  selectedDataSource?: string;
  backendReady: boolean;
}

export function useChatSession({ selectedModel, selectedDataSource, backendReady }: UseChatSessionOptions) {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSessionSummary | null>(null);
  const [detail, setDetail] = useState<ChatSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const lastRunIdRef = useRef<string | null>(null);
  const lastCompletedRunRef = useRef<string | null>(null);

  const { events: streamEvents, status: streamStatus, reset: resetStream } = useAgentStream({
    runId: activeRunId ?? undefined,
    eventsPath: activeRunId ? `/api/v1/agent/${activeRunId}/events` : undefined,
    autoReconnect: false,
  });

  const updateSessionPreview = useCallback((sessionId: string, preview: string | null | undefined) => {
    if (!preview) return;
    setSessions(prev =>
      prev.map(session => (session.id === sessionId ? { ...session, last_message_preview: preview } : session)),
    );
  }, []);

  const pickActiveRunId = useCallback((session: ChatSessionSummary | null | undefined) => {
    if (!session) return null;
    return session.status === 'active' ? session.run_id ?? null : null;
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      console.info('[ChatSession] Loading sessions');
      const data = await fetchChatSessions();
      console.info('[ChatSession] Sessions fetched', data);
      const normalizedSessions = data.map(session => ({
        ...session,
        last_message_preview: normalizePreview(session.last_message_preview),
      }));
      setSessions(normalizedSessions);
      setActiveSession(prev => {
        if (normalizedSessions.length === 0) {
          console.info('[ChatSession] No sessions found');
          setActiveRunId(null);
          return null;
        }
        if (!prev) {
          console.info('[ChatSession] Selecting first session', normalizedSessions[0]);
          setActiveRunId(pickActiveRunId(normalizedSessions[0]));
          return normalizedSessions[0];
        }
        const match = normalizedSessions.find(session => session.id === prev.id);
        console.info('[ChatSession] Matching session result', match ?? prev);
        setActiveRunId(pickActiveRunId(match ?? prev));
        return match ?? prev;
      });
    } catch (error) {
      console.error('Failed to load sessions', error);
    }
  }, [pickActiveRunId]);

  const fetchDetail = useCallback(async (sessionId: string, includeEvents: boolean = true) => {
    console.info('[ChatSession] Fetching session detail', sessionId, { includeEvents });
    const response = await fetchChatSession(sessionId, includeEvents);
    console.info('[ChatSession] Session detail response', response);
    return response;
  }, []);

  useEffect(() => {
    if (backendReady) {
      void loadSessions();
    }
  }, [loadSessions, backendReady]);

  useEffect(() => {
    if (!activeSession) {
      setDetail(null);
      if (!isCreatingConversation) {
        setActiveRunId(null);
        lastRunIdRef.current = null;
        lastCompletedRunRef.current = null;
      }
      return;
    }
    const currentSession = activeSession;
    const sessionId = currentSession.id;
    let cancelled = false;
    async function loadDetail() {
      try {
        setLoading(true);
        const response = await fetchDetail(sessionId, true);
        if (!cancelled) {
          setDetail(response);
          const detailPreview = previewFromMessages(response.messages);
          if (detailPreview) {
            updateSessionPreview(sessionId, detailPreview);
          }
          const nextRunId = response.status === 'active' ? response.run_id ?? currentSession.run_id ?? null : null;
          setActiveRunId(nextRunId);
          setActiveSession(prev =>
            prev && prev.id === sessionId
              ? {
                  ...prev,
                  run_id: response.run_id ?? prev.run_id,
                  status: response.status,
                  last_message_preview: detailPreview ?? prev.last_message_preview,
                }
              : prev,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [activeSession?.id, fetchDetail, isCreatingConversation, updateSessionPreview]);

  const events = useMemo<AgentEventAny[]>(() => streamEvents, [streamEvents]);
  const reasoningEvents = useMemo(() => events.filter(e => e.type === 'reasoning'), [events]);
  const runHasEnded = useMemo(
    () =>
      events.some(event =>
        (event.type === 'run' && event.subtype === 'end') ||
        (event.type === 'message' && event.subtype === 'final'),
      ),
    [events],
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

  useEffect(() => {
    if (!activeSession || !activeRunId || streamEvents.length === 0) {
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
      console.info('[ChatSession] Run completed, refreshing session detail');
      void (async () => {
        try {
          setLoading(true);
          const currentSession = activeSession;
          const response = await fetchDetail(currentSession.id, true);
          setDetail(response);
          const detailPreview = previewFromMessages(response.messages);
          if (detailPreview) {
            updateSessionPreview(currentSession.id, detailPreview);
          }
          const nextRunId = response.status === 'active' ? response.run_id ?? activeRunId : null;
          setActiveSession(prev =>
            prev && prev.id === currentSession.id
              ? {
                  ...prev,
                  run_id: response.run_id ?? prev.run_id,
                  status: response.status,
                  last_message_preview: detailPreview ?? prev.last_message_preview,
                }
              : prev,
          );
          setActiveRunId(nextRunId);
          void loadSessions();
        } catch (error) {
          console.error('[ChatSession] Failed to refresh detail after run end', error);
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [activeSession, activeRunId, fetchDetail, loadSessions, streamEvents, updateSessionPreview]);

  const handleSelectSession = useCallback(
    (session: ChatSessionSummary) => {
      resetStream();
      setIsCreatingConversation(false);
      setActiveRunId(pickActiveRunId(session));
      if (activeSession?.id === session.id) {
        void (async () => {
          try {
            setLoading(true);
            const response = await fetchDetail(session.id, true);
            setDetail(response);
            const detailPreview = previewFromMessages(response.messages);
            if (detailPreview) {
              updateSessionPreview(session.id, detailPreview);
            }
            const nextRunId = response.status === 'active' ? response.run_id ?? activeSession.run_id ?? null : null;
            setActiveRunId(nextRunId);
            setActiveSession(prev =>
              prev && prev.id === session.id
                ? {
                    ...prev,
                    status: response.status,
                    run_id: response.run_id ?? prev.run_id,
                    last_message_preview: detailPreview ?? prev.last_message_preview,
                  }
                : prev,
            );
          } catch (error) {
            console.error('[ChatSession] Failed to refresh session detail', error);
          } finally {
            setLoading(false);
          }
        })();
        return;
      }
      setDetail(null);
      const normalizedSelection: ChatSessionSummary = {
        ...session,
        last_message_preview: normalizePreview(session.last_message_preview),
      };
      setActiveSession(normalizedSelection);
      setActiveRunId(pickActiveRunId(normalizedSelection));
    },
    [activeSession, fetchDetail, pickActiveRunId, resetStream, updateSessionPreview],
  );

  const handleDeleteSession = useCallback(
    async (session: ChatSessionSummary) => {
      try {
        await deleteConversation(session.id);
        setSessions(prev => prev.filter(item => item.id !== session.id));
        if (activeSession?.id === session.id) {
          setActiveSession(null);
          setActiveRunId(null);
          setDetail(null);
        }
        void loadSessions();
      } catch (error) {
        console.error('[ChatSession] Failed to delete conversation', error);
      }
    },
    [activeSession, loadSessions],
  );

  const handleNewConversation = useCallback(() => {
    setActiveSession(null);
    setActiveRunId(null);
    setDetail(null);
    setIsCreatingConversation(true);
    resetStream();
  }, [resetStream]);

  const handleSubmit = useCallback(
    async (prompt: string) => {
      if (!prompt.trim()) return;

      resetStream();

      try {
        if (!activeSession) {
          console.info('[ChatSession] Creating conversation for prompt', prompt);
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
          console.info('[ChatSession] Conversation created', response);
          const nowIso = new Date().toISOString();
          const newSession: ChatSessionSummary = {
            id: response.conversation_id ?? response.id,
            title: prompt ? prompt.slice(0, 80) : null,
            status: 'active',
            created_at: nowIso,
            updated_at: nowIso,
            last_message_preview: coercePreviewText(prompt),
            run_id: response.run_id,
            events_url: response.events_url,
          };
          setActiveSession(newSession);
          setActiveRunId(response.run_id ?? null);
          setSessions(prev => {
            const filtered = prev.filter(session => session.id !== newSession.id);
            return [newSession, ...filtered];
          });
          void loadSessions();
          return;
        }

        console.info('[ChatSession] Appending message to existing conversation', activeSession.id);
        const currentSession = activeSession;
        const response: AppendMessageResponse = await appendMessage(currentSession.id, { 
          role: 'user', 
          content: { text: prompt }, 
          model: selectedModel 
        });
        console.info('[ChatSession] Follow-up queued', response);
        const nextRunId = response.run_id ?? currentSession.run_id ?? null;
        setActiveRunId(nextRunId);
        setActiveSession(prev =>
          prev && prev.id === currentSession.id
            ? {
                ...prev,
                run_id: response.run_id ?? prev.run_id,
                status: 'active',
                updated_at: new Date().toISOString(),
                last_message_preview: coercePreviewText(prompt) ?? prev.last_message_preview,
              }
            : prev,
        );
        setDetail(prev =>
          prev
            ? {
                ...prev,
                messages: [
                  ...prev.messages,
                  {
                    id: `temp-${Date.now()}`,
                    role: 'user',
                    content: { text: prompt },
                    created_at: new Date().toISOString(),
                    seq: prev.messages.length + 1,
                  },
                ],
              }
            : prev,
        );
        void loadSessions();
      } catch (error) {
        console.error('Failed to submit message', error);
      }
    },
    [activeSession, selectedModel, selectedDataSource, loadSessions, resetStream],
  );

  return {
    // State
    sessions,
    activeSession,
    detail,
    loading,
    isStreaming,
    status,
    reasoningEvents,
    
    // Handlers
    handleSelectSession,
    handleDeleteSession,
    handleNewConversation,
    handleSubmit,
    loadSessions,
  };
}

