'use client';

import { MoreHorizontalIcon, PlusIcon } from 'lucide-react';
import type { Board } from '../../lib/boardsApi';

interface BoardTabsProps {
  boards: Board[];
  activeId?: string;
  onSelect: (board: Board) => void;
  onNew: () => void;
  onDelete?: (board: Board) => void;
}

export function BoardTabs({ boards, activeId, onSelect, onNew, onDelete }: BoardTabsProps) {
  return (
    <div className="flex items-center gap-0.5 bg-muted rounded-lg p-1">
      {boards.map(board => (
        <button
          key={board.id}
          onClick={() => onSelect(board)}
          className={`
            group relative flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors
            ${
              activeId === board.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }
          `}
        >
          <span>{board.name}</span>
          <MoreHorizontalIcon
            className={`h-4 w-4 text-muted-foreground/60 ${
              activeId === board.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            } transition-opacity`}
            onClick={(e) => {
              e.stopPropagation();
              // TODO: Show dropdown menu for rename/delete
              if (onDelete && boards.length > 1) {
                onDelete(board);
              }
            }}
          />
        </button>
      ))}

      <button
        onClick={onNew}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-background/50 hover:text-foreground transition-colors"
        title="New board"
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

