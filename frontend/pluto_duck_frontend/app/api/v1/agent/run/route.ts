import { NextResponse } from 'next/server';

import { startAgentRun } from '../../_server/agentRuntime.ts';
import { ok, parseJsonBody, resolveProjectScope, toErrorResponse } from '../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface StartRunRequest {
  question?: string;
  model?: string;
  metadata?: Record<string, unknown>;
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

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<StartRunRequest>(request);
    const started = await startAgentRun({
      question: payload.question ?? '',
      model: payload.model ?? null,
      metadata: payload.metadata ?? null,
      scope_project_id: scope.project_id,
      user_context: extractRunUserContext(request),
      runtime_engine: payload.runtime_engine ?? null,
    });
    return ok(started);
  } catch (error) {
    return toErrorResponse(error);
  }
}
