'use client';

import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary';
import {
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useEffect,
  type KeyboardEvent,
} from 'react';

import { editorTheme } from './theme';
import type { Board } from '../../lib/boardsApi';
import { formatBoardUpdatedAt, getDisplayTabTitle } from '../../lib/boardTitle';
import { ImageNode, AssetEmbedNode, CalloutNode, MarkdownTableNode, type AssetEmbedConfig } from './nodes';
import SlashCommandPlugin, { AssetEmbedContext } from './plugins/SlashCommandPlugin';
import DraggableBlockPlugin from './plugins/DraggableBlockPlugin';
import { InitialContentPlugin } from './plugins/InitialContentPlugin';
import { InsertMarkdownPlugin, type InsertMarkdownHandle } from './plugins/InsertMarkdownPlugin';
import { InsertAssetEmbedPlugin, type InsertAssetEmbedHandle } from './plugins/InsertAssetEmbedPlugin';
import { AssetPicker } from './components/AssetPicker';
import { DisplayConfigModal } from './components/DisplayConfigModal';
import { ConfigModalContext } from './components/AssetEmbedComponent';
import { BOARD_TRANSFORMERS } from './transformers';

interface BoardEditorProps {
  board: Board;
  projectId: string;
  tabId: string;
  tabName?: string;
  onRenameTab?: (newName: string) => void;
  boardUpdatedAt?: string | null;
  initialContent: string | null;
  onContentChange: (content: string) => void;
}

export interface BoardEditorHandle {
  insertMarkdown: (content: string) => void;
  insertAssetEmbed: (analysisId: string, projectId: string, config: AssetEmbedConfig) => void;
}

// State for the two-step embed flow
interface EmbedFlowState {
  step: 'picker' | 'config' | null;
  analysisId: string | null;
  callback: ((analysisId: string, config: AssetEmbedConfig) => void) | null;
}

// State for editing existing embedded assets
interface EditConfigState {
  analysisId: string | null;
  currentConfig: AssetEmbedConfig | null;
  onSave: ((config: AssetEmbedConfig) => void) | null;
}

