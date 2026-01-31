'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getFileDiagnosis,
  type FileDiagnosis,
} from '../../../../lib/fileAssetApi';
import type { Dataset } from '../types';
import { isFileAsset } from '../utils';

interface DatasetDiagnosisState {
  diagnosis: FileDiagnosis | null;
  diagnosisLoading: boolean;
  resetDiagnosis: () => void;
  refreshDiagnosis: () => Promise<void>;
  setDiagnosis: (next: FileDiagnosis | null) => void;
}

export function useDatasetDiagnosis(
  projectId: string,
  dataset: Dataset
): DatasetDiagnosisState {
  const [diagnosis, setDiagnosis] = useState<FileDiagnosis | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);

  const resetDiagnosis = useCallback(() => {
    setDiagnosis(null);
  }, []);

  const refreshDiagnosis = useCallback(async () => {
    if (!isFileAsset(dataset)) return;
    setDiagnosisLoading(true);
    try {
      const data = await getFileDiagnosis(projectId, dataset.id);
      setDiagnosis(data);
    } catch (err) {
      console.error('Failed to load diagnosis:', err);
    } finally {
      setDiagnosisLoading(false);
    }
  }, [projectId, dataset]);

  // Reset diagnosis when dataset changes
  useEffect(() => {
    resetDiagnosis();
  }, [dataset, resetDiagnosis]);

  // Load diagnosis data for FileAsset
  useEffect(() => {
    void refreshDiagnosis();
  }, [refreshDiagnosis]);

  return {
    diagnosis,
    diagnosisLoading,
    resetDiagnosis,
    refreshDiagnosis,
    setDiagnosis,
  };
}
