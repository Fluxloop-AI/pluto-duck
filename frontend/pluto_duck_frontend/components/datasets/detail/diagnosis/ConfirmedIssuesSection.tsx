'use client';

import { ArrowRight, Check, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DatasetIssue, IssueResponseInfo } from '../types';

function getIssueResponseInfo(issue: DatasetIssue): IssueResponseInfo | null {
  if (issue.status === 'open') {
    return null;
  }

  if (issue.status === 'dismissed') {
    return {
      type: 'no',
      text: issue.user_response || 'Not an issue',
      color: 'text-[#a8a29e]',
    };
  }

  if (issue.status === 'resolved') {
    return {
      type: 'resolved',
      text: 'Resolved',
      color: 'text-emerald-600',
    };
  }

  // status === 'confirmed'
  if (!issue.user_response) {
    return {
      type: 'yes',
      text: 'Issue confirmed',
      color: 'text-red-500',
    };
  }

  if (issue.user_response === 'Needs review') {
    return {
      type: 'unsure',
      text: 'Needs review',
      color: 'text-[#d97706]',
    };
  }

  // Custom user note
  const displayText = issue.user_response.length > 25
    ? `${issue.user_response.slice(0, 25)}...`
    : issue.user_response;

  return {
    type: 'custom',
    text: displayText,
    color: 'text-[#a8a29e]',
  };
}

interface ConfirmedIssuesSectionProps {
  issues: DatasetIssue[];
}

export function ConfirmedIssuesSection({ issues }: ConfirmedIssuesSectionProps) {
  const confirmedIssues = issues.filter((issue) => issue.status !== 'open');

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Confirmed Issues
      </h3>

      <div className="rounded-xl bg-muted/50 p-4">
        {confirmedIssues.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No confirmed issues yet.
          </div>
        ) : (
          confirmedIssues.map((issue, index) => {
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
                  {issue.issue}
                </span>
                {responseInfo && (
                  <span className={cn('text-xs', responseInfo.color)}>
                    {responseInfo.text}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg bg-[#292524] px-4 py-2.5 text-sm text-white hover:bg-[#1c1917] transition-colors"
        >
          <MessageSquare size={14} />
          <span>Review with agent</span>
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
