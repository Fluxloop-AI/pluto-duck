import { NextResponse } from 'next/server';

import { estimateSourceTableSize } from '../../../../../_server/source.ts';
import { ok, requireRouteParam, resolveProjectScope, toErrorResponse } from '../../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    sourceName: string;
    tableName: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const sourceName = requireRouteParam(context.params.sourceName, 'Source name');
    const tableName = requireRouteParam(context.params.tableName, 'Table name');
    const scope = resolveProjectScope(request);
    return ok(await estimateSourceTableSize(sourceName, tableName, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
