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
  refreshIssues: () => Promise<void>;
  findIssues: () => Promise<void>;
  updateIssue: (issueId: string, status?: DiagnosisIssueStatus, userResponse?: string) => Promise<void>;
  deleteIssue: (issueId: string, reason?: string) => Promise<void>;
}

export function useDatasetIssues(projectId: string, dataset: Dataset): DatasetIssuesState {
  const [issues, setIssues] = useState<DiagnosisIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);

  const fileId = useMemo(() => (isFileAsset(dataset) ? dataset.id : null), [dataset]);

  const refreshIssues = useCallback(async () => {
    if (!fileId) return;
    setIssuesLoading(true);
    try {
      const response = await listDiagnosisIssues(projectId, fileId);
      setIssues(response.issues ?? []);
    } catch (error) {
      console.error('Failed to load issues:', error);
    } finally {
      setIssuesLoading(false);
    }
  }, [projectId, fileId]);

  const findIssues = useCallback(async () => {
    if (!fileId) return;
    setIssuesLoading(true);
    try {
      const response = await findDiagnosisIssues(projectId, fileId);
      setIssues(response.issues ?? []);
    } catch (error) {
      console.error('Failed to find issues:', error);
    } finally {
      setIssuesLoading(false);
    }
  }, [projectId, fileId]);

  const updateIssue = useCallback(
    async (issueId: string, status?: DiagnosisIssueStatus, userResponse?: string) => {
      if (!fileId) return;
      try {
        const updated = await updateDiagnosisIssue(projectId, issueId, {
          status,
          user_response: userResponse,
        });
        setIssues((prev) => prev.map((issue) => (issue.id === updated.id ? updated : issue)));
      } catch (error) {
        console.error('Failed to update issue:', error);
      }
    },
    [projectId, fileId]
  );

  const deleteIssue = useCallback(
    async (issueId: string, reason?: string) => {
      if (!fileId) return;
      try {
        const deleted = await deleteDiagnosisIssue(projectId, issueId, {
          delete_reason: reason,
        });
        setIssues((prev) => prev.filter((issue) => issue.id !== deleted.id));
      } catch (error) {
        console.error('Failed to delete issue:', error);
      }
    },
    [projectId, fileId]
  );

  useEffect(() => {
    if (!fileId) {
      setIssues([]);
      return;
    }
    void refreshIssues();
  }, [refreshIssues]);

  return {
    issues,
    issuesLoading,
    refreshIssues,
    findIssues,
    updateIssue,
    deleteIssue,
  };
}
