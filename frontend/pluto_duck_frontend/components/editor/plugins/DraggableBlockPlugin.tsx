import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin';
import { useRef } from 'react';
import { GripVertical } from 'lucide-react';

export default function DraggableBlockPlugin({ anchorElem = document.body }: { anchorElem?: HTMLElement }): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorElem}
      menuRef={menuRef as any}
      targetLineRef={targetLineRef as any}
      menuComponent={
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
      }
      targetLineComponent={
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
      }
      isOnMenu={(element) => {
        return element.closest('.draggable-block-menu') !== null;
      }}
    />
  );
}

