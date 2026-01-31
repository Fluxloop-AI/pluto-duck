'use client';

import { useState } from 'react';
import type { FileDiagnosis } from '../../../../lib/fileAssetApi';
import { rescanQuickScan } from '../../../../lib/fileAssetApi';
import type { Dataset } from '../types';
import { useDatasetIssues } from '../hooks/useDatasetIssues';
import { isFileAsset } from '../utils';
import { ConfirmedIssuesSection } from './ConfirmedIssuesSection';
import { IssuesSection } from './IssuesSection';
import { QuickScanSection } from './QuickScanSection';

interface DiagnosisTabContentProps {
  projectId: string;
  dataset: Dataset;
  diagnosis: FileDiagnosis | null;
  diagnosisLoading: boolean;
  onDiagnosisUpdate: (diagnosis: FileDiagnosis | null) => void;
  refreshDiagnosis: () => Promise<void>;
}

export function DiagnosisTabContent({
  projectId,
  dataset,
  diagnosis,
  diagnosisLoading,
  onDiagnosisUpdate,
  refreshDiagnosis,
}: DiagnosisTabContentProps) {
  const {
    issues,
    issuesLoading,
    findIssues,
    updateIssue,
    issuesError,
  } = useDatasetIssues(projectId, dataset);
  const [quickScanError, setQuickScanError] = useState<string | null>(null);

  const handleRespond = (id: string, response: string, note?: string) => {
    if (response === 'correct') {
      void updateIssue(id, 'confirmed');
      return;
    }
    if (response === 'incorrect') {
      void updateIssue(id, 'dismissed', 'Not an issue');
      return;
    }
    if (response === 'unknown') {
      void updateIssue(id, 'confirmed', 'Needs review');
      return;
    }
    if (response === 'custom' && note) {
      void updateIssue(id, 'confirmed', note);
    }
  };

  const handleReset = (id: string) => {
    void updateIssue(id, 'open', '');
  };

  return (
    <div className="space-y-12">
      {/* Quick Scan Section */}
      <div className="space-y-4">
        <QuickScanSection
          diagnosis={diagnosis}
          diagnosisLoading={diagnosisLoading}
          onRescan={async () => {
            if (!isFileAsset(dataset)) return;
            setQuickScanError(null);
            try {
              const updated = await rescanQuickScan(projectId, dataset.id);
              onDiagnosisUpdate(updated);
            } catch (error) {
              setQuickScanError(error instanceof Error ? error.message : 'Failed to rescan quick scan');
            } finally {
              await refreshDiagnosis();
            }
          }}
        />
        {quickScanError && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {quickScanError}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border/50" />

      {/* Issues Section */}
      <div className="space-y-4">
        {issuesError && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {issuesError}
          </div>
        )}
        <IssuesSection
          issues={issues}
          onRespond={handleRespond}
          onReset={handleReset}
          onFindIssues={() => void findIssues()}
          loading={issuesLoading}
        />
      </div>

      {/* Divider */}
      <div className="border-t border-border/50" />

      {/* Confirmed Issues Section */}
      <ConfirmedIssuesSection issues={issues} />
    </div>
  );
}
