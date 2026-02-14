import { NextResponse } from 'next/server';

import { compileAnalysis } from '../../../../_server/assets.ts';
import {
  ok,
  parseJsonBody,
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

interface CompileRequest {
  params?: Record<string, unknown>;
  force?: boolean;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const analysisId = requireRouteParam((await context.params).analysisId, 'analysis_id');
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<CompileRequest>(request, {
      maxBytes: 64 * 1024,
      timeoutMs: 10_000,
    });
    return ok(
      await withRequestTimeout(() => compileAnalysis(analysisId, payload, scope.project_id), {
        timeoutMs: 15_000,
        detail: 'Analysis compile timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
