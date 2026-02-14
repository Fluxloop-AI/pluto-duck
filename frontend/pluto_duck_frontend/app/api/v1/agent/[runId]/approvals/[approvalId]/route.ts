import { NextResponse } from 'next/server';

import { getRunApproval } from '../../../../_server/agentRuntime.ts';
import { ok, requireRouteParam, resolveProjectScope, toErrorResponse } from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    runId: string;
    approvalId: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const runId = requireRouteParam((await context.params).runId, 'Run id');
    const approvalId = requireRouteParam((await context.params).approvalId, 'Approval id');
    const scope = resolveProjectScope(request);
    return ok(await getRunApproval(runId, approvalId, scope.project_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
