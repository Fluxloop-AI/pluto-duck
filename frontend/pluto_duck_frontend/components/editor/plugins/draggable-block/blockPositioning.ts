// Forked from @lexical/react@0.18.0 LexicalDraggableBlockPlugin.dev.mjs.

import { calculateZoomLevel } from '@lexical/utils';
import { $getRoot, type LexicalEditor } from 'lexical';

import {
  Downward,
  Indeterminate,
  SPACE,
  TARGET_LINE_HALF_HEIGHT,
  TEXT_BOX_HORIZONTAL_PADDING,
  Upward,
} from './constants.ts';
import { Point, Rectangle, type PointContainResult } from './geometry.ts';

let prevIndex = Infinity;

type PositionEvent = Pick<MouseEvent, 'clientX' | 'clientY'>;

export function getCurrentIndex(keysLength: number): number {
  if (keysLength === 0) {
    return Infinity;
  }

  if (prevIndex >= 0 && prevIndex < keysLength) {
    return prevIndex;
  }

  return Math.floor(keysLength / 2);
}

export function getTopLevelNodeKeys(editor: LexicalEditor): string[] {
  return editor.getEditorState().read(() => $getRoot().getChildrenKeys());
}

export function getCollapsedMargins(elem: HTMLElement): { marginBottom: number; marginTop: number } {
  const getMargin = (element: Element | null, margin: 'marginTop' | 'marginBottom'): number =>
    element ? parseFloat(window.getComputedStyle(element)[margin]) : 0;

  const { marginTop, marginBottom } = window.getComputedStyle(elem);
  const prevElemSiblingMarginBottom = getMargin(elem.previousElementSibling, 'marginBottom');
  const nextElemSiblingMarginTop = getMargin(elem.nextElementSibling, 'marginTop');
  const collapsedTopMargin = Math.max(parseFloat(marginTop), prevElemSiblingMarginBottom);
  const collapsedBottomMargin = Math.max(parseFloat(marginBottom), nextElemSiblingMarginTop);

  return {
    marginBottom: collapsedBottomMargin,
    marginTop: collapsedTopMargin,
  };
}

export function getBlockElement(
  anchorElem: HTMLElement,
  editor: LexicalEditor,
  event: PositionEvent,
  useEdgeAsDefault = false,
): HTMLElement | null {
  const anchorElementRect = anchorElem.getBoundingClientRect();
  const topLevelNodeKeys = getTopLevelNodeKeys(editor);
  let blockElem: HTMLElement | null = null;

  editor.getEditorState().read(() => {
    if (useEdgeAsDefault) {
      const [firstNode, lastNode] = [
        editor.getElementByKey(topLevelNodeKeys[0]),
        editor.getElementByKey(topLevelNodeKeys[topLevelNodeKeys.length - 1]),
      ];
      const [firstNodeRect, lastNodeRect] = [
        firstNode != null ? firstNode.getBoundingClientRect() : undefined,
        lastNode != null ? lastNode.getBoundingClientRect() : undefined,
      ];

      if (firstNodeRect && lastNodeRect) {
        const firstNodeZoom = calculateZoomLevel(firstNode);
        const lastNodeZoom = calculateZoomLevel(lastNode);

        if (event.clientY / firstNodeZoom < firstNodeRect.top) {
          blockElem = firstNode;
        } else if (event.clientY / lastNodeZoom > lastNodeRect.bottom) {
          blockElem = lastNode;
        }

        if (blockElem) {
          return;
        }
      }
    }

    let index = getCurrentIndex(topLevelNodeKeys.length);
    let direction = Indeterminate;

    while (index >= 0 && index < topLevelNodeKeys.length) {
      const key = topLevelNodeKeys[index];
      const elem = editor.getElementByKey(key);

      if (elem === null) {
        break;
      }

      const zoom = calculateZoomLevel(elem);
      const point = new Point(event.clientX / zoom, event.clientY / zoom);
      const domRect = Rectangle.fromDOM(elem);
      const { marginTop, marginBottom } = getCollapsedMargins(elem);
      const rect = domRect.generateNewRect({
        bottom: domRect.bottom + marginBottom,
        left: anchorElementRect.left,
        right: anchorElementRect.right,
        top: domRect.top - marginTop,
      });

      const {
        result,
        reason: { isOnTopSide, isOnBottomSide },
      } = rect.contains(point) as PointContainResult;

      if (result) {
        blockElem = elem;
        prevIndex = index;
        break;
      }

      if (useEdgeAsDefault && !isOnTopSide && !isOnBottomSide) {
        // Drag handle can be slightly outside text box on the horizontal axis.
        // In drag mode, prioritize vertical proximity to keep target line visible.
        blockElem = elem;
        prevIndex = index;
        break;
      }

      if (direction === Indeterminate) {
        if (isOnTopSide) {
          direction = Upward;
        } else if (isOnBottomSide) {
          direction = Downward;
        } else {
          // Stop searching if pointer is neither above nor below current block.
          direction = Infinity;
        }
      }

      index += direction;
    }
  });

  return blockElem;
}

