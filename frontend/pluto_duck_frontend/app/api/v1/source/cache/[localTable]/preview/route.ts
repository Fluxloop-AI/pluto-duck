import { NextResponse } from 'next/server';

import { previewCachedTable } from '../../../../_server/source.ts';
import { ok, requireRouteParam, resolveProjectScope, toErrorResponse } from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    localTable: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const localTable = requireRouteParam((await context.params).localTable, 'local_table');
    const scope = resolveProjectScope(request);
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get('limit') ?? '100');
    return ok(await previewCachedTable(localTable, scope.project_id, limitRaw));
  } catch (error) {
    return toErrorResponse(error);
  }
}
