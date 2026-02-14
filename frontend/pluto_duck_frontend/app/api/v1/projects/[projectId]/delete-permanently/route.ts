import { NextResponse } from 'next/server';

import { ok, parseJsonBody, resolveRouteProjectId, toErrorResponse } from '../../../_server/http.ts';
import { deleteProjectPermanently } from '../../../_server/store.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    projectId: string;
  };
}

interface ProjectDangerOperationRequest {
  confirmation: string;
}

export async function POST(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const projectId = resolveRouteProjectId(request, context.params.projectId);
    const payload = await parseJsonBody<ProjectDangerOperationRequest>(request);
    return ok(await deleteProjectPermanently(projectId, payload.confirmation));
  } catch (error) {
    return toErrorResponse(error);
  }
}
