'use client';

import { useState } from 'react';
import { X, Play, CheckCircle, XCircle, SkipForward, Clock, ArrowDown, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  type ExecutionPlan,
  type ExecutionResult,
  formatDuration,
} from '@/lib/assetsApi';

interface ExecutionPlanViewProps {
  open: boolean;
  plan: ExecutionPlan;
  result: ExecutionResult | null;
  isExecuting: boolean;
  onExecute: (options?: { continueOnFailure?: boolean }) => void;
  onCancel: () => void;
}

export function ExecutionPlanView({
  open,
  plan,
  result,
  isExecuting,
  onExecute,
  onCancel,
}: ExecutionPlanViewProps) {
  const [continueOnFailure, setContinueOnFailure] = useState(false);

  const getStepIcon = (action: string, status?: string, error?: string | null) => {
    if (status === 'success') {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }
    if (status === 'failed') {
      return <XCircle className="h-5 w-5 text-red-500" />;
    }
    // Skipped due to dependency failure
    if (status === 'skipped' && error?.includes('dependency failed')) {
      return <AlertTriangle className="h-5 w-5 text-orange-500" />;
    }
    if (status === 'skipped' || action === 'skip') {
      return <SkipForward className="h-5 w-5 text-yellow-500" />;
    }
    return <Play className="h-5 w-5 text-primary" />;
  };

  const getStepResult = (analysisId: string) => {
    return result?.step_results.find((r) => r.analysis_id === analysisId);
  };

  // Count result stats
  const successCount = result?.step_results.filter((r) => r.status === 'success').length ?? 0;
  const failedCount = result?.step_results.filter((r) => r.status === 'failed').length ?? 0;
  const skippedCount = result?.step_results.filter((r) => r.status === 'skipped').length ?? 0;
  const totalDuration = result?.step_results.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 -mx-6 -mt-6">
          <div>
            <h2 className="text-lg font-semibold">
              {result ? 'Execution Result' : 'Execution Plan'}
            </h2>
            <p className="text-sm text-muted-foreground">
              Target: <span className="font-mono">{plan.target_id}</span>
            </p>
          </div>
          <button
            onClick={onCancel}
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="py-4 space-y-4">
          {/* Summary */}
          {result && (
            <div
              className={`rounded-lg p-4 ${
                result.success
                  ? 'bg-green-500/10 border border-green-500/30'
                  : 'bg-red-500/10 border border-red-500/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {result.success ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                  <span className={`font-medium ${result.success ? 'text-green-500' : 'text-red-500'}`}>
                    {result.success ? 'Execution Successful' : 'Execution Failed'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    {successCount}
                  </span>
                  {failedCount > 0 && (
                    <span className="flex items-center gap-1">
                      <XCircle className="h-3 w-3 text-red-500" />
                      {failedCount}
                    </span>
                  )}
                  {skippedCount > 0 && (
                    <span className="flex items-center gap-1">
                      <SkipForward className="h-3 w-3 text-yellow-500" />
                      {skippedCount}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(totalDuration)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Steps */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Steps</h3>
            <div className="space-y-1">
              {plan.steps.map((step, index) => {
                const stepResult = getStepResult(step.analysis_id);
                const isTarget = step.analysis_id === plan.target_id;

                return (
                  <div key={step.analysis_id}>
                    <div
                      className={`flex items-center gap-3 rounded-lg border p-3 ${
                        isTarget ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      {/* Icon */}
                      {getStepIcon(step.action, stepResult?.status, stepResult?.error)}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium truncate">
                            {step.analysis_id}
                          </span>
                          {isTarget && (
                            <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                              target
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              step.action === 'run'
                                ? 'bg-blue-500/20 text-blue-400'
                                : step.action === 'skip'
                                ? 'bg-yellow-500/20 text-yellow-400'
                                : 'bg-red-500/20 text-red-400'
                            }`}
                          >
                            {step.action.toUpperCase()}
                          </span>
                          {step.reason && (
                            <span className="text-xs text-muted-foreground">{step.reason}</span>
                          )}
                        </div>
                      </div>

                      {/* Result Stats */}
                      {stepResult && stepResult.status !== 'skipped' && (
                        <div className="text-right text-sm text-muted-foreground">
                          {stepResult.rows_affected !== null && (
                            <div>{stepResult.rows_affected.toLocaleString()} rows</div>
                          )}
                          <div className="flex items-center gap-1 justify-end">
                            <Clock className="h-3 w-3" />
                            {formatDuration(stepResult.duration_ms)}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Arrow between steps */}
                    {index < plan.steps.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ArrowDown className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Error Details */}
          {result && !result.success && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
              <h4 className="text-sm font-medium text-red-500 mb-2">Error Details</h4>
              {result.step_results
                .filter((r) => r.status === 'failed')
                .map((r) => (
                  <div key={r.run_id} className="text-sm text-red-400">
                    <span className="font-mono">{r.analysis_id}</span>: {r.error || 'Unknown error'}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border pt-4 -mx-6 px-6">
          {/* Continue on failure option */}
          {!result && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={continueOnFailure}
                onChange={(e) => setContinueOnFailure(e.target.checked)}
                className="rounded border-border"
              />
              Continue on failure
            </label>
          )}
          {result && <div />}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              {result ? 'Close' : 'Cancel'}
            </Button>
            {!result && (
              <Button
                onClick={() => onExecute({ continueOnFailure })}
                disabled={isExecuting}
              >
                <Play className="mr-2 h-4 w-4" />
                {isExecuting ? 'Executing...' : 'Execute'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

