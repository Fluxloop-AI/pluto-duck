'use client';

import { useImperativeHandle, forwardRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $createParagraphNode } from 'lexical';
import { $createAssetEmbedNode, type AssetEmbedConfig } from '../nodes/AssetEmbedNode';

export interface InsertAssetEmbedHandle {
  insertAssetEmbed: (analysisId: string, projectId: string, config: AssetEmbedConfig) => void;
}

export const InsertAssetEmbedPlugin = forwardRef<InsertAssetEmbedHandle>(
  function InsertAssetEmbedPlugin(_, ref) {
    const [editor] = useLexicalComposerContext();

    useImperativeHandle(ref, () => ({
      insertAssetEmbed: (analysisId: string, projectId: string, config: AssetEmbedConfig) => {
        editor.update(() => {
          const root = $getRoot();

          // Create AssetEmbedNode
          const assetNode = $createAssetEmbedNode(analysisId, projectId, config);

          // Add trailing paragraph for continued editing
          const trailingParagraph = $createParagraphNode();

          // Append at the end of the document
          root.append(assetNode);
          root.append(trailingParagraph);
          trailingParagraph.select();
        });
      },
    }));

    return null;
  }
);
