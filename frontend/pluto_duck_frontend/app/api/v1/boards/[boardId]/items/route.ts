import { NextResponse } from 'next/server';

import { createBoardItem, listBoardItems } from '../../../_server/boards.ts';
import {
  created,
  ok,
  parseJsonBody,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    boardId: string;
  };
}

interface CreateBoardItemRequest {
  item_type: string;
  title?: string | null;
  payload: Record<string, unknown>;
  render_config?: Record<string, unknown> | null;
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const boardId = requireRouteParam(context.params.boardId, 'Board id');
    const scope = resolveProjectScope(request);
    return ok(await listBoardItems(boardId, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const boardId = requireRouteParam(context.params.boardId, 'Board id');
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<CreateBoardItemRequest>(request);
    return created(await createBoardItem(boardId, payload, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
