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

  // Reset diagnosis when dataset changes
  useEffect(() => {
    resetDiagnosis();
  }, [dataset, resetDiagnosis]);

  // Load diagnosis data for FileAsset
  useEffect(() => {
    if (!isFileAsset(dataset)) return;

    const loadDiagnosis = async () => {
      setDiagnosisLoading(true);
      try {
        const data = await getFileDiagnosis(projectId, dataset.id);
        setDiagnosis(data);
      } catch (err) {
        console.error('Failed to load diagnosis:', err);
      } finally {
        setDiagnosisLoading(false);
      }
    };

    void loadDiagnosis();
  }, [projectId, dataset]);

  return {
    diagnosis,
    diagnosisLoading,
    resetDiagnosis,
  };
}
