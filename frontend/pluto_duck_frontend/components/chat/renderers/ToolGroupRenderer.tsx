'use client';

import { memo } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import type { ToolGroupItem, ToolItem } from '../../../types/chatRenderItem';
import { StepDot } from '../../ai-elements/step-dot';
import { TodoCheckbox } from '../../ai-elements/todo-checkbox';
import { ToolInput, ToolOutput } from '../../ai-elements/tool';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import { formatToolName } from './ToolRenderer';
import { buildToolDetailRowsForChild } from './toolDetailContent';
import { parseTodosFromToolPayload } from './toolTodoParser';
import { getToolTodoTextClass } from './toolTodoViewModel';

function mapGroupStateToPhase(state: ToolGroupItem['state']): 'running' | 'complete' | 'error' {
  if (state === 'pending') {
    return 'running';
  }
  if (state === 'error') {
    return 'error';
  }
  return 'complete';
}

function renderDefaultChildren(children: ToolItem[]) {
  return children.map(child => {
    const detailRows = buildToolDetailRowsForChild(child);
    const inputRow = detailRows.find(row => row.kind === 'input');
    const resultRow = detailRows.find(
      row => row.kind === 'output' || row.kind === 'error'
    );

    if (!inputRow && !resultRow) {
      return null;
    }

    return (
      <div key={child.id}>
        {inputRow && child.input != null && <ToolInput input={child.input} />}
        {resultRow && (
          <ToolOutput
            output={resultRow.kind === 'output' ? resultRow.content : undefined}
            errorText={resultRow.kind === 'error' ? resultRow.content : undefined}
          />
        )}
      </div>
    );
  });
}

function renderTodoChildren(children: ToolItem[]) {
  // 마지막 자식의 todos를 최종 상태로 사용
  const lastChild = children[children.length - 1];
  const todos = parseTodosFromToolPayload(lastChild.input, lastChild.output);
  const lastError = children.find(c => c.error)?.error;

  return (
    <>
      {todos.length > 0 && (
        <div className="pl-[38px] pr-2 pb-2">
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
      )}
      {lastError && (
        <div className="pl-[38px] pr-2 pb-2 text-xs text-destructive">
          {lastError}
        </div>
      )}
    </>
  );
}

export interface ToolGroupRendererProps {
  item: ToolGroupItem;
}

export const ToolGroupRenderer = memo(function ToolGroupRenderer({
  item,
}: ToolGroupRendererProps) {
  const isTodo = item.toolName === 'write_todos';
  const displayName = isTodo ? 'Update Todos' : formatToolName(item.toolName);

  return (
    <Collapsible
      className="not-prose text-xs group"
      defaultOpen={false}
    >
      <CollapsibleTrigger className="group/step flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 pr-3 transition-colors hover:bg-muted/50">
        <StepDot phase={mapGroupStateToPhase(item.state)} />
        <span className="font-medium text-[0.85rem] shrink-0">{displayName}</span>
        <ChevronDownIcon className="size-3 text-muted-foreground opacity-40 transition-[opacity,transform] shrink-0 ml-auto group-hover/step:opacity-70 group-data-[state=open]/step:rotate-180 group-data-[state=open]/step:opacity-70" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden text-popover-foreground outline-none data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        {isTodo
          ? renderTodoChildren(item.children)
          : renderDefaultChildren(item.children)
        }
      </CollapsibleContent>
    </Collapsible>
  );
});
