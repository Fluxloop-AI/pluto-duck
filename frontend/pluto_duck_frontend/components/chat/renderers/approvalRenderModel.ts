import type { ApprovalItem } from '../../../types/chatRenderItem';

export type ApprovalAction = 'approved' | 'rejected';
export type ApprovalDecisionHandler = (
  approvalEventId: string,
  runId: string | null,
  decision: ApprovalAction,
) => void;

export function resolveApprovalSummary(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return 'Approval required before continuing.';
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const description = parsed.description;
    if (typeof description === 'string' && description.trim()) return description.trim();
    const reason = parsed.reason;
    if (typeof reason === 'string' && reason.trim()) return reason.trim();
    const message = parsed.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
    const tool = parsed.tool;
    if (typeof tool === 'string' && tool.trim()) return `${tool} requires approval.`;
  } catch {
    // Keep raw content as fallback.
  }
  return trimmed;
}

export function resolveApprovalBadgeClass(decision: ApprovalItem['decision']): string {
  if (decision === 'approved') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
  if (decision === 'rejected') return 'bg-destructive/10 text-destructive border-destructive/30';
  return 'bg-muted text-muted-foreground border-border';
}

export function dispatchApprovalDecision(
  onDecision: ApprovalDecisionHandler | undefined,
  approvalEventId: string,
  runId: string | null,
  decision: ApprovalAction,
): void {
  onDecision?.(approvalEventId, runId, decision);
}
