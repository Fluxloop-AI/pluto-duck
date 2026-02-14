import { NextResponse } from 'next/server';

import { getConversationSummary, listConversationEvents } from '../../../../_server/chat.ts';
import { ok, requireRouteParam, resolveProjectScope, toErrorResponse } from '../../../../_server/http.ts';
import { StoreHttpError } from '../../../../_server/store.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    conversationId: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const conversationId = requireRouteParam((await context.params).conversationId, 'Conversation id');
    const scope = resolveProjectScope(request);
    const summary = await getConversationSummary(conversationId);
    if (!summary || (scope.project_id && summary.project_id !== scope.project_id)) {
      throw new StoreHttpError(404, 'Conversation not found');
    }
    return ok(await listConversationEvents(conversationId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
