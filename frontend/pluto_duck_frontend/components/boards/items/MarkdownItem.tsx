'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary';
import { HeadingNode, QuoteNode, $createHeadingNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { TRANSFORMERS } from '@lexical/markdown';
import { 
  EditorState, 
  $getSelection, 
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  $getRoot,
  $createParagraphNode,
  TextFormatType
} from 'lexical';
import { $setBlocksType } from '@lexical/selection';
import { Bold, Italic, Underline, Code, Strikethrough, Heading1, Heading2, Heading3 } from 'lucide-react';
import type { BoardItem } from '../../../lib/boardsApi';

interface MarkdownItemProps {
  item: BoardItem;
  onUpdate?: (itemId: string, updates: { payload?: Record<string, any> }) => Promise<any>;
}

// Plugin to load initial content
function InitialContentPlugin({ content, onLoaded }: { content: any; onLoaded?: () => void }) {
  const [editor] = useLexicalComposerContext();
  const [isLoaded, setIsLoaded] = useState(false);
  
  useEffect(() => {
    if (!content || isLoaded) return;
    
    try {
      const editorStateJSON = typeof content === 'string' 
        ? JSON.parse(content) 
        : content;
      
      const newEditorState = editor.parseEditorState(editorStateJSON);
      editor.setEditorState(newEditorState);
      setIsLoaded(true);
      onLoaded?.();
    } catch (error) {
      console.error('Failed to load initial content:', error);
      setIsLoaded(true);
      onLoaded?.();
    }
  }, [editor, content, isLoaded, onLoaded]);
  
  return null;
}

// Floating Toolbar Plugin
function FloatingToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [isText, setIsText] = useState(false);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isCode, setIsCode] = useState(false);

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    
    if ($isRangeSelection(selection)) {
      const hasText = !selection.isCollapsed();
      setIsText(hasText);
      
      if (hasText) {
        // Update format states
        setIsBold(selection.hasFormat('bold'));
        setIsItalic(selection.hasFormat('italic'));
        setIsUnderline(selection.hasFormat('underline'));
        setIsStrikethrough(selection.hasFormat('strikethrough'));
        setIsCode(selection.hasFormat('code'));
        
        // Position the toolbar
        const nativeSelection = window.getSelection();
        if (nativeSelection && nativeSelection.rangeCount > 0) {
          const range = nativeSelection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          
          if (toolbarRef.current) {
            const toolbar = toolbarRef.current;
            toolbar.style.top = `${rect.top - toolbar.offsetHeight - 8}px`;
            toolbar.style.left = `${rect.left + rect.width / 2 - toolbar.offsetWidth / 2}px`;
          }
        }
      }
    } else {
      setIsText(false);
    }
  }, []);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        updateToolbar();
        return false;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, updateToolbar]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        updateToolbar();
      });
    });
  }, [editor, updateToolbar]);

  const formatText = (format: TextFormatType) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  };

  const applyHeading = (headingTag: 'h1' | 'h2' | 'h3') => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode(headingTag));
      }
    });
  };

  if (!isText) {
    return null;
  }

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-1 p-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg"
      style={{ position: 'fixed' }}
    >
      <button
        onClick={() => formatText('bold')}
        className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
          isBold ? 'bg-gray-200 dark:bg-gray-600' : ''
        }`}
        title="Bold (Ctrl+B)"
      >
        <Bold className="w-4 h-4" />
      </button>
      <button
        onClick={() => formatText('italic')}
        className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
          isItalic ? 'bg-gray-200 dark:bg-gray-600' : ''
        }`}
        title="Italic (Ctrl+I)"
      >
        <Italic className="w-4 h-4" />
      </button>
      <button
        onClick={() => formatText('underline')}
        className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
          isUnderline ? 'bg-gray-200 dark:bg-gray-600' : ''
        }`}
        title="Underline (Ctrl+U)"
      >
        <Underline className="w-4 h-4" />
      </button>
      <button
        onClick={() => formatText('strikethrough')}
        className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
          isStrikethrough ? 'bg-gray-200 dark:bg-gray-600' : ''
        }`}
        title="Strikethrough"
      >
        <Strikethrough className="w-4 h-4" />
      </button>
      <button
        onClick={() => formatText('code')}
        className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
          isCode ? 'bg-gray-200 dark:bg-gray-600' : ''
        }`}
        title="Code"
      >
        <Code className="w-4 h-4" />
      </button>
      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
      <button
        onClick={() => applyHeading('h1')}
        className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        title="Heading 1"
      >
        <Heading1 className="w-4 h-4" />
      </button>
      <button
        onClick={() => applyHeading('h2')}
        className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        title="Heading 2"
      >
        <Heading2 className="w-4 h-4" />
      </button>
      <button
        onClick={() => applyHeading('h3')}
        className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        title="Heading 3"
      >
        <Heading3 className="w-4 h-4" />
      </button>
    </div>
  );
}

const editorTheme = {
  paragraph: 'mb-2 text-sm',
  quote: 'border-l-4 border-gray-300 pl-4 italic my-2',
  heading: {
    h1: 'text-2xl font-bold mb-3 mt-4',
    h2: 'text-xl font-bold mb-2 mt-3',
    h3: 'text-lg font-semibold mb-2 mt-2',
  },
  list: {
    nested: {
      listitem: 'list-none',
    },
    ol: 'list-decimal ml-4 my-2',
    ul: 'list-disc ml-4 my-2',
    listitem: 'mb-1',
  },
  code: 'bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded font-mono text-sm',
  codeHighlight: {
    atrule: 'text-purple-600',
    attr: 'text-blue-600',
    boolean: 'text-red-600',
    builtin: 'text-purple-600',
    cdata: 'text-gray-600',
    char: 'text-green-600',
    class: 'text-blue-600',
    'class-name': 'text-blue-600',
    comment: 'text-gray-500 italic',
    constant: 'text-red-600',
    deleted: 'text-red-600',
    doctype: 'text-gray-600',
    entity: 'text-orange-600',
    function: 'text-purple-600',
    important: 'text-red-600 font-bold',
    inserted: 'text-green-600',
    keyword: 'text-purple-600',
    namespace: 'text-blue-600',
    number: 'text-red-600',
    operator: 'text-gray-700',
    prolog: 'text-gray-600',
    property: 'text-blue-600',
    punctuation: 'text-gray-700',
    regex: 'text-orange-600',
    selector: 'text-green-600',
    string: 'text-green-600',
    symbol: 'text-red-600',
    tag: 'text-blue-600',
    url: 'text-blue-600 underline',
    variable: 'text-orange-600',
  },
  link: 'text-blue-600 underline hover:text-blue-800',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    underlineStrikethrough: 'underline line-through',
    code: 'bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded font-mono text-sm',
  },
};

export function MarkdownItem({ item, onUpdate }: MarkdownItemProps) {
  const [isClient, setIsClient] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const initialConfig = {
    namespace: 'MarkdownEditor',
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
    ],
  };

  const handleInitialLoadComplete = useCallback(() => {
    // Wait a bit to ensure the editor is fully initialized
    setTimeout(() => {
      setIsInitialLoadComplete(true);
    }, 100);
  }, []);

  const saveContent = useCallback(async (content: any) => {
    if (!onUpdate) return;
    
    try {
      setIsSaving(true);
      await onUpdate(item.id, {
        payload: { content }
      });
    } catch (error) {
      console.error('Failed to save markdown content:', error);
    } finally {
      setIsSaving(false);
    }
  }, [item.id, onUpdate]);

  const onChange = useCallback((editorState: EditorState) => {
    // Don't save during initial load
    if (!isInitialLoadComplete) return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save for 1 second
    saveTimeoutRef.current = setTimeout(() => {
      const jsonState = editorState.toJSON();
      void saveContent(jsonState);
    }, 1000);
  }, [isInitialLoadComplete, saveContent]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  if (!isClient) {
    return (
      <div className="min-h-[200px] p-4 bg-gray-50 dark:bg-gray-900 rounded-lg animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-3"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 bg-transparent rounded-lg border border-transparent hover:border-border/50 focus-within:border-border transition-colors relative">
      {/* Saving indicator */}
      {isSaving && (
        <div className="absolute top-2 right-2 text-xs text-muted-foreground flex items-center gap-1 z-10">
          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
          Saving...
        </div>
      )}
      
      <LexicalComposer initialConfig={initialConfig}>
        <div className="relative flex-1 flex flex-col overflow-auto">
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="h-full outline-none prose dark:prose-invert max-w-none bg-transparent" />
            }
            placeholder={
              <div className="absolute top-0 left-0 text-muted-foreground/50 pointer-events-none">
                Start typing...
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <OnChangePlugin onChange={onChange} />
        <ListPlugin />
        <LinkPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <AutoFocusPlugin />
        <FloatingToolbarPlugin />
        <InitialContentPlugin content={item.payload.content} onLoaded={handleInitialLoadComplete} />
      </LexicalComposer>
    </div>
  );
}
