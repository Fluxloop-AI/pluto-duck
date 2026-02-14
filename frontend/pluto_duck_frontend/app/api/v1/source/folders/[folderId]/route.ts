import { NextResponse } from 'next/server';

import { deleteFolderSourceRecord } from '../../../_server/source.ts';
import {
  noContent,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    folderId: string;
  };
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const folderId = requireRouteParam(context.params.folderId, 'folder_id');
    const scope = resolveProjectScope(request);
    await deleteFolderSourceRecord(folderId, scope.project_id);
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
