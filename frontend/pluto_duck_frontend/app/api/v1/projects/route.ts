import { NextResponse } from 'next/server';

import { created, ok, parseJsonBody, resolveProjectScope, toErrorResponse } from '../_server/http.ts';
import { createProject, listProjects } from '../_server/store.ts';

export const dynamic = 'force-dynamic';

interface CreateProjectRequest {
  name: string;
  description?: string | null;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    resolveProjectScope(request);
    return ok(await listProjects());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    resolveProjectScope(request);
    const payload = await parseJsonBody<CreateProjectRequest>(request);
    return created(await createProject(payload));
  } catch (error) {
    return toErrorResponse(error);
  }
}
