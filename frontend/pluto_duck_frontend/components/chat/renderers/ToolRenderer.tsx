'use client';

import { memo } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolDetailBox,
  ToolDetailRow,
  ToolDetailDivider,
} from '../../ai-elements/tool';
import { StepDot } from '../../ai-elements/step-dot';
import { mapToolStateToPhase } from '../../ai-elements/tool-state-phase-map';
import { TodoCheckbox } from '../../ai-elements/todo-checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import type { ToolItem } from '../../../types/chatRenderItem';
import { parseTodosFromToolPayload } from './toolTodoParser';
import {
  buildToolDetailRowsForChild,
  extractToolMessageContent,
} from './toolDetailContent';
import {
  getToolTodoStepPhase,
  getToolTodoTextClass,
  shouldDefaultOpenToolTodo,
  shouldShowToolTodoChevron,
} from './toolTodoViewModel';

/**
 * Convert snake_case or camelCase to Title Case
 * e.g., read_file → Read File, executeCommand → Execute Command
 */
export function formatToolName(name: string): string {
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
export function extractContent(output: unknown): unknown {
  return extractToolMessageContent(output);
}

/**
 * Get first meaningful item from tool output for preview
 */
function getFirstMeaningfulItem(output: unknown): string | null {
  const content = extractToolMessageContent(output);
  if (content == null) return null;

  const serializedContent =
    typeof content === 'string' ? content : JSON.stringify(content);
  if (typeof serializedContent !== 'string' || !serializedContent.trim()) {
    return null;
  }
  const str = serializedContent;

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
  variant?: 'default' | 'inline';
}

export const ToolRenderer = memo(function ToolRenderer({
  item,
  variant = 'default',
}: ToolRendererProps) {
  // 1) inline write_todos
  if (variant === 'inline' && item.toolName === 'write_todos') {
    const todos = parseTodosFromToolPayload(item.input, item.output);
    const todoCountLabel = `Update Todos — ${todos.length} items`;

    return (
      <div className="flex items-center gap-2 px-2 py-1 min-w-0 text-xs">
        <StepDot phase={getToolTodoStepPhase(item.state)} className="scale-[0.7]" />
        <span className="truncate min-w-0 text-[0.8rem]">{todoCountLabel}</span>
        {item.error ? (
          <span className="truncate min-w-0 text-[0.8rem] text-destructive">
            {item.error}
          </span>
        ) : null}
      </div>
    );
  }

  // 2) inline generic tool
  if (variant === 'inline') {
    const toolState = getToolUIState(item.state);
    const phase = mapToolStateToPhase(toolState);
    const keyParam = extractKeyParam(item.input);
    const preview = item.state === 'completed' ? getFirstMeaningfulItem(item.output) : null;
    const fallback = formatToolName(item.toolName);
    const inlineText = keyParam ?? preview ?? fallback;

    return (
      <div className="flex items-center gap-2 px-2 py-1 min-w-0 text-xs">
        <StepDot phase={phase} className="scale-[0.7]" />
        {item.error ? (
          <span className="truncate min-w-0 text-[0.8rem] text-destructive">
            {item.error}
          </span>
        ) : (
          <span className="truncate min-w-0 text-[0.8rem]">{inlineText}</span>
        )}
      </div>
    );
  }

  // 3) default rendering
  // Special handling for write_todos tool
  if (item.toolName === 'write_todos') {
    const todos = parseTodosFromToolPayload(item.input, item.output);
    const showChevron = shouldShowToolTodoChevron(item.state);

    return (
      <Collapsible
        className="not-prose text-xs group"
        defaultOpen={shouldDefaultOpenToolTodo(item.state)}
      >
        <CollapsibleTrigger
          className="group/step flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 pr-3 transition-colors hover:bg-muted/50 disabled:cursor-default"
          disabled={!showChevron}
        >
          <StepDot phase={getToolTodoStepPhase(item.state)} />
          <span className="font-semibold text-[0.85rem] shrink-0">
            Update Todos
          </span>
          {showChevron ? (
            <ChevronDownIcon className="size-3 text-muted-foreground opacity-40 transition-[opacity,transform] shrink-0 ml-auto group-hover/step:opacity-70 group-data-[state=open]/step:rotate-180 group-data-[state=open]/step:opacity-70" />
          ) : null}
        </CollapsibleTrigger>
        {todos.length > 0 && (
          <CollapsibleContent className="overflow-hidden text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2">
            <div className="pl-[38px] pr-2 pt-2 pb-2">
              {todos.map((todo) => (
                <div key={todo.id} className="flex items-start gap-2 py-1">
                  <TodoCheckbox status={todo.status} />
                  <span
                    className={`text-[0.8rem] break-words ${getToolTodoTextClass(todo.status)}`}
                  >
                    {todo.title}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        )}
        {item.error && (
          <div className="pl-[38px] pr-2 pb-2 text-xs text-destructive">
            {item.error}
          </div>
        )}
      </Collapsible>
    );
  }

  // Default tool rendering
  const toolState = getToolUIState(item.state);
  const toolName = formatToolName(item.toolName);
  const keyParam = extractKeyParam(item.input);
  const preview = item.state !== 'pending' ? getFirstMeaningfulItem(item.output) : null;
  const detailRows = buildToolDetailRowsForChild(item);

  return (
    <Tool defaultOpen={false}>
      <ToolHeader
        state={toolState}
        toolName={toolName}
        keyParam={keyParam}
        preview={preview}
      />
      <ToolContent>
        {detailRows.length > 0 && (
          <div className="pl-[38px] pr-2 pt-2 pb-2">
            <ToolDetailBox>
              {detailRows.map((row, index) => (
                <div key={row.key}>
                  {index > 0 && <ToolDetailDivider />}
                  <ToolDetailRow
                    content={row.content}
                    variant={row.variant}
                    renderMode={row.renderMode}
                    language={row.language}
                  />
                </div>
              ))}
            </ToolDetailBox>
          </div>
        )}
      </ToolContent>
    </Tool>
  );
});
