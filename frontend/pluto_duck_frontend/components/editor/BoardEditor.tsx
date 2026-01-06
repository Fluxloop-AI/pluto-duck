'use client';

import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { TRANSFORMERS } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary';
import { useRef, useState } from 'react';

import { editorTheme } from './theme';
import type { Board } from '../../lib/boardsApi';
import { ChartNode, ImageNode } from './nodes';
import SlashCommandPlugin from './plugins/SlashCommandPlugin';
import DraggableBlockPlugin from './plugins/DraggableBlockPlugin';
import { updateBoard } from '../../lib/boardsApi';
import { InitialContentPlugin } from './plugins/InitialContentPlugin';

interface BoardEditorProps {
  board: Board;
  projectId: string;
}

export function BoardEditor({ board, projectId }: BoardEditorProps) {
  const initialConfig = {
    namespace: 'BoardEditor',
    theme: editorTheme,
    onError: (error: Error) => {
      console.error('Lexical error:', error);
    },
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      LinkNode,
      AutoLinkNode,
      ChartNode,
      ImageNode,
    ],
  };

  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced save function
  const handleOnChange = (editorState: any) => {
    if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
        setIsSaving(true);
        try {
            const jsonState = JSON.stringify(editorState.toJSON());
            // We'll store the content in the 'description' field temporarily 
            // until the backend schema is updated to support a dedicated 'content' column,
            // OR if the backend already supports arbitrary JSON in a field.
            // For now, let's assume we patch the board with a 'content' field 
            // (Note: You might need to update the Board type and API if 'content' isn't there yet).
            
            // If the backend doesn't support 'content' yet, we can verify what fields are available.
            // Using 'settings' or a new field is recommended. Let's try 'settings.content'.
            console.log('[BoardEditor] Saving content for board:', board.id);
            console.log('[BoardEditor] Content preview:', jsonState.substring(0, 100) + '...');
            
            await updateBoard(board.id, {
                settings: {
                    ...board.settings, // Keep existing settings
                    content: jsonState
                }
            });
            console.log('[BoardEditor] Save successful');
        } catch (error) {
            console.error("Failed to save board content:", error);
        } finally {
            setIsSaving(false);
        }
    }, 1000); // 1 second debounce
  };

  const [anchorElem, setAnchorElem] = useState<HTMLElement | null>(null);
  const onRef = (node: HTMLDivElement | null) => {
    if (node) {
        setAnchorElem(node);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background relative">
      <div className="absolute top-2 right-4 z-10">
        {isSaving ? (
            <span className="text-xs text-muted-foreground animate-pulse">Saving...</span>
        ) : (
            <span className="text-xs text-muted-foreground opacity-50">Saved</span>
        )}
      </div>
      <LexicalComposer initialConfig={initialConfig}>
        <div className="flex-1 relative overflow-auto" ref={onRef}>
          <div className="relative min-h-full max-w-4xl mx-auto">
             <RichTextPlugin
                contentEditable={
                <ContentEditable className="min-h-full outline-none prose dark:prose-invert max-w-none p-8 pl-12" />
                }
                placeholder={
                <div className="absolute top-8 left-12 text-muted-foreground pointer-events-none">
                    Type '/' to insert blocks...
                </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
            />
            {anchorElem && <DraggableBlockPlugin anchorElem={anchorElem} />}
          </div>
          <HistoryPlugin />
          <AutoFocusPlugin />
          <ListPlugin />
          <LinkPlugin />
          <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
          <OnChangePlugin onChange={handleOnChange} />
          <SlashCommandPlugin projectId={projectId} />
          <InitialContentPlugin content={board.settings?.content || null} />
        </div>
      </LexicalComposer>
    </div>
  );
}
