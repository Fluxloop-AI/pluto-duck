import { NextResponse } from 'next/server';

import { createFolderSourceRecord, listFolderSources } from '../../_server/source.ts';
import { created, ok, parseJsonBody, resolveProjectScope, toErrorResponse } from '../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface CreateFolderSourceRequest {
  name: string;
  path: string;
  allowed_types?: string;
  pattern?: string | null;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    return ok(await listFolderSources(scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<CreateFolderSourceRequest>(request);
    return created(await createFolderSourceRecord(payload, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
