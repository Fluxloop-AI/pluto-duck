import { NextResponse } from 'next/server';

import { deleteBoardAsset } from '../../../_server/boards.ts';
import {
  noContent,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    assetId: string;
  };
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const assetId = requireRouteParam(context.params.assetId, 'Asset id');
    const scope = resolveProjectScope(request);
    await deleteBoardAsset(assetId, scope.project_id);
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
