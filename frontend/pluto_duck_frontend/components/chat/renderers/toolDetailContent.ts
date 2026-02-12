import type { ToolItem } from '../../../types/chatRenderItem';

export type ToolDetailRowKind = 'input' | 'output' | 'error';
export type ToolDetailRenderMode = 'plain' | 'code';

export interface ToolDetailRow {
  key: string;
  childId: string;
  kind: ToolDetailRowKind;
  content: string;
  variant: 'default' | 'error';
  renderMode: ToolDetailRenderMode;
  language?: 'json';
}

export interface ToolDetailDividerEntry {
  type: 'divider';
  key: string;
}

export type ToolDetailRenderEntry = ToolDetailRow | ToolDetailDividerEntry;

type ToolDetailChild = Pick<ToolItem, 'id' | 'input' | 'output' | 'error'>;

export function serializeToolDetailContent(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'object'
  ) {
    try {
      return JSON.stringify(value, null, 2) ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

export function extractToolMessageContent(output: unknown): unknown {
  if (output == null) {
    return null;
  }

  if (typeof output === 'object') {
    const toolMessage = output as { content?: unknown };
    if (toolMessage.content !== undefined) {
      return toolMessage.content;
    }
  }

  return output;
}

export function buildToolDetailRowsForChild(child: ToolDetailChild): ToolDetailRow[] {
  const rows: ToolDetailRow[] = [];
  const inputContent = serializeToolDetailContent(child.input);

  if (inputContent !== null) {
    rows.push({
      key: `${child.id}-input`,
      childId: child.id,
      kind: 'input',
      content: inputContent,
      variant: 'default',
      renderMode: 'code',
      language: 'json',
    });
  }

  const errorContent =
    typeof child.error === 'string' && child.error.trim().length > 0
      ? child.error
      : null;

  if (errorContent !== null) {
    rows.push({
      key: `${child.id}-error`,
      childId: child.id,
      kind: 'error',
      content: errorContent,
      variant: 'error',
      renderMode: 'plain',
    });
    return rows;
  }

  const outputContent = serializeToolDetailContent(
    extractToolMessageContent(child.output)
  );

  if (outputContent !== null) {
    rows.push({
      key: `${child.id}-output`,
      childId: child.id,
      kind: 'output',
      content: outputContent,
      variant: 'default',
      renderMode: 'code',
      language: 'json',
    });
  }

  return rows;
}

export function buildToolDetailRowsForChildren(
  children: ToolDetailChild[]
): ToolDetailRow[] {
  return children.flatMap(buildToolDetailRowsForChild);
}

export function buildToolDetailEntriesForChildren(
  children: ToolDetailChild[]
): ToolDetailRenderEntry[] {
  const rows = buildToolDetailRowsForChildren(children);
  const entries: ToolDetailRenderEntry[] = [];

  rows.forEach((row, index) => {
    if (index > 0) {
      entries.push({
        type: 'divider',
        key: `${rows[index - 1]?.key}-to-${row.key}`,
      });
    }
    entries.push(row);
  });

  return entries;
}
