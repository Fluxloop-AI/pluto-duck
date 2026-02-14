import { NextResponse } from 'next/server';

import { scanFolderSourceFiles } from '../../../../_server/source.ts';
import { ok, requireRouteParam, resolveProjectScope, toErrorResponse } from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    folderId: string;
  };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const folderId = requireRouteParam(context.params.folderId, 'folder_id');
    const scope = resolveProjectScope(request);
    return ok(await scanFolderSourceFiles(folderId, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
