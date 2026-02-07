'use client';

import { useState, useEffect, useCallback } from 'react';
import { Upload, Folder, FileSpreadsheet, Database, FileText, Trash2, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { isTauriRuntime } from '../../lib/tauriRuntime';
import { importFile, diagnoseFiles, countDuplicateRows, type FileType, type FileDiagnosis, type DiagnoseFileRequest, type DuplicateCountResponse, type MergedAnalysis, type FileAsset } from '../../lib/fileAssetApi';
import { DiagnosisResultView } from './DiagnosisResultView';
import { DatasetAnalyzingView } from './DatasetAnalyzingView';

interface SelectedFile {
  id: string;
  name: string;
  path: string | null;
}

// Allowed file extensions
const ALLOWED_EXTENSIONS = ['csv', 'parquet'];

// Helper to generate unique IDs
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// Helper to extract filename from path
function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

// Helper to check if file extension is allowed
function isAllowedFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? ALLOWED_EXTENSIONS.includes(ext) : false;
}

// Helper to get file type from filename
function getFileType(filename: string): FileType | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'parquet') return 'parquet';
  return null;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\[^\\]/.test(path);
}

function hasParentTraversal(path: string): boolean {
  return path.split(/[\\/]+/).some(segment => segment === '..');
}

// Helper to check if all file diagnoses have identical schemas
// Returns true only when: 2+ files, same file_type, identical columns (name case-insensitive, type)
function areSchemasIdentical(diagnoses: FileDiagnosis[]): boolean {
  // Need at least 2 files to compare
  if (diagnoses.length < 2) return false;

  const first = diagnoses[0];

  // Check all files have the same file_type
  const allSameType = diagnoses.every(d => d.file_type === first.file_type);
  if (!allSameType) return false;

  // Compare columns: count, names (case-insensitive), and types
  const firstColumns = first.columns;

  for (let i = 1; i < diagnoses.length; i++) {
    const current = diagnoses[i];

    // Check column count
    if (current.columns.length !== firstColumns.length) return false;

    // Check each column matches (name case-insensitive, type exact)
    for (let j = 0; j < firstColumns.length; j++) {
      const firstCol = firstColumns[j];
      const currentCol = current.columns[j];

      if (firstCol.name.toLowerCase() !== currentCol.name.toLowerCase()) return false;
      if (firstCol.type !== currentCol.type) return false;
    }
  }

  return true;
}

function mergeDiagnosisResults(
  current: FileDiagnosis[] | null,
  incoming: FileDiagnosis[]
): FileDiagnosis[] {
  if (!current) return incoming;

  const currentByPath = new Map(current.map(d => [d.file_path, d]));

  return incoming.map((next) => {
    const prev = currentByPath.get(next.file_path);
    if (!prev) return next;
    return {
      ...prev,
      llm_analysis: next.llm_analysis ?? prev.llm_analysis,
      diagnosis_id: next.diagnosis_id ?? prev.diagnosis_id,
    };
  });
}

// Helper to generate a valid table name from filename
function generateTableName(filename: string): string {
  // Remove extension
  const nameWithoutExt = filename.replace(/\.(csv|parquet)$/i, '');
  // Convert to valid identifier: lowercase, replace non-alphanumeric with underscore
  return nameWithoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    .substring(0, 63); // Max length for identifiers
}

function buildMissingPathError(fileName: string): string {
  return `${fileName}: Missing file path in selected entry (unexpected state). Remove and add again from From device.`;
}

interface AddDatasetModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSuccess?: (createdAsset?: FileAsset) => void;
  onOpenPostgresModal?: () => void;
  language?: 'en' | 'ko';
}

type Step = 'select' | 'preview' | 'analyzing' | 'diagnose';

interface WebPathInputPanelProps {
  pendingPath: string;
  pathInputError: string | null;
  onPathChange: (value: string) => void;
  onPathSubmit: () => void;
  onPathCancel: () => void;
}

