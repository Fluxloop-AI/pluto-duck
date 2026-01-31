'use client';

import { useState } from 'react';
import { initialMockIssues } from '../mocks';
import type { FileDiagnosis } from '../../../../lib/fileAssetApi';
import type { DatasetIssue } from '../types';
import { ConfirmedIssuesSection } from './ConfirmedIssuesSection';
import { IssuesSection } from './IssuesSection';
import { QuickScanSection } from './QuickScanSection';

interface DiagnosisTabContentProps {
  diagnosis: FileDiagnosis | null;
  diagnosisLoading: boolean;
}

export function DiagnosisTabContent({
  diagnosis,
  diagnosisLoading,
}: DiagnosisTabContentProps) {
  const [issues, setIssues] = useState<DatasetIssue[]>(initialMockIssues);

  const handleRespond = (id: string, response: string, note?: string) => {
    setIssues((prev) =>
      prev.map((issue) => {
        if (issue.id !== id) return issue;

        if (response === 'correct') {
          return { ...issue, status: 'acknowledged' as const, isNew: false };
        }
        if (response === 'incorrect') {
          return {
            ...issue,
            status: 'dismissed' as const,
            dismissedReason: 'Not an issue',
            isNew: false,
          };
        }
        if (response === 'unknown') {
          return {
            ...issue,
            status: 'acknowledged' as const,
            userNote: 'Needs review',
            isNew: false,
          };
        }
        if (response === 'custom' && note) {
          return {
            ...issue,
            status: 'acknowledged' as const,
            userNote: note,
            isNew: false,
          };
        }
        return issue;
      })
    );
  };

  const handleReset = (id: string) => {
    setIssues((prev) =>
      prev.map((issue) => {
        if (issue.id !== id) return issue;
        return {
          ...issue,
          status: 'pending' as const,
          dismissedReason: undefined,
          userNote: undefined,
        };
      })
    );
  };

  return (
    <div className="space-y-12">
      {/* Quick Scan Section */}
      <QuickScanSection
        diagnosis={diagnosis}
        diagnosisLoading={diagnosisLoading}
      />

      {/* Divider */}
      <div className="border-t border-border/50" />

      {/* Issues Section */}
      <IssuesSection
        issues={issues}
        onRespond={handleRespond}
        onReset={handleReset}
      />

      {/* Divider */}
      <div className="border-t border-border/50" />

      {/* Confirmed Issues Section */}
      <ConfirmedIssuesSection issues={issues} />
    </div>
  );
}
