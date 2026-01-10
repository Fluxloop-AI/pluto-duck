'use client';

import {
  DecoratorNode,
  DOMConversionMap,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';
import { ReactNode } from 'react';
import { AssetEmbedComponent } from '../components/AssetEmbedComponent';

// Configuration for how to display the asset
export interface AssetEmbedConfig {
  displayType: 'table' | 'chart';
  tableConfig?: {
    rowsPerPage: number;
  };
  chartConfig?: {
    type: 'bar' | 'line' | 'pie' | 'area' | 'composed';
    xColumn: string;
    yColumn?: string;       // Single Y column (backward compatible)
    yColumns?: string[];    // Multiple Y columns for multi-series charts
    groupByColumn?: string; // Group data by this column (e.g., 'source' to show Google/Facebook/Naver as separate lines)
    stacked?: boolean;      // Stack bars/areas
    showDualAxis?: boolean; // Show secondary Y-axis for different scales
  };
}

export type SerializedAssetEmbedNode = Spread<
  {
    analysisId: string;
    projectId: string;
    config: AssetEmbedConfig;
  },
  SerializedLexicalNode
>;

export class AssetEmbedNode extends DecoratorNode<ReactNode> {
  __analysisId: string;
  __projectId: string;
  __config: AssetEmbedConfig;

  static getType(): string {
    return 'asset-embed';
  }

  static clone(node: AssetEmbedNode): AssetEmbedNode {
    return new AssetEmbedNode(
      node.__analysisId,
      node.__projectId,
      node.__config,
      node.__key
    );
  }

  constructor(
    analysisId: string,
    projectId: string,
    config: AssetEmbedConfig,
    key?: NodeKey
  ) {
    super(key);
    this.__analysisId = analysisId;
    this.__projectId = projectId;
    this.__config = config;
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'asset-embed-wrapper';
    div.style.margin = '1rem 0';
    div.style.display = 'block';
    // Add data attribute for Lexical to recognize this as a decorator
    div.setAttribute('data-lexical-decorator', 'true');
    return div;
  }

  updateDOM(): boolean {
    return false;
  }

  // Ensure this is a block-level node
  isInline(): boolean {
    return false;
  }

  // Prevent text insertion inside
  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div');
    element.setAttribute('data-lexical-asset-embed', 'true');
    element.setAttribute('data-analysis-id', this.__analysisId);
    element.setAttribute('data-project-id', this.__projectId);
    element.setAttribute('data-config', JSON.stringify(this.__config));
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-asset-embed')) {
          return null;
        }
        return {
          conversion: (element: HTMLElement) => {
            const analysisId = element.getAttribute('data-analysis-id') || '';
            const projectId = element.getAttribute('data-project-id') || '';
            const configStr = element.getAttribute('data-config') || '{}';
            const config = JSON.parse(configStr) as AssetEmbedConfig;
            return {
              node: $createAssetEmbedNode(analysisId, projectId, config),
            };
          },
          priority: 2,
        };
      },
    };
  }

  static importJSON(serializedNode: SerializedAssetEmbedNode): AssetEmbedNode {
    return $createAssetEmbedNode(
      serializedNode.analysisId,
      serializedNode.projectId,
      serializedNode.config
    );
  }

  exportJSON(): SerializedAssetEmbedNode {
    return {
      type: 'asset-embed',
      version: 1,
      analysisId: this.__analysisId,
      projectId: this.__projectId,
      config: this.__config,
    };
  }

  getAnalysisId(): string {
    return this.__analysisId;
  }

  getProjectId(): string {
    return this.__projectId;
  }

  getConfig(): AssetEmbedConfig {
    return this.__config;
  }

  setConfig(config: AssetEmbedConfig): void {
    const writable = this.getWritable();
    writable.__config = config;
  }

  decorate(): ReactNode {
    return (
      <AssetEmbedComponent
        analysisId={this.__analysisId}
        projectId={this.__projectId}
        config={this.__config}
        nodeKey={this.__key}
      />
    );
  }
}

export function $createAssetEmbedNode(
  analysisId: string,
  projectId: string,
  config: AssetEmbedConfig
): AssetEmbedNode {
  return new AssetEmbedNode(analysisId, projectId, config);
}

export function $isAssetEmbedNode(
  node: LexicalNode | null | undefined
): node is AssetEmbedNode {
  return node instanceof AssetEmbedNode;
}

