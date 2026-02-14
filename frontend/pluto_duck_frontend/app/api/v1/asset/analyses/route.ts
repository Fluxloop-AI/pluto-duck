import { NextResponse } from 'next/server';

import { createAnalysis, listAnalyses } from '../../_server/assets.ts';
import {
  created,
  ok,
  parseJsonBody,
  resolveProjectScope,
  toErrorResponse,
  withRequestTimeout,
} from '../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface CreateAnalysisRequest {
  sql: string;
  name: string;
  analysis_id?: string;
  description?: string | null;
  materialization?: 'view' | 'table' | 'append' | 'parquet';
  parameters?: Array<Record<string, unknown>>;
  tags?: string[];
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    const url = new URL(request.url);
    const tags = url.searchParams.getAll('tags').map((tag) => tag.trim()).filter(Boolean);
    return ok(
      await withRequestTimeout(() => listAnalyses(scope.project_id, tags.length > 0 ? tags : undefined), {
        timeoutMs: 10_000,
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<CreateAnalysisRequest>(request, {
      maxBytes: 256 * 1024,
      timeoutMs: 10_000,
    });
    return created(
      await withRequestTimeout(() => createAnalysis(payload, scope.project_id), {
        timeoutMs: 30_000,
        detail: 'Analysis creation timed out',
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
