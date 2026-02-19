export function getDisplayTabTitle(name: string): string {
  if (name.trim().length === 0) {
    return 'Untitled';
  }

  return name;
}

export function formatBoardUpdatedAt(updatedAt: string | null | undefined): string | null {
  if (!updatedAt) {
    return null;
  }

  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
