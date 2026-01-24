'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, Folder, FileSpreadsheet, Database, FileText, Trash2, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { isTauriRuntime } from '../../lib/tauriRuntime';
import { importFile, diagnoseFiles, type FileType, type FileDiagnosis, type DiagnoseFileRequest } from '../../lib/fileAssetApi';
import { DiagnosisResultView } from './DiagnosisResultView';

interface SelectedFile {
  id: string;
  name: string;
  path: string | null;
  file?: File;
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

interface AddDatasetModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSuccess?: () => void;
  onOpenPostgresModal?: () => void;
}

type Step = 'select' | 'preview' | 'diagnose';

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

  // Ref for hidden file input (web fallback)
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      } catch (error) {
        console.error('Failed to setup drag drop listener:', error);
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

    // Web environment: handle File objects (no path available)
    const files = Array.from(e.dataTransfer.files);
    const newFiles: SelectedFile[] = files
      .filter(f => isAllowedFile(f.name))
      .map(f => ({
        id: generateId(),
        name: f.name,
        path: null, // Web doesn't have access to file paths
        file: f,
      }));

    if (newFiles.length > 0) {
      addFiles(newFiles);
    }
  }, [addFiles]);

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
      } catch (error) {
        console.error('Failed to open file dialog:', error);
      }
    } else {
      // Web environment: use hidden file input
      fileInputRef.current?.click();
    }
  }, [addFiles]);

  // Handle file input change (web fallback)
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: SelectedFile[] = Array.from(files)
      .filter(f => isAllowedFile(f.name))
      .map(f => ({
        id: generateId(),
        name: f.name,
        path: null,
        file: f,
      }));

    if (newFiles.length > 0) {
      addFiles(newFiles);
    }

    // Reset input so same file can be selected again
    e.target.value = '';
  }, [addFiles]);

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

    // Build diagnosis request
    const filesToDiagnose: DiagnoseFileRequest[] = [];
    const errors: string[] = [];

    for (const file of selectedFiles) {
      if (!file.path) {
        errors.push(`${file.name}: No file path available (web upload not supported yet)`);
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

    try {
      const response = await diagnoseFiles(projectId, filesToDiagnose);
      setDiagnosisResults(response.diagnoses);
      // Check if schemas are identical for merge option
      const schemasIdentical = areSchemasIdentical(response.diagnoses);
      setSchemasMatch(schemasIdentical);
      setMergeFiles(false); // Reset merge checkbox when re-scanning
      setStep('diagnose');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to diagnose files';
      setDiagnosisError(message);
      console.error('Diagnosis failed:', error);
    } finally {
      setIsDiagnosing(false);
    }
  }, [projectId, selectedFiles]);

  // Import files - called when Import button is clicked on diagnose step
  const handleConfirmImport = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    setIsImporting(true);
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    // Merged import: combine all files into single table
    if (mergeFiles && schemasMatch && selectedFiles.length >= 2) {
      const firstFile = selectedFiles[0];

      if (!firstFile.path) {
        errors.push(`${firstFile.name}: No file path available (web upload not supported yet)`);
        setIsImporting(false);
        console.error('First file has no path:', errors);
        return;
      }

      const fileType = getFileType(firstFile.name);
      if (!fileType) {
        errors.push(`${firstFile.name}: Unsupported file type`);
        setIsImporting(false);
        console.error('First file has unsupported type:', errors);
        return;
      }

      const tableName = generateTableName(firstFile.name);

      // First file: create table with replace mode
      try {
        await importFile(projectId, {
          file_path: firstFile.path,
          file_type: fileType,
          table_name: tableName,
          name: firstFile.name,
          overwrite: true,
          mode: 'replace',
        });
        successCount++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${firstFile.name}: ${message}`);
        setIsImporting(false);
        console.error('First file failed to import:', errors);
        return; // First file failure means entire merge fails
      }

      // Remaining files: append to the first table
      for (let i = 1; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];

        if (!file.path) {
          errors.push(`${file.name}: No file path available`);
          console.warn(`Skipping file without path: ${file.name}`);
          continue;
        }

        const appendFileType = getFileType(file.name);
        if (!appendFileType) {
          errors.push(`${file.name}: Unsupported file type`);
          console.warn(`Skipping file with unsupported type: ${file.name}`);
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
          console.warn(`Append failed for ${file.name}:`, message);
          // Continue with remaining files (partial success allowed)
        }
      }

      setIsImporting(false);
      onImportSuccess?.();

      if (errors.length > 0) {
        console.warn('Some files failed during merge:', errors);
      }
      onOpenChange(false);
      return;
    }

    // Standard import: each file becomes its own table
    // Keep track of used table names to avoid duplicates
    const usedTableNames = new Set<string>();

    // Import files sequentially to avoid DB conflicts
    for (const file of selectedFiles) {
      // Only Tauri files with paths can be imported
      if (!file.path) {
        errors.push(`${file.name}: No file path available (web upload not supported yet)`);
        failCount++;
        continue;
      }

      const fileType = getFileType(file.name);
      if (!fileType) {
        errors.push(`${file.name}: Unsupported file type`);
        failCount++;
        continue;
      }

      // Generate unique table name
      let tableName = generateTableName(file.name);
      let suffix = 1;
      while (usedTableNames.has(tableName)) {
        tableName = `${generateTableName(file.name)}_${suffix}`;
        suffix++;
      }
      usedTableNames.add(tableName);

      try {
        await importFile(projectId, {
          file_path: file.path,
          file_type: fileType,
          table_name: tableName,
          name: file.name,
          overwrite: true,
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
      onImportSuccess?.();
    }

    if (failCount === 0) {
      // All files imported successfully
      onOpenChange(false);
    } else if (successCount > 0) {
      // Partial success - log errors but close modal
      console.warn('Some files failed to import:', errors);
      onOpenChange(false);
    } else {
      // All files failed
      console.error('All files failed to import:', errors);
      // Keep modal open so user can see the files and retry
    }
  }, [projectId, selectedFiles, mergeFiles, schemasMatch, removeDuplicates, onImportSuccess, onOpenChange]);

  // Go back from diagnose step to preview step
  const handleBackFromDiagnose = useCallback(() => {
    setStep('preview');
    setDiagnosisResults(null);
    setDiagnosisError(null);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 sm:max-w-[600px] h-[580px] rounded-3xl overflow-hidden">
        {/* Hidden file input for web fallback */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.parquet"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />

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
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
