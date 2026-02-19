import { DecoratorNode, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { ReactNode } from 'react';

export type SerializedMarkdownTableNode = Spread<
  {
    markdown: string;
  },
  SerializedLexicalNode
>;

type MarkdownTableComponentProps = {
  markdown: string;
  nodeKey: NodeKey;
};

function MarkdownTableComponent({ markdown }: MarkdownTableComponentProps): ReactNode {
  return <pre className="whitespace-pre-wrap">{markdown}</pre>;
}

export class MarkdownTableNode extends DecoratorNode<ReactNode> {
  __markdown: string;

  static getType(): string {
    return 'markdown-table';
  }

  static clone(node: MarkdownTableNode): MarkdownTableNode {
    return new MarkdownTableNode(node.__markdown, node.__key);
  }

  static importJSON(serializedNode: SerializedMarkdownTableNode): MarkdownTableNode {
    return $createMarkdownTableNode(serializedNode.markdown);
  }

  constructor(markdown: string, key?: NodeKey) {
    super(key);
    this.__markdown = markdown;
  }

  exportJSON(): SerializedMarkdownTableNode {
    return {
      markdown: this.__markdown,
      type: 'markdown-table',
      version: 1,
    };
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'markdown-table-node';
    return div;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  getMarkdown(): string {
    return this.getLatest().__markdown;
  }

  setMarkdown(markdown: string): void {
    const writable = this.getWritable();
    writable.__markdown = markdown;
  }

  getTextContent(): string {
    return this.__markdown;
  }

  decorate(): ReactNode {
    return (
      <MarkdownTableComponent
        markdown={this.__markdown}
        nodeKey={this.getKey()}
      />
    );
  }
}

export function $createMarkdownTableNode(markdown: string): MarkdownTableNode {
  return new MarkdownTableNode(markdown);
}

export function $isMarkdownTableNode(
  node: LexicalNode | null | undefined,
): node is MarkdownTableNode {
  return node instanceof MarkdownTableNode;
}
