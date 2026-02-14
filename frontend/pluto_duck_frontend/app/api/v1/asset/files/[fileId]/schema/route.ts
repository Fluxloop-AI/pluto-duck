import { NextResponse } from 'next/server';

import { getFileSchema } from '../../../../_server/assets.ts';
import { ok, requireRouteParam, resolveProjectScope, toErrorResponse } from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    fileId: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const fileId = requireRouteParam((await context.params).fileId, 'file_id');
    const scope = resolveProjectScope(request);
    return ok(await getFileSchema(fileId, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
