'use client';

import { Check, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mockQuickScanItems } from '../mocks';

export function QuickScanSection() {
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
