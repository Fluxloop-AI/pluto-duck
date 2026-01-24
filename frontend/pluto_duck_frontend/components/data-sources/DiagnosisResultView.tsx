'use client';

import { X, AlertTriangle, ArrowRight, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import type { FileDiagnosis, ColumnSchema, TypeSuggestion } from '../../lib/fileAssetApi';

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
  onImport: () => void;
  onClose: () => void;
  isImporting: boolean;
  schemasMatch: boolean;
  mergeFiles: boolean;
  onMergeFilesChange: (checked: boolean) => void;
  removeDuplicates: boolean;
  onRemoveDuplicatesChange: (checked: boolean) => void;
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helper to format number with commas
function formatNumber(num: number): string {
  return num.toLocaleString();
}

// Helper to get file name from path
function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

// Single file diagnosis card
interface FileDiagnosisCardProps {
  diagnosis: FileDiagnosis;
  isExpanded: boolean;
  onToggle: () => void;
}

function FileDiagnosisCard({ diagnosis, isExpanded, onToggle }: FileDiagnosisCardProps) {
  const fileName = getFileName(diagnosis.file_path);
  const hasIssues = Object.keys(diagnosis.missing_values).length > 0 || diagnosis.type_suggestions.length > 0;
  const totalMissingValues = Object.values(diagnosis.missing_values).reduce((sum, count) => sum + count, 0);

  // Create a map of type suggestions by column name
  const suggestionsByColumn: Record<string, TypeSuggestion> = {};
  for (const suggestion of diagnosis.type_suggestions) {
    suggestionsByColumn[suggestion.column_name] = suggestion;
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Card Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center text-muted-foreground">
            <FileText size={20} strokeWidth={1.5} />
          </div>
          <div className="text-left">
            <p className="font-medium text-foreground">{fileName}</p>
            <p className="text-sm text-muted-foreground">
              {formatNumber(diagnosis.row_count)} rows, {diagnosis.columns.length} columns, {formatFileSize(diagnosis.file_size_bytes)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasIssues && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-full text-xs font-medium">
              <AlertTriangle size={12} />
              {totalMissingValues > 0 && <span>{formatNumber(totalMissingValues)} nulls</span>}
              {diagnosis.type_suggestions.length > 0 && (
                <span>{diagnosis.type_suggestions.length} type hint{diagnosis.type_suggestions.length > 1 ? 's' : ''}</span>
              )}
            </div>
          )}
          {isExpanded ? <ChevronUp size={20} className="text-muted-foreground" /> : <ChevronDown size={20} className="text-muted-foreground" />}
        </div>
      </button>

      {/* Card Content - Schema Table */}
      {isExpanded && (
        <div className="border-t border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Column</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Nullable</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Issues</th>
                </tr>
              </thead>
              <tbody>
                {diagnosis.columns.map((column: ColumnSchema) => {
                  const missingCount = diagnosis.missing_values[column.name] || 0;
                  const suggestion = suggestionsByColumn[column.name];
                  const hasColumnIssue = missingCount > 0 || suggestion;

                  return (
                    <tr
                      key={column.name}
                      className={hasColumnIssue ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''}
                    >
                      <td className="px-4 py-2 font-mono text-foreground">{column.name}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-muted-foreground">{column.type}</span>
                          {suggestion && (
                            <span className="flex items-center gap-1 text-xs text-primary">
                              <ArrowRight size={12} />
                              <span className="font-mono">{suggestion.suggested_type}</span>
                              <span className="text-muted-foreground">({Math.round(suggestion.confidence * 100)}%)</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {column.nullable ? 'Yes' : 'No'}
                      </td>
                      <td className="px-4 py-2">
                        {missingCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded text-xs">
                            <AlertTriangle size={10} />
                            {formatNumber(missingCount)} null{missingCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
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
}: DiagnosisResultViewProps) {
  // Track which cards are expanded (default: first one expanded)
  const [expandedIndex, setExpandedIndex] = useState<number>(0);

  const totalFiles = diagnoses.length;
  const totalRows = diagnoses.reduce((sum, d) => sum + d.row_count, 0);
  const totalIssues = diagnoses.reduce((sum, d) => {
    const nullCount = Object.values(d.missing_values).reduce((s, c) => s + c, 0);
    return sum + (nullCount > 0 ? 1 : 0) + d.type_suggestions.length;
  }, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-border">
        <div>
          <h3 className="text-xl font-semibold text-foreground">
            File Analysis
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {totalFiles} file{totalFiles > 1 ? 's' : ''}, {formatNumber(totalRows)} total rows
            {totalIssues > 0 && `, ${totalIssues} potential issue${totalIssues > 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors p-2 -mr-2 rounded-lg hover:bg-muted"
        >
          <X size={20} />
        </button>
      </div>

      {/* Merge Files Banner - shown when schemas match */}
      {schemasMatch && diagnoses.length >= 2 && (
        <div className="mx-8 mt-4 p-4 bg-primary/5 border border-primary/20 rounded-xl">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={mergeFiles}
              onChange={(e) => onMergeFilesChange(e.target.checked)}
              className="w-4 h-4 rounded border-primary/50 text-primary focus:ring-primary/50 cursor-pointer"
            />
            <div>
              <span className="text-sm font-medium text-foreground">
                {diagnoses.length}개의 파일을 하나의 데이터셋으로 통합
              </span>
              <span className="text-sm text-muted-foreground ml-2">
                (총 {formatNumber(totalRows)}행)
              </span>
            </div>
          </label>
          {/* Deduplicate checkbox - shown when merge is enabled */}
          {mergeFiles && (
            <label className="flex items-center gap-3 cursor-pointer ml-7 mt-2">
              <input
                type="checkbox"
                checked={removeDuplicates}
                onChange={(e) => onRemoveDuplicatesChange(e.target.checked)}
                className="w-4 h-4 rounded border-primary/50 text-primary focus:ring-primary/50 cursor-pointer"
              />
              <span className="text-sm text-muted-foreground">
                중복된 행 제거 <span className="text-primary">(권장)</span>
              </span>
            </label>
          )}
        </div>
      )}

      {/* Scrollable Diagnosis Cards */}
      <div className="flex-1 overflow-y-auto px-8 py-4 space-y-3">
        {diagnoses.map((diagnosis, index) => (
          <FileDiagnosisCard
            key={diagnosis.file_path}
            diagnosis={diagnosis}
            isExpanded={expandedIndex === index}
            onToggle={() => setExpandedIndex(expandedIndex === index ? -1 : index)}
          />
        ))}
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
          onClick={onImport}
          disabled={isImporting}
          className="px-8 py-3.5 rounded-xl font-semibold"
        >
          {isImporting ? 'Importing...' : `Import ${totalFiles > 1 ? 'All' : ''}`}
        </Button>
      </div>
    </div>
  );
}
