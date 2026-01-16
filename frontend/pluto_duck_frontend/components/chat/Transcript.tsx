'use client';

import { CheckIcon, XIcon } from 'lucide-react';
import { Response } from '../ai-elements/response';
import { Reasoning, ReasoningTrigger, ReasoningContent } from '../ai-elements/reasoning';
import type { ToolUIApproval, ToolUIState } from '../ai-elements/tool-types';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '../ai-elements/tool';
import {
  Plan,
  PlanHeader,
  PlanTitle,
  PlanAction,
  PlanTrigger,
  PlanContent,
} from '../ai-elements/plan';
import {
  TaskItem,
} from '../ai-elements/task';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
} from '../ai-elements/confirmation';
import type { AgentEventAny } from '../../types/agent';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: any;
  created_at: string;
}

interface TranscriptProps {
  messages: Message[];
  events: AgentEventAny[];
}

export function Transcript({ messages, events }: TranscriptProps) {
  const reasoningEvents = events.filter(event => event.type === 'reasoning');
  const hasActiveReasoning = reasoningEvents.some(event => event.subtype === 'chunk' || event.subtype === 'start');

  return (
    <div className="flex-1 space-y-4 overflow-y-auto">
      {messages.map(message => (
        <article
          key={message.id}
          className={`rounded-lg border p-4 text-sm shadow-sm ${
            message.role === 'user'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-50'
              : 'border-slate-800 bg-slate-900/70 text-slate-100'
          }`}
        >
          <header className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span>{message.role}</span>
            <time className="font-normal">{new Date(message.created_at).toLocaleTimeString()}</time>
          </header>
          <MessageContent content={message.content} />
        </article>
      ))}

      {reasoningEvents.length > 0 && (
        <Reasoning isStreaming={hasActiveReasoning} defaultOpen={true}>
          <ReasoningTrigger />
          <ReasoningContent>
            {reasoningEvents
              .map(event => {
                const content = event.content as any;
                return content && typeof content === 'object' && content.reason ? String(content.reason) : '';
              })
              .join('\n')}
          </ReasoningContent>
        </Reasoning>
      )}

      {events
        .filter(event => event.type === 'tool' || event.type === 'message' || event.type === 'plan')
        .map((event, index) => {
          // Handle tool events
          if (event.type === 'tool') {
            const toolState = getToolState(event);
            const toolInput = getToolInput(event);
            const toolOutput = getToolOutput(event);
            const errorText = getToolError(event);
            const approval = getToolApproval(event);

            return (
              <Tool key={`tool-${event.timestamp}-${index}`} defaultOpen>
                <ToolHeader
                  state={toolState}
                  toolName={getToolName(event)}
                />
                <ToolContent>
                  {toolInput && <ToolInput input={toolInput} />}
                  
                  {/* Approval workflow */}
                  <Confirmation approval={approval} state={toolState}>
                    <ConfirmationTitle>
                      <ConfirmationRequest>
                        This tool requires your approval to execute.
                      </ConfirmationRequest>
                      <ConfirmationAccepted>
                        <CheckIcon className="size-4 text-green-600 dark:text-green-400" />
                        <span>Approved</span>
                      </ConfirmationAccepted>
                      <ConfirmationRejected>
                        <XIcon className="size-4 text-destructive" />
                        <span>
                          Rejected
                          {approval?.reason && `: ${approval.reason}`}
                        </span>
                      </ConfirmationRejected>
                    </ConfirmationTitle>
                    <ConfirmationActions>
                      <ConfirmationAction
                        onClick={() => {
                          // TODO: Implement approval rejection
                          console.log('Tool rejected');
                        }}
                        variant="outline"
                      >
                        Reject
                      </ConfirmationAction>
                      <ConfirmationAction
                        onClick={() => {
                          // TODO: Implement approval acceptance
                          console.log('Tool approved');
                        }}
                        variant="default"
                      >
                        Approve
                      </ConfirmationAction>
                    </ConfirmationActions>
                  </Confirmation>

                  {(toolOutput || errorText) && (
                    <ToolOutput output={toolOutput} errorText={errorText} />
                  )}
                </ToolContent>
              </Tool>
            );
          }

          // Handle plan events
          if (event.type === 'plan') {
            const planData = getPlanData(event);
            const isStreaming = event.subtype === 'start' || event.subtype === 'chunk';

            return (
              <Plan key={`plan-${event.timestamp}-${index}`} defaultOpen isStreaming={isStreaming}>
                <PlanHeader>
                  <div className="flex-1">
                    <PlanTitle>{planData.title}</PlanTitle>
                    {planData.description && (
                      <p className="text-sm text-muted-foreground mt-1">{planData.description}</p>
                    )}
                  </div>
                  <PlanAction>
                    <PlanTrigger />
                  </PlanAction>
                </PlanHeader>
                <PlanContent>
                  <div className="space-y-2">
                    {planData.tasks.map((taskText, taskIndex) => (
                      <TaskItem key={taskIndex}>
                        {taskIndex + 1}. {taskText}
                      </TaskItem>
                    ))}
                  </div>
                </PlanContent>
              </Plan>
            );
          }

          // Fallback for other events (message, etc.)
          return (
            <article
              key={`${event.type}-${event.timestamp}-${index}`}
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-slate-300"
            >
              <header className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                <span>
                  {event.type}.{event.subtype}
                </span>
                {event.timestamp && <time className="font-normal text-slate-500">{new Date(event.timestamp).toLocaleTimeString()}</time>}
              </header>
              <ToolContentFallback content={event.content} />
            </article>
          );
        })}
    </div>
  );
}

