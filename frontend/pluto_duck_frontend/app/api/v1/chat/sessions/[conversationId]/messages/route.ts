import { NextResponse } from 'next/server';

import { appendConversationMessage, getConversationSummary } from '../../../../_server/chat.ts';
import { startAgentRun } from '../../../../_server/agentRuntime.ts';
import { StoreHttpError } from '../../../../_server/store.ts';
import {
  ok,
  parseJsonBody,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    conversationId: string;
  };
}

interface AppendMessageRequest {
  role: string;
  content: unknown;
  model?: string;
  metadata?: Record<string, unknown>;
  run_id?: string;
  runtime_engine?: string;
}

function extractRunUserContext(request: Request): Record<string, unknown> | null {
  const userId = request.headers.get('X-User-ID')?.trim();
  const sessionId = request.headers.get('X-Session-ID')?.trim();
  const userAgent = request.headers.get('user-agent')?.trim();
  const context: Record<string, unknown> = {};
  if (userId) {
    context.user_id = userId;
  }
  if (sessionId) {
    context.session_id = sessionId;
  }
  if (userAgent) {
    context.user_agent = userAgent;
  }
  return Object.keys(context).length > 0 ? context : null;
}

function extractUserText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
    const text = (content as Record<string, unknown>).text;
    if (typeof text === 'string') {
      return text;
    }
  }
  return '';
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const conversationId = requireRouteParam(context.params.conversationId, 'Conversation id');
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<AppendMessageRequest>(request);

    const summary = await getConversationSummary(conversationId);
    if (!summary || (scope.project_id && summary.project_id !== scope.project_id)) {
      throw new StoreHttpError(404, 'Conversation not found');
    }

    if (payload.role.trim().toLowerCase() === 'user') {
      const question = extractUserText(payload.content);
      const started = await startAgentRun({
        question,
        conversation_id: conversationId,
        model: payload.model ?? null,
        metadata: payload.metadata ?? null,
        scope_project_id: scope.project_id,
        user_context: extractRunUserContext(request),
        runtime_engine: payload.runtime_engine ?? null,
      });
      return ok({
        status: 'queued',
        conversation_id: started.conversation_id,
        run_id: started.run_id,
        events_url: started.events_url,
      });
    }

    await appendConversationMessage({
      conversation_id: conversationId,
      role: payload.role,
      content: payload.content,
      run_id: payload.run_id ?? null,
    });

    return ok({
      status: 'appended',
      conversation_id: conversationId,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
