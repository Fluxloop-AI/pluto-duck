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
import { useRef, useState, useCallback } from 'react';

import { editorTheme } from './theme';
import type { Board } from '../../lib/boardsApi';
import { ChartNode, ImageNode, AssetNode } from './nodes';
import SlashCommandPlugin from './plugins/SlashCommandPlugin';
import DraggableBlockPlugin from './plugins/DraggableBlockPlugin';
import { InitialContentPlugin } from './plugins/InitialContentPlugin';

interface BoardEditorProps {
  board: Board;
  projectId: string;
  tabId: string;
  initialContent: string | null;
  onContentChange: (content: string) => void;
}

export function BoardEditor({ 
  board, 
  projectId, 
  tabId,
  initialContent,
  onContentChange,
}: BoardEditorProps) {
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
      AssetNode,
    ],
  };

  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef<string | null>(initialContent);

  // Debounced save function
  const handleOnChange = useCallback((editorState: any) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      const jsonState = JSON.stringify(editorState.toJSON());
      
      // Skip if content hasn't changed
      if (jsonState === lastSavedContentRef.current) {
        return;
      }
      
      setIsSaving(true);
      lastSavedContentRef.current = jsonState;
      
      console.log('[BoardEditor] Saving tab content:', tabId);
      onContentChange(jsonState);
      
      // Reset saving state after a short delay
      setTimeout(() => setIsSaving(false), 500);
    }, 1000); // 1 second debounce
  }, [tabId, onContentChange]);

  const [anchorElem, setAnchorElem] = useState<HTMLElement | null>(null);
  const onRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setAnchorElem(node);
    }
  }, []);

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
          <InitialContentPlugin content={initialContent} />
        </div>
      </LexicalComposer>
    </div>
  );
}
