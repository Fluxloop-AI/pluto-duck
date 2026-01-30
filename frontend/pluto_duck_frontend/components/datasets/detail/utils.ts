import type { FileAsset } from '../../../lib/fileAssetApi';
import type { CachedTable } from '../../../lib/sourceApi';
import type { SourceFile } from './types';

type Dataset = FileAsset | CachedTable;

export function isFileAsset(dataset: Dataset): dataset is FileAsset {
  return 'file_type' in dataset;
}

export function getDatasetName(dataset: Dataset): string {
  if (isFileAsset(dataset)) {
    return dataset.name || dataset.table_name;
  }
  return dataset.local_table;
}

function getBaseName(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const parts = filePath.split(/[/\\\\]/);
  return parts[parts.length - 1] || null;
}

export function buildSourceFiles(dataset: Dataset): SourceFile[] {
  if (!isFileAsset(dataset)) {
    return [
      {
        name: dataset.source_table || dataset.local_table || 'Unknown',
        rows: dataset.row_count,
        columns: null,
        size: null,
      },
    ];
  }

  const sources = dataset.sources && dataset.sources.length > 0 ? dataset.sources : null;
  if (!sources) {
    const fallbackName = getBaseName(dataset.file_path) || dataset.name || 'Unknown';
    return [
      {
        name: fallbackName,
        rows: dataset.row_count,
        columns: dataset.column_count,
        size: dataset.file_size_bytes,
      },
    ];
  }

  return sources.map((source) => ({
    name: source.original_name || getBaseName(source.file_path) || dataset.name || 'Unknown',
    rows: source.row_count ?? null,
    columns: null,
    size: source.file_size_bytes ?? null,
    addedAt: source.added_at ?? null,
  }));
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hours}:${minutes}`;
}
