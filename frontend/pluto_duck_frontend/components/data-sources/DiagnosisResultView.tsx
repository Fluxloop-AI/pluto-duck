'use client';

import { X } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Button } from '../ui/button';
import { DatasetCard, type Dataset } from './DatasetCard';
import { AgentRecommendation } from './AgentRecommendation';
import type { FileDiagnosis, DuplicateCountResponse, MergedAnalysis } from '../../lib/fileAssetApi';

interface SelectedFile {
  id: string;
  name: string;
  path: string | null;
  file?: File;
}

interface DiagnosisResultViewProps {
  diagnoses: FileDiagnosis[];
  files: SelectedFile[];
  onBack: () => void;
  onImport: (datasetNames: Record<number, string>) => void;
  onClose: () => void;
  isImporting: boolean;
  schemasMatch: boolean;
  mergeFiles: boolean;
  onMergeFilesChange: (checked: boolean) => void;
  removeDuplicates: boolean;
  onRemoveDuplicatesChange: (checked: boolean) => void;
  duplicateInfo: DuplicateCountResponse | null;
  mergedAnalysis: MergedAnalysis | null;
}

// Helper to format number with commas
function formatNumber(num: number): string {
  return num.toLocaleString();
}

// Helper to get file name from path
function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

// Helper to generate a valid table name from filename
function generateTableName(filename: string): string {
  const nameWithoutExt = filename.replace(/\.(csv|parquet)$/i, '');
  return nameWithoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 63);
}

// Determine dataset status based on diagnosis
function determineStatus(diagnosis: FileDiagnosis): 'ready' | 'review' {
  if (!diagnosis.llm_analysis) return 'review';
  if (diagnosis.llm_analysis.issues.length > 0) return 'review';
  return 'ready';
}

// Count issues for a diagnosis
function countIssues(diagnosis: FileDiagnosis): number {
  return diagnosis.llm_analysis?.issues.length || 0;
}

export function DiagnosisResultView({
  diagnoses,
  files,
  onBack,
  onImport,
  onClose,
  isImporting,
  schemasMatch,
  mergeFiles,
  onMergeFilesChange,
  removeDuplicates,
  onRemoveDuplicatesChange,
  duplicateInfo,
  mergedAnalysis,
}: DiagnosisResultViewProps) {
  // Name editing state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [datasetNames, setDatasetNames] = useState<Record<number, string>>({});

  const totalFiles = diagnoses.length;
  const totalRows = diagnoses.reduce((sum, d) => sum + d.row_count, 0);

  // Show AgentRecommendation when schemas match and 2+ files
  const showAgentRecommendation = schemasMatch && diagnoses.length >= 2;

  // Convert diagnoses to Dataset objects for individual files
  const datasets: Dataset[] = useMemo(() => {
    return diagnoses.map((d, i) => ({
      id: i,
      name: datasetNames[i] || d.llm_analysis?.suggested_name || generateTableName(getFileName(d.file_path)),
      status: determineStatus(d),
      description: d.llm_analysis?.context || '',
      files: [getFileName(d.file_path)],
      stats: {
        rows: d.row_count,
        columns: d.columns.length,
        issues: countIssues(d),
      },
    }));
  }, [diagnoses, datasetNames]);

  // Create merged dataset
  const mergedDataset: Dataset = useMemo(() => {
    const totalMergedRows = diagnoses.reduce((sum, d) => sum + d.row_count, 0);
    const totalIssues = diagnoses.reduce((sum, d) => sum + countIssues(d), 0);
    const columnCount = diagnoses[0]?.columns.length || 0;

    return {
      id: 0,
      name: datasetNames[0] || mergedAnalysis?.suggested_name || 'merged_dataset',
      status: totalIssues > 0 ? 'review' : 'ready',
      description: mergedAnalysis?.context || '',
      files: diagnoses.map(d => getFileName(d.file_path)),
      stats: {
        rows: totalMergedRows,
        columns: columnCount,
        issues: totalIssues,
      },
    };
  }, [diagnoses, mergedAnalysis, datasetNames]);

  // Name editing handlers
  const startEditing = (id: number, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const saveEdit = (id: number) => {
    setDatasetNames(prev => ({ ...prev, [id]: editName }));
    setEditingId(null);
  };

  const handleImport = () => {
    onImport(datasetNames);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-border">
        <div>
          <h3 className="text-xl font-bold text-foreground">
            {totalFiles} Files Scanned
          </h3>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors p-2 -mr-2 rounded-lg hover:bg-muted"
        >
          <X size={20} />
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-4">
        {/* Agent Recommendation - shown when schemas match */}
        {showAgentRecommendation && (
          <AgentRecommendation
            fileCount={diagnoses.length}
            totalRows={duplicateInfo?.total_rows || totalRows}
            duplicateRows={duplicateInfo?.duplicate_rows || 0}
            estimatedRows={duplicateInfo?.estimated_rows || totalRows}
            isMerged={mergeFiles}
            removeDuplicates={removeDuplicates}
            onMergeChange={onMergeFilesChange}
            onRemoveDuplicatesChange={onRemoveDuplicatesChange}
          />
        )}

        {/* Dataset Cards */}
        {showAgentRecommendation && mergeFiles ? (
          // Merged view: single card
          <div className="space-y-4">
            <DatasetCard
              dataset={mergedDataset}
              isEditing={editingId === 0}
              editName={editName}
              onStartEdit={startEditing}
              onSaveEdit={saveEdit}
              onEditNameChange={setEditName}
            />
          </div>
        ) : (
          // Individual datasets view
          <div className="space-y-4">
            {datasets.map((dataset) => (
              <DatasetCard
                key={dataset.id}
                dataset={dataset}
                isEditing={editingId === dataset.id}
                editName={editName}
                onStartEdit={startEditing}
                onSaveEdit={saveEdit}
                onEditNameChange={setEditName}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-8 pt-4 pb-8 flex items-center justify-between border-t border-border">
        <Button
          variant="secondary"
          onClick={onBack}
          disabled={isImporting}
          className="px-6 py-3.5 rounded-xl"
        >
          Back
        </Button>

        <Button
          onClick={handleImport}
          disabled={isImporting}
          className="px-8 py-3.5 rounded-xl font-semibold"
        >
          {isImporting ? 'Creating...' : 'Create Datasets'}
        </Button>
      </div>
    </div>
  );
}
