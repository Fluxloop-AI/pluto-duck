'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  Handle,
  NodeProps,
  MarkerType,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Database, FileText, GitBranch, RefreshCw, Table2, Eye, Plus, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getLineageGraph,
  type LineageGraphNode,
  type LineageGraphEdge,
  type LineageGraph,
} from '@/lib/assetsApi';

// ============================================================================
// Custom Node Components
// ============================================================================

interface AnalysisNodeData {
  label: string;
  materialization: string | null;
  isStale: boolean | null;
  lastRunAt: string | null;
  onSelect?: (id: string) => void;
}

function AnalysisNode({ data, id }: NodeProps<Node<AnalysisNodeData>>) {
  const getIcon = () => {
    switch (data.materialization) {
      case 'view':
        return <Eye className="h-4 w-4" />;
      case 'table':
        return <Table2 className="h-4 w-4" />;
      case 'append':
        return <Plus className="h-4 w-4" />;
      case 'parquet':
        return <Package className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getBorderColor = () => {
    if (data.isStale === null) return 'border-gray-500';
    return data.isStale ? 'border-amber-500' : 'border-emerald-500';
  };

  const getStatusDot = () => {
    if (data.isStale === null) return 'bg-gray-400';
    return data.isStale ? 'bg-amber-400' : 'bg-emerald-400';
  };

  const analysisId = id.replace('analysis:', '');

  return (
    <div
      className={`relative px-4 py-3 rounded-lg bg-background border-2 shadow-lg cursor-pointer hover:shadow-xl transition-shadow ${getBorderColor()}`}
      onClick={() => data.onSelect?.(analysisId)}
    >
      <Handle type="target" position={Position.Left} className="!bg-primary !w-3 !h-3" />

      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-md bg-primary/10 text-primary">
          {getIcon()}
        </div>
        <div className="flex flex-col">
          <span className="font-medium text-sm">{data.label}</span>
          <span className="text-xs text-muted-foreground font-mono">{analysisId}</span>
        </div>
        <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${getStatusDot()}`} />
      </div>

      {data.lastRunAt && (
        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
          <RefreshCw className="h-3 w-3" />
          {new Date(data.lastRunAt).toLocaleString('ko-KR', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!bg-primary !w-3 !h-3" />
    </div>
  );
}

interface SourceNodeData {
  label: string;
  type: 'source' | 'file';
}

function SourceNode({ data }: NodeProps<Node<SourceNodeData>>) {
  return (
    <div className="px-4 py-3 rounded-lg bg-muted border border-border shadow-md">
      <Handle type="source" position={Position.Right} className="!bg-blue-500 !w-3 !h-3" />

      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-500">
          {data.type === 'source' ? (
            <Database className="h-4 w-4" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground uppercase">{data.type}</span>
          <span className="font-medium text-sm">{data.label}</span>
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  analysis: AnalysisNode,
  source: SourceNode,
  file: SourceNode,
};

// ============================================================================
// Layout Algorithm
// ============================================================================

interface LayoutNode {
  id: string;
  type: string;
  deps: string[];
}

function computeLayout(
  graphNodes: LineageGraphNode[],
  graphEdges: LineageGraphEdge[],
  onSelectAnalysis?: (id: string) => void
): { nodes: Node[]; edges: Edge[] } {
  // Build adjacency list
  const nodeMap = new Map<string, LayoutNode>();
  for (const n of graphNodes) {
    nodeMap.set(n.id, { id: n.id, type: n.type, deps: [] });
  }
  for (const e of graphEdges) {
    const target = nodeMap.get(e.target);
    if (target) {
      target.deps.push(e.source);
    }
  }

  // Compute levels (topological order)
  const levels = new Map<string, number>();
  const visited = new Set<string>();

  function getLevel(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    if (visited.has(id)) return 0; // Cycle detection

    visited.add(id);
    const node = nodeMap.get(id);
    if (!node || node.deps.length === 0) {
      levels.set(id, 0);
      return 0;
    }

    const maxDepLevel = Math.max(...node.deps.map(getLevel));
    const level = maxDepLevel + 1;
    levels.set(id, level);
    return level;
  }

  for (const id of nodeMap.keys()) {
    getLevel(id);
  }

  // Group by level
  const levelGroups = new Map<number, string[]>();
  for (const [id, level] of levels) {
    if (!levelGroups.has(level)) {
      levelGroups.set(level, []);
    }
    levelGroups.get(level)!.push(id);
  }

  // Position nodes
  const NODE_WIDTH = 220;
  const NODE_HEIGHT = 80;
  const LEVEL_GAP = 280;
  const NODE_GAP = 100;

  const nodes: Node[] = [];

  for (const [level, ids] of levelGroups) {
    const totalHeight = ids.length * NODE_HEIGHT + (ids.length - 1) * NODE_GAP;
    const startY = -totalHeight / 2;

    ids.forEach((id, index) => {
      const graphNode = graphNodes.find((n) => n.id === id);
      if (!graphNode) return;

      const x = level * LEVEL_GAP;
      const y = startY + index * (NODE_HEIGHT + NODE_GAP);

      if (graphNode.type === 'analysis') {
        nodes.push({
          id,
          type: 'analysis',
          position: { x, y },
          data: {
            label: graphNode.name || id.replace('analysis:', ''),
            materialization: graphNode.materialization,
            isStale: graphNode.is_stale,
            lastRunAt: graphNode.last_run_at,
            onSelect: onSelectAnalysis,
          },
        });
      } else {
        nodes.push({
          id,
          type: graphNode.type,
          position: { x, y },
          data: {
            label: graphNode.name || id.split(':')[1],
            type: graphNode.type,
          },
        });
      }
    });
  }

  // Create edges
  const edges: Edge[] = graphEdges.map((e, i) => ({
    id: `edge-${i}`,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    animated: false,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
    },
    style: {
      stroke: 'hsl(var(--primary))',
      strokeWidth: 2,
    },
  }));

  return { nodes, edges };
}

// ============================================================================
// Main Component
// ============================================================================

interface LineageGraphViewProps {
  projectId: string;
  highlightAnalysisId?: string;
  onSelectAnalysis?: (analysisId: string) => void;
}

export function LineageGraphView({
  projectId,
  highlightAnalysisId,
  onSelectAnalysis,
}: LineageGraphViewProps) {
  const [graphData, setGraphData] = useState<LineageGraph | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const fetchGraph = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getLineageGraph(projectId);
      setGraphData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load lineage graph');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  useEffect(() => {
    if (!graphData) return;

    const { nodes: layoutNodes, edges: layoutEdges } = computeLayout(
      graphData.nodes,
      graphData.edges,
      onSelectAnalysis
    );

    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [graphData, onSelectAnalysis, setNodes, setEdges]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
          <p className="text-sm text-muted-foreground">Loading lineage graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchGraph}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <GitBranch className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No analyses yet</p>
          <p className="text-xs text-muted-foreground">
            Create an analysis to see the lineage graph
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="hsl(var(--muted))" />
        <Controls className="!bg-background !border-border" />
        <MiniMap
          className="!bg-background !border-border"
          nodeColor={(node) => {
            if (node.type === 'analysis') {
              const data = node.data as AnalysisNodeData;
              if (data.isStale === null) return 'hsl(var(--muted-foreground))';
              return data.isStale ? 'hsl(var(--amber-500))' : 'hsl(var(--emerald-500))';
            }
            return 'hsl(var(--blue-500))';
          }}
        />

        <Panel position="top-left" className="flex items-center gap-4 bg-background/80 backdrop-blur-sm rounded-lg p-3 border border-border">
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Fresh</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-muted-foreground">Stale</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-full bg-gray-400" />
            <span className="text-muted-foreground">Never run</span>
          </div>
          <Button variant="outline" size="sm" onClick={fetchGraph} className="ml-2">
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

