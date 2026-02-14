export type Materialization = 'view' | 'table' | 'append' | 'parquet';
export type FileType = 'csv' | 'parquet';
export type IssueStatus = 'open' | 'confirmed' | 'dismissed' | 'resolved';
export type DownloadStatus = 'queued' | 'downloading' | 'completed' | 'error';

export interface AnalysisRecord {
  id: string;
  name: string;
  sql: string;
  description: string | null;
  materialization: Materialization;
  parameters: Array<Record<string, unknown>>;
  tags: string[];
  result_table: string;
  created_at: string;
  updated_at: string;
}

export interface ExecutionStepRecord {
  analysis_id: string;
  action: 'run' | 'skip' | 'fail';
  reason: string | null;
  operation: string | null;
  target_table: string | null;
}

export interface ExecutionPlanRecord {
  target_id: string;
  steps: ExecutionStepRecord[];
  params: Record<string, unknown>;
}

export interface StepResultRecord {
  run_id: string;
  analysis_id: string;
  status: 'success' | 'skipped' | 'failed';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  rows_affected: number | null;
  error: string | null;
}

export interface ExecutionResultRecord {
  success: boolean;
  target_id: string;
  step_results: StepResultRecord[];
}

export interface FreshnessRecord {
  analysis_id: string;
  is_stale: boolean;
  last_run_at: string | null;
  stale_reason: string | null;
}

export interface LineageNodeRecord {
  type: 'analysis' | 'source' | 'file';
  id: string;
  name?: string;
  full?: string;
}

export interface LineageRecord {
  analysis_id: string;
  upstream: LineageNodeRecord[];
  downstream: LineageNodeRecord[];
}

export interface RunHistoryRecord {
  run_id: string;
  analysis_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  rows_affected: number | null;
  error_message: string | null;
}

export interface AnalysisDataRecord {
  columns: string[];
  rows: unknown[][];
  total_rows: number;
}

export interface ExportAnalysisRecord {
  status: string;
  file_path: string;
}

export interface DownloadAnalysisRecord {
  filename: string;
  content: Uint8Array;
}

export interface LineageGraphNodeRecord {
  id: string;
  type: 'analysis' | 'source' | 'file';
  name: string | null;
  materialization: string | null;
  is_stale: boolean | null;
  last_run_at: string | null;
}

export interface LineageGraphEdgeRecord {
  source: string;
  target: string;
}

export interface LineageGraphRecord {
  nodes: LineageGraphNodeRecord[];
  edges: LineageGraphEdgeRecord[];
}

export interface FileSourceRecord {
  file_path: string;
  original_name: string | null;
  row_count: number | null;
  file_size_bytes: number | null;
  added_at: string;
}

export interface FileAssetRecord {
  id: string;
  name: string;
  file_path: string;
  file_type: FileType;
  table_name: string;
  description: string | null;
  row_count: number | null;
  column_count: number | null;
  file_size_bytes: number | null;
  diagnosis_id: string | null;
  created_at: string;
  updated_at: string;
  sources?: FileSourceRecord[] | null;
}

export interface FileSchemaRecord {
  columns: Array<{
    column_name: string;
    column_type: string;
    null: string;
    key: string | null;
    default: string | null;
    extra: string | null;
  }>;
}

export interface FilePreviewRecord {
  columns: string[];
  rows: unknown[][];
  total_rows: number | null;
}

export interface ColumnSchemaRecord {
  name: string;
  type: string;
  nullable: boolean;
}

export interface TypeSuggestionRecord {
  column_name: string;
  current_type: string;
  suggested_type: string;
  confidence: number;
  sample_values?: string[];
}

export interface LlmPotentialRecord {
  question: string;
  analysis: string;
}

export interface LlmIssueRecord {
  issue: string;
  issue_type: string;
  suggestion: string;
  example?: string;
}

export interface LlmAnalysisRecord {
  suggested_name: string;
  context: string;
  potential: LlmPotentialRecord[];
  issues: LlmIssueRecord[];
  analyzed_at: string;
  model_used: string;
}

export interface FileDiagnosisRecord {
  file_path: string;
  file_type: string;
  columns: ColumnSchemaRecord[];
  missing_values: Record<string, number>;
  row_count: number;
  file_size_bytes: number;
  type_suggestions: TypeSuggestionRecord[];
  diagnosed_at: string;
  encoding?: {
    detected: string;
    confidence: number;
  };
  parsing_integrity?: {
    total_lines: number;
    parsed_rows: number;
    malformed_rows: number;
    has_errors: boolean;
    error_message?: string;
  };
  column_statistics?: Array<Record<string, unknown>>;
  sample_rows?: unknown[][];
  llm_analysis?: LlmAnalysisRecord;
  diagnosis_id?: string;
}

export interface DiagnoseFilesResponseRecord {
  diagnoses: FileDiagnosisRecord[];
  merged_analysis?: {
    suggested_name: string;
    context: string;
  };
  llm_pending?: boolean;
}

export interface DuplicateCountRecord {
  total_rows: number;
  duplicate_rows: number;
  estimated_rows: number;
  skipped: boolean;
}

export interface DiagnosisIssueRecord {
  id: string;
  diagnosis_id: string;
  file_asset_id: string;
  issue: string;
  issue_type: string;
  suggestion?: string | null;
  example?: string | null;
  status: IssueStatus;
  user_response?: string | null;
  confirmed_at?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FilePreprocessingEventRecord {
  id: string;
  file_asset_id: string;
  event_type: string;
  message: string | null;
  actor: string | null;
  created_at: string;
}

export interface LocalModelInfoRecord {
  id: string;
  name: string;
  path: string;
  size_bytes?: number | null;
  quantization?: string | null;
}

export interface LocalDownloadStatusRecord {
  status: DownloadStatus;
  detail?: string | null;
  updated_at: string;
}
