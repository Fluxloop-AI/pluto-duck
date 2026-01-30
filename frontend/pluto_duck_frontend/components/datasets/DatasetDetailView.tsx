'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  previewFileData,
  getFileDiagnosis,
  type FilePreview,
  type FileDiagnosis,
} from '../../lib/fileAssetApi';
import {
  fetchCachedTablePreview,
  type CachedTablePreview,
} from '../../lib/sourceApi';
import { DatasetHeader } from './DatasetHeader';
import { DiagnosisTabContent } from './detail/diagnosis/DiagnosisTabContent';
import { SummaryTabContent } from './detail/summary/SummaryTabContent';
import { TableTabContent } from './detail/table/TableTabContent';
import type { Dataset, DatasetTab } from './detail/types';
import { isFileAsset } from './detail/utils';

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
  const [preview, setPreview] = useState<FilePreview | CachedTablePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<FileDiagnosis | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);

  // Reset preview and diagnosis when dataset changes
  useEffect(() => {
    setPreview(null);
    setError(null);
    setDiagnosis(null);
  }, [dataset]);

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

  const tabs: { id: DatasetTab; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'diagnosis', label: 'Diagnosis' },
    { id: 'table', label: 'Table' },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Tab Bar */}
      <div className="flex items-center bg-background pt-2">
        <div className="w-full max-w-4xl pl-6">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => (
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
            <TableTabContent
              preview={preview}
              loading={loading}
              error={error}
            />
          )}
          {activeTab === 'summary' && (
            <SummaryTabContent
              dataset={dataset}
              preview={preview}
              previewLoading={loading}
              setActiveTab={setActiveTab}
              diagnosis={diagnosis}
              diagnosisLoading={diagnosisLoading}
            />
          )}
          {activeTab === 'diagnosis' && (
            <DiagnosisTabContent />
          )}
        </div>
      </div>
    </div>
  );
}
