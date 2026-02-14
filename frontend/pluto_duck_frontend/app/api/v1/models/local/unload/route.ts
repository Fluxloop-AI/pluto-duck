import { NextResponse } from 'next/server';

import { unloadLocalModel } from '../../../_server/assets.ts';
import { noContent, toErrorResponse, withRequestTimeout } from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request): Promise<NextResponse> {
  try {
    await withRequestTimeout(() => unloadLocalModel(), {
      timeoutMs: 10_000,
      detail: 'Local model unload timed out',
    });
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
