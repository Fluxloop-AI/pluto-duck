'use client';

import { memo, useMemo } from 'react';
import { CheckIcon, Clock3Icon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApprovalItem } from '../../../types/chatRenderItem';
import {
  dispatchApprovalDecision,
  resolveApprovalBadgeClass,
  resolveApprovalSummary,
  type ApprovalAction,
} from './approvalRenderModel';

export interface ApprovalRendererProps {
  item: ApprovalItem;
  onDecision?: (approvalEventId: string, runId: string | null, decision: ApprovalAction) => void;
}

export const ApprovalRenderer = memo(function ApprovalRenderer({
  item,
  onDecision,
}: ApprovalRendererProps) {
  const summary = useMemo(() => resolveApprovalSummary(item.content), [item.content]);
  const isPending = item.decision === 'pending';

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Approval</span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
            resolveApprovalBadgeClass(item.decision),
          )}
        >
          {item.decision === 'approved' && <CheckIcon className="size-3" />}
          {item.decision === 'rejected' && <XIcon className="size-3" />}
          {item.decision === 'pending' && <Clock3Icon className="size-3" />}
          {item.decision}
        </span>
      </div>

      <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{summary}</p>

      {isPending && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
            onClick={() => dispatchApprovalDecision(onDecision, item.id, item.runId, 'rejected')}
          >
            Reject
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90"
            onClick={() => dispatchApprovalDecision(onDecision, item.id, item.runId, 'approved')}
          >
            Approve
          </button>
        </div>
      )}
    </div>
  );
});
