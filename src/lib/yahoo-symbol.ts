/**
 * Yahoo's chart path uses a hyphen for share classes (BRK-B), while the S&P list
 * still prints a dot (BRK.B). A 404 on the dotted form is what left index rows blank.
 */
export function yahooSymbol(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\./g, "-");
}

/** Dashed form first, then the raw symbol, then the dotted form. Duplicates dropped. */
export function yahooSymbolCandidates(ticker: string): string[] {
  const raw = ticker.trim().toUpperCase();
  const dashed = raw.replace(/\./g, "-");
  const dotted = raw.replace(/-/g, ".");
  return [...new Set([dashed, raw, dotted])];
}
