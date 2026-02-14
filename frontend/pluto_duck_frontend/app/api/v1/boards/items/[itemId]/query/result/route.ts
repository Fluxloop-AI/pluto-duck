import { NextResponse } from 'next/server';

import { getCachedBoardQueryResult } from '../../../../../_server/boards.ts';
import {
  ok,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    itemId: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const itemId = requireRouteParam((await context.params).itemId, 'Item id');
    const scope = resolveProjectScope(request);
    return ok(await getCachedBoardQueryResult(itemId, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
