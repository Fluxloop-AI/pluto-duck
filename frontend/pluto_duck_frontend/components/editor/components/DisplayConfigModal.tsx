'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Table2, BarChart3, LineChart, PieChart, AreaChart, Layers, GitBranch, Loader2 } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { type AssetEmbedConfig } from '../nodes/AssetEmbedNode';
import { getAnalysis, getAnalysisData, type Analysis, type AnalysisData } from '@/lib/assetsApi';

interface DisplayConfigModalProps {
  open: boolean;
  analysisId: string;
  projectId: string;
  initialConfig?: AssetEmbedConfig;
  onSave: (config: AssetEmbedConfig) => void;
  onCancel: () => void;
}

type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'composed';

const CHART_TYPES: { type: ChartType; icon: React.ReactNode; label: string }[] = [
  { type: 'bar', icon: <BarChart3 className="h-5 w-5" />, label: 'Bar' },
  { type: 'line', icon: <LineChart className="h-5 w-5" />, label: 'Line' },
  { type: 'pie', icon: <PieChart className="h-5 w-5" />, label: 'Pie' },
  { type: 'area', icon: <AreaChart className="h-5 w-5" />, label: 'Area' },
  { type: 'composed', icon: <Layers className="h-5 w-5" />, label: 'Mixed' },
];

const ROW_OPTIONS = [5, 10];

