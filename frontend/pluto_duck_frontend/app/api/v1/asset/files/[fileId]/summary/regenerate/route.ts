import { NextResponse } from 'next/server';

import { regenerateSummary } from '../../../../../_server/assets.ts';
import {
  ok,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
  withRequestTimeout,
} from '../../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    fileId: string;
  };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const fileId = requireRouteParam(context.params.fileId, 'file_id');
    const scope = resolveProjectScope(request);
    return ok(
      await withRequestTimeout(() => regenerateSummary(fileId, scope.project_id), {
        timeoutMs: 30_000,
        detail: 'Summary regeneration timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
