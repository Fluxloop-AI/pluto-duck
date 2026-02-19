export type ResolvedCalloutType = 'info' | 'warning' | 'success' | 'error';

export const HORIZONTAL_RULE_REGEXP = /^(---|\*\*\*|___)\s?$/;

const CALLOUT_TYPE_BY_MARKER: Record<string, ResolvedCalloutType> = {
  NOTE: 'info',
  IMPORTANT: 'info',
  WARNING: 'warning',
  TIP: 'success',
  CAUTION: 'error',
};

export const CALLOUT_INLINE_REGEXP = /^>\s*\[!(NOTE|WARNING|TIP|IMPORTANT|CAUTION)\]\s*(.*)$/i;

export const CALLOUT_BLOCK_START_REGEXP = /^>\s*\[!(NOTE|WARNING|TIP|IMPORTANT|CAUTION)\]\s*$/i;

export function resolveCalloutType(marker: string | undefined): ResolvedCalloutType | undefined {
  const normalized = marker?.toUpperCase();
  if (!normalized) {
    return undefined;
  }
  return CALLOUT_TYPE_BY_MARKER[normalized];
}

export function stripCalloutQuotePrefix(line: string): string {
  return line.replace(/^>\s?/, '').trimEnd();
}
