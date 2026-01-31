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
];

// LLM 대기 중 순차적으로 쌓아갈 메시지
const LLM_WAITING_MESSAGES = [
  'Scanning file structure...',
  'Evaluating data format...',
  'Checking field compatibility...',
  'Reviewing data patterns...',
  'Assessing conversion suitability...',
  'Validating schema structure...',
  'Examining data relationships...',
  'Processing metadata...',
  'Analyzing data distribution...',
  'Detecting potential issues...',
  'Evaluating data consistency...',
  'Checking value ranges...',
  'Identifying key columns...',
  'Assessing data completeness...',
  'Preparing recommendations...',
  'Finalizing assessment...',
];

// 최대 표시 컬럼 수
const MAX_VISIBLE_COLUMNS = 6;

// Helper functions
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileNameFromPath(filePath: string): string {
  return filePath.split('/').pop() || filePath;
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

  // Track when data first arrives (prevents re-trigger on subsequent updates)
  const [dataArrived, setDataArrived] = useState(false);

  // Phase 1 완료 상태
  const [phase1Complete, setPhase1Complete] = useState(false);

  // LLM 대기 중 표시할 메시지들 (쌓아가는 구조)
  const [llmWaitingMessages, setLlmWaitingMessages] = useState<string[]>([]);
  // 현재 진행 중인 메시지 인덱스 (-1이면 진행 중인 것 없음)
  const [currentLlmMessageIndex, setCurrentLlmMessageIndex] = useState(-1);

  // Track which phase we've started processing (using refs to avoid cleanup issues)
  const phase1StartedRef = useRef(false);
  const llmWaitingStartedRef = useRef(false);

  // Steps 1-5 IDs (file/data analysis)
  const PHASE1_STEPS = ['files', 'parsing', 'columns', 'quality', 'statistics'];

  // Auto-scroll when content changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [stepStatuses, visibleResults, llmWaitingMessages, currentLlmMessageIndex]);

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
        // Phase 1 complete
        setPhase1Complete(true);
        return;
      }

      const stepId = PHASE1_STEPS[currentIndex];
      setStepStatuses((prev) => ({ ...prev, [stepId]: 'processing' }));

      // Processing time for each step (600-1000ms)
      const processingTime = 600 + Math.random() * 400;

      setTimeout(() => {
        if (!isActive) return;

        setStepStatuses((prev) => ({ ...prev, [stepId]: 'completed' }));

        setTimeout(() => {
          if (!isActive) return;
          setVisibleResults((prev) => ({ ...prev, [stepId]: true }));
        }, 300);

        currentIndex++;
        setTimeout(processPhase1Step, 500);
      }, processingTime);
    };

    // Small delay before starting to allow UI to settle
    const startTimer = setTimeout(processPhase1Step, 200);

    return () => {
      isActive = false;
      clearTimeout(startTimer);
    };
  }, [dataArrived]);

  // LLM 대기 중 메시지 쌓아가기 애니메이션
  useEffect(() => {
    if (!phase1Complete || llmReady || llmWaitingStartedRef.current) return;

    llmWaitingStartedRef.current = true;
    let isActive = true;
    let currentIndex = 0;

    // 첫 번째 메시지 즉시 표시 (processing 상태)
    setCurrentLlmMessageIndex(0);

    const addNextMessage = () => {
      if (!isActive) return;

      if (currentIndex >= LLM_WAITING_MESSAGES.length) {
        console.warn('[LLM WAIT] index out of range', {
          currentIndex,
          length: LLM_WAITING_MESSAGES.length,
        });
        setCurrentLlmMessageIndex(-1);
        return;
      }

      // 현재 메시지를 완료 상태로 (배열에 추가)
      const message = LLM_WAITING_MESSAGES[currentIndex];
      setLlmWaitingMessages((prev) => [...prev, message]);
      currentIndex++;

      // 다음 메시지가 있으면 진행
      if (currentIndex < LLM_WAITING_MESSAGES.length) {
        setCurrentLlmMessageIndex(currentIndex);
        // 1500-2500ms 간격으로 다음 메시지
        const interval = 1500 + Math.random() * 1000;
        setTimeout(addNextMessage, interval);
      } else {
        // 모든 메시지 완료, 마지막에서 대기 (인덱스를 -1로 설정하여 processing 표시 없앰)
        setCurrentLlmMessageIndex(-1);
      }
    };

    // 첫 번째 메시지 완료 후 다음으로 진행 (1.5-2.5초 후)
    const initialDelay = 1500 + Math.random() * 1000;
    const timer = setTimeout(addNextMessage, initialDelay);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [phase1Complete, llmReady]);

  // LLM 준비 완료 시 처리
  useEffect(() => {
    if (!llmReady) return;

    // 짧은 딜레이 후 완료 처리
    const timer = setTimeout(() => {
      onComplete();
    }, 300);

    return () => clearTimeout(timer);
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
              const visibleColumns = diagnosis.columns.slice(0, MAX_VISIBLE_COLUMNS);
              const remainingCount = diagnosis.columns.length - MAX_VISIBLE_COLUMNS;
              return (
                <div key={diagnosis.file_path} className="space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-muted-foreground text-xs font-mono mr-1">
                      {getFileNameFromPath(diagnosis.file_path)}
                    </span>
                    {visibleColumns.map((col) => (
                      <ResultTag key={col.name}>{col.name}</ResultTag>
                    ))}
                    {remainingCount > 0 && (
                      <ResultTag variant="count">+{remainingCount} more</ResultTag>
                    )}
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

              {/* LLM 대기 중 완료된 메시지들 */}
              {llmWaitingMessages.map((message, index) => (
                <div key={index} className="animate-slide-in">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full bg-foreground flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-background" strokeWidth={3} />
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {(message ?? '').replace('...', '')}
                    </span>
                  </div>
                </div>
              ))}

              {/* LLM 대기 중 현재 진행 중인 메시지 */}
              {currentLlmMessageIndex >= 0 && currentLlmMessageIndex < LLM_WAITING_MESSAGES.length && (
                <div className="animate-slide-in">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                    <span className="text-sm text-foreground font-medium">
                      {LLM_WAITING_MESSAGES[currentLlmMessageIndex]}
                    </span>
                  </div>
                </div>
              )}
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
