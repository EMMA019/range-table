import type { Bar } from "./types";
import { forwardShareMultiplier, loadPitSplits, nominalCloseFromAdjusted, type PitSplit } from "./pit-splits";
import { sharesOutstandingPit } from "./pit-shares";

function priorCalendarDate(asOf: string, daysBack: number): string {
  const t = Date.parse(`${asOf}T12:00:00Z`) - daysBack * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function barOnOrBefore(bars: Bar[], date: string): Bar | null {
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
  return best;
}

/** Nominal close aligned with EDGAR share count after forward split adjustment. */
export function nominalMcapClose(bar: Bar, splits: PitSplit[]): number | null {
  if (!bar || !(bar.c > 0)) return null;
  const fromC = nominalCloseFromAdjusted(bar.c, bar.date, splits);
  if (bar.mcapC != null && bar.mcapC > 0) {
    const ratio = bar.mcapC / fromC;
    if (ratio > 0.55 && ratio < 1.8) return bar.mcapC;
  }
  return fromC > 0 ? fromC : null;
}

export function pitMarketCapAtDate(
  bars: Bar[],
  facts: unknown | undefined,
  asOf: string,
  splits?: PitSplit[],
): number {
  const bar = barOnOrBefore(bars, asOf);
  if (!bar) return 0;
  const pit = facts ? sharesOutstandingPit(facts, asOf) : null;
  if (!pit || pit.shares <= 0) return 0;
  const sp = splits ?? [];
  const fwd = forwardShareMultiplier(sp, pit.factEnd, asOf);
  const inflate = nominalCloseFromAdjusted(bar.c, bar.date, sp) / bar.c;
  let sh = pit.shares;
  const prior = facts ? sharesOutstandingPit(facts, priorCalendarDate(asOf, 120)) : null;
  if (
    prior &&
    prior.shares > 0 &&
    sh / prior.shares > 4 &&
    inflate > 3 &&
    fwd < inflate * 0.5
  ) {
    sh /= inflate;
  } else {
    sh *= fwd;
    if (fwd < 1.5 && inflate > 1.2) sh *= inflate;
  }
  return bar.c * sh;
}

export function pitMarketCapForTicker(
  ticker: string,
  bars: Bar[],
  facts: unknown | undefined,
  asOf: string,
  root?: string,
): number {
  const splits = loadPitSplits(ticker, root);
  return pitMarketCapAtDate(bars, facts, asOf, splits);
}

/** Flag mcap change > threshold between consecutive sessions (split misalignment). */
export function detectMcapJump(
  bars: Bar[],
  facts: unknown | undefined,
  splits: PitSplit[],
  threshold = 0.4,
): Array<{ from: string; to: string; ratio: number }> {
  const out: Array<{ from: string; to: string; ratio: number }> = [];
  for (let i = 1; i < bars.length; i += 1) {
    const d0 = bars[i - 1].date;
    const d1 = bars[i].date;
    const m0 = pitMarketCapAtDate(bars, facts, d0, splits);
    const m1 = pitMarketCapAtDate(bars, facts, d1, splits);
    if (!(m0 > 0) || !(m1 > 0)) continue;
    const ratio = m1 / m0;
    if (ratio > 1 + threshold || ratio < 1 - threshold) out.push({ from: d0, to: d1, ratio });
  }
  return out;
}
