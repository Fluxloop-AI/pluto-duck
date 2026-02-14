import { NextResponse } from 'next/server';

import { createBoard, listBoards } from '../../../../_server/boards.ts';
import {
  created,
  ok,
  parseJsonBody,
  resolveRouteProjectId,
  toErrorResponse,
} from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    projectId: string;
  };
}

interface CreateBoardRequest {
  name: string;
  description?: string | null;
  settings?: Record<string, unknown> | null;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const projectId = resolveRouteProjectId(request, context.params.projectId);
    return ok(await listBoards(projectId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const projectId = resolveRouteProjectId(request, context.params.projectId);
    const payload = await parseJsonBody<CreateBoardRequest>(request);
    return created(await createBoard(projectId, payload));
  } catch (error) {
    return toErrorResponse(error);
  }
}
