import { etWallTimeMs } from "./calendar";
import { atr14 } from "./compute";
import { jst, siteUrl, type AlertItem } from "./alerts";
import { finalBars } from "./alerts-entry";
import type { Holding } from "./holdings";
import { isIgnoredTicker } from "./holdings";
import type { Bar } from "./types";

/**
 * First session of the run of final closes under the line that ends on the latest bar.
 * Null when the latest close is at or above the line. Read from the bars, so no state is kept
 * and the id stays the same until the price closes back above the line. `ongoing` means the run
 * covers every stored bar, so its real start is older than the data and must not anchor the id.
 */
export function reviewBreakStart(bars: Bar[], line: number): { start: string; days: number; ongoing: boolean } | null {
  let start: string | null = null;
  let days = 0;
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    if (!(bars[i].c < line)) break;
    start = bars[i].date;
    days += 1;
  }
  return start ? { start, days, ongoing: days === bars.length } : null;
}

/** Holdings closing under their review line. Built only for an authenticated caller. */
export function reviewAlerts(holdings: Holding[], series: Record<string, Bar[] | undefined>, now: Date): AlertItem[] {
  const out: AlertItem[] = [];
  for (const holding of holdings) {
    if (holding.reviewLine == null || isIgnoredTicker(holding.ticker)) continue;
    const raw = series[holding.ticker];
    if (!raw?.length) continue;
    const bars = finalBars(raw, now);
    const last = bars.at(-1);
    const run = reviewBreakStart(bars, holding.reviewLine);
    if (!last || !run) continue;
    const atr = atr14(bars);
    const gap = last.c - holding.reviewLine;
    const eventAt = new Date(etWallTimeMs(last.date, 16 * 60)).toISOString();
    out.push({
      id: `review:${holding.ticker}:${run.ongoing ? `${holding.reviewLine}-ongoing` : run.start}`,
      kind: "review_break",
      priority: "high",
      ticker: holding.ticker,
      title: `${holding.ticker} 終値が見直しライン $${holding.reviewLine.toFixed(2)} を下回った（${run.days}日${run.ongoing ? "以上" : "目"}）`,
      body: [
        `終値 $${last.c.toFixed(2)}（${last.date}）/ ライン比 ${((gap / last.c) * 100).toFixed(1)}%${atr ? `・${(gap / atr).toFixed(1)} ATR` : ""}`,
        `${run.ongoing ? `${run.start} より前` : run.start} の終値から下回っている。売買は自分で判断する`,
      ].join("\n"),
      eventAt,
      eventAtJst: jst(eventAt),
      url: siteUrl("/holdings"),
      flags: [],
      facts: { breakStart: run.ongoing ? null : run.start, days: run.days, close: last.c, barDate: last.date, reviewLine: holding.reviewLine },
    });
  }
  return out;
}
