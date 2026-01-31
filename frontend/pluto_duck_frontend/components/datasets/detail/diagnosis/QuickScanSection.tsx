'use client';

import { Check, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import type { FileDiagnosis } from '../../../../lib/fileAssetApi';
import type { QuickScanItem } from '../types';

const MISSING_WARNING_THRESHOLD = 2;
const MAX_LIST_ITEMS = 3;

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) {
    return `${rounded.toFixed(0)}%`;
  }
  return `${rounded.toFixed(1)}%`;
}

function formatTypeTitle(okCount: number, totalCount: number): string {
  if (totalCount === 0) {
    return 'Column Types: Check Needed';
  }
  if (okCount === totalCount) {
    return 'Column Types: All Good';
  }
  if (okCount === 0 || okCount / totalCount < 0.5) {
    return 'Column Types: Fix Needed';
  }
  return 'Column Types: Check Needed';
}

function renderMissingColumns(
  missingColumns: { name: string; percent: number }[],
  rowCount: number,
  totalCells: number
): ReactNode {
  if (totalCells === 0 || rowCount === 0) {
    return 'No data';
  }
  if (missingColumns.length === 0) {
    return 'No missing values';
  }
  const limited = missingColumns.slice(0, MAX_LIST_ITEMS);
  const remaining = missingColumns.length - limited.length;
  const entries = limited.map(
    (col) => `${col.name} ${formatPercent(col.percent)}`
  );
  if (remaining > 0) {
    entries.push(`+${remaining} more`);
  }
  return entries.join(', ');
}

function buildQuickScanItems(
  diagnosis: FileDiagnosis | null,
  diagnosisLoading: boolean
): QuickScanItem[] {
  if (diagnosisLoading) {
    return [
      {
        id: 'missing',
        status: 'warning',
        title: 'Missing values',
        subtitle: 'Loading...',
      },
      {
        id: 'types',
        status: 'warning',
        title: 'Column types',
        subtitle: 'Loading...',
      },
      {
        id: 'parsing',
        status: 'warning',
        title: 'Parsing errors',
        subtitle: 'Loading...',
      },
    ];
  }

  const rowCount = diagnosis?.row_count ?? 0;
  const columnCount = diagnosis?.columns?.length ?? 0;
  const totalCells = rowCount * columnCount;
  const missingValues = diagnosis?.missing_values ?? {};
  const missingTotal = Object.values(missingValues).reduce(
    (sum, value) => sum + value,
    0
  );
  const missingPercent = totalCells > 0 ? (missingTotal / totalCells) * 100 : 0;
  const missingColumns = Object.entries(missingValues)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({
      name,
      percent: rowCount > 0 ? (count / rowCount) * 100 : 0,
    }))
    .sort((a, b) => b.percent - a.percent);
  const missingColumnsLabel = renderMissingColumns(
    missingColumns,
    rowCount,
    totalCells
  );
  const missingStatus =
    totalCells === 0
      ? 'warning'
      : missingPercent > MISSING_WARNING_THRESHOLD
        ? 'warning'
        : 'success';
  const missingTitle = `Missing ${formatPercent(missingPercent)}`;

  const typeSuggestions = diagnosis?.type_suggestions ?? [];
  const okCount = Math.max(0, columnCount - typeSuggestions.length);
  const typeTitle = formatTypeTitle(okCount, columnCount);
  const typeSubtitle = columnCount === 0
    ? 'No data'
    : `${okCount}/${columnCount} OK`;
  const typeStatus = columnCount === 0
    ? 'warning'
    : typeSuggestions.length === 0
      ? 'success'
      : 'warning';

  const parsing = diagnosis?.parsing_integrity;
  const hasParsingIssues = Boolean(
    parsing && (parsing.has_errors || parsing.malformed_rows > 0)
  );
  let parsingSubtitle = 'No data';
  let parsingTitle = 'No Parsing Errors';
  if (parsing) {
    if (hasParsingIssues) {
      parsingTitle = 'Parsing Errors Found';
      if (parsing.error_message && parsing.error_message.trim().length > 0) {
        parsingSubtitle = `Error: ${parsing.error_message}`;
      } else {
        parsingSubtitle = `Malformed ${parsing.malformed_rows} / ${parsing.total_lines} rows`;
      }
    } else {
      parsingSubtitle = 'No issues';
    }
  }

  return [
    {
      id: 'missing',
      status: missingStatus,
      title: missingTitle,
      subtitle: missingColumnsLabel,
    },
    {
      id: 'types',
      status: typeStatus,
      title: typeTitle,
      subtitle: typeSubtitle,
    },
    {
      id: 'parsing',
      status: parsing
        ? hasParsingIssues
          ? 'warning'
          : 'success'
        : 'warning',
      title: parsingTitle,
      subtitle: parsingSubtitle,
    },
  ];
}

interface QuickScanSectionProps {
  diagnosis: FileDiagnosis | null;
  diagnosisLoading: boolean;
  onRescan: () => void;
}

export function QuickScanSection({
  diagnosis,
  diagnosisLoading,
  onRescan,
}: QuickScanSectionProps) {
  const quickScanItems = buildQuickScanItems(diagnosis, diagnosisLoading);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Quick Scan
        </h3>
        <button
          type="button"
          onClick={onRescan}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted/50 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Rescan
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        Automatically scanned on upload.
      </p>

      <div>
        {quickScanItems.map((item, index) => {
          const isSuccess = item.status === 'success';
          const isLast = index === quickScanItems.length - 1;
          return (
            <div
              key={item.id}
              className={cn(
                'flex flex-wrap items-center gap-3 py-3',
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
              <span className="text-sm font-medium text-[#1c1917]">
                {item.title}
              </span>
              {/* Detail */}
              <div className="ml-1 text-[13px] text-[#a8a29e]">
                {item.subtitle}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
