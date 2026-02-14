import { NextResponse } from 'next/server';

import { refreshCachedTable } from '../../../../_server/source.ts';
import { ok, requireRouteParam, resolveProjectScope, toErrorResponse } from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    localTable: string;
  };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const localTable = requireRouteParam((await context.params).localTable, 'local_table');
    const scope = resolveProjectScope(request);
    return ok(await refreshCachedTable(localTable, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
