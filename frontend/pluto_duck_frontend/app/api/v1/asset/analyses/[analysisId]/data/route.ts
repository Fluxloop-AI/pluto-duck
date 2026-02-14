import { NextResponse } from 'next/server';

import { getAnalysisData } from '../../../../_server/assets.ts';
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
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? '1000');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    return ok(
      await withRequestTimeout(() => getAnalysisData(analysisId, { limit, offset }, scope.project_id), {
        timeoutMs: 15_000,
        detail: 'Analysis data query timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
