import { NextResponse } from 'next/server';

import { createBoardQuery } from '../../../../_server/boards.ts';
import {
  created,
  parseJsonBody,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    itemId: string;
  };
}

interface CreateQueryRequest {
  query_text: string;
  data_source_tables?: string[];
  refresh_mode?: string;
  refresh_interval_seconds?: number | null;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const itemId = requireRouteParam(context.params.itemId, 'Item id');
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<CreateQueryRequest>(request);
    return created(await createBoardQuery(itemId, payload, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
