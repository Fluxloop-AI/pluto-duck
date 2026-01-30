'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  previewFileData,
  type FilePreview,
} from '../../../../lib/fileAssetApi';
import {
  fetchCachedTablePreview,
  type CachedTablePreview,
} from '../../../../lib/sourceApi';
import type { Dataset, DatasetTab } from '../types';
import { isFileAsset } from '../utils';

interface DatasetPreviewState {
  preview: FilePreview | CachedTablePreview | null;
  loading: boolean;
  error: string | null;
  resetPreview: () => void;
}

export function useDatasetPreview(
  projectId: string,
  dataset: Dataset,
  activeTab: DatasetTab
): DatasetPreviewState {
  const [preview, setPreview] = useState<FilePreview | CachedTablePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetPreview = useCallback(() => {
    setPreview(null);
    setError(null);
  }, []);

  // Reset preview when dataset changes
  useEffect(() => {
    resetPreview();
  }, [dataset, resetPreview]);

  // Load table preview data when dataset changes or tab becomes 'table' or 'summary'
  useEffect(() => {
    if (activeTab !== 'table' && activeTab !== 'summary') return;
    if (preview !== null) return; // Don't reload if we already have data

    const loadPreview = async () => {
      setLoading(true);
      setError(null);
      try {
        if (isFileAsset(dataset)) {
          const data = await previewFileData(projectId, dataset.id);
          setPreview(data);
        } else {
          const data = await fetchCachedTablePreview(projectId, dataset.local_table);
          setPreview(data);
        }
      } catch (err) {
        console.error('Failed to load preview:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data preview');
      } finally {
        setLoading(false);
      }
    };

    void loadPreview();
  }, [projectId, dataset, activeTab, preview]);

  return {
    preview,
    loading,
    error,
    resetPreview,
  };
}
