import { NextResponse } from 'next/server';

import { deleteConversation, getConversationDetail } from '../../../_server/chat.ts';
import { noContent, ok, requireRouteParam, resolveProjectScope, toErrorResponse } from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    conversationId: string;
  };
}

function includeEventsFlag(request: Request): boolean {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('include_events') ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const conversationId = requireRouteParam(context.params.conversationId, 'Conversation id');
    const scope = resolveProjectScope(request);
    return ok(await getConversationDetail(conversationId, scope.project_id, includeEventsFlag(request)));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const conversationId = requireRouteParam(context.params.conversationId, 'Conversation id');
    const scope = resolveProjectScope(request);
    await deleteConversation(conversationId, scope.project_id);
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
