import { NextResponse } from 'next/server';

import { listLocalModels } from '../../_server/assets.ts';
import { ok, toErrorResponse, withRequestTimeout } from '../../_server/http.ts';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request): Promise<NextResponse> {
  try {
    return ok(await withRequestTimeout(() => listLocalModels(), { timeoutMs: 10_000 }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
