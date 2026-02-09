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
} from '../../ai-elements/queue';
import type { ToolItem } from '../../../types/chatRenderItem';
import { parseTodosFromToolPayload } from './toolTodoParser';

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
 * Extract actual content from ToolMessage wrapper
 */
function extractContent(output: any): any {
  if (!output) return null;
  // Handle ToolMessage wrapper: { type: "tool", content: "...", tool_call_id: "..." }
  if (typeof output === 'object' && output.content !== undefined) {
    return output.content;
  }
  return output;
}

/**
 * Get first meaningful item from tool output for preview
 */
function getFirstMeaningfulItem(output: any): string | null {
  const content = extractContent(output);
  if (!content) return null;

  const str = typeof content === 'string' ? content : JSON.stringify(content);

  // Array format: try to parse and get first element
  if (str.startsWith('[')) {
    try {
      const arr = JSON.parse(str);
      if (Array.isArray(arr) && arr.length > 0) {
        return String(arr[0]);
      }
    } catch {
      // Not valid JSON array, continue
    }
  }

  // Multi-line: get first non-empty line
  const lines = str.split('\n').filter(line => line.trim());
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    // Truncate if too long
    return firstLine.length > 60 ? firstLine.slice(0, 60) + '...' : firstLine;
  }

  return str.length > 60 ? str.slice(0, 60) + '...' : str;
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
    const todos = parseTodosFromToolPayload(item.input, item.output);
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
  const toolName = formatToolName(item.toolName);
  const keyParam = extractKeyParam(item.input);
  const preview = item.state !== 'pending' ? getFirstMeaningfulItem(item.output) : null;
  const actualOutput = extractContent(item.output);

  return (
    <Tool defaultOpen={false}>
      <ToolHeader
        state={toolState}
        toolName={toolName}
        keyParam={keyParam}
        preview={preview}
      />
      <ToolContent>
        {item.input && <ToolInput input={item.input} />}
        {(actualOutput || item.error) && (
          <ToolOutput
            output={actualOutput ? JSON.stringify(actualOutput, null, 2) : undefined}
            errorText={item.error}
          />
        )}
      </ToolContent>
    </Tool>
  );
});
