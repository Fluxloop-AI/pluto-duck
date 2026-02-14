import { NextResponse } from 'next/server';

import { noContent, parseJsonBody, resolveRouteProjectId, toErrorResponse } from '../../../_server/http.ts';
import { updateProjectSettings } from '../../../_server/store.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    projectId: string;
  };
}

interface UpdateProjectSettingsRequest {
  ui_state?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
}

export async function PATCH(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const projectId = resolveRouteProjectId(request, (await context.params).projectId);
    const payload = await parseJsonBody<UpdateProjectSettingsRequest>(request);
    await updateProjectSettings(projectId, payload);
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
