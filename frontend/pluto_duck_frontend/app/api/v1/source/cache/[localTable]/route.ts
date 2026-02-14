import { NextResponse } from 'next/server';

import { dropCachedTable, getCachedTable } from '../../../_server/source.ts';
import {
  noContent,
  ok,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    localTable: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const localTable = requireRouteParam(context.params.localTable, 'local_table');
    const scope = resolveProjectScope(request);
    return ok(await getCachedTable(localTable, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const localTable = requireRouteParam(context.params.localTable, 'local_table');
    const scope = resolveProjectScope(request);
    await dropCachedTable(localTable, scope.project_id);
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
