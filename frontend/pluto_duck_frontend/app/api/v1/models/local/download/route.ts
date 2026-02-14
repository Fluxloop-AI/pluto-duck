import { NextResponse } from 'next/server';

import { requestLocalModelDownload } from '../../../_server/assets.ts';
import { ok, parseJsonBody, toErrorResponse, withRequestTimeout } from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface DownloadRequest {
  repo_id: string;
  filename: string;
  model_id?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = await parseJsonBody<DownloadRequest>(request, {
      maxBytes: 16 * 1024,
      timeoutMs: 10_000,
    });
    return ok(
      await withRequestTimeout(() => requestLocalModelDownload(payload), {
        timeoutMs: 15_000,
        detail: 'Local model download request timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
