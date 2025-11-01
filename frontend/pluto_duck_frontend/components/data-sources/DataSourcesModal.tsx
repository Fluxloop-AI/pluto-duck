'use client';

import { useEffect, useState } from 'react';
import { DatabaseIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  fetchDataSources,
  fetchDataSourceDetail,
  deleteDataSource,
  deleteTable,
  syncTable,
  type DataSource,
  type DataSourceTable,
} from '../../lib/dataSourcesApi';
import { SourceCard } from './SourceCard';
import { ConnectorGrid } from './ConnectorGrid';

interface DataSourcesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportClick: (connectorType: string, source?: DataSource) => void;
  refreshTrigger?: number;
}

export function DataSourcesModal({ open, onOpenChange, onImportClick, refreshTrigger }: DataSourcesModalProps) {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [tablesBySource, setTablesBySource] = useState<Record<string, DataSourceTable[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSources = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDataSources();
      setSources(data);
      const details = await Promise.all(
        data.map(async source => {
          try {
            const detail = await fetchDataSourceDetail(source.id);
            return { id: source.id, tables: detail.tables };
          } catch (detailError) {
            console.error('Failed to load tables for source', source.id, detailError);
            return { id: source.id, tables: [] };
          }
        })
      );
      setTablesBySource(
        details.reduce<Record<string, DataSourceTable[]>>((acc, detail) => {
          acc[detail.id] = detail.tables;
          return acc;
        }, {})
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data sources');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadSources();
    }
  }, [open, refreshTrigger]);

  const handleDelete = async (sourceId: string) => {
    try {
      await deleteDataSource(sourceId, false); // Don't drop table by default
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete data source');
    }
  };

  const handleSyncTable = async (sourceId: string, tableId: string) => {
    try {
      setTablesBySource(prev => ({
        ...prev,
        [sourceId]: (prev[sourceId] || []).map(table =>
          table.id === tableId ? { ...table, status: 'syncing' } : table
        ),
      }));
      await syncTable(sourceId, tableId);
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync table');
      await loadSources();
    }
  };

  const handleDeleteTable = async (sourceId: string, tableId: string) => {
    try {
      await deleteTable(sourceId, tableId, false);
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove table');
    }
  };

  const handleAddTable = (source: DataSource) => {
    onImportClick(source.connector_type, source);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Data Sources</DialogTitle>
          <DialogDescription>
            Manage your external data sources and imports
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          <div className="space-y-8 py-4">
            {/* Connected Sources */}
            <section>
              <h2 className="mb-4 text-lg font-semibold">Connected Sources</h2>
              
              {loading && (
                <div className="text-sm text-muted-foreground">Loading sources...</div>
              )}
              
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              
              {!loading && !error && sources.length === 0 && (
                <div className="rounded-lg border border-dashed border-border bg-muted/10 p-8 text-center">
                  <DatabaseIcon className="mx-auto h-12 w-12 text-muted-foreground/40" />
                  <p className="mt-4 text-sm text-muted-foreground">
                    No data sources yet. Add your first source below.
                  </p>
                </div>
              )}
              
              {!loading && sources.length > 0 && (
                <div className="space-y-3">
                  {sources.map(source => (
                    <SourceCard
                      key={source.id}
                      source={source}
                      tables={tablesBySource[source.id] || []}
                      onDelete={handleDelete}
                      onSyncTable={handleSyncTable}
                      onDeleteTable={handleDeleteTable}
                      onAddTable={handleAddTable}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Add New Source */}
            <section>
              <h2 className="mb-4 text-lg font-semibold">Import New Data Source</h2>
              <ConnectorGrid onConnectorClick={onImportClick} />
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

