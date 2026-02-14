import { NextResponse } from 'next/server';

import { getFreshness } from '../../../../_server/assets.ts';
import {
  ok,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
  withRequestTimeout,
} from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    analysisId: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const analysisId = requireRouteParam(context.params.analysisId, 'analysis_id');
    const scope = resolveProjectScope(request);
    return ok(await withRequestTimeout(() => getFreshness(analysisId, scope.project_id), { timeoutMs: 10_000 }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
