import { DecoratorNode, DOMConversionMap, DOMConversionOutput, DOMExportOutput, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { ReactNode } from 'react';
import { ChartComponent } from '../components/ChartComponent';

export type SerializedChartNode = Spread<
  {
    queryId: string | null;
    chartType: string;
    projectId: string;
  },
  SerializedLexicalNode
>;

export class ChartNode extends DecoratorNode<ReactNode> {
  __queryId: string | null;
  __chartType: string;
  __projectId: string;

  static getType(): string {
    return 'chart';
  }

  static clone(node: ChartNode): ChartNode {
    return new ChartNode(node.__queryId, node.__chartType, node.__projectId, node.__key);
  }

  static importJSON(serializedNode: SerializedChartNode): ChartNode {
    const node = $createChartNode(
      serializedNode.queryId,
      serializedNode.chartType,
      serializedNode.projectId
    );
    return node;
  }

  constructor(queryId: string | null, chartType: string, projectId: string, key?: NodeKey) {
    super(key);
    this.__queryId = queryId;
    this.__chartType = chartType;
    this.__projectId = projectId;
  }

  exportJSON(): SerializedChartNode {
    return {
      queryId: this.__queryId,
      chartType: this.__chartType,
      projectId: this.__projectId,
      type: 'chart',
      version: 1,
    };
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'lexical-chart-node my-4';
    return div;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  decorate(): ReactNode {
    return (
      <ChartComponent
        queryId={this.__queryId}
        chartType={this.__chartType}
        projectId={this.__projectId}
        nodeKey={this.getKey()}
      />
    );
  }
}

export function $createChartNode(
  queryId: string | null,
  chartType: string,
  projectId: string
): ChartNode {
  return new ChartNode(queryId, chartType, projectId);
}

export function $isChartNode(node: LexicalNode | null | undefined): node is ChartNode {
  return node instanceof ChartNode;
}

