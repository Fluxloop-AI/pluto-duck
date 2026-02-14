import { NextResponse } from 'next/server';

import { loadLocalModel } from '../../../_server/assets.ts';
import { noContent, parseJsonBody, toErrorResponse, withRequestTimeout } from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface LoadRequest {
  model_id: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = await parseJsonBody<LoadRequest>(request, {
      maxBytes: 8 * 1024,
      timeoutMs: 10_000,
    });
    await withRequestTimeout(() => loadLocalModel(payload.model_id), {
      timeoutMs: 10_000,
      detail: 'Local model load timed out',
    });
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
