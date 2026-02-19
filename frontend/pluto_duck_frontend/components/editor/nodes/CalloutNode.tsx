import { DecoratorNode, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { ReactNode } from 'react';
import { CalloutComponent } from '../components/CalloutComponent';

export type CalloutType = 'info' | 'warning' | 'success' | 'error';

export type SerializedCalloutNode = Spread<
  {
    calloutType: CalloutType;
    text: string;
  },
  SerializedLexicalNode
>;

export class CalloutNode extends DecoratorNode<ReactNode> {
  __calloutType: CalloutType;
  __text: string;

  static getType(): string {
    return 'callout';
  }

  static clone(node: CalloutNode): CalloutNode {
    return new CalloutNode(node.__calloutType, node.__text, node.__key);
  }

  static importJSON(serializedNode: SerializedCalloutNode): CalloutNode {
    return $createCalloutNode(serializedNode.calloutType, serializedNode.text);
  }

  constructor(calloutType: CalloutType, text: string, key?: NodeKey) {
    super(key);
    this.__calloutType = calloutType;
    this.__text = text;
  }

  exportJSON(): SerializedCalloutNode {
    return {
      calloutType: this.__calloutType,
      text: this.__text,
      type: 'callout',
      version: 1,
    };
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'callout-node';
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

  getCalloutType(): CalloutType {
    return this.getLatest().__calloutType;
  }

  setCalloutType(calloutType: CalloutType): void {
    const writable = this.getWritable();
    writable.__calloutType = calloutType;
  }

  getText(): string {
    return this.getLatest().__text;
  }

  setText(text: string): void {
    const writable = this.getWritable();
    writable.__text = text;
  }

  getTextContent(): string {
    return this.__text;
  }

  decorate(): ReactNode {
    return (
      <CalloutComponent
        calloutType={this.__calloutType}
        text={this.__text}
        nodeKey={this.getKey()}
      />
    );
  }
}

export function $createCalloutNode(calloutType: CalloutType = 'info', text = ''): CalloutNode {
  return new CalloutNode(calloutType, text);
}

export function $isCalloutNode(node: LexicalNode | null | undefined): node is CalloutNode {
  return node instanceof CalloutNode;
}
