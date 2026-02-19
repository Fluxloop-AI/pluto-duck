'use client';

import { useImperativeHandle, forwardRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { $getRoot, $createParagraphNode } from 'lexical';
import { BOARD_TRANSFORMERS } from '../transformers';

export interface InsertMarkdownHandle {
  insertMarkdown: (content: string) => void;
}

export const InsertMarkdownPlugin = forwardRef<InsertMarkdownHandle>(
  function InsertMarkdownPlugin(_, ref) {
    const [editor] = useLexicalComposerContext();

    useImperativeHandle(ref, () => ({
      insertMarkdown: (content: string) => {
        editor.update(() => {
          const root = $getRoot();

          // 1. Save existing children and detach from root
          const existingChildren = root.getChildren();
          for (const child of existingChildren) {
            child.remove(); // Detach from parent but node remains in memory
          }

          // 2. Convert markdown (root is empty, so clear() has no effect)
          $convertFromMarkdownString(content, BOARD_TRANSFORMERS);

          // 3. Save new children and detach from root
          const newChildren = root.getChildren();
          for (const child of newChildren) {
            child.remove();
          }

          // 4. Append existing children first
          for (const child of existingChildren) {
            root.append(child);
          }

          // 5. Append new children
          for (const child of newChildren) {
            root.append(child);
          }

          // 6. Add trailing paragraph for continued editing
          const trailingParagraph = $createParagraphNode();
          root.append(trailingParagraph);
          trailingParagraph.select();
        });
      },
    }));

    return null;
  }
);
