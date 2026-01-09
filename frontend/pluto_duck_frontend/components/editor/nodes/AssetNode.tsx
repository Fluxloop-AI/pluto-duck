import { DecoratorNode, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { ReactNode } from 'react';
import { AssetComponent } from '../components/AssetComponent';

export type SerializedAssetNode = Spread<
  {
    analysisId: string;
    projectId: string;
  },
  SerializedLexicalNode
>;

export class AssetNode extends DecoratorNode<ReactNode> {
  __analysisId: string;
  __projectId: string;

  static getType(): string {
    return 'asset';
  }

  static clone(node: AssetNode): AssetNode {
    return new AssetNode(node.__analysisId, node.__projectId, node.__key);
  }

  static importJSON(serializedNode: SerializedAssetNode): AssetNode {
    const node = $createAssetNode(
      serializedNode.analysisId,
      serializedNode.projectId
    );
    return node;
  }

  constructor(analysisId: string, projectId: string, key?: NodeKey) {
    super(key);
    this.__analysisId = analysisId;
    this.__projectId = projectId;
  }

  exportJSON(): SerializedAssetNode {
    return {
      analysisId: this.__analysisId,
      projectId: this.__projectId,
      type: 'asset',
      version: 1,
    };
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'lexical-asset-node my-4';
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
      <AssetComponent
        analysisId={this.__analysisId}
        projectId={this.__projectId}
        nodeKey={this.getKey()}
      />
    );
  }

  getAnalysisId(): string {
    return this.__analysisId;
  }

  setAnalysisId(analysisId: string): void {
    const self = this.getWritable();
    self.__analysisId = analysisId;
  }
}

export function $createAssetNode(
  analysisId: string,
  projectId: string
): AssetNode {
  return new AssetNode(analysisId, projectId);
}

export function $isAssetNode(node: LexicalNode | null | undefined): node is AssetNode {
  return node instanceof AssetNode;
}

