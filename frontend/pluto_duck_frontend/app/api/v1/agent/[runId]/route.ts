import { NextResponse } from 'next/server';

import { cancelAgentRun, getRunResult } from '../../_server/agentRuntime.ts';
import { ok, requireRouteParam, resolveProjectScope, toErrorResponse } from '../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    runId: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const runId = requireRouteParam((await context.params).runId, 'Run id');
    const scope = resolveProjectScope(request);
    return ok(await getRunResult(runId, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const runId = requireRouteParam((await context.params).runId, 'Run id');
    const scope = resolveProjectScope(request);
    const url = new URL(request.url);
    const reason = url.searchParams.get('reason');
    return ok(
      await cancelAgentRun({
        run_id: runId,
        reason,
        scope_project_id: scope.project_id,
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
