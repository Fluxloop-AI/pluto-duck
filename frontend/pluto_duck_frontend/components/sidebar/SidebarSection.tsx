'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible';

interface SidebarSectionProps {
  label: string;
  defaultOpen?: boolean;
  onAddClick?: () => void;
  children: ReactNode;
}

export function SidebarSection({
  label,
  defaultOpen = true,
  onAddClick,
  children,
}: SidebarSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center justify-between px-[18px] py-2">
        <CollapsibleTrigger className="flex items-center gap-1 hover:opacity-80 transition-opacity">
          <span className="text-xs text-muted-foreground font-medium">
            {label}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              isOpen ? '' : '-rotate-90'
            }`}
          />
        </CollapsibleTrigger>
        {onAddClick && (
          <button
            type="button"
            onClick={onAddClick}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent transition-colors"
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>
      <CollapsibleContent className="px-[18px]">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
