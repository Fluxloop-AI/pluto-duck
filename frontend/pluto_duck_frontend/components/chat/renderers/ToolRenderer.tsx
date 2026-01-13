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
 * Convert snake_case or camelCase to Title Case
 * e.g., read_file → Read File, executeCommand → Execute Command
 */
function formatToolName(name: string): string {
  if (!name) return 'Tool';

  // Handle snake_case and camelCase
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Extract key parameter from tool input for display
 * Returns shortened version for UI display
 */
function extractKeyParam(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;

  const obj = input as Record<string, unknown>;

  // Priority order for key parameters
  const keyFields = [
    'file_path', 'filePath', 'path',      // File operations
    'command', 'cmd',                      // Command execution
    'query', 'search', 'pattern',          // Search operations
    'url', 'uri',                          // Network operations
    'name', 'title',                       // General identifiers
  ];

  for (const field of keyFields) {
    const value = obj[field];
    if (typeof value === 'string' && value.trim()) {
      return shortenParam(value, field);
    }
  }

  return null;
}

/**
 * Shorten parameter value for display
 */
function shortenParam(value: string, fieldType: string): string {
  const maxLength = 30;

  // For file paths, show just the filename or last part
  if (['file_path', 'filePath', 'path'].includes(fieldType)) {
    const parts = value.split('/').filter(Boolean);
    const filename = parts[parts.length - 1] || value;
    return filename.length > maxLength
      ? '...' + filename.slice(-maxLength)
      : filename;
  }

  // For commands, show first part
  if (['command', 'cmd'].includes(fieldType)) {
    const shortened = value.length > maxLength
      ? value.slice(0, maxLength) + '...'
      : value;
    return shortened;
  }

  // Default: truncate if too long
  return value.length > maxLength
    ? value.slice(0, maxLength) + '...'
    : value;
}

/**
 * Build display title for tool
 */
function buildToolTitle(toolName: string, input: unknown): string {
  const formattedName = formatToolName(toolName);
  const keyParam = extractKeyParam(input);

  if (keyParam) {
    return `${formattedName} · ${keyParam}`;
  }

  return formattedName;
}

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
  const displayTitle = buildToolTitle(item.toolName, item.input);

  return (
    <Tool defaultOpen={false}>
      <ToolHeader
        state={toolState}
        type={`tool-${item.toolName}`}
        title={displayTitle}
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
