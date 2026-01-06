'use client';

import { useEffect, useState } from 'react';
import { TrashIcon } from 'lucide-react';
import type { Board } from '../../lib/boardsApi';

interface BoardListProps {
  boards: Board[];
  activeId?: string;
  onSelect: (board: Board) => void;
  onDelete?: (board: Board) => void;
  // Optional props to handle new interface calls if needed, but we keep it minimal for now to fix build
  // If the parent passes onUpdate or onCreate, we can add them here as optional
  onUpdate?: (boardId: string, data: any) => void;
  onCreate?: () => void;
}

export function BoardList({ boards, activeId, onSelect, onDelete }: BoardListProps) {
  const [tick, setTick] = useState(0);

  // Update relative times every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, []);

  if (boards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <p className="text-sm">No boards yet</p>
        <p className="text-xs mt-1">Create one to get started</p>
      </div>
    );
  }

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const diffMs = Math.abs(Date.now() - date.getTime());
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    // Format as local date and time
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-1">
      {boards.map((board) => (
        <div
          key={board.id}
          className={`
            group relative flex items-start gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer transition-colors
            ${
              activeId === board.id
                ? 'bg-primary/10 text-primary'
                : 'text-foreground hover:bg-accent'
            }
          `}
          onClick={() => onSelect(board)}
        >
          <div className="flex-1 min-w-0">
            <p className={`truncate ${activeId === board.id ? 'font-medium' : 'font-normal'}`}>
              {board.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {formatRelativeTime(board.updated_at)}
            </p>
          </div>

          {onDelete && boards.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete board "${board.name}"?`)) {
                  onDelete(board);
                }
              }}
              className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive transition-opacity shrink-0"
              title="Delete board"
            >
              <TrashIcon className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
