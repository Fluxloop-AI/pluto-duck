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
    <div className="flex items-center justify-end border-b border-border bg-background px-2 pt-3 pb-1">
      <div className="flex items-center gap-1.5">
        {onAddItem && (
          <button
            onClick={onAddItem}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card hover:bg-accent"
            title="Add item"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

