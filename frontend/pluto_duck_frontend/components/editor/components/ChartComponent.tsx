'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { executeQuery, QueryResult } from '../../../lib/boardsApi';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Loader2 } from 'lucide-react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_DELETE_COMMAND,
  KEY_BACKSPACE_COMMAND,
  NodeKey,
} from 'lexical';

interface ChartComponentProps {
  queryId: string | null;
  chartType: string;
  projectId: string;
  nodeKey: NodeKey; // Make sure nodeKey is passed
}

export function ChartComponent({ queryId, chartType, projectId, nodeKey }: ChartComponentProps) {
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Lexical Selection Hooks
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const chartRef = useRef<HTMLDivElement>(null);

  // Delete handling
  const onDelete = useCallback((payload: KeyboardEvent) => {
    if (isSelected && $isNodeSelection($getSelection())) {
      const event: KeyboardEvent = payload;
      event.preventDefault();
      const node = $getNodeByKey(nodeKey);
      if (node) {
        node.remove();
        return true; // Stop propagation - we handled this command
      }
    }
    return false;
  }, [isSelected, nodeKey]);

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          if (chartRef.current && chartRef.current.contains(event.target as Node)) {
            if (!event.shiftKey) {
              clearSelection();
            }
            setSelected(!isSelected);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [clearSelection, editor, isSelected, nodeKey, onDelete, setSelected]);

  useEffect(() => {
    if (!queryId) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        // Mock data for prototype
        await new Promise(resolve => setTimeout(resolve, 1000));
        setData({
            columns: ['name', 'value'],
            data: [
                { name: 'A', value: 400 },
                { name: 'B', value: 300 },
                { name: 'C', value: 200 },
                { name: 'D', value: 500 },
            ],
            row_count: 4,
            executed_at: new Date().toISOString()
        });
      } catch (err) {
        setError('Failed to load chart data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [queryId, projectId]);

  // Wrapper style for selection border
  const containerClass = `relative border rounded-lg bg-card h-[400px] transition-shadow ${
    isSelected ? 'ring-2 ring-blue-500 border-transparent' : 'border-border'
  }`;

  if (!queryId) {
    return (
      <div ref={chartRef} className={`p-4 flex flex-col items-center justify-center text-muted-foreground h-[300px] bg-muted/50 rounded-lg ${isSelected ? 'ring-2 ring-blue-500' : 'border'}`}>
        <p>No query selected</p>
        <button className="mt-2 text-sm text-blue-500 hover:underline">
          Select Data Source
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div ref={chartRef} className={`flex items-center justify-center h-[300px] rounded-lg ${isSelected ? 'ring-2 ring-blue-500' : 'border'}`}>
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div ref={chartRef} className={`p-4 bg-red-50 dark:bg-red-900/10 text-red-500 h-[300px] flex items-center justify-center rounded-lg ${isSelected ? 'ring-2 ring-blue-500' : 'border'}`}>
        {error}
      </div>
    );
  }

  if (!data || data.data.length === 0) {
    return (
      <div ref={chartRef} className={`p-4 h-[300px] flex items-center justify-center text-muted-foreground rounded-lg ${isSelected ? 'ring-2 ring-blue-500' : 'border'}`}>
        No data available
      </div>
    );
  }

  return (
    <div ref={chartRef} className={containerClass}>
      <div className="p-4 h-full flex flex-col">
        <div className="mb-4">
            <h3 className="font-semibold text-lg">Chart Analysis</h3>
            <p className="text-xs text-muted-foreground">Query ID: {queryId}</p>
        </div>
        <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
            </ResponsiveContainer>
        </div>
      </div>
      
      {/* Selection Overlay (Invisible but captures clicks if needed, though ref on div works) */}
      {isSelected && (
         <div className="absolute inset-0 pointer-events-none rounded-lg ring-2 ring-blue-500" />
      )}
    </div>
  );
}
