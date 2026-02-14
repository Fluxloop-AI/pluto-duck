import { NextResponse } from 'next/server';

import { downloadBoardAsset } from '../../../../_server/boards.ts';
import {
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    assetId: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const assetId = requireRouteParam((await context.params).assetId, 'Asset id');
    const scope = resolveProjectScope(request);
    const downloaded = await downloadBoardAsset(assetId, scope.project_id);
    return new NextResponse(downloaded.content, {
      status: 200,
      headers: {
        'Content-Type': downloaded.mime_type,
        'Content-Disposition': `attachment; filename="${downloaded.filename.replaceAll('"', '')}"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
