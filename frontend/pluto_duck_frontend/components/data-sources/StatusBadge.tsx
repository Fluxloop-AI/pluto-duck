'use client';

import { Check, AlertCircle } from 'lucide-react';

export type DatasetStatus = 'ready' | 'review';

interface StatusBadgeProps {
  status: DatasetStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  if (status === 'ready') {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
          <Check className="w-3 h-3 text-white" strokeWidth={3} />
        </div>
        <span className="text-emerald-500 font-semibold text-sm">Dataset Ready</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <AlertCircle className="w-5 h-5 text-orange-500" />
      <span className="text-orange-500 font-semibold text-sm">Review with AI</span>
    </div>
  );
}
