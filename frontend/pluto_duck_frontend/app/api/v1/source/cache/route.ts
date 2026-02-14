import { NextResponse } from 'next/server';

import { cacheSourceTable, listCachedTables } from '../../_server/source.ts';
import { created, ok, parseJsonBody, resolveProjectScope, toErrorResponse } from '../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface CacheTableRequest {
  source_name: string;
  table_name: string;
  local_name?: string;
  filter_sql?: string;
  expires_hours?: number;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    const url = new URL(request.url);
    const sourceName = (url.searchParams.get('source_name') ?? '').trim() || null;
    return ok(await listCachedTables(scope.project_id, sourceName));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<CacheTableRequest>(request);
    return created(await cacheSourceTable(payload, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
