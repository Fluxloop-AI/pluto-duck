import type { TimelineIntent, TimelineLane } from '../types/chatTimelineItem';

interface ClassificationContentRecord {
  [key: string]: unknown;
}

export interface TimelineEventClassificationInput {
  type: string;
  subtype?: string;
  content: unknown;
}

export interface TimelineEventClassificationMeta {
  eventId?: string;
  sequence?: number;
  runId?: string | null;
  toolCallId?: string | null;
  parentEventId?: string | null;
  phase?: string;
}

export interface TimelineEventClassification {
  intent: TimelineIntent;
  lane: TimelineLane;
  approvalId?: string;
  approvalDecision?: 'pending' | 'approved' | 'rejected';
  hasApprovalSignal: boolean;
}

function isRecord(value: unknown): value is ClassificationContentRecord {
  return value !== null && typeof value === 'object';
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveApprovalDecision(value: unknown): TimelineEventClassification['approvalDecision'] {
  const decision = toOptionalString(value);
  if (!decision) return undefined;
  if (decision === 'approve' || decision === 'approved' || decision === 'edit' || decision === 'edited') {
    return 'approved';
  }
  if (decision === 'reject' || decision === 'rejected') {
    return 'rejected';
  }
  if (decision === 'pending') {
    return 'pending';
  }
  return undefined;
}

function classifyToolEvent(content: ClassificationContentRecord): TimelineEventClassification {
  const approvalRequired = content.approval_required === true;
  const approvalId = toOptionalString(content.approval_id);
  const approvalDecision = resolveApprovalDecision(content.decision);
  const hasApprovalSignal = approvalRequired || Boolean(approvalId) || approvalDecision !== undefined;

  if (hasApprovalSignal) {
    return {
      intent: 'approval-control',
      lane: 'control',
      approvalId,
      approvalDecision,
      hasApprovalSignal: true,
    };
  }

  return {
    intent: 'execution',
    lane: 'tool',
    hasApprovalSignal: false,
  };
}

export function classifyTimelineEvent(
  event: TimelineEventClassificationInput,
  _meta?: TimelineEventClassificationMeta,
): TimelineEventClassification {
  if (event.type === 'tool') {
    const content = isRecord(event.content) ? event.content : {};
    return classifyToolEvent(content);
  }
  if (event.type === 'reasoning') {
    return {
      intent: 'reasoning',
      lane: 'reasoning',
      hasApprovalSignal: false,
    };
  }
  if (event.type === 'message') {
    return {
      intent: 'message',
      lane: 'assistant',
      hasApprovalSignal: false,
    };
  }
  if (event.type === 'plan') {
    const content = isRecord(event.content) ? event.content : {};
    return {
      intent: 'approval-control',
      lane: 'control',
      approvalId: toOptionalString(content.approval_id),
      approvalDecision: resolveApprovalDecision(content.decision),
      hasApprovalSignal: true,
    };
  }
  return {
    intent: 'unknown-control',
    lane: 'control',
    hasApprovalSignal: false,
  };
}
