'use client';

import { useState, useEffect, useCallback } from 'react';

interface DatasetMemoState {
  memo: string;
  setMemo: (value: string) => void;
  handleMemoChange: (value: string) => void;
}

export function useDatasetMemo(datasetId: string): DatasetMemoState {
  const [memo, setMemo] = useState('');
  const [memoSaveTimeout, setMemoSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  // Load memo from localStorage on mount (or reset if no saved memo)
  useEffect(() => {
    const savedMemo = localStorage.getItem(`dataset-memo-${datasetId}`);
    setMemo(savedMemo || '');
  }, [datasetId]);

  // Debounced save to localStorage
  const handleMemoChange = useCallback((value: string) => {
    setMemo(value);
    if (memoSaveTimeout) {
      clearTimeout(memoSaveTimeout);
    }
    const timeout = setTimeout(() => {
      localStorage.setItem(`dataset-memo-${datasetId}`, value);
    }, 500);
    setMemoSaveTimeout(timeout);
  }, [datasetId, memoSaveTimeout]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (memoSaveTimeout) {
        clearTimeout(memoSaveTimeout);
      }
    };
  }, [memoSaveTimeout]);

  return {
    memo,
    setMemo,
    handleMemoChange,
  };
}
