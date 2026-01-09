'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Play,
  Save,
  Clock,
  GitBranch,
  History,
  Code,
  Settings,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  updateAnalysis,
  getRunHistory,
  type Analysis,
  type FreshnessStatus,
  type RunHistoryEntry,
  formatDuration,
  getStatusColor,
  getMaterializationIcon,
} from '@/lib/assetsApi';
import { LineageGraphView } from './LineageGraphView';

interface AssetDetailModalProps {
  open: boolean;
  analysis: Analysis;
  freshness: FreshnessStatus | null;
  onClose: () => void;
  onUpdated: (analysis: Analysis) => void;
  onRun: (analysis: Analysis) => void;
  projectId: string;
}

type Tab = 'overview' | 'sql' | 'lineage' | 'history';

export function AssetDetailModal({
  open,
  analysis,
  freshness,
  onClose,
  onUpdated,
  onRun,
  projectId,
}: AssetDetailModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState(analysis.name);
  const [editDescription, setEditDescription] = useState(analysis.description || '');
  const [editSql, setEditSql] = useState(analysis.sql);
  const [editMaterialization, setEditMaterialization] = useState(analysis.materialization);
  const [editTags, setEditTags] = useState(analysis.tags.join(', '));

  // Data state
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Reset form when analysis changes
  useEffect(() => {
    setEditName(analysis.name);
    setEditDescription(analysis.description || '');
    setEditSql(analysis.sql);
    setEditMaterialization(analysis.materialization);
    setEditTags(analysis.tags.join(', '));
    setIsEditing(false);
  }, [analysis]);

  // Load history when tab changes
  useEffect(() => {
    if (activeTab === 'history' && history.length === 0) {
      setIsLoadingHistory(true);
      getRunHistory(analysis.id, { projectId, limit: 20 })
        .then(setHistory)
        .catch(console.error)
        .finally(() => setIsLoadingHistory(false));
    }
  }, [activeTab, analysis.id, projectId, history.length]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updated = await updateAnalysis(
        analysis.id,
        {
          name: editName,
          description: editDescription || undefined,
          sql: editSql,
          materialization: editMaterialization,
          tags: editTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        },
        projectId
      );
      onUpdated(updated);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('ko-KR');
  };

  const tabs = [
    { id: 'overview' as Tab, label: 'Overview', icon: Settings },
    { id: 'sql' as Tab, label: 'SQL', icon: Code },
    { id: 'lineage' as Tab, label: 'Lineage', icon: GitBranch },
    { id: 'history' as Tab, label: 'History', icon: History },
  ];

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{getMaterializationIcon(analysis.materialization)}</span>
            <div>
              <h2 className="text-lg font-semibold">{analysis.name}</h2>
              <p className="text-sm text-muted-foreground font-mono">{analysis.id}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {freshness && (
              <span
                className={`flex items-center gap-1 text-sm ${
                  freshness.is_stale ? 'text-yellow-500' : 'text-green-500'
                }`}
              >
                {freshness.is_stale ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                {freshness.is_stale ? 'Stale' : 'Fresh'}
              </span>
            )}
            <Button variant="outline" onClick={() => onRun(analysis)}>
              <Play className="mr-2 h-4 w-4" />
              Run
            </Button>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-border px-6">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Edit Mode Toggle */}
              <div className="flex justify-end">
                {isEditing ? (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsEditing(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                      <Save className="mr-2 h-4 w-4" />
                      {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setIsEditing(true)}>
                    Edit
                  </Button>
                )}
              </div>

              {/* Name */}
              <div>
                <label className="text-sm font-medium text-muted-foreground">Name</label>
                {isEditing ? (
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1"
                  />
                ) : (
                  <p className="mt-1 text-foreground">{analysis.name}</p>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="text-sm font-medium text-muted-foreground">Description</label>
                {isEditing ? (
                  <Textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="mt-1"
                    rows={3}
                  />
                ) : (
                  <p className="mt-1 text-foreground">
                    {analysis.description || <span className="text-muted-foreground italic">No description</span>}
                  </p>
                )}
              </div>

              {/* Materialization */}
              <div>
                <label className="text-sm font-medium text-muted-foreground">Materialization</label>
                {isEditing ? (
                  <Select
                    value={editMaterialization}
                    onValueChange={(v) => setEditMaterialization(v as typeof editMaterialization)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">View (computed on-demand)</SelectItem>
                      <SelectItem value="table">Table (stored)</SelectItem>
                      <SelectItem value="append">Append (incremental)</SelectItem>
                      <SelectItem value="parquet">Parquet (file export)</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="mt-1 text-foreground flex items-center gap-2">
                    {getMaterializationIcon(analysis.materialization)}
                    <span className="capitalize">{analysis.materialization}</span>
                  </p>
                )}
              </div>

              {/* Tags */}
              <div>
                <label className="text-sm font-medium text-muted-foreground">Tags</label>
                {isEditing ? (
                  <Input
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="comma, separated, tags"
                    className="mt-1"
                  />
                ) : (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {analysis.tags.length > 0 ? (
                      analysis.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-sm text-primary"
                        >
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground italic">No tags</span>
                    )}
                  </div>
                )}
              </div>

              {/* Result Table */}
              <div>
                <label className="text-sm font-medium text-muted-foreground">Result Table</label>
                <p className="mt-1 font-mono text-foreground bg-muted px-2 py-1 rounded inline-block">
                  {analysis.result_table}
                </p>
              </div>

              {/* Timestamps */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Created</label>
                  <p className="mt-1 text-foreground">{formatDate(analysis.created_at)}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Updated</label>
                  <p className="mt-1 text-foreground">{formatDate(analysis.updated_at)}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sql' && (
            <div className="space-y-4">
              {isEditing ? (
                <Textarea
                  value={editSql}
                  onChange={(e) => setEditSql(e.target.value)}
                  className="font-mono text-sm h-[400px]"
                />
              ) : (
                <pre className="rounded-lg bg-muted p-4 overflow-auto text-sm font-mono whitespace-pre-wrap">
                  {analysis.sql}
                </pre>
              )}
            </div>
          )}

          {activeTab === 'lineage' && (
            <div className="h-[500px] -m-6">
              <LineageGraphView
                projectId={projectId}
                highlightAnalysisId={analysis.id}
                onSelectAnalysis={(id) => {
                  // Could navigate to the selected analysis
                  console.log('Selected analysis:', id);
                }}
              />
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-4">
              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : history.length > 0 ? (
                <div className="space-y-2">
                  {history.map((entry) => (
                    <div
                      key={entry.run_id}
                      className="flex items-center justify-between rounded-md border border-border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${getStatusColor(
                            entry.status
                          )}`}
                        >
                          {entry.status}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {formatDate(entry.started_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {entry.rows_affected !== null && (
                          <span>{entry.rows_affected.toLocaleString()} rows</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(entry.duration_ms)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-12">
                  No execution history yet
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

