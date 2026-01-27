'use client';

import { useState, useEffect, useRef } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { FileDiagnosis } from '../../lib/fileAssetApi';

interface SelectedFile {
  id: string;
  name: string;
  path: string | null;
  file?: File;
}

interface DatasetAnalyzingViewProps {
  diagnosisResults: FileDiagnosis[] | null;
  selectedFiles: SelectedFile[];
  onComplete: () => void;
  llmReady: boolean;
}

type StepStatus = 'pending' | 'processing' | 'completed';

interface AnalysisStep {
  id: string;
  label: string;
  processingLabel: string;
}

const ANALYSIS_STEPS: AnalysisStep[] = [
  { id: 'files', label: 'File check complete', processingLabel: 'Checking files...' },
  { id: 'parsing', label: 'Data parsing complete', processingLabel: 'Parsing data...' },
  { id: 'columns', label: 'Column structure analysis complete', processingLabel: 'Analyzing column structure...' },
  { id: 'quality', label: 'Data quality check complete', processingLabel: 'Checking data quality...' },
  { id: 'statistics', label: 'Statistical analysis complete', processingLabel: 'Analyzing statistics...' },
  { id: 'naming', label: 'Dataset name ready', processingLabel: 'Thinking of dataset name...' },
  { id: 'description', label: 'Description ready', processingLabel: 'Writing description...' },
  { id: 'understanding', label: 'Data understanding complete', processingLabel: 'Understanding data...' },
  { id: 'integration', label: 'Integration complete', processingLabel: 'Integrating checks...' },
];

