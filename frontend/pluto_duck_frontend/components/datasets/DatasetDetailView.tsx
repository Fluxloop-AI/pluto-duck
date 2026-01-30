'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Pencil,
  RefreshCw,
  Table2,
  Plus,
  FileText,
  Bot,
  ChevronRight,
  Check,
  Search,
  MessageSquare,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssetTableView } from '../editor/components/AssetTableView';
import { previewFileData, getFileDiagnosis, type FileAsset, type FilePreview, type FileDiagnosis } from '../../lib/fileAssetApi';
import { fetchCachedTablePreview, type CachedTable, type CachedTablePreview } from '../../lib/sourceApi';
import { DatasetHeader } from './DatasetHeader';

export type Dataset = FileAsset | CachedTable;

type DatasetTab = 'summary' | 'diagnosis' | 'table';

interface DatasetDetailViewProps {
  projectId: string;
  dataset: Dataset;
  onDelete?: () => void;
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

function getBaseName(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const parts = filePath.split(/[/\\\\]/);
  return parts[parts.length - 1] || null;
}

function buildSourceFiles(dataset: Dataset): SourceFile[] {
  if (!isFileAsset(dataset)) {
    return [
      {
        name: dataset.source_table || dataset.local_table || 'Unknown',
        rows: dataset.row_count,
        columns: null,
        size: null,
      },
    ];
  }

  const sources = dataset.sources && dataset.sources.length > 0 ? dataset.sources : null;
  if (!sources) {
    const fallbackName = getBaseName(dataset.file_path) || dataset.name || 'Unknown';
    return [
      {
        name: fallbackName,
        rows: dataset.row_count,
        columns: dataset.column_count,
        size: dataset.file_size_bytes,
      },
    ];
  }

  return sources.map((source) => ({
    name: source.original_name || getBaseName(source.file_path) || dataset.name || 'Unknown',
    rows: source.row_count ?? null,
    columns: null,
    size: source.file_size_bytes ?? null,
    addedAt: source.added_at ?? null,
  }));
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
  addedAt?: string | null;
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

interface SummaryTabContentProps {
  dataset: Dataset;
  preview: FilePreview | CachedTablePreview | null;
  previewLoading: boolean;
  setActiveTab: (tab: DatasetTab) => void;
  diagnosis: FileDiagnosis | null;
  diagnosisLoading: boolean;
}

function SummaryTabContent({
  dataset,
  preview,
  previewLoading,
  setActiveTab,
  diagnosis,
  diagnosisLoading,
}: SummaryTabContentProps) {
  const [memo, setMemo] = useState('');
  const [memoSaveTimeout, setMemoSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  // Get dataset ID for localStorage key
  const datasetId = dataset.id;

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

  // Build metadata
  const createdAt = isFileAsset(dataset) ? dataset.created_at : dataset.cached_at;

  // Agent Analysis from LLM diagnosis
  const agentAnalysis = useMemo((): AgentAnalysis | null => {
    const llmAnalysis = diagnosis?.llm_analysis;
    if (!llmAnalysis) return null;

    return {
      summary: llmAnalysis.context || '',
      bulletPoints: (llmAnalysis.potential || [])
        .filter((item) => item?.question)
        .map((item) => item.question),
      generatedAt: llmAnalysis.analyzed_at || new Date().toISOString(),
    };
  }, [diagnosis]);

  // Source files (multi-source aware with fallback)
  const sourceFiles = useMemo((): SourceFile[] => buildSourceFiles(dataset), [dataset]);

  // Mock diagnosis data based on dataset creation date
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
            {agentAnalysis && (
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
            )}
          </div>

          {diagnosisLoading ? (
            <div className="rounded-lg bg-muted/50 p-4 space-y-3">
              <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
              <div className="h-4 w-full bg-muted animate-pulse rounded" />
              <div className="h-4 w-2/3 bg-muted animate-pulse rounded" />
              <div className="mt-4 space-y-2">
                <div className="h-3 w-1/2 bg-muted animate-pulse rounded" />
                <div className="h-3 w-2/3 bg-muted animate-pulse rounded" />
                <div className="h-3 w-1/2 bg-muted animate-pulse rounded" />
              </div>
            </div>
          ) : agentAnalysis ? (
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-sm leading-relaxed">{agentAnalysis.summary}</p>
              {agentAnalysis.bulletPoints.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {agentAnalysis.bulletPoints.map((point, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">분석 정보가 없습니다</p>
            </div>
          )}
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

          {/* Diagnosis */}
          <div className="pt-4 space-y-3">
            <span className="text-sm text-muted-foreground">Diagnosis</span>
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

// =============================================================================
// Diagnosis Tab Types and Components
// =============================================================================

interface QuickScanItem {
  id: string;
  status: 'success' | 'warning';
  title: string;
  subtitle: string;
}

interface DatasetIssue {
  id: string;
  title: string;
  columnName: string;
  discoveredAt: string;
  example: string;
  description: string;
  isNew?: boolean;
  status: 'pending' | 'dismissed' | 'acknowledged';
  dismissedReason?: string;
  userNote?: string;
}

// Mock data for Quick Scan
const mockQuickScanItems: QuickScanItem[] = [
  {
    id: '1',
    status: 'success',
    title: '결측치 2.4%',
    subtitle: '양호',
  },
  {
    id: '2',
    status: 'success',
    title: '컬럼 타입',
    subtitle: '8개 중 7개 정상',
  },
  {
    id: '3',
    status: 'warning',
    title: 'date 컬럼',
    subtitle: 'string으로 저장됨',
  },
];

// Mock data for Issues
const initialMockIssues: DatasetIssue[] = [
  {
    id: '1',
    title: '날짜 형식이 섞여 있어요',
    columnName: 'date',
    discoveredAt: '2025.01.25',
    example: '"2025-01-22", "01/23/2025"',
    description: 'YYYY-MM-DD와 MM/DD/YYYY 형식이 섞여 있어요.',
    status: 'dismissed',
    dismissedReason: '문제 아님',
  },
  {
    id: '2',
    title: '금액 표기가 섞여 있어요',
    columnName: 'spend',
    discoveredAt: '2025.01.25',
    example: '"125000", "₩125,000"',
    description: '숫자만 있는 것과 통화 기호가 포함된 것이 섞여 있어요.',
    status: 'acknowledged',
    userNote: '"미국 지사 데이터라 원래 이래요"',
  },
  {
    id: '3',
    title: '전화번호 형식이 섞여 있어요',
    columnName: 'phone',
    discoveredAt: '2025.01.26',
    example: '"010-1234-5678", "01012345678"',
    description: '하이픈이 있는 것과 없는 것이 섞여 있어요.',
    isNew: true,
    status: 'pending',
  },
  {
    id: '4',
    title: '결측치에 패턴이 있어요',
    columnName: 'revenue',
    discoveredAt: '2025.01.26',
    example: 'conversions=0 일 때 revenue=null',
    description: '전환이 없을 때 매출이 비어있어요. 의도된 건지 확인이 필요해요.',
    isNew: true,
    status: 'pending',
  },
];

function QuickScanSection() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Quick Scan
        </h3>
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted/50 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Rescan
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        업로드 시 자동으로 검사한 결과예요.
      </p>

      <div>
        {mockQuickScanItems.map((item, index) => {
          const isSuccess = item.status === 'success';
          const isLast = index === mockQuickScanItems.length - 1;

          return (
            <div
              key={item.id}
              className={cn(
                'flex items-center gap-3 py-3',
                !isLast && 'border-b border-[#f0efed]'
              )}
            >
              {/* Icon with circular background */}
              <div
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]',
                  isSuccess
                    ? 'bg-[#f0fdf4] text-[#16a34a]'
                    : 'bg-[#fefce8] text-[#d97706]'
                )}
              >
                {isSuccess ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : (
                  <span className="font-semibold">!</span>
                )}
              </div>
              {/* Label */}
              <span className="text-sm font-medium text-[#1c1917]">{item.title}</span>
              {/* Detail */}
              <span className="text-[13px] text-[#a8a29e] ml-1">{item.subtitle}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IssueCard({
  issue,
  onRespond,
  onReset,
}: {
  issue: DatasetIssue;
  onRespond: (id: string, response: string, note?: string) => void;
  onReset: (id: string) => void;
}) {
  const [showInput, setShowInput] = useState(false);
  const [userInput, setUserInput] = useState('');

  const handleCustomInput = () => {
    if (userInput.trim()) {
      onRespond(issue.id, 'custom', userInput.trim());
      setShowInput(false);
      setUserInput('');
    }
  };

  const getStatusText = () => {
    if (issue.status === 'dismissed') {
      return issue.dismissedReason || '문제 아님';
    }
    if (issue.status === 'acknowledged') {
      if (issue.userNote) {
        return issue.userNote;
      }
      return '문제 맞음';
    }
    return '';
  };

  const getStatusColor = () => {
    if (issue.status === 'acknowledged') {
      if (issue.userNote === '확인 필요') {
        return 'text-[#d97706]'; // warning color
      }
      return 'text-red-500'; // "문제 맞음" - red color
    }
    return 'text-muted-foreground';
  };

  return (
    <div className="rounded-xl bg-muted/50 p-5 space-y-4">
      {/* Header */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 text-xs bg-background border border-border rounded-md font-medium text-muted-foreground">{issue.columnName}</span>
          <h4 className="text-base font-medium">{issue.title}</h4>
          {issue.isNew && (
            <span className="text-[10px] font-semibold text-red-500">NEW</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{issue.discoveredAt} 발견</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground">{issue.description}</p>

      {/* Example */}
      <div className="rounded-lg bg-background px-4 py-3">
        <code className="text-sm text-muted-foreground">예: {issue.example}</code>
      </div>

      {/* Actions or Status */}
      {issue.status === 'pending' && !showInput && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => onRespond(issue.id, 'correct')}
            className="px-4 py-2 text-sm bg-background border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            맞아요
          </button>
          <button
            type="button"
            onClick={() => onRespond(issue.id, 'incorrect')}
            className="px-4 py-2 text-sm bg-background border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            아니에요
          </button>
          <button
            type="button"
            onClick={() => onRespond(issue.id, 'unknown')}
            className="px-4 py-2 text-sm bg-background border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            잘 모르겠어요
          </button>
          <button
            type="button"
            onClick={() => setShowInput(true)}
            className="px-4 py-2 text-sm bg-background border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            직접 입력
          </button>
        </div>
      )}

      {/* Custom Input Mode */}
      {issue.status === 'pending' && showInput && (
        <div className="space-y-3 pt-1">
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="이 데이터에 대해 알려주세요..."
            className="w-full min-h-[80px] rounded-lg border border-border bg-background p-3 text-sm resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowInput(false);
                setUserInput('');
              }}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleCustomInput}
              className="px-4 py-2 text-sm bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* Resolved Status */}
      {issue.status !== 'pending' && (
        <div className="flex items-center justify-between pt-1">
          <span className={cn('text-sm', getStatusColor())}>
            {getStatusText()}
          </span>
          <button
            type="button"
            onClick={() => onReset(issue.id)}
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
          >
            다시 확인하기
          </button>
        </div>
      )}
    </div>
  );
}

function IssuesSection({
  issues,
  onRespond,
  onReset,
}: {
  issues: DatasetIssue[];
  onRespond: (id: string, response: string, note?: string) => void;
  onReset: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Issues
        </h3>
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted/50 transition-colors"
        >
          <Search className="h-4 w-4" />
          Find Issues
        </button>
      </div>

      <div className="space-y-4">
        {issues.map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            onRespond={onRespond}
            onReset={onReset}
          />
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Confirmed Issues Section
// =============================================================================

type IssueResponseType = 'yes' | 'no' | 'custom' | 'unsure';

interface IssueResponseInfo {
  type: IssueResponseType;
  text: string;
  color: string;
}

function getIssueResponseInfo(issue: DatasetIssue): IssueResponseInfo | null {
  if (issue.status === 'pending') {
    return null;
  }

  if (issue.status === 'dismissed') {
    return {
      type: 'no',
      text: '문제 아님',
      color: 'text-[#a8a29e]',
    };
  }

  // status === 'acknowledged'
  if (!issue.userNote) {
    return {
      type: 'yes',
      text: '문제 맞음',
      color: 'text-red-500',
    };
  }

  if (issue.userNote === '확인 필요') {
    return {
      type: 'unsure',
      text: '확인 필요',
      color: 'text-[#d97706]',
    };
  }

  // Custom user note
  const displayText = issue.userNote.length > 25
    ? `${issue.userNote.slice(0, 25)}...`
    : issue.userNote;

  return {
    type: 'custom',
    text: displayText,
    color: 'text-[#a8a29e]',
  };
}

function ConfirmedIssuesSection({ issues }: { issues: DatasetIssue[] }) {
  const confirmedIssues = issues.filter((issue) => issue.status !== 'pending');

  if (confirmedIssues.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Confirmed Issues
      </h3>

      <div className="rounded-xl bg-muted/50 p-4">
        {confirmedIssues.map((issue, index) => {
          const responseInfo = getIssueResponseInfo(issue);
          const isLast = index === confirmedIssues.length - 1;

          return (
            <div
              key={issue.id}
              className={cn(
                'flex items-center gap-2.5 py-2',
                !isLast && 'border-b border-[#f0efed]'
              )}
            >
              <Check
                size={14}
                className="shrink-0 text-[#292524]"
                strokeWidth={2.5}
              />
              <span className="flex-1 text-[13px] text-[#57534e]">
                {issue.title}
              </span>
              {responseInfo && (
                <span className={cn('text-xs', responseInfo.color)}>
                  {responseInfo.text}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg bg-[#292524] px-4 py-2.5 text-sm text-white hover:bg-[#1c1917] transition-colors"
        >
          <MessageSquare size={14} />
          <span>에이전트와 함께 정리하기</span>
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function DiagnosisTabContent() {
  const [issues, setIssues] = useState<DatasetIssue[]>(initialMockIssues);

  const handleRespond = (id: string, response: string, note?: string) => {
    setIssues((prev) =>
      prev.map((issue) => {
        if (issue.id !== id) return issue;

        if (response === 'correct') {
          return { ...issue, status: 'acknowledged' as const, isNew: false };
        }
        if (response === 'incorrect') {
          return { ...issue, status: 'dismissed' as const, dismissedReason: '문제 아님', isNew: false };
        }
        if (response === 'unknown') {
          return { ...issue, status: 'acknowledged' as const, userNote: '확인 필요', isNew: false };
        }
        if (response === 'custom' && note) {
          return { ...issue, status: 'acknowledged' as const, userNote: `"${note}"`, isNew: false };
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
      <QuickScanSection />

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
