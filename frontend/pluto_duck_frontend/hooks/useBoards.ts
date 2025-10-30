import { useCallback, useEffect, useState } from 'react';
import {
  fetchBoards,
  fetchBoardDetail,
  createBoard as createBoardApi,
  updateBoard as updateBoardApi,
  deleteBoard as deleteBoardApi,
  type Board,
  type BoardDetail,
} from '../lib/boardsApi';

export interface UseBoardsOptions {
  projectId: string;
  enabled?: boolean;
}

export function useBoards({ projectId, enabled = true }: UseBoardsOptions) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoard, setActiveBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBoards = useCallback(async () => {
    if (!projectId || !enabled) return;

    setLoading(true);
    setError(null);
    try {
      const data = await fetchBoards(projectId);
      setBoards(data);
      
      // Don't auto-select - let user choose
    } catch (err) {
      console.error('Failed to load boards:', err);
      setError(err instanceof Error ? err.message : 'Failed to load boards');
    } finally {
      setLoading(false);
    }
  }, [projectId, enabled]);

  const createBoard = useCallback(async (name: string, description?: string) => {
    if (!projectId) return null;

    try {
      const newBoard = await createBoardApi(projectId, { name, description });
      setBoards(prev => [...prev, newBoard]);
      setActiveBoard(newBoard);
      return newBoard;
    } catch (err) {
      console.error('Failed to create board:', err);
      throw err;
    }
  }, [projectId]);

  const updateBoard = useCallback(async (
    boardId: string,
    updates: { name?: string; description?: string; settings?: Record<string, any> }
  ) => {
    try {
      const updated = await updateBoardApi(boardId, updates);
      setBoards(prev => prev.map(b => b.id === boardId ? updated : b));
      if (activeBoard?.id === boardId) {
        setActiveBoard(updated);
      }
      return updated;
    } catch (err) {
      console.error('Failed to update board:', err);
      throw err;
    }
  }, [activeBoard]);

  const deleteBoard = useCallback(async (boardId: string) => {
    try {
      await deleteBoardApi(boardId);
      setBoards(prev => prev.filter(b => b.id !== boardId));
      
      if (activeBoard?.id === boardId) {
        const remaining = boards.filter(b => b.id !== boardId);
        setActiveBoard(remaining[0] || null);
      }
    } catch (err) {
      console.error('Failed to delete board:', err);
      throw err;
    }
  }, [activeBoard, boards]);

  const selectBoard = useCallback((board: Board) => {
    setActiveBoard(board);
  }, []);

  useEffect(() => {
    if (projectId && enabled) {
      // Reset active board when project changes
      setActiveBoard(null);
      
      void loadBoards();
      
      // Refresh boards list every minute to sync updated_at and sort order
      const interval = setInterval(() => {
        void loadBoards();
      }, 60000); // 60 seconds

      return () => clearInterval(interval);
    }
  }, [projectId, enabled, loadBoards]);

  return {
    boards,
    activeBoard,
    loading,
    error,
    loadBoards,
    createBoard,
    updateBoard,
    deleteBoard,
    selectBoard,
  };
}