export function setMenuPosition(
  targetElem: HTMLElement | null,
  floatingElem: HTMLElement,
  anchorElem: HTMLElement,
): void {
  if (!targetElem) {
    floatingElem.style.opacity = '0';
    floatingElem.style.transform = 'translate(-10000px, -10000px)';
    return;
  }

  const targetRect = targetElem.getBoundingClientRect();
  const targetStyle = window.getComputedStyle(targetElem);
  const floatingElemRect = floatingElem.getBoundingClientRect();
  const anchorElementRect = anchorElem.getBoundingClientRect();
  const top =
    targetRect.top + (parseInt(targetStyle.lineHeight, 10) - floatingElemRect.height) / 2 - anchorElementRect.top;
  const left = SPACE;

  floatingElem.style.opacity = '1';
  floatingElem.style.transform = `translate(${left}px, ${top}px)`;
}

export function setDragImage(dataTransfer: DataTransfer, draggableBlockElem: HTMLElement): void {
  const { transform } = draggableBlockElem.style;

  // Remove dragImage borders.
  draggableBlockElem.style.transform = 'translateZ(0)';
  dataTransfer.setDragImage(draggableBlockElem, 0, 0);

  setTimeout(() => {
    draggableBlockElem.style.transform = transform;
  });
}

export function setTargetLine(
  targetLineElem: HTMLElement,
  targetBlockElem: HTMLElement,
  mouseY: number,
  anchorElem: HTMLElement,
): void {
  const { top: targetBlockElemTop, height: targetBlockElemHeight } = targetBlockElem.getBoundingClientRect();
  const { top: anchorTop, width: anchorWidth } = anchorElem.getBoundingClientRect();
  const { marginTop, marginBottom } = getCollapsedMargins(targetBlockElem);

  let lineTop = targetBlockElemTop;

  if (shouldInsertAfterBlock(mouseY, targetBlockElemTop, targetBlockElemHeight)) {
    lineTop += targetBlockElemHeight + marginBottom / 2;
  } else {
    lineTop -= marginTop / 2;
  }

  const top = lineTop - anchorTop - TARGET_LINE_HALF_HEIGHT;
  const left = TEXT_BOX_HORIZONTAL_PADDING - SPACE;

  targetLineElem.style.transform = `translate(${left}px, ${top}px)`;
  targetLineElem.style.width = `${anchorWidth - (TEXT_BOX_HORIZONTAL_PADDING - SPACE) * 2}px`;
  targetLineElem.style.opacity = '.4';
}

export function shouldInsertAfterBlock(pointerY: number, targetTop: number, targetHeight: number): boolean {
  return pointerY >= targetTop + targetHeight / 2;
}

export function hideTargetLine(targetLineElem: HTMLElement | null): void {
  if (targetLineElem) {
    targetLineElem.style.opacity = '0';
    targetLineElem.style.transform = 'translate(-10000px, -10000px)';
  }
}
