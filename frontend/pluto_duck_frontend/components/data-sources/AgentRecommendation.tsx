'use client';

import { Package, Check } from 'lucide-react';

// Helper to format number with commas
function formatNumber(num: number): string {
  return num.toLocaleString();
}

interface AgentRecommendationProps {
  fileCount: number;
  totalRows: number;
  duplicateRows: number;
  estimatedRows: number;
  isMerged: boolean;
  removeDuplicates: boolean;
  onMergeChange: (checked: boolean) => void;
  onRemoveDuplicatesChange: (checked: boolean) => void;
}

export function AgentRecommendation({
  fileCount,
  totalRows,
  duplicateRows,
  estimatedRows,
  isMerged,
  removeDuplicates,
  onMergeChange,
  onRemoveDuplicatesChange,
}: AgentRecommendationProps) {
  const toggleMerge = () => {
    const newMerged = !isMerged;
    onMergeChange(newMerged);
    // merge 해제하면 remove duplicates도 해제
    if (!newMerged) {
      onRemoveDuplicatesChange(false);
    }
  };

  const toggleRemoveDuplicates = () => {
    // merge가 체크되어 있을 때만 토글 가능
    if (isMerged) {
      onRemoveDuplicatesChange(!removeDuplicates);
    }
  };

  return (
    <div className="bg-sky-50 dark:bg-sky-950/30 rounded-xl p-4 mb-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-4 h-4 text-sky-600 dark:text-sky-400" />
        <span className="text-sky-600 dark:text-sky-400 font-semibold text-sm">Agent Recommendation</span>
      </div>

      {/* Checkboxes */}
      <div className="space-y-2">
        {/* Make files into 1 dataset */}
        <label className="flex items-center gap-2.5 cursor-pointer group">
          <Check className="w-4 h-4 text-foreground flex-shrink-0" strokeWidth={2.5} />
          <span className="text-sm font-medium text-foreground">
            Make {fileCount} files into 1 dataset (total {formatNumber(totalRows)} rows)
          </span>
        </label>

        {/* Remove duplicated rows */}
        <label className="flex items-center gap-2.5 cursor-pointer group">
          <Check className="w-4 h-4 text-foreground flex-shrink-0" strokeWidth={2.5} />
          <span className="text-sm font-medium text-foreground">
            Remove duplicated {formatNumber(duplicateRows)} rows (total estimated {formatNumber(estimatedRows)} rows)
          </span>
        </label>
      </div>
    </div>
  );
}
