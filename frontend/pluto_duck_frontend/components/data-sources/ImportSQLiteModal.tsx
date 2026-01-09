'use client';

import { useState, useEffect } from 'react';
import { FolderOpenIcon } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { createDataSource, importTablesBulk, testConnection, type DataSource } from '../../lib/dataSourcesApi';

interface ImportSQLiteModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSuccess?: () => void;
  existingSource?: DataSource;
}

type Step = 'connection' | 'tables';

export function ImportSQLiteModal({ projectId, open, onOpenChange, onImportSuccess, existingSource }: ImportSQLiteModalProps) {
  const [step, setStep] = useState<Step>('connection');
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Step 1: Connection info
  const [name, setName] = useState('');
  const [dbPath, setDbPath] = useState('');
  const [description, setDescription] = useState('');
  
  // Step 2: Table selection
  const [availableTables, setAvailableTables] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [sourceId, setSourceId] = useState<string>('');
  const [overwrite, setOverwrite] = useState(true);

  // Auto-load tables for existing source
  useEffect(() => {
    if (open && existingSource) {
      setName(existingSource.name);
      setDescription(existingSource.description || '');
      setDbPath(existingSource.source_config.path as string || '');
      setSourceId(existingSource.id);
      
      // Load tables
      const loadTables = async () => {
        setTesting(true);
        setError(null);
        try {
          const testResult = await testConnection(
            existingSource.connector_type,
            existingSource.source_config
          );
          setAvailableTables(testResult.tables);
          setStep('tables');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load tables');
        } finally {
          setTesting(false);
        }
      };
      
      void loadTables();
    } else if (open && !existingSource) {
      // Reset for new connection
      setStep('connection');
      setName('');
      setDbPath('');
      setDescription('');
      setAvailableTables([]);
      setSelectedTables(new Set());
      setError(null);
    }
  }, [open, existingSource]);

  const handleTestConnection = async () => {
    setError(null);
    
    if (!name.trim()) {
      setError('Display name is required');
      return;
    }
    
    if (!dbPath.trim()) {
      setError('Database path is required');
      return;
    }

    setTesting(true);
    try {
      // Test connection and get tables
      const testResult = await testConnection('sqlite', { path: dbPath.trim() });
      setAvailableTables(testResult.tables);
      
      // Create data source
      const source = await createDataSource(projectId, {
        name: name.trim(),
        description: description.trim() || undefined,
        connector_type: 'sqlite',
        source_config: { path: dbPath.trim() },
      });
      setSourceId(source.name);  // Use name instead of id for project-scoped sources
      
      // Move to step 2
      setStep('tables');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to SQLite database');
    } finally {
      setTesting(false);
    }
  };

  const handleImportTables = async () => {
    setError(null);
    setSuccessMessage(null);
    
    if (selectedTables.size === 0) {
      setError('Please select at least one table');
      return;
    }

    setImporting(true);
    try {
      // Generate prefix from data source name
      const prefix = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      
      const tables = Array.from(selectedTables).map(sourceTable => ({
        source_table: sourceTable,
        target_table: `${prefix}_${sourceTable}`,
        overwrite,
      }));

      const result = await importTablesBulk(projectId, sourceId, { tables });
      const successCount = result.results.filter(r => r.status === 'active').length;
      const failCount = result.results.filter(r => r.status === 'error').length;
      
      setSuccessMessage(
        `Imported ${successCount} table${successCount !== 1 ? 's' : ''}` +
        (failCount > 0 ? ` (${failCount} failed)` : '')
      );
      
      // Reset
      setName('');
      setDbPath('');
      setDescription('');
      setSelectedTables(new Set());
      setAvailableTables([]);
      setStep('connection');
      
      if (onImportSuccess) {
        onImportSuccess();
      }
      
      setTimeout(() => {
        onOpenChange(false);
        setSuccessMessage(null);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import tables');
    } finally {
      setImporting(false);
    }
  };

  const handleCancel = () => {
    setError(null);
    setSuccessMessage(null);
    setStep('connection');
    setSelectedTables(new Set());
    setAvailableTables([]);
    onOpenChange(false);
  };

  const handleBack = () => {
    setStep('connection');
    setSelectedTables(new Set());
    setError(null);
  };

  const toggleTable = (table: string) => {
    setSelectedTables(prev => {
      const next = new Set(prev);
      if (next.has(table)) {
        next.delete(table);
      } else {
        next.add(table);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedTables.size === availableTables.length) {
      setSelectedTables(new Set());
    } else {
      setSelectedTables(new Set(availableTables));
    }
  };

  const handleBrowse = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{
          name: 'SQLite Database',
          extensions: ['db', 'sqlite', 'sqlite3']
        }]
      });
      
      if (selected) {
        setDbPath(selected as string);
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {step === 'connection' ? 'Connect to SQLite Database' : 'Select Tables to Import'}
          </DialogTitle>
          <DialogDescription>
            {step === 'connection' 
              ? 'Select a SQLite database file' 
              : `Available tables (${availableTables.length})`}
          </DialogDescription>
        </DialogHeader>

        {step === 'connection' ? (
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="name" className="text-sm font-medium">
                Display Name *
              </label>
              <Input
                id="name"
                placeholder="Legacy Database"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <label htmlFor="db-path" className="text-sm font-medium">
                Database Path *
              </label>
              <div className="flex gap-2">
                <Input
                  id="db-path"
                  placeholder="/Users/username/data/database.db"
                  value={dbPath}
                  onChange={(e) => setDbPath(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleBrowse}
                  title="Browse files"
                >
                  <FolderOpenIcon className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Full path to the SQLite database file
              </p>
            </div>

            <div className="grid gap-2">
              <label htmlFor="description" className="text-sm font-medium">
                Description (optional)
              </label>
              <Input
                id="description"
                placeholder="Legacy system database"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4 py-4">
            <div className="max-h-[400px] overflow-y-auto rounded-md border border-border">
              <div className="sticky top-0 border-b border-border bg-muted/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedTables.size === availableTables.length && availableTables.length > 0}
                    onChange={toggleAll}
                    className="h-4 w-4"
                  />
                  <label className="text-sm font-medium">
                    Select all ({selectedTables.size}/{availableTables.length})
                  </label>
                </div>
              </div>
              
              {availableTables.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No tables found
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {availableTables.map(table => (
                    <div key={table} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={selectedTables.has(table)}
                        onChange={() => toggleTable(table)}
                        className="h-4 w-4"
                      />
                      <label className="flex-1 cursor-pointer text-sm">
                        {table}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="overwrite"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="overwrite" className="text-sm">
                Overwrite if table exists
              </label>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {successMessage && (
              <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
                {successMessage}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'connection' ? (
            <>
              <Button variant="outline" onClick={handleCancel} disabled={testing}>
                Cancel
              </Button>
              <Button onClick={handleTestConnection} disabled={testing}>
                {testing ? 'Testing...' : 'Test & Next'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleBack} disabled={importing}>
                Back
              </Button>
              <Button onClick={handleImportTables} disabled={importing || selectedTables.size === 0}>
                {importing ? 'Importing...' : `Import ${selectedTables.size} table${selectedTables.size !== 1 ? 's' : ''}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

