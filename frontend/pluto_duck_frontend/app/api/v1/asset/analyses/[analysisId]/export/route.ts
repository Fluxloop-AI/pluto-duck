import { NextResponse } from 'next/server';

import { exportAnalysisCsv } from '../../../../_server/assets.ts';
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

interface ExportRequest {
  file_path: string;
  force?: boolean;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const analysisId = requireRouteParam(context.params.analysisId, 'analysis_id');
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<ExportRequest>(request, {
      maxBytes: 16 * 1024,
      timeoutMs: 10_000,
    });
    return ok(
      await withRequestTimeout(() => exportAnalysisCsv(analysisId, payload, scope.project_id), {
        timeoutMs: 60_000,
        detail: 'CSV export timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
