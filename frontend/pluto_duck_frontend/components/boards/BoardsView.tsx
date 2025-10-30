'use client';

import { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { useBoards } from '../../hooks/useBoards';
import { useBoardItems } from '../../hooks/useBoardItems';
import { BoardToolbar } from './BoardToolbar';
import { BoardCanvas } from './BoardCanvas';
import { AddItemModal } from './modals/AddItemModal';
import { MarkdownItem, ChartItem, TableItem, MetricItem, ImageItem } from './items';
import { Loader } from '../ai-elements';
import type { BoardItem, Board } from '../../lib/boardsApi';

interface BoardsViewProps {
  projectId: string;
  activeBoard: Board | null;
}

export function BoardsView({ projectId, activeBoard }: BoardsViewProps) {
  const {
    items,
    loading: itemsLoading,
    addItem,
    updateItem,
    deleteItem,
    updateItemPosition,
  } = useBoardItems({ boardId: activeBoard?.id });

  const [showAddItemModal, setShowAddItemModal] = useState(false);

  const handleAddItem = () => {
    setShowAddItemModal(true);
  };

  const handleCreateItem = async (itemType: string, title?: string) => {
    if (!activeBoard) return;

    // Create default payload based on item type
    let payload: Record<string, any> = {};
    let width = 2; // Default width (half of 4 columns)

    switch (itemType) {
      case 'markdown':
        payload = { content: {} };
        width = 4; // Full width for markdown
        break;
      case 'chart':
      case 'metric':
        // Will need query configuration - for now create placeholder
        payload = { query_id: null, note: 'Query configuration needed' };
        width = 2; // Half width
        break;
      case 'table':
        payload = { query_id: null, note: 'Query configuration needed' };
        width = 4; // Full width for tables
        break;
      case 'image':
        payload = { asset_id: null, note: 'Upload image needed' };
        width = 2; // Half width
        break;
    }

    // Find next available position (bottom of the board)
    const maxY = items.length > 0 ? Math.max(...items.map(item => item.position_y + (item.height || 1))) : 0;

    await addItem({
      item_type: itemType,
      title: title || undefined,
      payload,
      width,
      height: 1,
      position_x: 0,
      position_y: maxY,
    });
  };

  const handleSettings = () => {
    // TODO: Open board settings modal
    console.log('Settings clicked');
  };

  const renderItem = (item: BoardItem) => {
    switch (item.item_type) {
      case 'markdown':
        return <MarkdownItem item={item} onUpdate={updateItem} />;
      case 'chart':
        return <ChartItem item={item} projectId={projectId} />;
      case 'table':
        return <TableItem item={item} projectId={projectId} />;
      case 'metric':
        return <MetricItem item={item} projectId={projectId} />;
      case 'image':
        return <ImageItem item={item} projectId={projectId} onUpdate={updateItem} />;
      default:
        return (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <p className="text-sm">Unknown item type: {item.item_type}</p>
          </div>
        );
    }
  };

  if (!activeBoard) {
    return (
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
                d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5z"
              />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">Select a board from the sidebar</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <AddItemModal
        open={showAddItemModal}
        onOpenChange={setShowAddItemModal}
        onSubmit={handleCreateItem}
      />

      <div className="flex h-full flex-col">
        <BoardToolbar
          board={activeBoard}
          onAddItem={handleAddItem}
          onSettings={handleSettings}
        />

        <BoardCanvas
          items={items}
          onItemUpdate={updateItem}
          onItemResize={(itemId, size) => {
            const item = items.find(i => i.id === itemId);
            if (!item) return;
            
            updateItemPosition(itemId, {
              position_x: item.position_x,
              position_y: item.position_y,
              width: size.width ?? item.width,
              height: size.height ?? item.height,
            });
          }}
          onItemMove={(itemId, position) => {
            const item = items.find(i => i.id === itemId);
            if (!item) return;
            
            updateItemPosition(itemId, {
              position_x: position.position_x,
              position_y: position.position_y,
              width: item.width,
              height: item.height,
            });
          }}
          onItemDelete={deleteItem}
        >
          {renderItem}
        </BoardCanvas>
      </div>
    </>
  );
}

