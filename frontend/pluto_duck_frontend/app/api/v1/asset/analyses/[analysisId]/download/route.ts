import { NextResponse } from 'next/server';

import { downloadAnalysisCsv } from '../../../../_server/assets.ts';
import {
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
    const analysisId = requireRouteParam((await context.params).analysisId, 'analysis_id');
    const scope = resolveProjectScope(request);
    const url = new URL(request.url);
    const force = (url.searchParams.get('force') ?? 'false').toLowerCase() === 'true';

    const downloaded = await withRequestTimeout(
      () => downloadAnalysisCsv(analysisId, { force }, scope.project_id),
      {
        timeoutMs: 60_000,
        detail: 'CSV download preparation timed out',
      }
    );

    return new NextResponse(downloaded.content, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${downloaded.filename}"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
