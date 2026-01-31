'use client';

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
  } = useDatasetIssues(projectId, dataset);

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
      <QuickScanSection
        diagnosis={diagnosis}
        diagnosisLoading={diagnosisLoading}
        onRescan={async () => {
          if (!isFileAsset(dataset)) return;
          try {
            const updated = await rescanQuickScan(projectId, dataset.id);
            onDiagnosisUpdate(updated);
          } catch (error) {
            console.error('Failed to rescan quick scan:', error);
          } finally {
            await refreshDiagnosis();
          }
        }}
      />

      {/* Divider */}
      <div className="border-t border-border/50" />

      {/* Issues Section */}
      <IssuesSection
        issues={issues}
        onRespond={handleRespond}
        onReset={handleReset}
        onFindIssues={() => void findIssues()}
        loading={issuesLoading}
      />

      {/* Divider */}
      <div className="border-t border-border/50" />

      {/* Confirmed Issues Section */}
      <ConfirmedIssuesSection issues={issues} />
    </div>
  );
}