export const BoardEditor = forwardRef<BoardEditorHandle, BoardEditorProps>(
  function BoardEditor({
    board,
    projectId,
    tabId,
    tabName,
    onRenameTab,
    boardUpdatedAt,
    initialContent,
    onContentChange,
  }, ref) {
  const insertMarkdownRef = useRef<InsertMarkdownHandle>(null);
  const insertAssetEmbedRef = useRef<InsertAssetEmbedHandle>(null);

  // Expose insertMarkdown and insertAssetEmbed methods to parent
  useImperativeHandle(ref, () => ({
    insertMarkdown: (content: string) => {
      insertMarkdownRef.current?.insertMarkdown(content);
    },
    insertAssetEmbed: (analysisId: string, projectId: string, config: AssetEmbedConfig) => {
      insertAssetEmbedRef.current?.insertAssetEmbed(analysisId, projectId, config);
    },
  }));

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
      HorizontalRuleNode,
      CalloutNode,
      MarkdownTableNode,
      ImageNode,
      AssetEmbedNode,
    ],
  };

  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef<string | null>(initialContent);

  // Asset Embed flow state (for new embeds)
  const [embedFlow, setEmbedFlow] = useState<EmbedFlowState>({
    step: null,
    analysisId: null,
    callback: null,
  });

  // Edit config state (for existing embeds)
  const [editConfig, setEditConfig] = useState<EditConfigState>({
    analysisId: null,
    currentConfig: null,
    onSave: null,
  });

  // Open the embed flow (called from slash command)
  const openAssetEmbed = useCallback(
    (callback: (analysisId: string, config: AssetEmbedConfig) => void) => {
      setEmbedFlow({
        step: 'picker',
        analysisId: null,
        callback,
      });
    },
    []
  );

  // Handle analysis selection (step 1 → step 2)
  const handleAssetSelect = useCallback((analysisId: string) => {
    setEmbedFlow((prev) => ({
      ...prev,
      step: 'config',
      analysisId,
    }));
  }, []);

  // Handle config save (step 2 → done)
  const handleConfigSave = useCallback((config: AssetEmbedConfig) => {
    if (embedFlow.callback && embedFlow.analysisId) {
      embedFlow.callback(embedFlow.analysisId, config);
    }
    setEmbedFlow({ step: null, analysisId: null, callback: null });
  }, [embedFlow]);

  // Cancel embed flow
  const handleEmbedCancel = useCallback(() => {
    setEmbedFlow({ step: null, analysisId: null, callback: null });
  }, []);

  // Open config modal for existing embed (edit mode)
  const openConfigModal = useCallback(
    (
      analysisId: string,
      currentConfig: AssetEmbedConfig,
      onSave: (config: AssetEmbedConfig) => void
    ) => {
      setEditConfig({ analysisId, currentConfig, onSave });
    },
    []
  );

  // Handle edit config save
  const handleEditConfigSave = useCallback(
    (config: AssetEmbedConfig) => {
      if (editConfig.onSave) {
        editConfig.onSave(config);
      }
      setEditConfig({ analysisId: null, currentConfig: null, onSave: null });
    },
    [editConfig]
  );

  // Cancel edit config
  const handleEditConfigCancel = useCallback(() => {
    setEditConfig({ analysisId: null, currentConfig: null, onSave: null });
  }, []);

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

      // Reset saving state and update last saved time
      setTimeout(() => {
        setIsSaving(false);
        setLastSavedAt(new Date());
      }, 500);
    }, 1000); // 1 second debounce
  }, [tabId, onContentChange]);

  const [anchorElem, setAnchorElem] = useState<HTMLElement | null>(null);
  const onRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setAnchorElem(node);
    }
  }, []);
  const resolvedTabName = tabName ?? board.settings?.tabs?.find((tab) => tab.id === tabId)?.name ?? '';
  const resolvedBoardUpdatedAt = boardUpdatedAt ?? board.updated_at ?? null;
  const [localTabName, setLocalTabName] = useState(resolvedTabName);

  useEffect(() => {
    setLocalTabName(resolvedTabName);
  }, [resolvedTabName]);

  const inputTabName = onRenameTab ? resolvedTabName : localTabName;
  const displayTitle = getDisplayTabTitle(inputTabName);
  const formattedBoardUpdatedAt = formatBoardUpdatedAt(resolvedBoardUpdatedAt);
  const handleTitleChange = useCallback((nextName: string) => {
    if (onRenameTab) {
      onRenameTab(nextName);
      return;
    }
    setLocalTabName(nextName);
  }, [onRenameTab]);

  const handleTitleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    const contentEditable = anchorElem?.querySelector<HTMLElement>('[contenteditable="true"]');
    contentEditable?.focus();
  }, [anchorElem]);

  return (
    <div className="h-full flex flex-col bg-background relative">
      <div className="absolute top-2 right-4 z-10 flex items-center gap-3">
        {lastSavedAt && (
          <span className="text-xs text-muted-foreground">
            {lastSavedAt.toLocaleString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          </span>
        )}
        {isSaving ? (
          <span className="text-xs text-muted-foreground animate-pulse">Saving...</span>
        ) : (
          <span className="text-xs text-muted-foreground opacity-50">Auto-saved</span>
        )}
      </div>
      <AssetEmbedContext.Provider value={{ openAssetEmbed }}>
        <ConfigModalContext.Provider value={{ openConfigModal }}>
          <LexicalComposer initialConfig={initialConfig}>
            <div className="flex-1 overflow-auto">
              <div className="min-h-full">
                <div className="pl-[22px] pr-6 pt-5 pb-6">
                  {formattedBoardUpdatedAt && (
                    <div className="mb-3 text-xs text-muted-foreground text-center">
                      {formattedBoardUpdatedAt}
                    </div>
                  )}
                  <input
                    type="text"
                    value={inputTabName}
                    onChange={(event) => handleTitleChange(event.target.value)}
                    onKeyDown={handleTitleKeyDown}
                    placeholder="Untitled"
                    title={displayTitle}
                    aria-label="Board title"
                    className="w-full text-4xl font-bold bg-transparent border-none outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="relative px-6 pb-6" ref={onRef}>
                  <RichTextPlugin
                    contentEditable={
                      <ContentEditable className="board-editor-prose min-h-full outline-none prose dark:prose-invert max-w-none [--tw-prose-body:hsl(var(--foreground))]" />
                    }
                    placeholder={
                      <div className="absolute top-0 left-6 text-muted-foreground pointer-events-none">
                        Type &apos;/&apos; to insert blocks...
                      </div>
                    }
                    ErrorBoundary={LexicalErrorBoundary}
                  />
                  {anchorElem && <DraggableBlockPlugin anchorElem={anchorElem} />}
                </div>
              </div>
              <HistoryPlugin />
              <AutoFocusPlugin />
              <ListPlugin />
              <LinkPlugin />
              <HorizontalRulePlugin />
              <MarkdownShortcutPlugin transformers={BOARD_TRANSFORMERS} />
              <OnChangePlugin onChange={handleOnChange} />
              <SlashCommandPlugin projectId={projectId} />
              <InitialContentPlugin content={initialContent} />
              <InsertMarkdownPlugin ref={insertMarkdownRef} />
              <InsertAssetEmbedPlugin ref={insertAssetEmbedRef} />
            </div>
          </LexicalComposer>
        </ConfigModalContext.Provider>
      </AssetEmbedContext.Provider>

      {/* Step 1: Asset Picker Modal */}
      <AssetPicker
        open={embedFlow.step === 'picker'}
        projectId={projectId}
        onSelect={handleAssetSelect}
        onCancel={handleEmbedCancel}
      />

      {/* Step 2: Display Config Modal (new embed) */}
      {embedFlow.step === 'config' && embedFlow.analysisId && (
        <DisplayConfigModal
          open={true}
          analysisId={embedFlow.analysisId}
          projectId={projectId}
          onSave={handleConfigSave}
          onCancel={handleEmbedCancel}
        />
      )}

      {/* Edit Config Modal (existing embed) */}
      {editConfig.analysisId && editConfig.currentConfig && (
        <DisplayConfigModal
          open={true}
          analysisId={editConfig.analysisId}
          projectId={projectId}
          initialConfig={editConfig.currentConfig}
          onSave={handleEditConfigSave}
          onCancel={handleEditConfigCancel}
        />
      )}
    </div>
  );
});
