import type { Bar } from "./types";

/** Close for PIT market-cap (nominal / not split-back-adjusted). Falls back to `c`. */
export function mcapCloseOnOrBefore(bars: Bar[], date: string): number | null {
  let lo = 0;
  let hi = bars.length - 1;
  let best: Bar | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) {
      best = bars[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (!best) return null;
  const px = best.mcapC ?? best.c;
  return px > 0 ? px : null;
}

export function barMcapClose(bar: Bar): number {
  const px = bar.mcapC ?? bar.c;
  return px;
}
