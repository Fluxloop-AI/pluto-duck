export function normalizeWhiteTokenColors(html: string): string {
  return html.replace(
    /style=(['"])(.*?)\1/gi,
    (_match, quote: string, styleValue: string) => {
      const normalizedStyleValue = styleValue.replace(
        /(^|;)\s*color\s*:\s*(white|#(?:fff|ffffff))\b/gi,
        (_innerMatch, prefix: string) => `${prefix}color:#6B7280`
      );
      return `style=${quote}${normalizedStyleValue}${quote}`;
    }
  );
}
