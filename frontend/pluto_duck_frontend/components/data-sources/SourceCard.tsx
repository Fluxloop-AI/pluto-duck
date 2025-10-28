'use client';

import { ChevronDownIcon, DatabaseIcon, FileTextIcon, PackageIcon, PlusIcon, RefreshCwIcon, ServerIcon, TrashIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import type { DataSource, DataSourceTable } from '../../lib/dataSourcesApi';

interface SourceCardProps {
  source: DataSource;
  tables: DataSourceTable[];
  onDelete: (sourceId: string) => void;
  onSyncTable: (sourceId: string, tableId: string) => void;
  onDeleteTable: (sourceId: string, tableId: string) => void;
  onAddTable: (source: DataSource) => void;
}

const CONNECTOR_ICONS: Record<string, React.ReactNode> = {
  csv: <FileTextIcon className="h-5 w-5" />,
  parquet: <PackageIcon className="h-5 w-5" />,
  postgres: <ServerIcon className="h-5 w-5" />,
  sqlite: <DatabaseIcon className="h-5 w-5" />,
};

function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return 'Never';
  
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function formatSource(connectorType: string, config: Record<string, any>): string {
  if (connectorType === 'csv' || connectorType === 'parquet' || connectorType === 'sqlite') {
    const path = config.path as string;
    if (path) {
      // Show only filename or last part of path
      const parts = path.split('/');
      return parts[parts.length - 1] || path;
    }
  }
  
  if (connectorType === 'postgres') {
    const dsn = config.dsn as string;
    if (dsn) {
      // Hide password in DSN
      return dsn.replace(/:([^@]+)@/, ':***@');
    }
  }
  
  return 'Unknown source';
}

function formatRowsCount(rows: number | null): string {
  if (rows === null || rows === undefined) return 'Unknown rows';
  return `${rows.toLocaleString()} rows`;
}

function formatTableSource(table: DataSourceTable): string {
  if (table.source_query) {
    return 'Custom query';
  }
  if (table.source_table) {
    return table.source_table;
  }
  return 'Imported file';
}

export function SourceCard({ source, tables, onDelete, onSyncTable, onDeleteTable, onAddTable }: SourceCardProps) {
  const icon = CONNECTOR_ICONS[source.connector_type] || <DatabaseIcon className="h-5 w-5" />;
  const sourceLabel = formatSource(source.connector_type, source.source_config);
  const hasTables = tables.length > 0;
  
  return (
    <div className="rounded-lg border border-border bg-card p-4 transition hover:border-primary/40">
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">{source.name}</h3>
              <p className="text-xs text-muted-foreground">
                Source: {sourceLabel}
              </p>
            </div>
            
            {/* Status badge */}
            <div
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                source.status === 'active'
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : source.status === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-yellow-500/10 text-yellow-600'
              }`}
            >
              {source.status}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{hasTables ? `${tables.length} table${tables.length > 1 ? 's' : ''}` : 'No tables imported yet'}</span>
            <span>•</span>
            <span>Connector: {source.connector_type}</span>
          </div>

          {source.description && (
            <p className="text-xs text-muted-foreground">{source.description}</p>
          )}

          {source.error_message && (
            <p className="text-xs text-destructive">{source.error_message}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAddTable(source)}
            className="flex items-center gap-1"
          >
            <PlusIcon className="h-4 w-4" /> Add table
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDelete(source.id)}
            title="Delete source"
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Collapsible className="mt-4">
        <CollapsibleTrigger className={`flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-xs transition hover:bg-muted/60 ${hasTables ? '' : 'cursor-default opacity-60'}`} disabled={!hasTables}>
          <span className="font-medium">Imported tables</span>
          <ChevronDownIcon className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 border-l border-border pl-4 pt-3">
          {hasTables ? (
            tables.map(table => (
              <div key={table.id} className="flex items-start justify-between rounded-md border border-border/60 bg-muted/10 p-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{table.target_table}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                      {table.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    <span>{formatTableSource(table)}</span>
                    <span>•</span>
                    <span>{formatRowsCount(table.rows_count)}</span>
                    {table.last_imported_at && (
                      <>
                        <span>•</span>
                        <span>Imported {formatTimeAgo(table.last_imported_at)}</span>
                      </>
                    )}
                  </div>
                  {table.error_message && (
                    <p className="text-destructive">{table.error_message}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSyncTable(source.id, table.id)}
                    title="Re-import table"
                  >
                    <RefreshCwIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDeleteTable(source.id, table.id)}
                    title="Remove table"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground">
              No tables imported yet. Use “Add table” to import data.
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

