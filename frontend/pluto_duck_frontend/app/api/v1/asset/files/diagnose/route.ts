import { NextResponse } from 'next/server';

import { diagnoseFiles } from '../../../_server/assets.ts';
import {
  ok,
  parseJsonBody,
  resolveProjectScope,
  toErrorResponse,
  withRequestTimeout,
} from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface DiagnoseRequest {
  files: Array<{
    file_path: string;
    file_type: 'csv' | 'parquet';
  }>;
  use_cache?: boolean;
  include_llm?: boolean;
  llm_mode?: 'sync' | 'defer' | 'cache_only';
  language?: 'en' | 'ko';
  include_merge_analysis?: boolean;
  merge_context?: {
    total_rows: number;
    duplicate_rows: number;
    estimated_rows: number;
    skipped: boolean;
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<DiagnoseRequest>(request, {
      maxBytes: 512 * 1024,
      timeoutMs: 10_000,
    });
    return ok(
      await withRequestTimeout(() => diagnoseFiles(payload, scope.project_id), {
        timeoutMs: 45_000,
        detail: 'File diagnosis timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
