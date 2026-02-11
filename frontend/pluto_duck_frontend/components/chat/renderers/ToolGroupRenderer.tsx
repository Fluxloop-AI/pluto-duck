'use client';

import { memo } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import type { ToolGroupItem } from '../../../types/chatRenderItem';
import { StepDot } from '../../ai-elements/step-dot';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import { ToolRenderer, formatToolName } from './ToolRenderer';

function mapGroupStateToPhase(state: ToolGroupItem['state']): 'running' | 'complete' | 'error' {
  if (state === 'pending') {
    return 'running';
  }
  if (state === 'error') {
    return 'error';
  }
  return 'complete';
}

export interface ToolGroupRendererProps {
  item: ToolGroupItem;
}

export const ToolGroupRenderer = memo(function ToolGroupRenderer({
  item,
}: ToolGroupRendererProps) {
  const displayName = formatToolName(item.toolName);

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
        <div className="pl-[28px]">
          {item.children.map(child => (
            <ToolRenderer
              key={child.id}
              item={child}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
