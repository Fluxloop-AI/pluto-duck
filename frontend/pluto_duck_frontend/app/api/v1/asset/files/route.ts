import { NextResponse } from 'next/server';

import { importFileAsset, listFileAssets } from '../../_server/assets.ts';
import {
  created,
  ok,
  parseJsonBody,
  resolveProjectScope,
  toErrorResponse,
  withRequestTimeout,
} from '../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface ImportFileRequest {
  file_path: string;
  file_type: 'csv' | 'parquet';
  table_name: string;
  name?: string;
  description?: string;
  overwrite?: boolean;
  mode?: 'replace' | 'append' | 'merge';
  target_table?: string;
  merge_keys?: string[];
  deduplicate?: boolean;
  diagnosis_id?: string;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    return ok(await withRequestTimeout(() => listFileAssets(scope.project_id), { timeoutMs: 10_000 }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<ImportFileRequest>(request, {
      maxBytes: 256 * 1024,
      timeoutMs: 10_000,
    });
    return created(
      await withRequestTimeout(() => importFileAsset(payload, scope.project_id), {
        timeoutMs: 60_000,
        detail: 'File import timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
