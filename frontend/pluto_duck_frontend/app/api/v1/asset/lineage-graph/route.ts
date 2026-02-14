import { NextResponse } from 'next/server';

import { getLineageGraph } from '../../_server/assets.ts';
import { ok, resolveProjectScope, toErrorResponse, withRequestTimeout } from '../../_server/http.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    return ok(
      await withRequestTimeout(() => getLineageGraph(scope.project_id), {
        timeoutMs: 20_000,
        detail: 'Lineage graph query timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
