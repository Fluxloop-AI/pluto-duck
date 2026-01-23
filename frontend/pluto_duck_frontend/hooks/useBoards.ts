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
      // Sort by updated_at descending (most recent first)
      const sortedData = [...data].sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      setBoards(sortedData);

      // Auto-select first board if available (most recently updated)
      // Note: We always select first board here because activeBoard is reset
      // to null when projectId changes (in the separate useEffect)
      if (sortedData.length > 0) {
        // Fetch detail for the first board (most recently updated)
        try {
          const detail = await fetchBoardDetail(sortedData[0].id);
          setActiveBoard(detail);
        } catch (e) {
          console.error("Failed to load initial active board detail", e);
          setActiveBoard(sortedData[0]);
        }
      }
      // If data.length === 0, activeBoard is already null from the reset effect
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
      // Add new board at the beginning (most recent first)
      setBoards(prev => [newBoard, ...prev]);
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

  const selectBoard = useCallback(async (board: Board | null) => {
    if (!board) {
      setActiveBoard(null);
      return;
    }
    try {
      // Fetch fresh details BEFORE setting activeBoard to avoid stale data overwrite
      const detail = await fetchBoardDetail(board.id);
      setActiveBoard(detail);
    } catch (err) {
      console.error('Failed to fetch board detail:', err);
      // Fallback to list item only on error
      setActiveBoard(board);
    }
  }, []);

  // Reset state when projectId changes (before loadBoards runs)
  useEffect(() => {
    // Clear previous project's data immediately when project changes
    setBoards([]);
    setActiveBoard(null);
  }, [projectId]);

  useEffect(() => {
    if (projectId && enabled) {
      void loadBoards();
      
      // Note: Removed 60-second interval refresh as it was causing unnecessary reloads
      // If you need periodic sync, implement it with a ref to avoid stale closures
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