function WebPathInputPanel({
  pendingPath,
  pathInputError,
  onPathChange,
  onPathSubmit,
  onPathCancel,
}: WebPathInputPanelProps) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <p className="text-sm font-medium text-foreground mb-2">Absolute file path</p>
      <div className="flex items-center gap-2">
        <Input
          value={pendingPath}
          onChange={(e) => onPathChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onPathSubmit();
            }
          }}
          placeholder="/absolute/path/to/data.csv"
          className="flex-1"
        />
        <Button type="button" onClick={onPathSubmit} className="px-4">
          Add
        </Button>
        <Button type="button" variant="secondary" onClick={onPathCancel} className="px-4">
          Cancel
        </Button>
      </div>
      {pathInputError && <p className="text-sm text-destructive mt-2">{pathInputError}</p>}
    </div>
  );
}

// ============================================================================
// SelectSourceView - Initial view with dropzone and options
// ============================================================================

interface SelectSourceViewProps {
  onFromDeviceClick: () => void;
  onGoogleSheetsClick: () => void;
  onDatabaseClick: () => void;
  onCancel: () => void;
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  showPathInput: boolean;
  pendingPath: string;
  pathInputError: string | null;
  onPathChange: (value: string) => void;
  onPathSubmit: () => void;
  onPathCancel: () => void;
}

function SelectSourceView({
  onFromDeviceClick,
  onGoogleSheetsClick,
  onDatabaseClick,
  onCancel,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  showPathInput,
  pendingPath,
  pathInputError,
  onPathChange,
  onPathSubmit,
  onPathCancel,
}: SelectSourceViewProps) {
  return (
    <div className="flex flex-col h-full p-8">
      {/* Dropzone Area */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`border border-dashed rounded-2xl flex-1 flex flex-col items-center justify-center cursor-pointer transition-all group mb-6 min-h-0 ${
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/20 bg-muted/30 hover:bg-muted/50 hover:border-primary/50'
        }`}
      >
        <div className="w-16 h-16 bg-background rounded-full flex items-center justify-center shadow-sm border border-border mb-4 group-hover:scale-110 transition-transform">
          <Upload size={28} className="text-foreground" />
        </div>
        <p className="text-foreground text-lg font-medium">Drop files here</p>
        <p className="text-muted-foreground text-sm mt-1">CSV or Parquet files</p>
      </div>

      {/* Options List */}
      <div className="space-y-2 mb-8">
        <button
          onClick={onFromDeviceClick}
          className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-muted rounded-xl transition-colors text-left group"
        >
          <Folder size={20} className="text-muted-foreground group-hover:text-foreground transition-colors" />
          <span className="text-muted-foreground group-hover:text-foreground text-base font-medium transition-colors">From device</span>
        </button>
        <button
          onClick={onGoogleSheetsClick}
          className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-muted rounded-xl transition-colors text-left group opacity-50 cursor-not-allowed"
          disabled
        >
          <FileSpreadsheet size={20} className="text-muted-foreground" />
          <span className="text-muted-foreground text-base font-medium">Google Sheets</span>
          <span className="ml-auto text-xs text-muted-foreground">Coming soon</span>
        </button>
        <button
          onClick={onDatabaseClick}
          className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-muted rounded-xl transition-colors text-left group"
        >
          <Database size={20} className="text-muted-foreground group-hover:text-foreground transition-colors" />
          <span className="text-muted-foreground group-hover:text-foreground text-base font-medium transition-colors">Database</span>
        </button>
      </div>

      {showPathInput && (
        <div className="mb-6">
          <WebPathInputPanel
            pendingPath={pendingPath}
            pathInputError={pathInputError}
            onPathChange={onPathChange}
            onPathSubmit={onPathSubmit}
            onPathCancel={onPathCancel}
          />
        </div>
      )}

      {/* Cancel Button */}
      <Button
        variant="secondary"
        onClick={onCancel}
        className="w-full py-3.5 rounded-xl"
      >
        Cancel
      </Button>
    </div>
  );
}

// ============================================================================
// FilePreviewView - View showing selected files
// ============================================================================

interface FilePreviewViewProps {
  files: SelectedFile[];
  onRemoveFile: (id: string) => void;
  onClear: () => void;
  onAddMore: () => void;
  onScan: () => void;
  onClose: () => void;
  isDiagnosing: boolean;
  diagnosisError: string | null;
  showPathInput: boolean;
  pendingPath: string;
  pathInputError: string | null;
  onPathChange: (value: string) => void;
  onPathSubmit: () => void;
  onPathCancel: () => void;
}

