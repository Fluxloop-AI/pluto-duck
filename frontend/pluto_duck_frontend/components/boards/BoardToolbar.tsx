'use client';

import { PlusIcon, SettingsIcon } from 'lucide-react';
import type { Board } from '../../lib/boardsApi';

interface BoardToolbarProps {
  board: Board | null;
  onAddItem?: () => void;
  onSettings?: () => void;
}

export function BoardToolbar({ board, onAddItem, onSettings }: BoardToolbarProps) {
  return (
    <div className="flex items-center border-b border-border bg-background px-2 pt-3 pb-1">
      <div className="flex-1" />
      
      <div className="text-center">
        <h2 className="text-xs font-semibold">{board?.name || 'Select a board'}</h2>
        {board?.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{board.description}</p>
        )}
      </div>

      <div className="flex-1 flex items-center justify-end gap-1.5">
        {onAddItem && (
          <button
            onClick={onAddItem}
            className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add Item
          </button>
        )}
        
        {onSettings && (
          <button
            onClick={onSettings}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card hover:bg-accent"
            title="Board settings"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

