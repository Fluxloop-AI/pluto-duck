import { NextResponse } from 'next/server';

import { createConversation, listConversations } from '../../_server/chat.ts';
import { startAgentRun } from '../../_server/agentRuntime.ts';
import { created, ok, parseJsonBody, resolveProjectScope, toErrorResponse } from '../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface CreateConversationRequest {
  question?: string;
  metadata?: Record<string, unknown>;
  conversation_id?: string;
  model?: string;
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

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    return ok(await listConversations(scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<CreateConversationRequest>(request);

    if (payload.question && payload.question.trim().length > 0) {
      const started = await startAgentRun({
        question: payload.question,
        conversation_id: payload.conversation_id ?? null,
        model: payload.model ?? null,
        metadata: payload.metadata ?? null,
        scope_project_id: scope.project_id,
        user_context: extractRunUserContext(request),
        runtime_engine: payload.runtime_engine ?? null,
      });
      return created({
        id: started.conversation_id,
        conversation_id: started.conversation_id,
        run_id: started.run_id,
        events_url: started.events_url,
      });
    }

    const createdConversation = await createConversation({
      question: null,
      metadata: payload.metadata ?? null,
      conversation_id: payload.conversation_id ?? null,
      model: payload.model ?? null,
      scope_project_id: scope.project_id,
    });
    return created({
      id: createdConversation.id,
      conversation_id: createdConversation.id,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
