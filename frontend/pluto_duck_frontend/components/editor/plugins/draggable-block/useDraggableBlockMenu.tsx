// Forked from @lexical/react@0.18.0 LexicalDraggableBlockPlugin.dev.mjs.

import { eventFiles } from '@lexical/rich-text';
import { calculateZoomLevel, isHTMLElement, mergeRegister } from '@lexical/utils';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  DRAGOVER_COMMAND,
  DROP_COMMAND,
  type LexicalEditor,
} from 'lexical';
import {
  type DragEvent as ReactDragEvent,
  type ReactNode,
  type ReactPortal,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { DRAG_DATA_FORMAT } from './constants';
import {
  getBlockElement,
  hideTargetLine,
  shouldInsertAfterBlock,
  setDragImage,
  setMenuPosition,
  setTargetLine,
} from './blockPositioning';

interface UseDraggableBlockMenuParams {
  editor: LexicalEditor;
  anchorElem: HTMLElement;
  menuRef: RefObject<HTMLElement>;
  targetLineRef: RefObject<HTMLElement>;
  isEditable: boolean;
  menuComponent: ReactNode;
  targetLineComponent: ReactNode;
  isOnMenu: (element: HTMLElement) => boolean;
}

function resolveEventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target == null) {
    return null;
  }

  if (isHTMLElement(target)) {
    return target;
  }

  if (target instanceof Node && target.parentElement && isHTMLElement(target.parentElement)) {
    return target.parentElement;
  }

  return null;
}

export function useDraggableBlockMenu({
  editor,
  anchorElem,
  menuRef,
  targetLineRef,
  isEditable,
  menuComponent,
  targetLineComponent,
  isOnMenu,
}: UseDraggableBlockMenuParams): ReactPortal {
  const scrollerElem = anchorElem.parentElement;
  const isDraggingBlockRef = useRef(false);
  const [draggableBlockElem, setDraggableBlockElem] = useState<HTMLElement | null>(null);

  useEffect(() => {
    function onMouseMove(event: MouseEvent): void {
      const target = event.target;

      if (target != null && !isHTMLElement(target)) {
        setDraggableBlockElem(null);
        return;
      }

      if (target != null && isOnMenu(target)) {
        return;
      }

      const nextDraggableBlockElem = getBlockElement(anchorElem, editor, event);
      setDraggableBlockElem(nextDraggableBlockElem);
    }

    function onMouseLeave(): void {
      setDraggableBlockElem(null);
    }

    if (scrollerElem != null) {
      scrollerElem.addEventListener('mousemove', onMouseMove);
      scrollerElem.addEventListener('mouseleave', onMouseLeave);
    }

    return () => {
      if (scrollerElem != null) {
        scrollerElem.removeEventListener('mousemove', onMouseMove);
        scrollerElem.removeEventListener('mouseleave', onMouseLeave);
      }
    };
  }, [scrollerElem, anchorElem, editor, isOnMenu]);

  useEffect(() => {
    if (menuRef.current) {
      setMenuPosition(draggableBlockElem, menuRef.current, anchorElem);
    }
  }, [anchorElem, draggableBlockElem, menuRef]);

  useEffect(() => {
    function onDragover(event: DragEvent): boolean {
      if (!isDraggingBlockRef.current) {
        return false;
      }

      const [isFileTransfer] = eventFiles(event);
      if (isFileTransfer) {
        return false;
      }

      const { clientY, target } = event;
      const targetElement = resolveEventTargetElement(target);
      if (targetElement === null) {
        return false;
      }

      const targetBlockElem = getBlockElement(anchorElem, editor, event, true);
      const targetLineElem = targetLineRef.current;

      if (targetBlockElem === null || targetLineElem === null) {
        return false;
      }

      setTargetLine(targetLineElem, targetBlockElem, clientY / calculateZoomLevel(targetElement), anchorElem);

      // Prevent default event to be able to trigger onDrop events.
      event.preventDefault();
      return true;
    }

    function onDrop(event: DragEvent): boolean {
      if (!isDraggingBlockRef.current) {
        return false;
      }

      const [isFileTransfer] = eventFiles(event);
      if (isFileTransfer) {
        return false;
      }

      const { target, dataTransfer, clientY } = event;
      const targetElement = resolveEventTargetElement(target);
      if (targetElement === null) {
        return false;
      }
      const dragData = dataTransfer != null ? dataTransfer.getData(DRAG_DATA_FORMAT) : '';
      const draggedNode = $getNodeByKey(dragData);

      if (!draggedNode) {
        return false;
      }

      const targetBlockElem = getBlockElement(anchorElem, editor, event, true);
      if (!targetBlockElem) {
        return false;
      }

      const targetNode = $getNearestNodeFromDOMNode(targetBlockElem);
      if (!targetNode) {
        return false;
      }

      if (targetNode === draggedNode) {
        return true;
      }

      const { top: targetBlockElemTop, height: targetBlockElemHeight } = targetBlockElem.getBoundingClientRect();
      if (
        shouldInsertAfterBlock(
          clientY / calculateZoomLevel(targetElement),
          targetBlockElemTop,
          targetBlockElemHeight,
        )
      ) {
        targetNode.insertAfter(draggedNode);
      } else {
        targetNode.insertBefore(draggedNode);
      }

      setDraggableBlockElem(null);
      return true;
    }

    return mergeRegister(
      editor.registerCommand(
        DRAGOVER_COMMAND,
        (event) => {
          return onDragover(event);
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        DROP_COMMAND,
        (event) => {
          return onDrop(event);
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [anchorElem, editor, targetLineRef]);

  function onDragStart(event: ReactDragEvent<HTMLDivElement>): void {
    const { dataTransfer } = event;
    if (!dataTransfer || !draggableBlockElem) {
      return;
    }

    setDragImage(dataTransfer, draggableBlockElem);

    let nodeKey = '';
    editor.update(() => {
      const node = $getNearestNodeFromDOMNode(draggableBlockElem);
      if (node) {
        nodeKey = node.getKey();
      }
    });

    isDraggingBlockRef.current = true;
    dataTransfer.setData(DRAG_DATA_FORMAT, nodeKey);
  }

  function onDragEnd(): void {
    isDraggingBlockRef.current = false;
    hideTargetLine(targetLineRef.current);
  }

  return createPortal(
    <>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {isEditable && menuComponent}
      </div>
      {targetLineComponent}
    </>,
    anchorElem,
  );
}
