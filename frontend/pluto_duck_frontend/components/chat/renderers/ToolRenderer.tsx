'use client';

import { memo } from 'react';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '../../ai-elements/tool';
import {
  Queue,
  QueueList,
  QueueItem,
  QueueItemIndicator,
  QueueItemContent,
  type QueueTodo,
} from '../../ai-elements/queue';
import type { ToolItem } from '../../../types/chatRenderItem';

/**
 * Parse todos from write_todos tool output
 */
function parseTodosFromOutput(output: any): QueueTodo[] {
  if (!output) return [];

  let parsed = output;
  if (typeof output === 'string') {
    try {
      parsed = JSON.parse(output);
    } catch {
      return [];
    }
  }

  const todos = parsed.todos || parsed.items || parsed;
  if (!Array.isArray(todos)) return [];

  return todos.map((todo: any, index: number) => ({
    id: todo.id || String(index),
    title: todo.content || todo.title || todo.name || String(todo),
    description: todo.description,
    status: todo.status === 'completed' ? 'completed' : 'pending',
  }));
}

/**
 * Convert ToolItem state to ToolUIState
 */
function getToolUIState(state: ToolItem['state']): 'input-streaming' | 'output-available' | 'output-error' {
  if (state === 'pending') return 'input-streaming';
  if (state === 'error') return 'output-error';
  return 'output-available';
}

export interface ToolRendererProps {
  item: ToolItem;
}

export const ToolRenderer = memo(function ToolRenderer({
  item,
}: ToolRendererProps) {
  // Special handling for write_todos tool
  if (item.toolName === 'write_todos') {
    const todos = parseTodosFromOutput(item.output);
    const completedCount = todos.filter(t => t.status === 'completed').length;
    const isLoading = item.state === 'pending';

    return (
      <Queue>
        <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
          <span className="font-medium">
            {isLoading ? 'Updating todos...' : `Tasks (${completedCount}/${todos.length})`}
          </span>
        </div>
        {todos.length > 0 && (
          <QueueList>
            {todos.map((todo) => (
              <QueueItem key={todo.id} className="flex-row items-start gap-2">
                <QueueItemIndicator completed={todo.status === 'completed'} />
                <QueueItemContent completed={todo.status === 'completed'}>
                  {todo.title}
                </QueueItemContent>
              </QueueItem>
            ))}
          </QueueList>
        )}
        {item.error && (
          <div className="text-xs text-destructive px-1">{item.error}</div>
        )}
      </Queue>
    );
  }

  // Default tool rendering
  const toolState = getToolUIState(item.state);

  return (
    <Tool defaultOpen={false}>
      <ToolHeader
        state={toolState}
        type={`tool-${item.toolName}`}
        title={item.toolName}
      />
      <ToolContent>
        {item.input && <ToolInput input={item.input} />}
        {(item.output || item.error) && (
          <ToolOutput
            output={item.output ? JSON.stringify(item.output, null, 2) : undefined}
            errorText={item.error}
          />
        )}
      </ToolContent>
    </Tool>
  );
});
