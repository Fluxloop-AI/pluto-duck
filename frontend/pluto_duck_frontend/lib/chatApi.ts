import { apiJson, apiVoid } from './apiClient';

export interface ChatSessionSummary {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_preview: string | null;
  run_id?: string;
  events_url?: string;
  project_id?: string;
}

export interface ChatSessionDetail {
  id: string;
  status: string;
  messages: Array<{ id: string; role: string; content: any; created_at: string; seq: number; run_id?: string | null }>;
  events?: Array<{ type: string; subtype: string; content: any; metadata?: any; timestamp?: string }>;
  events_url?: string;
  run_id?: string;
}

export async function fetchChatSessions(projectId?: string): Promise<ChatSessionSummary[]> {
  return apiJson<ChatSessionSummary[]>('/api/v1/chat/sessions', { projectId });
}

export async function fetchChatSession(conversationId: string, includeEvents = false): Promise<ChatSessionDetail> {
  const path = `/api/v1/chat/sessions/${conversationId}${
    includeEvents ? '?include_events=true' : ''
  }`;
  return apiJson<ChatSessionDetail>(path);
}

export interface CreateConversationPayload {
  question?: string;
  metadata?: Record<string, unknown>;
  conversation_id?: string;
  model?: string;
}

export interface CreateConversationResponse {
  id: string;
  run_id?: string;
  events_url?: string;
  conversation_id?: string;
}

export async function createConversation(payload: CreateConversationPayload): Promise<CreateConversationResponse> {
  return apiJson<CreateConversationResponse>('/api/v1/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export interface AppendMessageResponse {
  status: string;
  run_id?: string;
  events_url?: string;
  conversation_id?: string;
}

export interface AppendMessagePayload {
  role: string;
  content: any;
  model?: string;
  metadata?: Record<string, unknown>;
  run_id?: string;
}

export async function appendMessage(
  conversationId: string,
  payload: AppendMessagePayload,
): Promise<AppendMessageResponse> {
  return apiJson<AppendMessageResponse>(`/api/v1/chat/sessions/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteConversation(conversationId: string, projectId?: string): Promise<void> {
  await apiVoid(`/api/v1/chat/sessions/${conversationId}`, {
    method: 'DELETE',
    projectId,
  });
}

export interface ChatSettings {
  data_sources?: any;
  dbt_project?: any;
  ui_preferences?: any;
  llm_provider?: any;
}

export async function fetchChatSettings(): Promise<ChatSettings> {
  return apiJson<ChatSettings>('/api/v1/chat/settings');
}

export async function updateChatSettings(payload: ChatSettings): Promise<ChatSettings> {
  return apiJson<ChatSettings>('/api/v1/chat/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
