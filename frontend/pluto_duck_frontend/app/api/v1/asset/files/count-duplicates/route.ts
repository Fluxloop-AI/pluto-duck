import { NextResponse } from 'next/server';

import { countDuplicateRowsAcrossFiles } from '../../../_server/assets.ts';
import { ok, parseJsonBody, toErrorResponse, withRequestTimeout } from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface CountDuplicatesRequest {
  files: Array<{
    file_path: string;
    file_type: 'csv' | 'parquet';
  }>;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = await parseJsonBody<CountDuplicatesRequest>(request, {
      maxBytes: 256 * 1024,
      timeoutMs: 10_000,
    });
    return ok(
      await withRequestTimeout(() => countDuplicateRowsAcrossFiles(payload.files), {
        timeoutMs: 45_000,
        detail: 'Duplicate counting timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
