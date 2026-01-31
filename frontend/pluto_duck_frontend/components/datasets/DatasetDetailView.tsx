'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { DatasetHeader } from './DatasetHeader';
import {
  DiagnosisTabContent,
  SummaryTabContent,
  TableTabContent,
  useDatasetDiagnosis,
  useDatasetPreview,
} from './detail';
import type { Dataset, DatasetTab } from './detail';

const DATASET_DETAIL_TABS: { id: DatasetTab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'diagnosis', label: 'Diagnosis' },
  { id: 'table', label: 'Table' },
];

interface DatasetDetailViewProps {
  projectId: string;
  dataset: Dataset;
  onDelete?: () => void;
}

export function DatasetDetailView({
  projectId,
  dataset,
  onDelete,
}: DatasetDetailViewProps) {
  const [activeTab, setActiveTab] = useState<DatasetTab>('summary');
  const { diagnosis, diagnosisLoading } = useDatasetDiagnosis(projectId, dataset);
  const { preview, loading, error } = useDatasetPreview(projectId, dataset, activeTab);
  const summaryProps = {
    dataset,
    preview,
    previewLoading: loading,
    setActiveTab,
    diagnosis,
    diagnosisLoading,
  };
  const tableProps = {
    preview,
    loading,
    error,
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab Bar */}
      <div className="flex items-center bg-background pt-2">
        <div className="w-full max-w-4xl pl-6">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {DATASET_DETAIL_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm transition-colors',
                  activeTab === tab.id
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-6 px-8">
        <div className="max-w-4xl space-y-12">
          {/* Shared Header */}
          <DatasetHeader dataset={dataset} onDelete={onDelete} />

          {/* Tab Content */}
          {activeTab === 'table' && (
            <TableTabContent {...tableProps} />
          )}
          {activeTab === 'summary' && (
            <SummaryTabContent {...summaryProps} />
          )}
          {activeTab === 'diagnosis' && (
            <DiagnosisTabContent
              diagnosis={diagnosis}
              diagnosisLoading={diagnosisLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
}
