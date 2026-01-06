'use client';

import { useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { BoardToolbar } from './BoardToolbar';
import { BoardEditor } from '../editor/BoardEditor';
import { Board } from '../../lib/boardsApi';

interface BoardsViewProps {
  projectId: string;
  activeBoard: Board | null;
}

export function BoardsView({ projectId, activeBoard }: BoardsViewProps) {
  const handleSettings = () => {
    // TODO: Open board settings modal
    console.log('Settings clicked');
  };

  const handleAddItem = () => {
     // Legacy function, might be removed or adapted for slash commands
     console.log('Add item clicked');
    }

  if (!activeBoard) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-muted">
            <LayoutDashboard className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">Select a board from the sidebar</p>
        </div>
      </div>
    );
  }

  return (
      <div className="flex h-full flex-col">
        <BoardToolbar
          board={activeBoard}
          onAddItem={handleAddItem}
          onSettings={handleSettings}
      />
      <div className="flex-1 overflow-hidden relative">
         <BoardEditor key={activeBoard.id} board={activeBoard} projectId={projectId} />
      </div>
    </div>
  );
}
