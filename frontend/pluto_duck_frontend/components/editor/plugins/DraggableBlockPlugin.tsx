import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin';
import { useRef } from 'react';
import { GripVertical } from 'lucide-react';

const DRAGGABLE_BLOCK_MENU_CLASSNAME = 'draggable-block-menu';

function DraggableBlockMenu({ anchorElem, item }: { anchorElem: HTMLElement; item: any }) {
  // This is a placeholder for the menu that appears when clicking the drag handle
  return null;
}

export default function DraggableBlockPlugin({ anchorElem = document.body }: { anchorElem?: HTMLElement }): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorElem}
      menuRef={menuRef as any}
      targetLineRef={targetLineRef as any}
      menuComponent={
        <div ref={menuRef} className="icon draggable-block-menu opacity-0 absolute top-0 left-0 hover:opacity-100 cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded">
          <GripVertical size={16} className="text-muted-foreground" />
        </div>
      }
      targetLineComponent={
        <div ref={targetLineRef} className="pointer-events-none bg-blue-500 h-1 absolute top-0 left-0 right-0 opacity-0 transition-opacity" />
      }
      isOnMenu={(_element) => {
        return false;
      }}
    />
  );
}

