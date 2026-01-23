'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, FileText, History, Table, RefreshCw } from 'lucide-react';
import { AssetTableView } from '../editor/components/AssetTableView';
import { previewFileData, type FileAsset, type FilePreview } from '../../lib/fileAssetApi';
import { fetchCachedTablePreview, type CachedTable, type CachedTablePreview } from '../../lib/sourceApi';

export type Dataset = FileAsset | CachedTable;

type DatasetTab = 'summary' | 'history' | 'table';

interface DatasetDetailViewProps {
  projectId: string;
  dataset: Dataset;
  onBack: () => void;
}

function isFileAsset(dataset: Dataset): dataset is FileAsset {
  return 'file_type' in dataset;
}

function getDatasetName(dataset: Dataset): string {
  if (isFileAsset(dataset)) {
    return dataset.name || dataset.table_name;
  }
  return dataset.local_table;
}

export function DatasetDetailView({
  projectId,
  dataset,
  onBack,
}: DatasetDetailViewProps) {
  const [activeTab, setActiveTab] = useState<DatasetTab>('table');
  const [preview, setPreview] = useState<FilePreview | CachedTablePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load table preview data when dataset changes or tab becomes 'table'
  useEffect(() => {
    if (activeTab !== 'table') return;

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
  }, [projectId, dataset, activeTab]);

  const tabs: { id: DatasetTab; label: string; icon: React.ReactNode }[] = [
    { id: 'summary', label: 'Summary', icon: <FileText className="h-3.5 w-3.5" /> },
    { id: 'history', label: 'History', icon: <History className="h-3.5 w-3.5" /> },
    { id: 'table', label: 'Table', icon: <Table className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted transition-colors"
          title="Back to datasets"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-semibold truncate">{getDatasetName(dataset)}</h1>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 border-b px-6 pt-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm transition-colors ${
              activeTab === tab.id
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'table' && (
          <TableTabContent
            preview={preview}
            loading={loading}
            error={error}
          />
        )}
        {activeTab === 'summary' && (
          <PlaceholderTabContent
            icon={<FileText className="h-8 w-8 text-muted-foreground" />}
            title="Coming soon"
            description="Dataset schema, statistics, and metadata"
          />
        )}
        {activeTab === 'history' && (
          <PlaceholderTabContent
            icon={<History className="h-8 w-8 text-muted-foreground" />}
            title="Coming soon"
            description="Change history and version tracking"
          />
        )}
      </div>
    </div>
  );
}

interface TableTabContentProps {
  preview: FilePreview | CachedTablePreview | null;
  loading: boolean;
  error: string | null;
}

function TableTabContent({ preview, loading, error }: TableTabContentProps) {
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">No data available</p>
      </div>
    );
  }

  return (
    <AssetTableView
      columns={preview.columns}
      rows={preview.rows}
      totalRows={preview.total_rows ?? preview.rows.length}
      rowsPerPage={10}
    />
  );
}

interface PlaceholderTabContentProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function PlaceholderTabContent({ icon, title, description }: PlaceholderTabContentProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        {icon}
      </div>
      <div className="text-center">
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
