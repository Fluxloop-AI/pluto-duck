import { NextResponse } from 'next/server';

import { listFolderFilesForSource } from '../../../../_server/source.ts';
import { ok, requireRouteParam, resolveProjectScope, toErrorResponse } from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    folderId: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const folderId = requireRouteParam(context.params.folderId, 'folder_id');
    const scope = resolveProjectScope(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? '500');
    return ok(await listFolderFilesForSource(folderId, scope.project_id, limit));
  } catch (error) {
    return toErrorResponse(error);
  }
}
