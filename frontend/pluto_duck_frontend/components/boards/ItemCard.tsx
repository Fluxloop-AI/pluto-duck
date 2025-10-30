'use client';

import { MoreVerticalIcon, TrashIcon, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, GripVerticalIcon } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { BoardItem } from '../../lib/boardsApi';

interface ItemCardProps {
  item: BoardItem;
  children: ReactNode;
  onDelete?: (itemId: string) => void;
  onResize?: (itemId: string, size: { width?: number; height?: number }) => void;
  isDragging?: boolean;
  className?: string;
}

export function ItemCard({ item, children, onDelete, onResize, isDragging = false, className = '' }: ItemCardProps) {
  const [showRightHandle, setShowRightHandle] = useState(false);
  const [showBottomHandle, setShowBottomHandle] = useState(false);

  // Constrain to 1-4 columns
  const columns = Math.max(1, Math.min(item.width ?? 1, 4));
  
  const canGrowWidth = columns < 4;
  const canShrinkWidth = columns > 1;
  const canGrowHeight = true;
  const canShrinkHeight = (item.height ?? 1) > 1;

  // Draggable
  const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({
    id: item.id,
  });

  // Droppable
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: item.id,
  });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Show handle if within 20px of right edge
    setShowRightHandle(rect.width - x < 20);
    // Show handle if within 20px of bottom edge
    setShowBottomHandle(rect.height - y < 20);
  };

  const handleMouseLeave = () => {
    setShowRightHandle(false);
    setShowBottomHandle(false);
  };

  // Combine refs
  const setRefs = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  return (
    <div
      ref={setRefs}
      className={`
        group relative rounded-lg border-2 bg-transparent p-2 transition-all flex flex-col
        ${isDragging ? 'opacity-40' : ''}
        ${isOver ? 'border-blue-500 bg-blue-500/10' : 'border-transparent hover:border-border/60'}
        ${className}
      `}
      style={{
        gridColumn: `${item.position_x + 1} / span ${columns}`,
        gridRow: `${item.position_y + 1} / span ${item.height ?? 1}`,
        minHeight: `${(item.height ?? 1) * 50}px`,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute -top-1 -left-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10"
        title="Drag to reorder"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded bg-background/80 backdrop-blur-sm border border-border shadow-sm hover:bg-accent">
          <GripVerticalIcon className="h-4 w-4" />
        </div>
      </div>

      {/* Item actions */}
      {onDelete && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent">
                <MoreVerticalIcon className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onDelete(item.id)}
                className="text-destructive focus:text-destructive"
              >
                <TrashIcon className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Item title */}
      {item.title && (
        <h3 className="text-sm font-semibold mb-2 pr-8">{item.title}</h3>
      )}

      {/* Item content */}
      <div className="w-full flex-1 flex flex-col">
        {children}
      </div>

      {/* Right resize handle */}
      {onResize && showRightHandle && (
        <div className="absolute right-0 top-0 bottom-0 w-8 flex flex-col items-center justify-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 transition-colors border-r-2 border-blue-500/50 z-20">
          {canGrowWidth && (
            <button
              onClick={() => onResize(item.id, { width: columns + 1 })}
              className="p-1 rounded hover:bg-blue-500 text-blue-600 hover:text-white transition-colors"
              title="Expand width"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {canShrinkWidth && (
            <button
              onClick={() => onResize(item.id, { width: columns - 1 })}
              className="p-1 rounded hover:bg-blue-500 text-blue-600 hover:text-white transition-colors"
              title="Shrink width"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Bottom resize handle */}
      {onResize && showBottomHandle && (
        <div className="absolute left-0 right-0 bottom-0 h-8 flex items-center justify-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 transition-colors border-b-2 border-blue-500/50 z-20">
          {canGrowHeight && (
            <button
              onClick={() => onResize(item.id, { height: (item.height ?? 1) + 1 })}
              className="p-1 rounded hover:bg-blue-500 text-blue-600 hover:text-white transition-colors"
              title="Expand height"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}
          {canShrinkHeight && (
            <button
              onClick={() => onResize(item.id, { height: (item.height ?? 1) - 1 })}
              className="p-1 rounded hover:bg-blue-500 text-blue-600 hover:text-white transition-colors"
              title="Shrink height"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

