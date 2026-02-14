import { NextResponse } from 'next/server';

import { deleteDiagnosisIssue, updateDiagnosisIssue } from '../../../../_server/assets.ts';
import {
  ok,
  parseJsonBody,
  requireRouteParam,
  toErrorResponse,
  withRequestTimeout,
} from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    issueId: string;
  };
}

interface UpdateIssueRequest {
  status?: 'open' | 'confirmed' | 'dismissed' | 'resolved';
  user_response?: string;
  resolved_by?: string;
}

interface DeleteIssueRequest {
  deleted_by?: string;
  delete_reason?: string;
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const issueId = requireRouteParam(context.params.issueId, 'issue_id');
    const payload = await parseJsonBody<UpdateIssueRequest>(request, {
      maxBytes: 16 * 1024,
      timeoutMs: 10_000,
    });
    return ok(
      await withRequestTimeout(() => updateDiagnosisIssue(issueId, payload), {
        timeoutMs: 10_000,
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const issueId = requireRouteParam(context.params.issueId, 'issue_id');
    const payload = await parseJsonBody<DeleteIssueRequest>(request, {
      maxBytes: 16 * 1024,
      timeoutMs: 10_000,
    });
    return ok(
      await withRequestTimeout(() => deleteDiagnosisIssue(issueId, payload), {
        timeoutMs: 10_000,
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
