import { NextResponse } from 'next/server';

import { deleteSourceConnection, getSourceDetail, updateSourceConnection } from '../../_server/source.ts';
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
    sourceName: string;
  };
}

interface UpdateSourceRequest {
  description?: string | null;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const sourceName = requireRouteParam((await context.params).sourceName, 'Source name');
    const scope = resolveProjectScope(request);
    return ok(await getSourceDetail(sourceName, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const sourceName = requireRouteParam((await context.params).sourceName, 'Source name');
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<UpdateSourceRequest>(request);
    return ok(await updateSourceConnection(sourceName, payload, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const sourceName = requireRouteParam((await context.params).sourceName, 'Source name');
    const scope = resolveProjectScope(request);
    await deleteSourceConnection(sourceName, scope.project_id);
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
