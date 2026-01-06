import { DecoratorNode, DOMConversionMap, DOMConversionOutput, DOMExportOutput, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { ReactNode } from 'react';
import { ImageComponent } from '../components/ImageComponent';

export interface ImagePayload {
  altText: string;
  height?: number;
  key?: NodeKey;
  src: string;
  width?: number;
}

export type SerializedImageNode = Spread<
  {
    altText: string;
    height: number;
    src: string;
    width: number;
  },
  SerializedLexicalNode
>;

export class ImageNode extends DecoratorNode<ReactNode> {
  __src: string;
  __altText: string;
  __width: number;
  __height: number;

  static getType(): string {
    return 'image';
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__src,
      node.__altText,
      node.__width,
      node.__height,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    const { altText, height, width, src } = serializedNode;
    const node = $createImageNode({
      altText,
      height,
      src,
      width,
    });
    return node;
  }

  exportJSON(): SerializedImageNode {
    return {
      altText: this.__altText,
      height: this.__height,
      src: this.__src,
      type: 'image',
      version: 1,
      width: this.__width,
    };
  }

  constructor(
    src: string,
    altText: string,
    width: number,
    height: number,
    key?: NodeKey,
  ) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__width = width;
    this.__height = height;
  }

  createDOM(): HTMLElement {
    const span = document.createElement('div');
    span.className = 'lexical-image-node block my-4';
    return span;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  decorate(): ReactNode {
    return (
      <ImageComponent
        src={this.__src}
        altText={this.__altText}
        width={this.__width}
        height={this.__height}
        nodeKey={this.getKey()}
        resizable={true}
      />
    );
  }
}

export function $createImageNode({
  altText,
  height,
  src,
  width,
}: ImagePayload): ImageNode {
  return new ImageNode(src, altText, width || 400, height || 300);
}

export function $isImageNode(
  node: LexicalNode | null | undefined,
): node is ImageNode {
  return node instanceof ImageNode;
}

