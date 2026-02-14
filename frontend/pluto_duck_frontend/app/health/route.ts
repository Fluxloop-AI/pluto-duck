import { NextResponse } from 'next/server';

import { ok, toErrorResponse } from '../api/v1/_server/http.ts';
import { getStoreHealth } from '../api/v1/_server/store.ts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const db = await getStoreHealth();
    return ok({
      status: 'ok',
      runtime: 'node',
      db,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
