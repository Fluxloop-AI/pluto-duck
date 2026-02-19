export interface SlashFilterOption {
  title: string;
  keywords: ReadonlyArray<string>;
}

export function filterSlashOptionsByQuery<T extends SlashFilterOption>(
  options: T[],
  queryString: string | null
): T[] {
  const raw = (queryString || '').trim().toLowerCase();
  if (!raw) return options;

  const scored: Array<{ option: T; score: number }> = [];

  for (const option of options) {
    const title = option.title.toLowerCase();
    const keywords = option.keywords.map((keyword) => keyword.toLowerCase());

    // Prefer prefix matches, then fallback to contains.
    let score = -1;
    if (title.startsWith(raw)) score = 300;
    else if (keywords.some((keyword) => keyword.startsWith(raw))) score = 200;
    else if (title.includes(raw)) score = 100;
    else if (keywords.some((keyword) => keyword.includes(raw))) score = 50;

    if (score >= 0) {
      scored.push({ option, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.option);
}
