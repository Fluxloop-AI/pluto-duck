import { NextResponse } from 'next/server';

import { applyApprovalDecision } from '../../../../../_server/agentRuntime.ts';
import {
  ok,
  parseJsonBody,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../../../../_server/http.ts';
import { StoreHttpError } from '../../../../../_server/store.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    runId: string;
    approvalId: string;
  };
}

interface ApprovalDecisionRequest {
  decision: 'approve' | 'reject' | 'edit';
  edited_args?: Record<string, unknown>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const runId = requireRouteParam((await context.params).runId, 'Run id');
    const approvalId = requireRouteParam((await context.params).approvalId, 'Approval id');
    const scope = resolveProjectScope(request);
    const payload = await parseJsonBody<ApprovalDecisionRequest>(request);
    if (payload.decision !== 'approve' && payload.decision !== 'reject' && payload.decision !== 'edit') {
      throw new StoreHttpError(400, 'decision must be approve|reject|edit');
    }

    await applyApprovalDecision({
      run_id: runId,
      approval_id: approvalId,
      decision: payload.decision,
      edited_args: payload.edited_args ?? null,
      scope_project_id: scope.project_id,
    });

    return ok({
      status: 'accepted',
      approval_id: approvalId,
      run_id: runId,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
