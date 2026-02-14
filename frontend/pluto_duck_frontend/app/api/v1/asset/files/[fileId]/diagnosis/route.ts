import { NextResponse } from 'next/server';

import { getFileDiagnosis } from '../../../../_server/assets.ts';
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
    const fileId = requireRouteParam(context.params.fileId, 'file_id');
    const scope = resolveProjectScope(request);
    const url = new URL(request.url);
    const useCache = (url.searchParams.get('use_cache') ?? 'true').toLowerCase() !== 'false';
    return ok(
      await withRequestTimeout(() => getFileDiagnosis(fileId, { use_cache: useCache }, scope.project_id), {
        timeoutMs: useCache ? 10_000 : 30_000,
        detail: 'Diagnosis lookup timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
