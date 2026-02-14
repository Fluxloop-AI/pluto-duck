import { NextResponse } from 'next/server';

import { ok, parseJsonBody, resolveProjectScope, toErrorResponse } from '../_server/http.ts';
import { getSettings, updateSettings, type UpdateSettingsPayload } from '../_server/store.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    resolveProjectScope(request);
    return ok(await getSettings());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    resolveProjectScope(request);
    const payload = await parseJsonBody<UpdateSettingsPayload>(request);
    return ok(await updateSettings(payload));
  } catch (error) {
    return toErrorResponse(error);
  }
}
