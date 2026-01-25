'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  History,
  Pencil,
  RefreshCw,
  Table2,
  Plus,
  FileText,
  Bot,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssetTableView } from '../editor/components/AssetTableView';
import { previewFileData, type FileAsset, type FilePreview } from '../../lib/fileAssetApi';
import { fetchCachedTablePreview, type CachedTable, type CachedTablePreview } from '../../lib/sourceApi';
import { DatasetHeader } from './DatasetHeader';

export type Dataset = FileAsset | CachedTable;

type DatasetTab = 'summary' | 'history' | 'table';

interface DatasetDetailViewProps {
  projectId: string;
  dataset: Dataset;
}

// =============================================================================
// Utility Functions
// =============================================================================

export function isFileAsset(dataset: Dataset): dataset is FileAsset {
  return 'file_type' in dataset;
}

export function getDatasetName(dataset: Dataset): string {
  if (isFileAsset(dataset)) {
    return dataset.name || dataset.table_name;
  }
  return dataset.local_table;
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hours}:${minutes}`;
}

// =============================================================================
// Types
// =============================================================================

interface AgentAnalysis {
  summary: string;
  bulletPoints: string[];
  generatedAt: string;
}

interface SourceFile {
  name: string;
  rows: number | null;
  columns: number | null;
  size: number | null;
}

interface HistoryItem {
  id: string;
  title: string;
  timestamp: string;
  isHighlighted: boolean;
  badge?: string;
}

export function DatasetDetailView({
  projectId,
  dataset,
}: DatasetDetailViewProps) {
  const [activeTab, setActiveTab] = useState<DatasetTab>('summary');
  const [preview, setPreview] = useState<FilePreview | CachedTablePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset preview when dataset changes
  useEffect(() => {
    setPreview(null);
    setError(null);
  }, [dataset]);

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
    { id: 'history', label: 'History' },
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
          <DatasetHeader dataset={dataset} />

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
    </div>
  );
}

interface SummaryTabContentProps {
  dataset: Dataset;
  preview: FilePreview | CachedTablePreview | null;
  previewLoading: boolean;
  setActiveTab: (tab: DatasetTab) => void;
}

function SummaryTabContent({
  dataset,
  preview,
  previewLoading,
  setActiveTab,
}: SummaryTabContentProps) {
  const [memo, setMemo] = useState('');
  const [memoSaveTimeout, setMemoSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  // Get dataset ID for localStorage key
  const datasetId = isFileAsset(dataset) ? dataset.id : dataset.id;

  // Load memo from localStorage on mount
  useEffect(() => {
    const savedMemo = localStorage.getItem(`dataset-memo-${datasetId}`);
    if (savedMemo) {
      setMemo(savedMemo);
    }
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

  // Build metadata
  const rowCount = isFileAsset(dataset) ? dataset.row_count : dataset.row_count;
  const columnCount = isFileAsset(dataset) ? dataset.column_count : null;
  const fileSize = isFileAsset(dataset) ? dataset.file_size_bytes : null;
  const createdAt = isFileAsset(dataset) ? dataset.created_at : dataset.cached_at;
  const originalFileName = isFileAsset(dataset) ? dataset.name : dataset.source_table;

  // Mock Agent Analysis (based on dataset characteristics)
  const mockAnalysis = useMemo((): AgentAnalysis => {
    const name = getDatasetName(dataset);
    return {
      summary: `Meta Ads Manager에서 추출한 것으로 보이는 광고 성과 데이터입니다. 2개 캠페인(신규가입_프로모션, 리타겟팅_장바구니)의 10일간(1/22-31) 일별 퍼포먼스를 담고 있습니다.`,
      bulletPoints: [
        '캠페인별 효율(CPC, CTR, ROAS) 비교',
        '일별 성과 추이 및 이상 탐지',
        '비용 대비 전환 최적화 포인트 탐색',
      ],
      generatedAt: new Date().toISOString(),
    };
  }, [dataset]);

  // Source files (currently just the main file)
  const sourceFiles = useMemo((): SourceFile[] => {
    return [{
      name: originalFileName || 'Unknown',
      rows: rowCount,
      columns: columnCount,
      size: fileSize,
    }];
  }, [originalFileName, rowCount, columnCount, fileSize]);

  // Mock history data based on dataset creation date
  const historyItems = useMemo((): HistoryItem[] => {
    const createdDate = createdAt ? new Date(createdAt) : new Date();
    const processedDate = new Date(createdDate);
    processedDate.setDate(processedDate.getDate() + 1);
    processedDate.setHours(9, 15, 0, 0);

    return [
      {
        id: '1',
        title: 'Pre-processing completed',
        timestamp: processedDate.toISOString(),
        isHighlighted: true,
        badge: 'Agent',
      },
      {
        id: '2',
        title: 'Dataset created',
        timestamp: createdDate.toISOString(),
        isHighlighted: false,
      },
    ];
  }, [createdAt]);

  return (
    <div className="space-y-12">
      {/* DATA CONTEXT Section */}
      <div className="space-y-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Data Context
        </h3>

        {/* Agent Analysis Card */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bot className="h-4 w-4" />
              <span>Agent Analysis</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="h-3 w-3" />
                <span>Edit</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Regenerate</span>
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-sm leading-relaxed">{mockAnalysis.summary}</p>
            <ul className="mt-3 space-y-1.5">
              {mockAnalysis.bulletPoints.map((point, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Memo Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span>Memo</span>
        </div>
        <textarea
          value={memo}
          onChange={(e) => handleMemoChange(e.target.value)}
          placeholder="Add your memo here..."
          className="w-full min-h-[120px] rounded-lg bg-muted/50 p-4 text-sm resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Divider */}
      <div className="border-t border-border/50 my-12" />

      {/* ORIGINAL SOURCES Section */}
      <div className="space-y-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Original Sources
        </h3>

        <div className="space-y-2">
          {sourceFiles.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-3 rounded-lg bg-muted/50 p-3 hover:bg-muted/70 transition-colors"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded bg-muted">
                <Table2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {file.rows !== null && <>{file.rows.toLocaleString()} rows</>}
                  {file.columns !== null && <> · {file.columns} columns</>}
                  {file.size !== null && <> · {formatFileSize(file.size)}</>}
                </p>
              </div>
            </div>
          ))}

          {/* Add More Data Button */}
          <button
            type="button"
            className="flex items-center gap-2 w-fit rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Add More Data</span>
          </button>

          {/* History */}
          <div className="pt-4 space-y-3">
            <span className="text-sm text-muted-foreground">History</span>
            <div className="space-y-4">
              {historyItems.map((item) => (
                <div key={item.id} className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-1.5 h-2.5 w-2.5 rounded-full shrink-0',
                      item.isHighlighted ? 'bg-blue-500' : 'bg-muted-foreground/40'
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{item.title}</span>
                      {item.badge && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(item.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border/50 my-12" />

      {/* SAMPLE DATA Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Sample Data
          </h3>
          <button
            type="button"
            onClick={() => setActiveTab('table')}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>View More</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {previewLoading ? (
          <div className="flex h-48 items-center justify-center rounded-lg border border-border">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : preview && preview.rows.length > 0 ? (
          <AssetTableView
            columns={preview.columns}
            rows={preview.rows}
            totalRows={preview.total_rows ?? preview.rows.length}
            initialRows={5}
            hideFooter
          />
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-border">
            <p className="text-sm text-muted-foreground">No preview data available</p>
          </div>
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
    <div className="space-y-6">
      <AssetTableView
        columns={preview.columns}
        rows={preview.rows}
        totalRows={preview.total_rows ?? preview.rows.length}
        alwaysShowSearch
      />

      {/* Add More Data Button */}
      <button
        type="button"
        className="flex items-center gap-2 w-fit rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        <Plus className="h-4 w-4" />
        <span>Add More Data</span>
      </button>
    </div>
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
