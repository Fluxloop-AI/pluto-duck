import { NextResponse } from 'next/server';

import { previewFileAsset } from '../../../../_server/assets.ts';
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
    const limit = Number(url.searchParams.get('limit') ?? '100');
    return ok(
      await withRequestTimeout(() => previewFileAsset(fileId, { limit }, scope.project_id), {
        timeoutMs: 15_000,
        detail: 'Preview query timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
