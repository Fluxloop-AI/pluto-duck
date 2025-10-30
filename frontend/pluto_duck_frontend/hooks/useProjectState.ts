import { useCallback, useEffect, useMemo, useRef } from 'react';
import { updateProjectSettings, type ProjectUIState } from '../lib/projectsApi';

interface ProjectState {
  chatTabs: Array<{ id: string; order: number }>;
  activeChatTabId: string | null;
  activeBoardId: string | null;
  activeView: 'boards' | 'data-sources';
}

interface UseProjectStateOptions {
  projectId: string | null;
  enabled?: boolean;
  autoSaveDelay?: number; // milliseconds
}

export function useProjectState(options: UseProjectStateOptions) {
  const { projectId, enabled = true, autoSaveDelay = 2000 } = options;
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedStateRef = useRef<string>('');

  const saveState = useCallback(
    async (state: ProjectState) => {
      if (!projectId || !enabled) return;

      const uiState: ProjectUIState = {
        chat: {
          open_tabs: state.chatTabs,
          active_tab_id: state.activeChatTabId || undefined,
        },
        boards: {
          active_board_id: state.activeBoardId || undefined,
        },
        active_view: state.activeView,
      };

      try {
        await updateProjectSettings(projectId, { ui_state: uiState });
        lastSavedStateRef.current = JSON.stringify(state);
      } catch (error) {
        console.error('Failed to save project state:', error);
      }
    },
    [projectId, enabled]
  );

  const debouncedSaveState = useCallback(
    (state: ProjectState) => {
      if (!projectId || !enabled) return;

      // Check if state actually changed
      const stateStr = JSON.stringify(state);
      if (stateStr === lastSavedStateRef.current) {
        return; // No changes, skip save
      }

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new timeout
      saveTimeoutRef.current = setTimeout(() => {
        void saveState(state);
      }, autoSaveDelay);
    },
    [projectId, enabled, autoSaveDelay, saveState]
  );

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    saveState,
    debouncedSaveState,
  };
}

