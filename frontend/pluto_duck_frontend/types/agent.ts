export type AgentEventType = 'reasoning' | 'tool' | 'message' | 'plan' | 'run';

export type AgentEventSubtype = 'start' | 'chunk' | 'end' | 'final' | 'error';

export interface AgentMessageChunkContent {
  text_delta: string;
  is_final?: boolean;
}

export interface AgentEvent {
  type: AgentEventType;
  subtype: AgentEventSubtype;
  content: unknown;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export type AgentConversationEvent = AgentEvent & {
  type: 'reasoning' | 'message';
};

export type AgentPlanEvent = AgentEvent & {
  type: 'plan';
};

export type AgentToolEvent = AgentEvent & {
  type: 'tool';
};

export type AgentRunEvent = AgentEvent & {
  type: 'run';
};

export type AgentEventAny = AgentConversationEvent | AgentPlanEvent | AgentToolEvent | AgentRunEvent;
