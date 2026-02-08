export type TimelineItemType = 'reasoning' | 'tool' | 'assistant-message' | 'user-message' | 'approval';

export type TimelineItemStatus = 'pending' | 'streaming' | 'complete' | 'error';

export type TimelineIntent = 'execution' | 'approval-control' | 'reasoning' | 'message' | 'unknown-control';

export type TimelineLane = 'user' | 'reasoning' | 'tool' | 'assistant' | 'control';

export interface TimelineItemBase {
  id: string;
  type: TimelineItemType;
  runId: string | null;
  sequence: number | null;
  displayOrder?: number;
  timestamp: string;
  status: TimelineItemStatus;
  isStreaming: boolean;
  isPartial: boolean;
  eventId?: string;
  parentEventId?: string | null;
  intent?: TimelineIntent;
  lane?: TimelineLane;
}

export interface ReasoningTimelineItem extends TimelineItemBase {
  type: 'reasoning';
  // Legacy rows without segmentation metadata should be treated as order 0.
  segmentId: string;
  segmentOrder: number;
  content: string;
  phase?: string;
}

export interface ToolTimelineItem extends TimelineItemBase {
  type: 'tool';
  toolName: string;
  toolCallId?: string | null;
  state: 'pending' | 'completed' | 'error';
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface AssistantMessageTimelineItem extends TimelineItemBase {
  type: 'assistant-message';
  content: string;
  messageId?: string;
}

export interface UserMessageTimelineItem extends TimelineItemBase {
  type: 'user-message';
  content: string;
  messageId: string;
  mentions?: string[];
}

export interface ApprovalTimelineItem extends TimelineItemBase {
  type: 'approval';
  content: string;
  decision?: 'pending' | 'approved' | 'rejected';
}

export type TimelineItem =
  | ReasoningTimelineItem
  | ToolTimelineItem
  | AssistantMessageTimelineItem
  | UserMessageTimelineItem
  | ApprovalTimelineItem;
