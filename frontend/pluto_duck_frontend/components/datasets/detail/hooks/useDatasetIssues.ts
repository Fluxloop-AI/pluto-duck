'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteDiagnosisIssue,
  findDiagnosisIssues,
  listDiagnosisIssues,
  updateDiagnosisIssue,
  type DiagnosisIssue,
  type DiagnosisIssueStatus,
} from '../../../../lib/fileAssetApi';
import type { Dataset } from '../types';
import { isFileAsset } from '../utils';

interface DatasetIssuesState {
  issues: DiagnosisIssue[];
  issuesLoading: boolean;
  issuesError: string | null;
  refreshIssues: () => Promise<void>;
  findIssues: () => Promise<void>;
  updateIssue: (issueId: string, status?: DiagnosisIssueStatus, userResponse?: string) => Promise<void>;
  deleteIssue: (issueId: string, reason?: string) => Promise<void>;
}

export function useDatasetIssues(projectId: string, dataset: Dataset): DatasetIssuesState {
  const [issues, setIssues] = useState<DiagnosisIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);

  const fileId = useMemo(() => (isFileAsset(dataset) ? dataset.id : null), [dataset]);

  const refreshIssues = useCallback(async () => {
    if (!fileId) return;
    setIssuesError(null);
    setIssuesLoading(true);
    try {
      const response = await listDiagnosisIssues(projectId, fileId);
      setIssues(response.issues ?? []);
    } catch (error) {
      setIssuesError(error instanceof Error ? error.message : 'Failed to load issues');
    } finally {
      setIssuesLoading(false);
    }
  }, [projectId, fileId]);

  const findIssues = useCallback(async () => {
    if (!fileId) return;
    setIssuesError(null);
    setIssuesLoading(true);
    try {
      const response = await findDiagnosisIssues(projectId, fileId);
      setIssues(response.issues ?? []);
    } catch (error) {
      setIssuesError(error instanceof Error ? error.message : 'Failed to find issues');
    } finally {
      setIssuesLoading(false);
    }
  }, [projectId, fileId]);

  const updateIssue = useCallback(
    async (issueId: string, status?: DiagnosisIssueStatus, userResponse?: string) => {
      if (!fileId) return;
      setIssuesError(null);
      try {
        const updated = await updateDiagnosisIssue(projectId, issueId, {
          status,
          user_response: userResponse,
        });
        setIssues((prev) => prev.map((issue) => (issue.id === updated.id ? updated : issue)));
      } catch (error) {
        setIssuesError(error instanceof Error ? error.message : 'Failed to update issue');
      }
    },
    [projectId, fileId]
  );

  const deleteIssue = useCallback(
    async (issueId: string, reason?: string) => {
      if (!fileId) return;
      setIssuesError(null);
      try {
        const deleted = await deleteDiagnosisIssue(projectId, issueId, {
          delete_reason: reason,
        });
        setIssues((prev) => prev.filter((issue) => issue.id !== deleted.id));
      } catch (error) {
        setIssuesError(error instanceof Error ? error.message : 'Failed to delete issue');
      }
    },
    [projectId, fileId]
  );

  useEffect(() => {
    if (!fileId) {
      setIssues([]);
      setIssuesError(null);
      return;
    }
    void refreshIssues();
  }, [refreshIssues]);

  return {
    issues,
    issuesLoading,
    issuesError,
    refreshIssues,
    findIssues,
    updateIssue,
    deleteIssue,
  };
}
