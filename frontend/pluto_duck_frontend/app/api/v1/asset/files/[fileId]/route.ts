import { NextResponse } from 'next/server';

import { deleteFileAsset, getFileAsset } from '../../../_server/assets.ts';
import {
  noContent,
  ok,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
  withRequestTimeout,
} from '../../../_server/http.ts';

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
    return ok(await withRequestTimeout(() => getFileAsset(fileId, scope.project_id), { timeoutMs: 10_000 }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const fileId = requireRouteParam((await context.params).fileId, 'file_id');
    const scope = resolveProjectScope(request);
    const url = new URL(request.url);
    const dropTable = (url.searchParams.get('drop_table') ?? 'true').toLowerCase() !== 'false';
    await withRequestTimeout(() => deleteFileAsset(fileId, { drop_table: dropTable }, scope.project_id), {
      timeoutMs: 30_000,
      detail: 'File delete timed out',
    });
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
