import { useState, useEffect, useMemo } from 'react';
import { listAnalyses, type Analysis } from '../lib/assetsApi';
import { fetchSources, type Source } from '../lib/sourceApi';
import { listFileAssets, type FileAsset } from '../lib/fileAssetApi';
import { DatabaseIcon, FileIcon, TableIcon, Table2Icon } from 'lucide-react';

export interface MentionItem {
  id: string;
  type: 'analysis' | 'source' | 'dataset';
  name: string;
  description?: string | null;
  metadata?: any;
}

export interface MentionGroup {
  label: string;
  items: MentionItem[];
}

export function useAssetMentions(projectId: string) {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [files, setFiles] = useState<FileAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all assets
  useEffect(() => {
    if (!projectId) return;

    let isMounted = true;
    setIsLoading(true);

    const loadData = async () => {
      try {
        const [analysesData, sourcesData, filesData] = await Promise.all([
          listAnalyses({ projectId }).catch(() => []),
          fetchSources(projectId).catch(() => []),
          listFileAssets(projectId).catch(() => []),
        ]);

        if (isMounted) {
          setAnalyses(analysesData);
          setSources(sourcesData);
          setFiles(filesData);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          console.error('Failed to load assets for mentions:', err);
          setError('Failed to load assets');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  // Group assets for mentions
  const mentionGroups = useMemo<MentionGroup[]>(() => {
    const groups: MentionGroup[] = [];

    // 1. Analyses
    if (analyses.length > 0) {
      groups.push({
        label: 'Analyses',
        items: analyses.map((a) => ({
          id: a.id,
          type: 'analysis',
          name: a.name,
          description: a.description,
          metadata: {
            sql: a.sql,
            materialization: a.materialization,
            result_table: a.result_table,
          },
        })),
      });
    }

    // 2. Data Sources
    if (sources.length > 0) {
      groups.push({
        label: 'Data Sources',
        items: sources.map((s) => ({
          id: s.name, // Use name as ID for sources (e.g. "pg", "sqlite")
          type: 'source',
          name: s.name,
          description: s.description || `${s.source_type} connection`,
          metadata: {
            source_type: s.source_type,
            table_count: s.table_count,
          },
        })),
      });
    }

    // 3. Datasets (uploaded files)
    if (files.length > 0) {
      groups.push({
        label: 'Datasets',
        items: files.map((f) => ({
          id: f.id,
          type: 'dataset',
          name: f.name,
          description: f.description || `${f.file_type.toUpperCase()} file`,
          metadata: {
            file_path: f.file_path,
            table_name: f.table_name,
            row_count: f.row_count,
          },
        })),
      });
    }

    return groups;
  }, [analyses, sources, files]);

  // Flattened list for easy searching
  const allMentions = useMemo(() => {
    return mentionGroups.flatMap(g => g.items);
  }, [mentionGroups]);

  return {
    mentionGroups,
    allMentions,
    isLoading,
    error,
    // Helper to get icon based on type
    getIcon: (type: 'analysis' | 'source' | 'dataset') => {
      switch (type) {
        case 'analysis': return Table2Icon;
        case 'source': return DatabaseIcon;
        case 'dataset': return FileIcon;
        default: return TableIcon;
      }
    }
  };
}
