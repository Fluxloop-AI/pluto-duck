import { appendMessage, createConversation, fetchChatSession, fetchChatSessions, type AppendMessageResponse, type ChatSessionDetail, type ChatSessionSummary, type CreateConversationResponse } from '../lib/chatApi';

export interface PromptWorkflowState {
  sessions: ChatSessionSummary[];
  activeSession: ChatSessionSummary | null;
  detail: ChatSessionDetail | null;
}

export interface ParsedPrompt {
  text: string;
  mentionedTables: string[];
}

/**
 * Parse @table mentions from prompt text.
 * Returns cleaned text and extracted table names.
 */
export function parseTableMentions(text: string): ParsedPrompt {
  const mentionRegex = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const matches = Array.from(text.matchAll(mentionRegex));
  const mentionedTables = matches.map(m => m[1]);
  const cleanedText = text.replace(mentionRegex, '').trim().replace(/\s+/g, ' ');
  
  return {
    text: cleanedText,
    mentionedTables,
  };
}

export async function ensureConversation(prompt: string, state: PromptWorkflowState): Promise<{
  session: ChatSessionSummary;
  detail: ChatSessionDetail | null;
  response: AppendMessageResponse | CreateConversationResponse;
}> {
  if (!prompt.trim()) {
    throw new Error('Prompt is empty');
  }

  if (!state.activeSession) {
    const created = await createConversation({ question: prompt });
    const nowIso = new Date().toISOString();
    const session: ChatSessionSummary = {
      id: created.conversation_id ?? created.id,
      title: prompt.slice(0, 80) || null,
      status: 'active',
      created_at: nowIso,
      updated_at: nowIso,
      last_message_preview: prompt.slice(0, 160) || null,
      run_id: created.run_id,
      events_url: created.events_url,
    };
    return { session, detail: null, response: created };
  }

  const appended = await appendMessage(state.activeSession.id, {
    role: 'user',
    content: { text: prompt },
  });
  return {
    session: {
      ...state.activeSession,
      run_id: appended.run_id ?? state.activeSession.run_id,
      updated_at: new Date().toISOString(),
      last_message_preview: prompt.slice(0, 160) || state.activeSession.last_message_preview,
    },
    detail: state.detail,
    response: appended,
  };
}