function FilePreviewView({
  files,
  onRemoveFile,
  onClear,
  onAddMore,
  onScan,
  onClose,
  isDiagnosing,
  diagnosisError,
  showPathInput,
  pendingPath,
  pathInputError,
  onPathChange,
  onPathSubmit,
  onPathCancel,
}: FilePreviewViewProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-border">
        <h3 className="text-xl font-semibold text-foreground">
          {files.length} file{files.length !== 1 ? 's' : ''} uploaded
        </h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors p-2 -mr-2 rounded-lg hover:bg-muted"
        >
          <X size={20} />
        </button>
      </div>

      {/* Scrollable File List */}
      <div className="flex-1 overflow-y-auto px-8 py-4 space-y-2">
        {files.map((file) => (
          <div
            key={file.id}
            className="flex items-center justify-between p-2.5 bg-muted/50 rounded-xl group transition-all hover:bg-muted border border-transparent hover:border-border"
          >
            <div className="flex items-center gap-3 min-w-0">
              {/* File Icon with Check */}
              <div className="relative w-10 h-10 flex-shrink-0 bg-muted rounded-lg flex items-center justify-center text-muted-foreground">
                <FileText size={20} strokeWidth={1.5} />
                <div className="absolute -bottom-1 -right-0.5 w-4 h-4 bg-foreground rounded-full flex items-center justify-center border-[1.5px] border-background z-10">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-background">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>
              <span className="text-sm font-medium text-foreground truncate pr-2">{file.name}</span>
            </div>
            <button
              onClick={() => onRemoveFile(file.id)}
              className="text-muted-foreground hover:text-destructive p-1.5 rounded-lg transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>

      {showPathInput && (
        <div className="px-8 pb-4">
          <WebPathInputPanel
            pendingPath={pendingPath}
            pathInputError={pathInputError}
            onPathChange={onPathChange}
            onPathSubmit={onPathSubmit}
            onPathCancel={onPathCancel}
          />
        </div>
      )}

      {/* Error message */}
      {diagnosisError && (
        <div className="px-8 py-3 bg-destructive/10 border-t border-destructive/20">
          <p className="text-sm text-destructive">{diagnosisError}</p>
        </div>
      )}

      {/* Footer Actions */}
      <div className="p-8 pt-4 pb-8 flex items-center justify-between border-t border-border">
        <Button
          variant="secondary"
          onClick={onClear}
          disabled={isDiagnosing}
          className="px-6 py-3.5 rounded-xl"
        >
          Clear
        </Button>

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={onAddMore}
            disabled={isDiagnosing}
            className="px-6 py-3.5 rounded-xl"
          >
            Add more
          </Button>
          <Button
            onClick={onScan}
            disabled={isDiagnosing || files.length === 0}
            className="px-8 py-3.5 rounded-xl font-semibold"
          >
            {isDiagnosing ? 'Analyzing...' : 'Scan'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// AddDatasetModal - Main component
// ============================================================================

export function AddDatasetModal({
  projectId,
  open,
  onOpenChange,
  onImportSuccess,
  onOpenPostgresModal,
  language,
}: AddDatasetModalProps) {
  const [step, setStep] = useState<Step>('select');
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagnosisResults, setDiagnosisResults] = useState<FileDiagnosis[] | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
  const [mergeFiles, setMergeFiles] = useState(false);
  const [schemasMatch, setSchemasMatch] = useState(false);
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [llmReady, setLlmReady] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateCountResponse | null>(null);
  const [mergedAnalysis, setMergedAnalysis] = useState<MergedAnalysis | null>(null);
  const [showPathInput, setShowPathInput] = useState(false);
  const [pendingPath, setPendingPath] = useState('');
  const [pathInputError, setPathInputError] = useState<string | null>(null);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setStep('select');
      setSelectedFiles([]);
      setIsDragOver(false);
      setIsDiagnosing(false);
      setDiagnosisResults(null);
      setIsImporting(false);
      setDiagnosisError(null);
      setMergeFiles(false);
      setSchemasMatch(false);
      setRemoveDuplicates(true);
      setLlmReady(false);
      setDuplicateInfo(null);
      setMergedAnalysis(null);
      setShowPathInput(false);
      setPendingPath('');
      setPathInputError(null);
    }
  }, [open]);

  // Listen for Tauri file drop events when modal is open
  useEffect(() => {
    if (!open || !isTauriRuntime()) return;

    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      try {
        const appWindow = getCurrentWebviewWindow();
        unlisten = await appWindow.onDragDropEvent((event) => {
          if (event.payload.type === 'enter') {
            setIsDragOver(true);
          } else if (event.payload.type === 'drop') {
            setIsDragOver(false);
            const paths = event.payload.paths;
            const newFiles: SelectedFile[] = paths
              .filter((p: string) => isAllowedFile(p))
              .map((p: string) => ({
                id: generateId(),
                name: getFileName(p),
                path: p,
              }));
            if (newFiles.length > 0) {
              setSelectedFiles(prev => [...prev, ...newFiles]);
              setStep('preview');
            }
          } else {
            // 'leave' or other types
            setIsDragOver(false);
          }
        });
      } catch {
        setPathInputError('Failed to set up drag and drop listener.');
      }
    };

    void setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [open]);

  // File manipulation helpers
  const addFiles = useCallback((newFiles: SelectedFile[]) => {
    setSelectedFiles(prev => [...prev, ...newFiles]);
    if (newFiles.length > 0) {
      setShowPathInput(false);
      setPendingPath('');
      setPathInputError(null);
      setStep('preview');
    }
  }, []);

  const removeFile = useCallback((id: string) => {
    setSelectedFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      if (next.length === 0) {
        setStep('select');
      }
      return next;
    });
  }, []);

  const clearFiles = useCallback(() => {
    setSelectedFiles([]);
    setShowPathInput(false);
    setPendingPath('');
    setPathInputError(null);
    setStep('select');
  }, []);

  // Drag and drop handlers (for web environment)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauriRuntime()) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauriRuntime()) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // In Tauri, the onDragDropEvent handles this
    if (isTauriRuntime()) return;

    setIsDragOver(false);

    setShowPathInput(true);
    setPathInputError('Drag and drop is not supported in web mode. Paste an absolute file path.');
  }, []);

  // From device button handler
  const handleFromDeviceClick = useCallback(async () => {
    if (isTauriRuntime()) {
      try {
        const selected = await openDialog({
          multiple: true,
          filters: [
            {
              name: 'Data Files',
              extensions: ALLOWED_EXTENSIONS,
            },
          ],
        });

        if (!selected) return;

        // selected can be string or string[]
        const paths = Array.isArray(selected) ? selected : [selected];
        const newFiles: SelectedFile[] = paths.map(p => ({
          id: generateId(),
          name: getFileName(p),
          path: p,
        }));

        if (newFiles.length > 0) {
          addFiles(newFiles);
        }
      } catch {
        setPathInputError('Failed to open file picker.');
      }
    } else {
      setShowPathInput(true);
      setPathInputError(null);
    }
  }, [addFiles]);

  const handleWebPathChange = useCallback((value: string) => {
    setPendingPath(value);
    setPathInputError(null);
  }, []);

  const handleWebPathCancel = useCallback(() => {
    setShowPathInput(false);
    setPendingPath('');
    setPathInputError(null);
  }, []);

  const handleWebPathSubmit = useCallback(() => {
    const trimmedPath = pendingPath.trim();
    if (!trimmedPath) {
      setPathInputError('File path is required');
      return;
    }
    if (!isAbsolutePath(trimmedPath)) {
      setPathInputError('Absolute file path is required');
      return;
    }
    if (hasParentTraversal(trimmedPath)) {
      setPathInputError("Parent traversal ('..') is not allowed");
      return;
    }

    const fileName = getFileName(trimmedPath);
    if (!isAllowedFile(fileName)) {
      setPathInputError('Only .csv and .parquet files are supported');
      return;
    }

    addFiles([{
      id: generateId(),
      name: fileName,
      path: trimmedPath,
    }]);
  }, [pendingPath, addFiles]);

  const handleGoogleSheetsClick = useCallback(() => {
    // Coming soon - no action
  }, []);

  const handleDatabaseClick = useCallback(() => {
    onOpenChange(false);
    onOpenPostgresModal?.();
  }, [onOpenChange, onOpenPostgresModal]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Diagnose files - called when Scan button is clicked
  const handleScan = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    setIsDiagnosing(true);
    setDiagnosisError(null);
    setLlmReady(false);

    // Build diagnosis request
    const filesToDiagnose: DiagnoseFileRequest[] = [];
    const errors: string[] = [];

    for (const file of selectedFiles) {
      if (!file.path) {
        errors.push(buildMissingPathError(file.name));
        continue;
      }

      const fileType = getFileType(file.name);
      if (!fileType) {
        errors.push(`${file.name}: Unsupported file type`);
        continue;
      }

      filesToDiagnose.push({
        file_path: file.path,
        file_type: fileType,
      });
    }

    if (filesToDiagnose.length === 0) {
      setDiagnosisError(errors.join('\n'));
      setIsDiagnosing(false);
      return;
    }

    // Immediately transition to analyzing step (before API calls)
    setStep('analyzing');
    setDiagnosisResults(null);

    try {
      const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const logPrefix = `[LLM DIAG][${traceId}]`;

      // First API call: fast diagnosis without LLM
      const fastResponse = await diagnoseFiles(projectId, filesToDiagnose, true, false, false, undefined, 'sync', language);
      setDiagnosisResults(fastResponse.diagnoses);

      // Check if schemas are identical for merge option
      const schemasIdentical = areSchemasIdentical(fastResponse.diagnoses);
      setSchemasMatch(schemasIdentical);
      setMergeFiles(false); // Reset merge checkbox when re-scanning
      setDuplicateInfo(null); // Reset duplicate info

      // If schemas match, count duplicates first to include in LLM merge context
      let dupResponse: DuplicateCountResponse | null = null;
      if (schemasIdentical) {
        try {
          dupResponse = await countDuplicateRows(projectId, filesToDiagnose);
          setDuplicateInfo(dupResponse);
        } catch {
          // Duplicate count failure is not critical
        }
      }

      // Second API call: with LLM analysis (slower)
      try {
        // If schemas match and we have duplicate info, include merge analysis
        const includeMergeAnalysis = schemasIdentical && dupResponse !== null;
        const mergeContext = dupResponse ? {
          total_rows: dupResponse.total_rows,
          duplicate_rows: dupResponse.duplicate_rows,
          estimated_rows: dupResponse.estimated_rows,
          skipped: dupResponse.skipped,
        } : undefined;

        const llmMode = 'defer';
        const llmResponse = await diagnoseFiles(
          projectId,
          filesToDiagnose,
          true,
          true,
          includeMergeAnalysis,
          mergeContext,
          llmMode,
          language
        );
        setDiagnosisResults((current) => mergeDiagnosisResults(current, llmResponse.diagnoses));

        // Store merged analysis if present
        if (llmResponse.merged_analysis) {
          setMergedAnalysis(llmResponse.merged_analysis);
        }

        const llmPending = llmResponse.llm_pending ?? llmResponse.diagnoses.some(d => !d.llm_analysis);
        console.info(`${logPrefix} defer response`, {
          llmPending,
          diagnosisCount: llmResponse.diagnoses.length,
          missingLlmCount: llmResponse.diagnoses.filter(d => !d.llm_analysis).length,
          hasMergedAnalysis: Boolean(llmResponse.merged_analysis),
        });

        if (llmPending) {
          const pollIntervalMs = 3000;
          const pollTimeoutMs = 180000;
          const pollStartedAt = Date.now();
          let pollAttempt = 0;
          let resolvedInPoll = false;
          console.info(`${logPrefix} poll start`, { pollIntervalMs, pollTimeoutMs });

          while (Date.now() - pollStartedAt < pollTimeoutMs) {
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            pollAttempt += 1;
            try {
              const pollResponse = await diagnoseFiles(
                projectId,
                filesToDiagnose,
                true,
                true,
                includeMergeAnalysis,
                mergeContext,
                'cache_only',
                language
              );

              setDiagnosisResults((current) => mergeDiagnosisResults(current, pollResponse.diagnoses));
              if (pollResponse.merged_analysis) {
                setMergedAnalysis(pollResponse.merged_analysis);
              }

              const stillPending = pollResponse.llm_pending ?? pollResponse.diagnoses.some(d => !d.llm_analysis);
              console.info(`${logPrefix} poll tick`, {
                pollAttempt,
                elapsedMs: Date.now() - pollStartedAt,
                stillPending,
                missingLlmCount: pollResponse.diagnoses.filter(d => !d.llm_analysis).length,
                hasMergedAnalysis: Boolean(pollResponse.merged_analysis),
              });
              if (!stillPending) {
                resolvedInPoll = true;
                console.info(`${logPrefix} llm ready from poll`, {
                  pollAttempt,
                  elapsedMs: Date.now() - pollStartedAt,
                });
                break;
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.warn(`${logPrefix} poll failed`, { pollAttempt, message });
              break;
            }
          }

          if (!resolvedInPoll) {
            console.warn(`${logPrefix} poll ended without ready`, {
              elapsedMs: Date.now() - pollStartedAt,
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`${logPrefix} llm stage failed`, { message });
        // LLM failure is not critical - we already have the fast diagnosis
      }

      console.info(`${logPrefix} setLlmReady(true)`);
      setLlmReady(true);
    } catch (error) {
      // First API call failed - go back to preview
      const message = error instanceof Error ? error.message : 'Failed to diagnose files';
      setDiagnosisError(message);
      setStep('preview');
    } finally {
      setIsDiagnosing(false);
    }
  }, [projectId, selectedFiles, language]);

  // Import files - called when Import button is clicked on diagnose step
  const handleConfirmImport = useCallback(async (datasetNames: Record<number, string>) => {
    if (selectedFiles.length === 0) return;

    setIsImporting(true);
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    // Merged import: combine all files into single table
    if (mergeFiles && schemasMatch && selectedFiles.length >= 2) {
      const firstFile = selectedFiles[0];

      if (!firstFile.path) {
        errors.push(buildMissingPathError(firstFile.name));
        setIsImporting(false);
        return;
      }

      const fileType = getFileType(firstFile.name);
      if (!fileType) {
        errors.push(`${firstFile.name}: Unsupported file type`);
        setIsImporting(false);
        return;
      }

      // Use edited name if provided, otherwise use merged analysis suggestion or default
      const tableName = datasetNames[0] || mergedAnalysis?.suggested_name || generateTableName(firstFile.name);

      // Get the first diagnosis for diagnosis_id
      const firstDiagnosis = diagnosisResults?.[0];

      // First file: create table with replace mode
      let createdAsset: FileAsset | undefined;
      try {
        createdAsset = await importFile(projectId, {
          file_path: firstFile.path,
          file_type: fileType,
          table_name: tableName,
          name: tableName,
          overwrite: true,
          mode: 'replace',
          diagnosis_id: firstDiagnosis?.diagnosis_id,
        });
        successCount++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${firstFile.name}: ${message}`);
        setIsImporting(false);
        return; // First file failure means entire merge fails
      }

      // Remaining files: append to the first table
      for (let i = 1; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];

        if (!file.path) {
          errors.push(buildMissingPathError(file.name));
          continue;
        }

        const appendFileType = getFileType(file.name);
        if (!appendFileType) {
          errors.push(`${file.name}: Unsupported file type`);
          continue;
        }

        try {
          await importFile(projectId, {
            file_path: file.path,
            file_type: appendFileType,
            table_name: tableName,
            name: file.name,
            mode: 'append',
            target_table: tableName,
            deduplicate: removeDuplicates,
          });
          successCount++;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`${file.name}: ${message}`);
          // Continue with remaining files (partial success allowed)
        }
      }

      setIsImporting(false);
      onImportSuccess?.(createdAsset);

      onOpenChange(false);
      return;
    }

    // Standard import: each file becomes its own table
    // Keep track of used table names to avoid duplicates
    const usedTableNames = new Set<string>();
    let lastCreatedAsset: FileAsset | undefined;

    // Import files sequentially to avoid DB conflicts
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const diagnosis = diagnosisResults?.[i];

      // Only Tauri files with paths can be imported
      if (!file.path) {
        errors.push(buildMissingPathError(file.name));
        failCount++;
        continue;
      }

      const fileType = getFileType(file.name);
      if (!fileType) {
        errors.push(`${file.name}: Unsupported file type`);
        failCount++;
        continue;
      }

      // Use edited name if provided, otherwise use LLM suggestion or default
      let tableName = datasetNames[i] || diagnosis?.llm_analysis?.suggested_name || generateTableName(file.name);
      let suffix = 1;
      while (usedTableNames.has(tableName)) {
        const baseName = datasetNames[i] || diagnosis?.llm_analysis?.suggested_name || generateTableName(file.name);
        tableName = `${baseName}_${suffix}`;
        suffix++;
      }
      usedTableNames.add(tableName);

      try {
        lastCreatedAsset = await importFile(projectId, {
          file_path: file.path,
          file_type: fileType,
          table_name: tableName,
          name: tableName,
          overwrite: true,
          diagnosis_id: diagnosis?.diagnosis_id,
        });
        successCount++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${file.name}: ${message}`);
        failCount++;
      }
    }

    setIsImporting(false);

    if (successCount > 0) {
      onImportSuccess?.(lastCreatedAsset);
    }

    if (failCount === 0) {
      // All files imported successfully
      onOpenChange(false);
    } else if (successCount > 0) {
      // Partial success - close modal to keep current UX
      onOpenChange(false);
    } else {
      // All files failed; keep modal open so user can retry
      setDiagnosisError(errors.join('\n'));
      // Keep modal open so user can see the files and retry
    }
  }, [projectId, selectedFiles, mergeFiles, schemasMatch, removeDuplicates, diagnosisResults, mergedAnalysis, onImportSuccess, onOpenChange]);

  // Go back from diagnose step to preview step
  const handleBackFromDiagnose = useCallback(() => {
    setStep('preview');
    setDiagnosisResults(null);
    setDiagnosisError(null);
  }, []);

  // Transition from analyzing step to diagnose step
  const handleAnalyzingComplete = useCallback(() => {
    setStep('diagnose');
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 sm:max-w-[600px] h-[580px] rounded-3xl overflow-hidden">
        {step === 'select' && (
          <SelectSourceView
            onFromDeviceClick={handleFromDeviceClick}
            onGoogleSheetsClick={handleGoogleSheetsClick}
            onDatabaseClick={handleDatabaseClick}
            onCancel={handleCancel}
            isDragOver={isDragOver}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            showPathInput={showPathInput}
            pendingPath={pendingPath}
            pathInputError={pathInputError}
            onPathChange={handleWebPathChange}
            onPathSubmit={handleWebPathSubmit}
            onPathCancel={handleWebPathCancel}
          />
        )}
        {step === 'preview' && (
          <FilePreviewView
            files={selectedFiles}
            onRemoveFile={removeFile}
            onClear={clearFiles}
            onAddMore={handleFromDeviceClick}
            onScan={handleScan}
            onClose={handleCancel}
            isDiagnosing={isDiagnosing}
            diagnosisError={diagnosisError}
            showPathInput={showPathInput}
            pendingPath={pendingPath}
            pathInputError={pathInputError}
            onPathChange={handleWebPathChange}
            onPathSubmit={handleWebPathSubmit}
            onPathCancel={handleWebPathCancel}
          />
        )}
        {step === 'analyzing' && (
          <DatasetAnalyzingView
            diagnosisResults={diagnosisResults}
            selectedFiles={selectedFiles}
            onComplete={handleAnalyzingComplete}
            llmReady={llmReady}
          />
        )}
        {step === 'diagnose' && diagnosisResults && (
          <DiagnosisResultView
            diagnoses={diagnosisResults}
            files={selectedFiles}
            onBack={handleBackFromDiagnose}
            onImport={handleConfirmImport}
            onClose={handleCancel}
            isImporting={isImporting}
            schemasMatch={schemasMatch}
            mergeFiles={mergeFiles}
            onMergeFilesChange={setMergeFiles}
            removeDuplicates={removeDuplicates}
            onRemoveDuplicatesChange={setRemoveDuplicates}
            duplicateInfo={duplicateInfo}
            mergedAnalysis={mergedAnalysis}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
