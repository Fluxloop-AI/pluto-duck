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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssetTableView } from '../../../editor/components/AssetTableView';
import type { FileDiagnosis, FilePreview } from '../../../../lib/fileAssetApi';
import type { CachedTablePreview } from '../../../../lib/sourceApi';
import type {
  AgentAnalysis,
  Dataset,
  DatasetTab,
  HistoryItem,
  SourceFile,
} from '../types';
import {
  buildSourceFiles,
  formatDate,
  formatFileSize,
  isFileAsset,
} from '../utils';

interface SummaryTabContentProps {
  dataset: Dataset;
  preview: FilePreview | CachedTablePreview | null;
  previewLoading: boolean;
  setActiveTab: (tab: DatasetTab) => void;
  diagnosis: FileDiagnosis | null;
  diagnosisLoading: boolean;
}

export function SummaryTabContent({
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
