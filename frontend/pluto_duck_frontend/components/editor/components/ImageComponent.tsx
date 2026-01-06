'use client';

import { useRef, useState } from 'react';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
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
import { useEffect } from 'react';

interface ImageComponentProps {
  src: string;
  altText: string;
  width: number;
  height: number;
  nodeKey: NodeKey;
  resizable: boolean;
}

export function ImageComponent({
  src,
  altText,
  width,
  height,
  nodeKey,
  resizable,
}: ImageComponentProps) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const [isResizing, setIsResizing] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const activeAnchor = useRef<string | null>(null);

  // Delete handling
  const onDelete = (payload: KeyboardEvent) => {
    if (isSelected && $isNodeSelection($getSelection())) {
      const event: KeyboardEvent = payload;
      event.preventDefault();
      const node = $getNodeByKey(nodeKey);
      if (node) {
        node.remove();
      }
    }
    return false;
  };

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          if (event.target === imageRef.current) {
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

  return (
    <div className={`relative inline-block ${isSelected ? 'ring-2 ring-blue-500' : ''}`}>
      {src ? (
        <img
          ref={imageRef}
          src={src}
          alt={altText}
          style={{ width, height, maxWidth: '100%' }}
          className="rounded-lg object-cover"
        />
      ) : (
        <div 
            className="flex items-center justify-center bg-muted rounded-lg border-2 border-dashed border-muted-foreground/25"
            style={{ width, height }}
        >
            <div className="text-center text-muted-foreground">
                <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <span className="text-sm">No Image</span>
            </div>
        </div>
      )}
      
      {/* Selection Overlay & Resize Handles could go here */}
      {isSelected && resizable && (
         <div className="absolute inset-0 pointer-events-none border-2 border-blue-500 rounded-lg" />
      )}
    </div>
  );
}

