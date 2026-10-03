import { SEMI_SLOT_CAP } from "./constants";
import { isIgnoredTicker } from "./holdings";

const SEMI_GROUPS = new Set(["semi", "equipment"]);

export function isSemiGroup(id: string): boolean {
  return SEMI_GROUPS.has(id);
}

/** Tickers in the semiconductor or equipment watchlist groups. */
export function semiTickerSet(groups: readonly { id: string; tickers: readonly { ticker: string }[] }[]): Set<string> {
  const out = new Set<string>();
  for (const group of groups) {
    if (!isSemiGroup(group.id)) continue;
    for (const ticker of group.tickers) out.add(ticker.ticker);
  }
  return out;
}

/** True when holdings already include `SEMI_SLOT_CAP` distinct semiconductor or equipment names. ONDS does not count. */
export function semiSlotsFull(
  holdings: readonly { ticker: string }[],
  semis: ReadonlySet<string>,
  cap = SEMI_SLOT_CAP,
): boolean {
  const held = new Set<string>();
  for (const holding of holdings) {
    if (isIgnoredTicker(holding.ticker)) continue;
    if (semis.has(holding.ticker)) held.add(holding.ticker);
  }
  return held.size >= cap;
}
