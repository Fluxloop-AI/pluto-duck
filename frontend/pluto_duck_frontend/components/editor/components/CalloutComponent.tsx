'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, NodeKey } from 'lexical';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

import { $isCalloutNode, type CalloutType } from '../nodes/CalloutNode';

interface CalloutComponentProps {
  calloutType: CalloutType;
  text: string;
  nodeKey: NodeKey;
}

const CALLOUT_OPTIONS: Array<{
  label: string;
  type: CalloutType;
  icon: typeof Info;
}> = [
  { label: 'Info', type: 'info', icon: Info },
  { label: 'Warning', type: 'warning', icon: AlertTriangle },
  { label: 'Success', type: 'success', icon: CheckCircle2 },
  { label: 'Error', type: 'error', icon: AlertCircle },
];

export function CalloutComponent({ calloutType, text, nodeKey }: CalloutComponentProps) {
  const [editor] = useLexicalComposerContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = textRef.current;
    if (!element) {
      return;
    }

    // Keep contentEditable uncontrolled while syncing external updates
    // to avoid caret reset on each keystroke.
    if (document.activeElement !== element && element.innerText !== text) {
      element.innerText = text;
    }
  }, [text]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const updateNodeText = useCallback(
    (nextText: string) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isCalloutNode(node)) {
          node.setText(nextText);
        }
      });
    },
    [editor, nodeKey],
  );

  const updateNodeType = useCallback(
    (nextType: CalloutType) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isCalloutNode(node)) {
          node.setCalloutType(nextType);
        }
      });
    },
    [editor, nodeKey],
  );

  const activeOption = useMemo(
    () => CALLOUT_OPTIONS.find((option) => option.type === calloutType) ?? CALLOUT_OPTIONS[0],
    [calloutType],
  );

  return (
    <div ref={containerRef} className="callout-node" data-callout-type={calloutType}>
      <div className="callout-node-shell relative flex items-start gap-3">
        <button
          type="button"
          className="callout-node-trigger mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label="Change callout type"
        >
          <activeOption.icon size={16} />
        </button>
        {menuOpen && (
          <div className="callout-node-menu absolute left-0 top-8 z-20 min-w-[148px] rounded-md border bg-popover p-1 shadow-md">
            {CALLOUT_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.type}
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    updateNodeType(option.type);
                    setMenuOpen(false);
                  }}
                >
                  <Icon size={14} />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <div
          ref={textRef}
          className="callout-node-text min-h-[1.5rem] flex-1 whitespace-pre-wrap break-words outline-none"
          contentEditable={true}
          suppressContentEditableWarning={true}
          onInput={(event) => {
            const nextText = event.currentTarget.innerText;
            updateNodeText(nextText);
          }}
          onPaste={(event) => {
            event.preventDefault();
            const pastedText = event.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, pastedText);
          }}
        />
      </div>
    </div>
  );
}
