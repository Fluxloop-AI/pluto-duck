import { useState, useEffect, useCallback } from 'react';
import { 
  fetchProjects, 
  fetchProject, 
  createProject as apiCreateProject,
  type Project,
  type ProjectListItem 
} from '../lib/projectsApi';

interface UseProjectsOptions {
  enabled?: boolean;
}

export function useProjects(options: UseProjectsOptions = {}) {
  const { enabled = true } = options;
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadProjects = useCallback(async () => {
    if (!enabled) return;
    
    try {
      setLoading(true);
      setError(null);
      const data = await fetchProjects();
      setProjects(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load projects'));
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const createProject = useCallback(async (data: { name: string; description?: string }) => {
    try {
      const newProject = await apiCreateProject(data);
      await loadProjects(); // Reload the list
      return newProject;
    } catch (err) {
      console.error('Failed to create project:', err);
      throw err;
    }
  }, [loadProjects]);

  useEffect(() => {
    if (enabled) {
      void loadProjects();
    }
  }, [enabled, loadProjects]);

  return {
    projects,
    loading,
    error,
    reload: loadProjects,
    createProject,
  };
}

