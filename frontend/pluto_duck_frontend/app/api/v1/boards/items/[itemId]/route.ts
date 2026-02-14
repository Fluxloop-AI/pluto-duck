import { NextResponse } from 'next/server';

import { deleteBoardItem, updateBoardItem } from '../../../_server/boards.ts';
import {
  noContent,
  ok,
  parseJsonBody,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    itemId: string;
  };
}

interface UpdateBoardItemRequest {
  title?: string | null;
  payload?: Record<string, unknown>;
  render_config?: Record<string, unknown> | null;
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const itemId = requireRouteParam((await context.params).itemId, 'Item id');
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<UpdateBoardItemRequest>(request);
    return ok(await updateBoardItem(itemId, payload, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const itemId = requireRouteParam((await context.params).itemId, 'Item id');
    const scope = resolveProjectScope(request);
    await deleteBoardItem(itemId, scope.project_id);
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
