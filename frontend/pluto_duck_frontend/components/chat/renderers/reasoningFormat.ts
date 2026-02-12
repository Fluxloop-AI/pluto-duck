function getFenceMarker(line: string): '`' | '~' | null {
  const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
  if (!fenceMatch) return null;
  return fenceMatch[1].startsWith('`') ? '`' : '~';
}

export function formatReasoningContent(text: string): string {
  const lines = text.split('\n');
  const formattedLines: string[] = [];
  let openFenceMarker: '`' | '~' | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMarker = getFenceMarker(line);

    if (fenceMarker) {
      if (openFenceMarker === null) {
        openFenceMarker = fenceMarker;
      } else if (openFenceMarker === fenceMarker) {
        openFenceMarker = null;
      }
      formattedLines.push(line);
      continue;
    }

    if (openFenceMarker !== null) {
      formattedLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^\*\*(.+?)\*\*$/);
    const normalizedLine = headingMatch ? `### ${headingMatch[1]}` : line;
    formattedLines.push(normalizedLine);

    if (/^### .+/.test(normalizedLine) && lines[index + 1] === '') {
      index += 1;
    }
  }

  return formattedLines.join('\n');
}
