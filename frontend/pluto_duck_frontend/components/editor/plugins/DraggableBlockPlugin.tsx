import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalEditable } from '@lexical/react/useLexicalEditable';
import { GripVertical } from 'lucide-react';
import { useRef } from 'react';

import { useDraggableBlockMenu } from './draggable-block/useDraggableBlockMenu';

interface DraggableBlockPluginProps {
  anchorElem?: HTMLElement;
}

export default function DraggableBlockPlugin({ anchorElem = document.body }: DraggableBlockPluginProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();

  return useDraggableBlockMenu({
    editor,
    anchorElem,
    menuRef,
    targetLineRef,
    isEditable,
    menuComponent: (
      <div
        ref={menuRef}
        className="draggable-block-menu"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          cursor: 'grab',
          padding: '4px',
          borderRadius: '4px',
          backgroundColor: 'hsl(var(--muted) / 0.5)',
          zIndex: 100,
          opacity: 1,
          willChange: 'transform',
        }}
      >
        <GripVertical size={14} className="text-muted-foreground" />
      </div>
    ),
    targetLineComponent: (
      <div
        ref={targetLineRef}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: '4px',
          backgroundColor: '#3b82f6',
          opacity: 0,
          pointerEvents: 'none',
          zIndex: 100,
        }}
      />
    ),
    isOnMenu: (element) => {
      return element.closest('.draggable-block-menu') !== null;
    },
  });
}
