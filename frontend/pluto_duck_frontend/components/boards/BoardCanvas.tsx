'use client';

import { useState, useRef } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, DragMoveEvent } from '@dnd-kit/core';
import type { BoardItem } from '../../lib/boardsApi';
import { ItemCard } from './ItemCard';

interface BoardCanvasProps {
  items: BoardItem[];
  onItemUpdate?: (itemId: string, updates: any) => void;
  onItemResize?: (itemId: string, size: { width?: number; height?: number }) => void;
  onItemMove?: (itemId: string, position: { position_x: number; position_y: number }) => void;
  onItemDelete?: (itemId: string) => void;
  children?: (item: BoardItem) => React.ReactNode;
}

export function BoardCanvas({ items, onItemUpdate, onItemResize, onItemMove, onItemDelete, children }: BoardCanvasProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewPosition, setPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const activeItem = items.find(item => item.id === activeId);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    const draggedItem = items.find(item => item.id === event.active.id);
    if (draggedItem) {
      setPreviewPosition({ x: draggedItem.position_x, y: draggedItem.position_y });
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const { delta, over } = event;
    const draggedItem = items.find(item => item.id === event.active.id);
    if (!draggedItem) return;

    if (over && over.id !== event.active.id) {
      // Hovering over another item
      const targetItem = items.find(item => item.id === over.id);
      if (targetItem) {
        setPreviewPosition({ x: targetItem.position_x, y: targetItem.position_y });
      }
    } else if (gridRef.current) {
      // Calculate position based on drag distance
      const columnWidth = 250;
      const rowHeight = 50;
      
      const columnDelta = Math.round(delta.x / columnWidth);
      const rowDelta = Math.round(delta.y / rowHeight);
      
      const newX = Math.max(0, Math.min(3, draggedItem.position_x + columnDelta));
      const newY = Math.max(0, draggedItem.position_y + rowDelta);
      
      setPreviewPosition({ x: newX, y: newY });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    
    if (onItemMove) {
      const draggedItem = items.find(item => item.id === active.id);
      if (!draggedItem) return;

      if (over && active.id !== over.id) {
        // Dropped on another item - swap positions
        const targetItem = items.find(item => item.id === over.id);
        if (targetItem) {
          onItemMove(active.id as string, {
            position_x: targetItem.position_x,
            position_y: targetItem.position_y,
          });
        }
      } else if (delta.x !== 0 || delta.y !== 0) {
        // Calculate new position based on drag distance
        // Approximate: 1 column ≈ 250px (can be adjusted)
        const columnWidth = 250;
        const rowHeight = 50;
        
        const columnDelta = Math.round(delta.x / columnWidth);
        const rowDelta = Math.round(delta.y / rowHeight);
        
        const newX = Math.max(0, Math.min(3, draggedItem.position_x + columnDelta));
        const newY = Math.max(0, draggedItem.position_y + rowDelta);
        
        // Only update if position actually changed
        if (newX !== draggedItem.position_x || newY !== draggedItem.position_y) {
          onItemMove(active.id as string, {
            position_x: newX,
            position_y: newY,
          });
        }
      }
    }
    
    setActiveId(null);
    setPreviewPosition(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setPreviewPosition(null);
  };

  return (
    <div className="flex-1 overflow-auto p-6 bg-transparent">
      {items.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="text-center space-y-2">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-muted">
              <svg
                className="h-6 w-6 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z"
                />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground">No items yet</p>
            <p className="text-xs text-muted-foreground">Click "Add Item" to get started</p>
          </div>
        </div>
      ) : (
        <DndContext
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div ref={gridRef} className="grid grid-cols-4 gap-3 auto-rows-min relative">
            {items.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                onDelete={onItemDelete}
                onResize={onItemResize}
                isDragging={item.id === activeId}
              >
                {children ? children(item) : <ItemPlaceholder item={item} />}
              </ItemCard>
            ))}
            
            {/* Drop preview */}
            {activeId && previewPosition && activeItem && (
              <div
                className="pointer-events-none bg-blue-500/10 rounded-lg"
                style={{
                  gridColumn: `${previewPosition.x + 1} / span ${Math.min(activeItem.width, 4)}`,
                  gridRow: `${previewPosition.y + 1} / span ${activeItem.height ?? 1}`,
                  minHeight: `${(activeItem.height ?? 1) * 50}px`,
                }}
              />
            )}
          </div>
          
          <DragOverlay>
            {activeItem && (
              <div className="opacity-50">
                <ItemCard
                  item={activeItem}
                  isDragging={true}
                >
                  {children ? children(activeItem) : <ItemPlaceholder item={activeItem} />}
                </ItemCard>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function ItemPlaceholder({ item }: { item: BoardItem }) {
  return (
    <div className="flex items-center justify-center py-8 text-muted-foreground">
      <div className="text-center">
        <p className="text-sm font-medium">{item.item_type}</p>
        <p className="text-xs">Item renderer not implemented</p>
      </div>
    </div>
  );
}

