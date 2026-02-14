import { NextResponse } from 'next/server';

import { updateBoardItemPosition } from '../../../../_server/boards.ts';
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
    itemId: string;
  };
}

interface UpdatePositionRequest {
  position_x: number;
  position_y: number;
  width: number;
  height: number;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const itemId = requireRouteParam((await context.params).itemId, 'Item id');
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<UpdatePositionRequest>(request);
    return ok(await updateBoardItemPosition(itemId, payload, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
