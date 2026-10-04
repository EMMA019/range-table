/** Prefer one listing when multiple share classes share a CIK (S&P may hold both). */
const PREFERRED_OVER: Record<string, string> = {
  GOOG: "GOOGL",
  FOXA: "FOX",
  NWSA: "NWS",
  UAA: "UA",
  LBTYK: "LBTYA",
  Z: "ZG",
};

export function preferredShareClassTicker(ticker: string): string {
  return PREFERRED_OVER[ticker.trim().toUpperCase()] ?? ticker.trim().toUpperCase();
}

/**
 * One CIK → one ticker in the eligible pool. Keeps higher `rank` (e.g. mcap) when tied.
 */
export function dedupeShareClassesByCik<T extends string>(
  tickers: T[],
  cikOf: (t: T) => number | null,
  rank: (t: T) => number,
): T[] {
  const best = new Map<number, T>();
  const noCik: T[] = [];
  for (const t of tickers) {
    const cik = cikOf(t);
    if (cik == null || cik <= 0) {
      noCik.push(t);
      continue;
    }
    const canon = preferredShareClassTicker(t) as T;
    const candidate = tickers.includes(canon) ? canon : t;
    const prev = best.get(cik);
    if (!prev || rank(candidate) > rank(prev)) best.set(cik, candidate);
  }
  const out = [...noCik, ...best.values()];
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}
