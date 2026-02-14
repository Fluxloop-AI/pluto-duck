import { NextResponse } from 'next/server';

import { cleanupExpiredCachedTables } from '../../../_server/source.ts';
import { ok, resolveProjectScope, toErrorResponse } from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    return ok(await cleanupExpiredCachedTables(scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
