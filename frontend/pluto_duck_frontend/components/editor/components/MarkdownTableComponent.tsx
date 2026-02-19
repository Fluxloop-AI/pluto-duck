'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, NodeKey } from 'lexical';

import { buildMarkdownTable, parseMarkdownTable, type ParsedMarkdownTable } from '../markdownTableUtils';
import { $isMarkdownTableNode } from '../nodes/MarkdownTableNode';

interface MarkdownTableComponentProps {
  markdown: string;
  nodeKey: NodeKey;
}

type TableState = ParsedMarkdownTable;

function cloneTableState(state: TableState): TableState {
  return {
    hasHeader: state.hasHeader,
    columns: [...state.columns],
    rows: state.rows.map((row) => [...row]),
  };
}

function buildCellKey(rowIndex: number, columnIndex: number): string {
  return `r:${rowIndex}:c:${columnIndex}`;
}

function buildHeaderKey(columnIndex: number): string {
  return `h:${columnIndex}`;
}

function getCellValue(state: TableState, key: string): string | null {
  if (key.startsWith('h:')) {
    const columnIndex = Number(key.slice(2));
    if (Number.isNaN(columnIndex)) {
      return null;
    }
    return state.columns[columnIndex] ?? '';
  }

  const match = /^r:(\d+):c:(\d+)$/.exec(key);
  if (!match) {
    return null;
  }

  const rowIndex = Number(match[1]);
  const columnIndex = Number(match[2]);
  if (Number.isNaN(rowIndex) || Number.isNaN(columnIndex)) {
    return null;
  }

  return state.rows[rowIndex]?.[columnIndex] ?? '';
}

function updateCellValue(state: TableState, key: string, nextValue: string): TableState {
  const next = cloneTableState(state);
  if (key.startsWith('h:')) {
    const columnIndex = Number(key.slice(2));
    if (!Number.isNaN(columnIndex) && next.columns[columnIndex] !== undefined) {
      next.columns[columnIndex] = nextValue;
    }
    return next;
  }

  const match = /^r:(\d+):c:(\d+)$/.exec(key);
  if (!match) {
    return next;
  }

  const rowIndex = Number(match[1]);
  const columnIndex = Number(match[2]);
  if (
    Number.isNaN(rowIndex) ||
    Number.isNaN(columnIndex) ||
    next.rows[rowIndex]?.[columnIndex] === undefined
  ) {
    return next;
  }

  next.rows[rowIndex][columnIndex] = nextValue;
  return next;
}

export function MarkdownTableComponent({ markdown, nodeKey }: MarkdownTableComponentProps) {
  const [editor] = useLexicalComposerContext();
  const parsedFromMarkdown = useMemo(() => parseMarkdownTable(markdown), [markdown]);
  const [tableState, setTableState] = useState<TableState>(() => {
    return parsedFromMarkdown ?? { hasHeader: false, columns: [], rows: [] };
  });

  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const activeCellKeyRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const tableStateRef = useRef<TableState>(tableState);

  useEffect(() => {
    tableStateRef.current = tableState;
  }, [tableState]);

  useEffect(() => {
    if (!parsedFromMarkdown) {
      return;
    }
    if (activeCellKeyRef.current) {
      return;
    }
    setTableState(cloneTableState(parsedFromMarkdown));
  }, [parsedFromMarkdown]);

  useEffect(() => {
    cellRefs.current.forEach((element, key) => {
      const nextValue = getCellValue(tableState, key);
      if (nextValue === null) {
        return;
      }
      if (document.activeElement === element) {
        return;
      }
      if (element.innerText !== nextValue) {
        element.innerText = nextValue;
      }
    });
  }, [tableState]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const persistNodeMarkdown = useCallback(
    (nextState: TableState) => {
      const nextMarkdown = buildMarkdownTable(
        nextState.columns,
        nextState.rows,
        nextState.hasHeader,
      );

      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isMarkdownTableNode(node)) {
          node.setMarkdown(nextMarkdown);
        }
      });
    },
    [editor, nodeKey],
  );

  const schedulePersist = useCallback(
    (nextState: TableState) => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        persistNodeMarkdown(nextState);
      }, 250);
    },
    [persistNodeMarkdown],
  );

  const flushPersist = useCallback(
    (nextState: TableState) => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      persistNodeMarkdown(nextState);
    },
    [persistNodeMarkdown],
  );

  const registerCellRef = useCallback(
    (key: string) => {
      return (element: HTMLTableCellElement | null) => {
        if (element) {
          cellRefs.current.set(key, element);
          const value = getCellValue(tableStateRef.current, key);
          if (value !== null && element.innerText !== value) {
            element.innerText = value;
          }
          return;
        }
        cellRefs.current.delete(key);
      };
    },
    [],
  );

  const onCellInput = useCallback(
    (key: string, nextText: string) => {
      setTableState((prevState) => {
        const nextState = updateCellValue(prevState, key, nextText);
        schedulePersist(nextState);
        return nextState;
      });
    },
    [schedulePersist],
  );

  const onCellBlur = useCallback(() => {
    activeCellKeyRef.current = null;
    flushPersist(tableStateRef.current);
  }, [flushPersist]);

  const handlePlainTextPaste = useCallback((event: React.ClipboardEvent<HTMLElement>) => {
    event.preventDefault();
    const pastedText = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, pastedText);
  }, []);

  if (tableState.columns.length === 0 && tableState.rows.length === 0) {
    return <div className="whitespace-pre-wrap">{markdown}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table>
        {tableState.hasHeader && (
          <thead>
            <tr>
              {tableState.columns.map((column, columnIndex) => {
                const cellKey = buildHeaderKey(columnIndex);
                return (
                  <th
                    key={cellKey}
                    ref={registerCellRef(cellKey)}
                    contentEditable={true}
                    suppressContentEditableWarning={true}
                    onFocus={() => {
                      activeCellKeyRef.current = cellKey;
                    }}
                    onInput={(event) => {
                      onCellInput(cellKey, event.currentTarget.innerText);
                    }}
                    onBlur={onCellBlur}
                    onPaste={handlePlainTextPaste}
                    data-table-column={columnIndex}
                  >
                    {column}
                  </th>
                );
              })}
            </tr>
          </thead>
        )}
        <tbody>
          {tableState.rows.map((row, rowIndex) => {
            return (
              <tr key={`row-${rowIndex}`}>
                {row.map((cell, columnIndex) => {
                  const cellKey = buildCellKey(rowIndex, columnIndex);
                  return (
                    <td
                      key={cellKey}
                      ref={registerCellRef(cellKey)}
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      onFocus={() => {
                        activeCellKeyRef.current = cellKey;
                      }}
                      onInput={(event) => {
                        onCellInput(cellKey, event.currentTarget.innerText);
                      }}
                      onBlur={onCellBlur}
                      onPaste={handlePlainTextPaste}
                      data-table-row={rowIndex}
                      data-table-column={columnIndex}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
