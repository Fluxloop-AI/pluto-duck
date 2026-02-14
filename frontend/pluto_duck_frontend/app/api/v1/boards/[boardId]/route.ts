import { NextResponse } from 'next/server';

import { deleteBoard, getBoardDetail, updateBoard } from '../../_server/boards.ts';
import {
  noContent,
  ok,
  parseJsonBody,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    boardId: string;
  };
}

interface UpdateBoardRequest {
  name?: string | null;
  description?: string | null;
  settings?: Record<string, unknown> | null;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const boardId = requireRouteParam((await context.params).boardId, 'Board id');
    const scope = resolveProjectScope(request);
    return ok(await getBoardDetail(boardId, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const boardId = requireRouteParam((await context.params).boardId, 'Board id');
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<UpdateBoardRequest>(request);
    return ok(await updateBoard(boardId, payload, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const boardId = requireRouteParam((await context.params).boardId, 'Board id');
    const scope = resolveProjectScope(request);
    await deleteBoard(boardId, scope.project_id);
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