function MessageContent({ content }: { content: any }) {
  if (content == null) {
    return <p className="text-slate-500">(empty)</p>;
  }

  if (typeof content === 'string') {
    return <Response>{content}</Response>;
  }

  if (content.text && typeof content.text === 'string') {
    return <Response>{content.text}</Response>;
  }

  return (
    <pre className="overflow-x-auto rounded bg-slate-950/90 p-2 text-[11px] text-slate-200">
      <code>{JSON.stringify(content, null, 2)}</code>
    </pre>
  );
}

function getToolState(event: any): ToolUIState {
  const subtype = event.subtype;
  if (subtype === 'start' || subtype === 'chunk') return 'input-streaming';
  if (subtype === 'error') return 'output-error';
  if (subtype === 'end' || subtype === 'final') return 'output-available';
  return 'input-available';
}

function getToolName(event: any): string {
  const content = event.content;
  if (content && typeof content === 'object') {
    if (content.tool_name) return content.tool_name;
    if (content.name) return content.name;
  }
  return 'unknown';
}

function getToolInput(event: any): Record<string, any> | undefined {
  const content = event.content;
  if (content && typeof content === 'object') {
    if (content.input) return content.input;
    if (content.parameters) return content.parameters;
    if (content.args) return content.args;
  }
  return undefined;
}

function getToolOutput(event: any): any {
  const content = event.content;
  if (content && typeof content === 'object') {
    if (content.output !== undefined) return content.output;
    if (content.result !== undefined) return content.result;
  }
  return undefined;
}

function getToolError(event: any): string | undefined {
  const content = event.content;
  if (event.subtype === 'error') {
    if (typeof content === 'string') return content;
    if (content && typeof content === 'object') {
      if (content.error) return String(content.error);
      if (content.message) return String(content.message);
    }
    return 'An error occurred';
  }
  return undefined;
}

function getPlanData(event: any): { title: string; description?: string; tasks: string[] } {
  const content = event.content;
  if (!content || typeof content !== 'object') {
    return { title: 'Plan', tasks: [] };
  }
  
  const tasks = content.tasks || content.steps || [];
  const taskArray = Array.isArray(tasks) ? tasks : [];
  
  return {
    title: content.title || content.name || 'Plan',
    description: content.description || content.summary,
    tasks: taskArray.map((task: any) => 
      task.title || task.name || task.description || String(task)
    ),
  };
}

function getToolApproval(event: any): ToolUIApproval {
  const content = event.content;
  if (content && typeof content === 'object') {
    if (content.approval) return content.approval;
    // Check if approval is in metadata
    if (event.metadata?.approval) return event.metadata.approval;
  }
  return undefined;
}

function ToolContentFallback({ content }: { content: any }) {
  if (content == null) {
    return <p className="text-slate-500">(empty)</p>;
  }

  if (typeof content === 'string') {
    return <p className="whitespace-pre-wrap font-mono text-[11px]">{content}</p>;
  }

  return (
    <pre className="overflow-x-auto rounded bg-slate-950/90 p-2 text-[11px] text-emerald-200">
      <code>{JSON.stringify(content, null, 2)}</code>
    </pre>
  );
}
