import { NextResponse } from 'next/server';

import { noContent, ok, resolveRouteProjectId, toErrorResponse } from '../../_server/http.ts';
import { getProject, legacyDeleteProject } from '../../_server/store.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    projectId: string;
  };
}

export async function GET(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const projectId = resolveRouteProjectId(request, (await context.params).projectId);
    return ok(await getProject(projectId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    resolveRouteProjectId(request, (await context.params).projectId);
    legacyDeleteProject();
  } catch (error) {
    return toErrorResponse(error);
  }

  return noContent();
}
