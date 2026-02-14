import { NextResponse } from 'next/server';

import { createSourceConnection, listSources } from '../_server/source.ts';
import { created, ok, parseJsonBody, resolveProjectScope, toErrorResponse } from '../_server/http.ts';

export const dynamic = 'force-dynamic';

interface CreateSourceRequest {
  name: string;
  source_type: string;
  source_config: Record<string, unknown>;
  description?: string | null;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    return ok(await listSources(scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<CreateSourceRequest>(request);
    return created(await createSourceConnection(payload, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
