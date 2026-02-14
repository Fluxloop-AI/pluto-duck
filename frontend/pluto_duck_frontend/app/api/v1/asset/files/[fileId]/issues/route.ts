import { NextResponse } from 'next/server';

import { listDiagnosisIssues } from '../../../../_server/assets.ts';
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
    fileId: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const fileId = requireRouteParam((await context.params).fileId, 'file_id');
    const scope = resolveProjectScope(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const includeDeleted = (url.searchParams.get('include_deleted') ?? 'false').toLowerCase() === 'true';

    return ok(await withRequestTimeout(
      () =>
        listDiagnosisIssues(
          fileId,
          {
            status,
            include_deleted: includeDeleted,
          },
          scope.project_id
        ),
      { timeoutMs: 10_000 }
    ));
  } catch (error) {
    return toErrorResponse(error);
  }
}
