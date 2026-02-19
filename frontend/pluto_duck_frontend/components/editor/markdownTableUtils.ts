export interface ParsedMarkdownTable {
  hasHeader: boolean;
  columns: string[];
  rows: string[][];
}

const SEPARATOR_CELL_REGEXP = /^:?-{3,}:?$/;

function parseRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return null;
  }

  const cells = trimmed
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());

  if (cells.length === 0) {
    return null;
  }

  return cells;
}

function normalizeRow(cells: string[], targetLength: number): string[] {
  if (cells.length === targetLength) {
    return [...cells];
  }
  if (cells.length > targetLength) {
    return cells.slice(0, targetLength);
  }
  return [...cells, ...Array.from({ length: targetLength - cells.length }, () => '')];
}

export function parseMarkdownTable(markdown: string): ParsedMarkdownTable | null {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return null;
  }

  const headerCells = parseRow(lines[0]);
  const secondLineCells = parseRow(lines[1]);
  const hasSeparator =
    headerCells !== null &&
    secondLineCells !== null &&
    headerCells.length === secondLineCells.length &&
    secondLineCells.every((cell) => SEPARATOR_CELL_REGEXP.test(cell));

  if (hasSeparator && headerCells !== null) {
    const columnCount = headerCells.length;
    const rows: string[][] = [];

    for (const line of lines.slice(2)) {
      const cells = parseRow(line);
      if (cells === null) {
        return null;
      }
      rows.push(normalizeRow(cells, columnCount));
    }

    return {
      hasHeader: true,
      columns: normalizeRow(headerCells, columnCount),
      rows,
    };
  }

  const rows: string[][] = [];
  for (const line of lines) {
    const cells = parseRow(line);
    if (cells === null) {
      return null;
    }
    rows.push(cells);
  }

  const columnCount = rows[0]?.length ?? 0;
  if (columnCount === 0) {
    return null;
  }

  if (rows.some((row) => row.length !== columnCount)) {
    return null;
  }

  return {
    hasHeader: false,
    columns: [],
    rows: rows.map((row) => normalizeRow(row, columnCount)),
  };
}

function formatRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

export function buildMarkdownTable(
  columns: string[],
  rows: string[][],
  hasHeader: boolean,
): string {
  if (hasHeader) {
    const columnCount = columns.length;
    if (columnCount === 0) {
      return '';
    }

    const headerLine = formatRow(normalizeRow(columns, columnCount));
    const separatorLine = formatRow(Array.from({ length: columnCount }, () => '---'));
    const rowLines = rows.map((row) => formatRow(normalizeRow(row, columnCount)));
    return [headerLine, separatorLine, ...rowLines].join('\n');
  }

  const columnCount = rows[0]?.length ?? 0;
  if (columnCount === 0) {
    return '';
  }

  return rows
    .map((row) => formatRow(normalizeRow(row, columnCount)))
    .join('\n');
}