export function DisplayConfigModal({
  open,
  analysisId,
  projectId,
  initialConfig,
  onSave,
  onCancel,
}: DisplayConfigModalProps) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Form state
  const [displayType, setDisplayType] = useState<'table' | 'chart'>(
    initialConfig?.displayType || 'table'
  );
  const [rowsPerPage, setRowsPerPage] = useState(
    initialConfig?.tableConfig?.rowsPerPage || 5
  );
  const [customRows, setCustomRows] = useState('');
  const [chartType, setChartType] = useState<ChartType>(
    initialConfig?.chartConfig?.type || 'bar'
  );
  const [xColumn, setXColumn] = useState(initialConfig?.chartConfig?.xColumn || '');
  const [yColumn, setYColumn] = useState(initialConfig?.chartConfig?.yColumn || '');
  const [yColumns, setYColumns] = useState<string[]>(initialConfig?.chartConfig?.yColumns || []);
  const [groupByColumn, setGroupByColumn] = useState(initialConfig?.chartConfig?.groupByColumn || '');
  const [stacked, setStacked] = useState(initialConfig?.chartConfig?.stacked || false);
  const [showDualAxis, setShowDualAxis] = useState(initialConfig?.chartConfig?.showDualAxis || false);

  // Chart mode: 'single', 'groupBy', 'multiY'
  const [chartMode, setChartMode] = useState<'single' | 'groupBy' | 'multiY'>(() => {
    if (initialConfig?.chartConfig?.groupByColumn) return 'groupBy';
    if (initialConfig?.chartConfig?.yColumns && initialConfig.chartConfig.yColumns.length > 0) return 'multiY';
    return 'single';
  });

  // Available columns from analysis data
  const columns = useMemo(() => analysisData?.columns || [], [analysisData]);

  // Load analysis metadata and data for column info
  useEffect(() => {
    if (open && analysisId) {
      setIsLoading(true);
      Promise.all([
        getAnalysis(analysisId, projectId),
        getAnalysisData(analysisId, { projectId, limit: 1 }) // Just need columns, limit to 1 row
      ])
        .then(([analysisResult, dataResult]) => {
          setAnalysis(analysisResult);
          setAnalysisData(dataResult);
          
          // Auto-select first columns if not set
          if (!xColumn && dataResult.columns.length > 0) {
            setXColumn(dataResult.columns[0]);
          }
          if (!yColumn && dataResult.columns.length > 1) {
            setYColumn(dataResult.columns[1]);
          }
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    }
  }, [open, analysisId, projectId]);

  // Reset form when opening with new config
  useEffect(() => {
    if (open && initialConfig) {
      setDisplayType(initialConfig.displayType);
      setRowsPerPage(initialConfig.tableConfig?.rowsPerPage || 5);
      setChartType(initialConfig.chartConfig?.type || 'bar');
      setXColumn(initialConfig.chartConfig?.xColumn || '');
      setYColumn(initialConfig.chartConfig?.yColumn || '');
      setYColumns(initialConfig.chartConfig?.yColumns || []);
      setGroupByColumn(initialConfig.chartConfig?.groupByColumn || '');
      setStacked(initialConfig.chartConfig?.stacked || false);
      setShowDualAxis(initialConfig.chartConfig?.showDualAxis || false);
      
      if (initialConfig.chartConfig?.groupByColumn) {
        setChartMode('groupBy');
      } else if (initialConfig.chartConfig?.yColumns && initialConfig.chartConfig.yColumns.length > 0) {
        setChartMode('multiY');
      } else {
        setChartMode('single');
      }
    }
  }, [open, initialConfig]);

  const effectiveRowsPerPage = customRows ? parseInt(customRows, 10) : rowsPerPage;

  const handleSave = () => {
    const config: AssetEmbedConfig = {
      displayType,
      tableConfig:
        displayType === 'table'
          ? { rowsPerPage: effectiveRowsPerPage || 5 }
          : undefined,
      chartConfig:
        displayType === 'chart'
          ? {
              type: chartType,
              xColumn: xColumn || columns[0] || 'column_0',
              yColumn: chartMode !== 'multiY' ? (yColumn || columns[1] || 'column_1') : undefined,
              yColumns: chartMode === 'multiY' ? yColumns : undefined,
              groupByColumn: chartMode === 'groupBy' ? groupByColumn : undefined,
              stacked: stacked || undefined,
              showDualAxis: showDualAxis || undefined,
            }
          : undefined,
    };
    onSave(config);
  };

  // Toggle yColumn in multi-select
  const toggleYColumn = (col: string) => {
    if (yColumns.includes(col)) {
      setYColumns(yColumns.filter(c => c !== col));
    } else {
      setYColumns([...yColumns, col]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4 -mx-6 px-6 -mt-2">
          <div>
            <h2 className="text-lg font-semibold">
              {initialConfig ? 'Edit Display' : 'Configure Display'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {analysis?.name || analysisId}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Content */}
        {!isLoading && (
        <div className="space-y-6 py-4">
          {/* Display Type Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Display Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setDisplayType('table')}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors ${
                  displayType === 'table'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/30'
                }`}
              >
                <Table2 className="h-8 w-8" />
                <span className="text-sm font-medium">Table</span>
              </button>
              <button
                onClick={() => setDisplayType('chart')}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors ${
                  displayType === 'chart'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/30'
                }`}
              >
                <BarChart3 className="h-8 w-8" />
                <span className="text-sm font-medium">Chart</span>
              </button>
            </div>
          </div>

          {/* Table Options */}
          {displayType === 'table' && (
            <div className="space-y-3">
              <label className="text-sm font-medium">Rows per Page</label>
              <div className="flex items-center gap-2">
                {ROW_OPTIONS.map((num) => (
                  <button
                    key={num}
                    onClick={() => {
                      setRowsPerPage(num);
                      setCustomRows('');
                    }}
                    className={`px-4 py-2 rounded-md text-sm ${
                      rowsPerPage === num && !customRows
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    {num}
                  </button>
                ))}
                <input
                  type="number"
                  placeholder="Custom"
                  value={customRows}
                  onChange={(e) => setCustomRows(e.target.value)}
                  min={1}
                  max={100}
                  className="w-20 px-3 py-2 rounded-md border border-border bg-background text-sm"
                />
              </div>
            </div>
          )}

          {/* Chart Options */}
          {displayType === 'chart' && (
            <div className="space-y-4">
              {/* Chart Type */}
              <div className="space-y-3">
                <label className="text-sm font-medium">Chart Type</label>
                  <div className="grid grid-cols-5 gap-2">
                  {CHART_TYPES.map(({ type, icon, label }) => (
                    <button
                      key={type}
                      onClick={() => setChartType(type)}
                        className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
                        chartType === type
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground/30'
                      }`}
                    >
                      {icon}
                      <span className="text-xs">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

                {/* Chart Mode Selection */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Chart Mode</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setChartMode('single')}
                      className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-colors ${
                        chartMode === 'single'
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground/30'
                      }`}
                    >
                      <LineChart className="h-4 w-4" />
                      <span className="text-xs">Single</span>
                      <span className="text-[10px] text-muted-foreground">1 metric</span>
                    </button>
                    <button
                      onClick={() => setChartMode('groupBy')}
                      className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-colors ${
                        chartMode === 'groupBy'
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground/30'
                      }`}
                    >
                      <GitBranch className="h-4 w-4" />
                      <span className="text-xs">Group By</span>
                      <span className="text-[10px] text-muted-foreground">Compare sources</span>
                    </button>
                    <button
                      onClick={() => setChartMode('multiY')}
                      className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-colors ${
                        chartMode === 'multiY'
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground/30'
                      }`}
                    >
                      <Layers className="h-4 w-4" />
                      <span className="text-xs">Multi Metric</span>
                      <span className="text-[10px] text-muted-foreground">Multiple Y columns</span>
                    </button>
                  </div>
                </div>

                {/* X-Axis Selection */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">X-Axis (Category)</label>
                  <select
                    value={xColumn}
                    onChange={(e) => setXColumn(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                  >
                    <option value="">Select column...</option>
                    {columns.map((col) => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    e.g., date, category, source name
                  </p>
                </div>

                {/* Single / GroupBy Mode: Y Column */}
                {(chartMode === 'single' || chartMode === 'groupBy') && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Y-Axis (Value)</label>
                    <select
                    value={yColumn}
                    onChange={(e) => setYColumn(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                    >
                      <option value="">Select column...</option>
                      {columns.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Numeric column to visualize (e.g., CTR, revenue, count)
                    </p>
                  </div>
                )}

                {/* GroupBy Mode: Group By Column */}
                {chartMode === 'groupBy' && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Group By Column</label>
                    <select
                      value={groupByColumn}
                      onChange={(e) => setGroupByColumn(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                    >
                      <option value="">Select column...</option>
                      {columns.filter(c => c !== xColumn && c !== yColumn).map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  <p className="text-xs text-muted-foreground">
                      Each unique value becomes a separate line/bar (e.g., source: Google, Facebook, Naver)
                  </p>
                </div>
                )}

                {/* MultiY Mode: Multiple Y Columns */}
                {chartMode === 'multiY' && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Y-Axis Columns (Select multiple)</label>
                    <div className="max-h-40 overflow-y-auto border border-border rounded-md p-2 space-y-1">
                      {columns.filter(c => c !== xColumn).map((col) => (
                        <label
                          key={col}
                          className={`flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-muted ${
                            yColumns.includes(col) ? 'bg-primary/10' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={yColumns.includes(col)}
                            onChange={() => toggleYColumn(col)}
                            className="rounded"
                          />
                          <span className="text-sm">{col}</span>
                        </label>
                      ))}
                    </div>
                    {yColumns.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Selected: {yColumns.join(', ')}
                      </p>
                    )}
                  </div>
                )}

                {/* Additional Options */}
                {(chartMode === 'groupBy' || chartMode === 'multiY') && (
                  <div className="space-y-3 pt-2 border-t border-border">
                    <label className="text-sm font-medium">Options</label>
                    <div className="flex flex-wrap gap-4">
                      {/* Stacked */}
                      {(chartType === 'bar' || chartType === 'area') && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stacked}
                            onChange={(e) => setStacked(e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-sm">Stacked</span>
                        </label>
                      )}
                      
                      {/* Dual Axis (only for multiY) */}
                      {chartMode === 'multiY' && yColumns.length > 1 && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showDualAxis}
                            onChange={(e) => setShowDualAxis(e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-sm">Dual Y-Axis</span>
                          <span className="text-xs text-muted-foreground">(for different scales)</span>
                        </label>
                      )}
                    </div>
                  </div>
                )}

                {/* Columns info */}
                {columns.length > 0 && (
                  <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                    <span className="font-medium">Available columns:</span> {columns.join(', ')}
                  </div>
                )}
              </div>
            )}
            </div>
          )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4 -mx-6 px-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-md hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {initialConfig ? 'Save' : 'Insert'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
