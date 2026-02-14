import { NextResponse } from 'next/server';

import { deleteAnalysis, getAnalysis, updateAnalysis } from '../../../_server/assets.ts';
import {
  noContent,
  ok,
  parseJsonBody,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
  withRequestTimeout,
} from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    analysisId: string;
  };
}

interface UpdateAnalysisRequest {
  sql?: string;
  name?: string;
  description?: string | null;
  materialization?: 'view' | 'table' | 'append' | 'parquet';
  parameters?: Array<Record<string, unknown>>;
  tags?: string[];
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const analysisId = requireRouteParam((await context.params).analysisId, 'analysis_id');
    const scope = resolveProjectScope(request);
    return ok(await withRequestTimeout(() => getAnalysis(analysisId, scope.project_id), { timeoutMs: 10_000 }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const analysisId = requireRouteParam((await context.params).analysisId, 'analysis_id');
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<UpdateAnalysisRequest>(request, {
      maxBytes: 256 * 1024,
      timeoutMs: 10_000,
    });
    return ok(
      await withRequestTimeout(() => updateAnalysis(analysisId, payload, scope.project_id), {
        timeoutMs: 30_000,
        detail: 'Analysis update timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const analysisId = requireRouteParam((await context.params).analysisId, 'analysis_id');
    const scope = resolveProjectScope(request);
    await withRequestTimeout(() => deleteAnalysis(analysisId, scope.project_id), {
      timeoutMs: 30_000,
      detail: 'Analysis delete timed out',
    });
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
