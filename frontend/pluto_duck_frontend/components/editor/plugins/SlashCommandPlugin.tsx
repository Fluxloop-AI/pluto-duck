import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { TextNode, $createParagraphNode, $getSelection, $isRangeSelection, COMMAND_PRIORITY_LOW } from 'lexical';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createCodeNode } from '@lexical/code';
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list';
import { useCallback, useState, useEffect } from 'react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { 
  Heading1, 
  Heading2, 
  Heading3, 
  List, 
  ListOrdered, 
  Quote, 
  Code, 
  BarChartBig, 
  Image as ImageIcon,
  Database,
} from 'lucide-react';
import { $createChartNode } from '../nodes/ChartNode';
import { $createImageNode } from '../nodes/ImageNode';
import { $createAssetNode } from '../nodes/AssetNode';
import { $setBlocksType } from '@lexical/selection';

class SlashMenuOption extends MenuOption {
  title: string;
  icon: React.ReactNode;
  keywords: Array<string>;
  onSelect: (editor: any) => void;

  constructor(
    title: string,
    icon: React.ReactNode,
    keywords: Array<string>,
    onSelect: (editor: any) => void
  ) {
    super(title);
    this.title = title;
    this.icon = icon;
    this.keywords = keywords || [];
    this.onSelect = onSelect;
  }
}

export default function SlashCommandPlugin({ projectId }: { projectId: string }): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string | null>(null);

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
  });

  const options = [
    new SlashMenuOption('Heading 1', <Heading1 size={18} />, ['h1', 'heading', 'large'], (editor) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode('h1'));
        }
      });
    }),
    new SlashMenuOption('Heading 2', <Heading2 size={18} />, ['h2', 'heading', 'medium'], (editor) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode('h2'));
        }
      });
    }),
    new SlashMenuOption('Heading 3', <Heading3 size={18} />, ['h3', 'heading', 'small'], (editor) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode('h3'));
        }
      });
    }),
    new SlashMenuOption('Bullet List', <List size={18} />, ['ul', 'list', 'bullet'], (editor) => {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    }),
    new SlashMenuOption('Numbered List', <ListOrdered size={18} />, ['ol', 'list', 'number'], (editor) => {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    }),
    new SlashMenuOption('Quote', <Quote size={18} />, ['quote', 'blockquote'], (editor) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createQuoteNode());
        }
      });
    }),
    new SlashMenuOption('Code Block', <Code size={18} />, ['code', 'block'], (editor) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createCodeNode());
        }
      });
    }),
    new SlashMenuOption('Chart', <BarChartBig size={18} />, ['chart', 'graph', 'data'], (editor) => {
      editor.update(() => {
        // Mock Chart Insertion
        const chartNode = $createChartNode(
            "mock-query-id", // In real implementation, this would trigger a picker
            "bar",
            projectId
        );
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
            selection.insertNodes([chartNode]);
            // Insert a paragraph after the chart to allow typing
            const paragraphNode = $createParagraphNode();
            chartNode.insertAfter(paragraphNode);
            paragraphNode.select();
        }
      });
    }),
    new SlashMenuOption('Image', <ImageIcon size={18} />, ['image', 'photo', 'picture'], (editor) => {
      editor.update(() => {
        // Mock Image Insertion
        const imageNode = $createImageNode({
            src: "https://images.unsplash.com/photo-1554080353-a576cf803bda?auto=format&fit=crop&w=1000&q=80",
            altText: "Placeholder Image",
            width: 500,
            height: 300
        });
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
            selection.insertNodes([imageNode]);
            // Insert a paragraph after the image to allow typing
            const paragraphNode = $createParagraphNode();
            imageNode.insertAfter(paragraphNode);
            paragraphNode.select();
        }
      });
    }),
    new SlashMenuOption('Asset', <Database size={18} />, ['asset', 'analysis', 'data', 'query'], (editor) => {
      editor.update(() => {
        // Insert Asset reference - will show a picker in real implementation
        // For now, use a placeholder that prompts for selection
        const analysisId = window.prompt('Enter Analysis ID:');
        if (analysisId) {
          const assetNode = $createAssetNode(analysisId, projectId);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertNodes([assetNode]);
            // Insert a paragraph after the asset to allow typing
            const paragraphNode = $createParagraphNode();
            assetNode.insertAfter(paragraphNode);
            paragraphNode.select();
          }
        }
      });
    }),
  ];

  const onSelectOption = useCallback(
    (
      selectedOption: SlashMenuOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
      matchingString: string,
    ) => {
      editor.update(() => {
        if (nodeToRemove) {
          nodeToRemove.remove();
        }
        selectedOption.onSelect(editor);
        closeMenu();
      });
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin<SlashMenuOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => {
        if (anchorElementRef.current == null || options.length === 0) {
          return null;
        }

        return anchorElementRef.current && createPortal(
          <div className="typeahead-popover bg-background border rounded-lg shadow-lg overflow-hidden min-w-[200px] p-1 z-50">
            <ul className="max-h-[300px] overflow-y-auto">
              {options.map((option, i) => (
                <SlashMenuItem
                  index={i}
                  isSelected={selectedIndex === i}
                  onClick={() => {
                    setHighlightedIndex(i);
                    selectOptionAndCleanUp(option);
                  }}
                  onMouseEnter={() => {
                    setHighlightedIndex(i);
                  }}
                  key={option.key}
                  option={option}
                />
              ))}
            </ul>
          </div>,
          anchorElementRef.current,
        );
      }}
    />
  );
}

function SlashMenuItem({
  index,
  isSelected,
  onClick,
  onMouseEnter,
  option,
}: {
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  option: SlashMenuOption;
}) {
  return (
    <li
      key={option.key}
      tabIndex={-1}
      className={`item cursor-pointer flex items-center gap-2 p-2 rounded-md text-sm ${
        isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground'
      }`}
      ref={option.setRefElement}
      role="option"
      aria-selected={isSelected}
      id={'typeahead-item-' + index}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="icon text-muted-foreground">{option.icon}</span>
      <span className="text">{option.title}</span>
    </li>
  );
}