// Helper functions
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileNameFromPath(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

function getColumnTypeSummaryForFile(diagnosis: FileDiagnosis): { numeric: number; text: number; date: number; other: number } {
  const summary = { numeric: 0, text: 0, date: 0, other: 0 };

  for (const col of diagnosis.columns) {
    const type = col.type.toLowerCase();
    if (type.includes('int') || type.includes('float') || type.includes('double') || type.includes('decimal') || type.includes('numeric')) {
      summary.numeric++;
    } else if (type.includes('varchar') || type.includes('text') || type.includes('string') || type.includes('char')) {
      summary.text++;
    } else if (type.includes('date') || type.includes('time') || type.includes('timestamp')) {
      summary.date++;
    } else {
      summary.other++;
    }
  }

  return summary;
}

function calculateMissingRateForFile(diagnosis: FileDiagnosis): number {
  const rowCount = diagnosis.row_count || 0;
  const colCount = diagnosis.columns.length;
  const totalCells = rowCount * colCount;

  if (totalCells === 0) return 0;

  let totalMissing = 0;
  for (const count of Object.values(diagnosis.missing_values)) {
    totalMissing += count;
  }

  return Math.round((totalMissing / totalCells) * 1000) / 10;
}

function getParsingSuccessRateForFile(diagnosis: FileDiagnosis): number {
  if (!diagnosis.parsing_integrity) return 100;

  const { total_lines, parsed_rows } = diagnosis.parsing_integrity;
  if (total_lines === 0) return 100;

  return Math.round((parsed_rows / total_lines) * 100);
}

function getDateRangeSummaryForFile(diagnosis: FileDiagnosis): string | null {
  if (!diagnosis.column_statistics) return null;

  for (const stat of diagnosis.column_statistics) {
    if (stat.date_stats) {
      const { min_date, max_date, span_days } = stat.date_stats;
      return `${min_date} ~ ${max_date} (${span_days}d)`;
    }
  }
  return null;
}

function getNumericRangeSummaryForFile(diagnosis: FileDiagnosis): string | null {
  if (!diagnosis.column_statistics) return null;

  for (const stat of diagnosis.column_statistics) {
    if (stat.numeric_stats) {
      const { min, max } = stat.numeric_stats;
      return `${stat.column_name}: ${min.toLocaleString()} ~ ${max.toLocaleString()}`;
    }
  }
  return null;
}

// ResultTag component
const ResultTag: React.FC<{ children: React.ReactNode; variant?: 'default' | 'count' }> = ({
  children,
  variant = 'default'
}) => (
  <span
    className={`
      inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
      ${variant === 'count'
        ? 'bg-primary/10 text-primary'
        : 'bg-muted text-muted-foreground'
      }
    `}
  >
    {children}
  </span>
);

export function DatasetAnalyzingView({
  diagnosisResults,
  selectedFiles,
  onComplete,
  llmReady,
}: DatasetAnalyzingViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>(() => {
    const initial: Record<string, StepStatus> = {};
    ANALYSIS_STEPS.forEach((step) => {
      initial[step.id] = 'pending';
    });
    return initial;
  });

  const [visibleResults, setVisibleResults] = useState<Record<string, boolean>>({});

  // Auto-scroll when content changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [stepStatuses, visibleResults]);

  // Track which phase we've started processing (using refs to avoid cleanup issues)
  const phase1StartedRef = useRef(false);
  const phase2StartedRef = useRef(false);

  // Track when data first arrives (prevents re-trigger on subsequent updates)
  const [dataArrived, setDataArrived] = useState(false);

  // Steps 1-5 IDs (file/data analysis)
  const PHASE1_STEPS = ['files', 'parsing', 'columns', 'quality', 'statistics'];
  // Steps 6-9 IDs (LLM analysis)
  const PHASE2_STEPS = ['naming', 'description', 'understanding', 'integration'];

  // Start with first step processing immediately on mount
  useEffect(() => {
    setStepStatuses((prev) => ({ ...prev, files: 'processing' }));
  }, []);

  // Detect when diagnosisResults first arrives (only triggers once)
  useEffect(() => {
    if (diagnosisResults && !dataArrived) {
      setDataArrived(true);
    }
  }, [diagnosisResults, dataArrived]);

  // Phase 1: Process steps 1-5 when data first arrives
  useEffect(() => {
    if (!dataArrived || phase1StartedRef.current) return;

    phase1StartedRef.current = true;
    let isActive = true;
    let currentIndex = 0;

    const processPhase1Step = () => {
      if (!isActive) return;

      if (currentIndex >= PHASE1_STEPS.length) {
        // Phase 1 complete, start phase 2 processing indicator if not started yet
        if (!phase2StartedRef.current) {
          setStepStatuses((prev) => ({ ...prev, naming: 'processing' }));
        }
        return;
      }

      const stepId = PHASE1_STEPS[currentIndex];
      setStepStatuses((prev) => ({ ...prev, [stepId]: 'processing' }));

      // Processing time for each step (300-500ms as per plan)
      const processingTime = 300 + Math.random() * 200;

      setTimeout(() => {
        if (!isActive) return;

        setStepStatuses((prev) => ({ ...prev, [stepId]: 'completed' }));

        setTimeout(() => {
          if (!isActive) return;
          setVisibleResults((prev) => ({ ...prev, [stepId]: true }));
        }, 150);

        currentIndex++;
        setTimeout(processPhase1Step, 300);
      }, processingTime);
    };

    // Small delay before starting to allow UI to settle
    const startTimer = setTimeout(processPhase1Step, 200);

    return () => {
      isActive = false;
      clearTimeout(startTimer);
    };
  }, [dataArrived]);

  // Phase 2: Process steps 6-9 when llmReady becomes true
  useEffect(() => {
    if (!llmReady || phase2StartedRef.current) return;

    phase2StartedRef.current = true;
    let isActive = true;
    let currentIndex = 0;

    const processPhase2Step = () => {
      if (!isActive) return;

      if (currentIndex >= PHASE2_STEPS.length) {
        // All steps complete, trigger onComplete (600-800ms delay as per plan)
        const completeDelay = 600 + Math.random() * 200;
        setTimeout(() => {
          if (isActive) onComplete();
        }, completeDelay);
        return;
      }

      const stepId = PHASE2_STEPS[currentIndex];
      setStepStatuses((prev) => ({ ...prev, [stepId]: 'processing' }));

      // Faster processing for LLM steps since data is already ready
      const processingTime = 300 + Math.random() * 150;

      setTimeout(() => {
        if (!isActive) return;

        setStepStatuses((prev) => ({ ...prev, [stepId]: 'completed' }));

        setTimeout(() => {
          if (!isActive) return;
          setVisibleResults((prev) => ({ ...prev, [stepId]: true }));
        }, 150);

        currentIndex++;
        setTimeout(processPhase2Step, 250);
      }, processingTime);
    };

    // Start processing phase 2
    const startTimer = setTimeout(processPhase2Step, 200);

    return () => {
      isActive = false;
      clearTimeout(startTimer);
    };
  }, [llmReady, onComplete]);

  const renderStepIcon = (status: StepStatus) => {
    if (status === 'processing') {
      return <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />;
    }
    if (status === 'completed') {
      return (
        <div className="w-4 h-4 rounded-full bg-foreground flex items-center justify-center">
          <Check className="w-2.5 h-2.5 text-background" strokeWidth={3} />
        </div>
      );
    }
    return <div className="w-4 h-4 rounded-full border border-border" />;
  };

  const renderStepResult = (stepId: string) => {
    if (!visibleResults[stepId]) return null;

    // For steps 1-5, need diagnosisResults to show data
    const needsDiagnosisData = ['files', 'parsing', 'columns', 'quality', 'statistics'].includes(stepId);
    if (needsDiagnosisData && !diagnosisResults) return null;

    switch (stepId) {
      case 'files':
        return (
          <div className="ml-7 mt-1 space-y-0.5 animate-fade-in">
            {diagnosisResults!.map((diagnosis) => (
              <div key={diagnosis.file_path} className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs font-mono">
                  {getFileNameFromPath(diagnosis.file_path)}
                </span>
                <ResultTag>{formatFileSize(diagnosis.file_size_bytes)}</ResultTag>
              </div>
            ))}
          </div>
        );

      case 'parsing':
        return (
          <div className="ml-7 mt-1 space-y-0.5 animate-fade-in">
            {diagnosisResults!.map((diagnosis) => {
              const successRate = getParsingSuccessRateForFile(diagnosis);
              return (
                <div key={diagnosis.file_path} className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs font-mono">
                    {getFileNameFromPath(diagnosis.file_path)}
                  </span>
                  <ResultTag variant="count">
                    {diagnosis.row_count.toLocaleString()} rows
                  </ResultTag>
                  {successRate < 100 && (
                    <span className="text-xs text-muted-foreground">({successRate}%)</span>
                  )}
                </div>
              );
            })}
          </div>
        );

      case 'columns':
        return (
          <div className="ml-7 mt-1 space-y-1 animate-fade-in">
            {diagnosisResults!.map((diagnosis) => {
              const typeSummary = getColumnTypeSummaryForFile(diagnosis);
              return (
                <div key={diagnosis.file_path} className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground text-xs font-mono">
                      {getFileNameFromPath(diagnosis.file_path)}
                    </span>
                    <ResultTag variant="count">{diagnosis.columns.length} columns</ResultTag>
                    {typeSummary.numeric > 0 && <ResultTag>Numeric {typeSummary.numeric}</ResultTag>}
                    {typeSummary.text > 0 && <ResultTag>Text {typeSummary.text}</ResultTag>}
                    {typeSummary.date > 0 && <ResultTag>Date {typeSummary.date}</ResultTag>}
                  </div>
                </div>
              );
            })}
          </div>
        );

      case 'quality':
        return (
          <div className="ml-7 mt-1 space-y-0.5 animate-fade-in">
            {diagnosisResults!.map((diagnosis) => {
              const missingRate = calculateMissingRateForFile(diagnosis);
              const suggestions = diagnosis.type_suggestions?.length || 0;
              return (
                <div key={diagnosis.file_path} className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground text-xs font-mono">
                    {getFileNameFromPath(diagnosis.file_path)}
                  </span>
                  <ResultTag variant="count">Missing {missingRate}%</ResultTag>
                  {suggestions > 0 && (
                    <ResultTag>{suggestions} suggestion{suggestions !== 1 ? 's' : ''}</ResultTag>
                  )}
                </div>
              );
            })}
          </div>
        );

      case 'statistics':
        return (
          <div className="ml-7 mt-1 space-y-0.5 animate-fade-in">
            {diagnosisResults!.map((diagnosis) => {
              const dateRange = getDateRangeSummaryForFile(diagnosis);
              const numericRange = getNumericRangeSummaryForFile(diagnosis);
              return (
                <div key={diagnosis.file_path} className="space-y-0.5">
                  <span className="text-muted-foreground text-xs font-mono">
                    {getFileNameFromPath(diagnosis.file_path)}
                  </span>
                  {dateRange && (
                    <div className="ml-2 text-muted-foreground text-xs">
                      Date: {dateRange}
                    </div>
                  )}
                  {numericRange && (
                    <div className="ml-2 text-muted-foreground text-xs">
                      {numericRange}
                    </div>
                  )}
                  {!dateRange && !numericRange && (
                    <span className="ml-2"><ResultTag>Complete</ResultTag></span>
                  )}
                </div>
              );
            })}
          </div>
        );

      // LLM-ready steps (6-9): Show minimal result
      case 'naming':
      case 'description':
      case 'understanding':
      case 'integration':
        return (
          <div className="ml-7 mt-1 animate-fade-in">
            <ResultTag>Ready</ResultTag>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-center px-8 py-6 border-b border-border">
        <h3 className="text-xl font-semibold text-foreground">
          Analyzing your data
        </h3>
      </div>

      {/* Subtitle */}
      <div className="px-8 pt-4 pb-2">
        <p className="text-muted-foreground text-sm text-center">
          Extracting schema, statistics, and quality metrics
        </p>
      </div>

      {/* Scrollable Content - Fixed height container for proper scrolling */}
      <div className="px-8 py-4">
        <div className="h-[320px] bg-muted/30 rounded-xl border border-border overflow-hidden">
          <div
            ref={scrollRef}
            className="h-full overflow-y-auto p-5 scroll-smooth"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}
          >
            <div className="space-y-3">
              {ANALYSIS_STEPS.map((step) => {
                const status = stepStatuses[step.id];
                if (status === 'pending') return null;

                return (
                  <div key={step.id} className="animate-slide-in">
                    {/* Main Step Row */}
                    <div className="flex items-center gap-3">
                      {renderStepIcon(status)}
                      <span
                        className={`text-sm transition-colors duration-200 ${
                          status === 'processing'
                            ? 'text-foreground font-medium'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {status === 'processing' ? step.processingLabel : step.label}
                      </span>
                    </div>

                    {/* Result */}
                    {renderStepResult(step.id)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Footer - Transition hint */}
      <div className="px-8 py-4 text-center">
        <p className="text-xs text-muted-foreground">
          Moving to results automatically...
        </p>
      </div>

      {/* Animation Styles */}
      <style>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out forwards;
        }

        @keyframes slide-in {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.4s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
