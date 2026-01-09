'use client';

import { useState } from 'react';
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
import { createDataSource, importTable } from '../../lib/dataSourcesApi';

interface ImportCSVModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSuccess?: () => void;
}

export function ImportCSVModal({ projectId, open, onOpenChange, onImportSuccess }: ImportCSVModalProps) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  const [name, setName] = useState('');
  const [filePath, setFilePath] = useState('');
  const [tableName, setTableName] = useState('');
  const [description, setDescription] = useState('');
  const [overwrite, setOverwrite] = useState(true);

  const handleImport = async () => {
    setError(null);
    setSuccessMessage(null);
    
    // Validation
    if (!name.trim()) {
      setError('Display name is required');
      return;
    }
    
    if (!filePath.trim()) {
      setError('File path is required');
      return;
    }
    
    if (!tableName.trim()) {
      setError('Table name is required');
      return;
    }
    
    // Validate table name (alphanumeric and underscore only)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      setError('Table name must start with a letter or underscore and contain only letters, numbers, and underscores');
      return;
    }

    setImporting(true);
    try {
      const source = await createDataSource(projectId, {
        name: name.trim(),
        description: description.trim() || undefined,
        connector_type: 'csv',
        source_config: { path: filePath.trim() },
      });

      const table = await importTable(projectId, source.name, {
        target_table: tableName.trim(),
        overwrite,
      });
      setSuccessMessage(`Successfully imported ${table.rows_count ?? 0} rows`);
      
      // Reset form
      setName('');
      setFilePath('');
      setTableName('');
      setDescription('');
      
      // Notify parent and close
      if (onImportSuccess) {
        onImportSuccess();
      }
      
      setTimeout(() => {
        onOpenChange(false);
        setSuccessMessage(null);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CSV');
    } finally {
      setImporting(false);
    }
  };

  const handleCancel = () => {
    setError(null);
    setSuccessMessage(null);
    onOpenChange(false);
  };

  // Auto-suggest table name from display name
  const handleNameChange = (value: string) => {
    setName(value);
    // Always auto-generate table name with prefix from display name
    const prefix = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    setTableName(prefix);
  };

  const handleBrowse = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{
          name: 'CSV Files',
          extensions: ['csv']
        }]
      });
      
      if (selected) {
        setFilePath(selected as string);
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import CSV File</DialogTitle>
          <DialogDescription>
            Import data from a CSV file into DuckDB
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Display Name */}
          <div className="grid gap-2">
            <label htmlFor="name" className="text-sm font-medium">
              Display Name *
            </label>
            <Input
              id="name"
              placeholder="Customer Data"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
            />
          </div>

          {/* File Path */}
          <div className="grid gap-2">
            <label htmlFor="file-path" className="text-sm font-medium">
              File Path *
            </label>
            <div className="flex gap-2">
              <Input
                id="file-path"
                placeholder="/Users/username/data/customers.csv"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
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
              Full path to the CSV file
            </p>
          </div>

          {/* Table Name */}
          <div className="grid gap-2">
            <label htmlFor="table-name" className="text-sm font-medium">
              Table Name (in DuckDB) *
            </label>
            <Input
              id="table-name"
              placeholder="customers"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Name for the DuckDB table
            </p>
          </div>

          {/* Description */}
          <div className="grid gap-2">
            <label htmlFor="description" className="text-sm font-medium">
              Description (optional)
            </label>
            <Input
              id="description"
              placeholder="Monthly customer exports from CRM"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Overwrite checkbox */}
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

          {/* Error Message */}
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
              {successMessage}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={importing}>
            {importing ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

