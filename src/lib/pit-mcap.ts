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

/** Detect Stooq/wrong-symbol rows (e.g. VIAC/PARA with c≈80k but mcapC≈10). */
export function barCloseLooksCorrupt(bar: Bar): boolean {
  if (!bar || !(bar.c > 0)) return true;
  if (bar.mcapC != null && bar.mcapC > 0) {
    const ratio = bar.c / bar.mcapC;
    if (ratio > 50 || ratio < 1 / 50) return true;
  }
  if (bar.c > 5_000 && (bar.mcapC == null || bar.mcapC < 1)) return true;
  return false;
}

/** Nominal close aligned with EDGAR share count after forward split adjustment. */
export function nominalMcapClose(bar: Bar, splits: PitSplit[]): number | null {
  if (!bar || !(bar.c > 0)) return null;
  const fromC = nominalCloseFromAdjusted(bar.c, bar.date, splits);
  if (bar.mcapC != null && bar.mcapC > 0) {
    if (barCloseLooksCorrupt(bar)) return bar.mcapC;
    const ratio = bar.mcapC / fromC;
    if (ratio > 0.55 && ratio < 1.8) return bar.mcapC;
  }
  return fromC > 0 ? fromC : bar.mcapC != null && bar.mcapC > 0 ? bar.mcapC : null;
}

function priceFactorAllSplitsAfterBar(barDate: string, splits: PitSplit[]): number {
  let m = 1;
  for (const sp of splits) {
    if (sp.date > barDate) m *= sp.numerator / sp.denominator;
  }
  return m;
}

function priceFactorBarToAsOf(barDate: string, asOf: string, splits: PitSplit[]): number {
  return forwardShareMultiplier(splits, barDate, asOf);
}

function upcomingSplitInflate(barDate: string, asOf: string, splits: PitSplit[]): number {
  const end = new Date(Date.parse(`${asOf}T12:00:00Z`) + 400 * 86_400_000).toISOString().slice(0, 10);
  let m = 1;
  for (const sp of splits) {
    if (sp.date > asOf && sp.date <= end) m *= sp.numerator / sp.denominator;
  }
  return m;
}

/** Apply Yahoo split factors to EDGAR shares only when facts still use pre-split units. */
function sharesForMcap(facts: unknown, asOf: string, splits: PitSplit[]): number {
  const pit = sharesOutstandingPit(facts, asOf);
  if (!pit || pit.shares <= 0) return 0;
  const fwd = forwardShareMultiplier(splits, pit.factEnd, asOf);
  if (fwd <= 1.01) return pit.shares;
  const beforeSplit = priorCalendarDate(asOf, 120);
  const prior = sharesOutstandingPit(facts, beforeSplit);
  if (prior && prior.shares > 0) {
    const observed = pit.shares / prior.shares;
    if (observed >= fwd * 0.45) return pit.shares;
  }
  return pit.shares * fwd;
}

export function pitMarketCapAtDate(
  bars: Bar[],
  facts: unknown | undefined,
  asOf: string,
  splits?: PitSplit[],
): number {
  const bar = barOnOrBefore(bars, asOf);
  if (!bar) return 0;
  if (barCloseLooksCorrupt(bar) && !(bar.mcapC != null && bar.mcapC > 0)) return 0;
  if (!facts) return 0;
  const sp = splits ?? [];
  const px = nominalMcapClose(bar, sp);
  if (!px || px <= 0) return 0;
  const sh = sharesForMcap(facts, asOf, sp);
  if (sh <= 0) return 0;
  const pfAll = priceFactorAllSplitsAfterBar(bar.date, sp);
  const pfToAsOf = priceFactorBarToAsOf(bar.date, asOf, sp);
  const mNomRaw = px * sh;
  let mNominal = mNomRaw;
  const corrupt = barCloseLooksCorrupt(bar);
  const mAdj = corrupt ? 0 : bar.c * sh;
  const mAdjPf = corrupt ? 0 : bar.c * sh * pfAll;
  const upcoming = upcomingSplitInflate(bar.date, asOf, sp);
  if (
    mAdj > 1e9 &&
    upcoming > 1.5 &&
    pfAll < 5 &&
    pfToAsOf < 1.01 &&
    mNomRaw > mAdj * 2.2 &&
    mNomRaw / mAdj < upcoming * 1.05 &&
    mNomRaw <= mAdj * (upcoming * 1.25)
  ) {
    return mAdj;
  }
  if (
    mAdj > 1e9 &&
    mAdj < 200e9 &&
    mNomRaw > mAdj * 4 &&
    upcoming > 1.5 &&
    pfToAsOf < 1.01
  ) {
    return mAdj;
  }
  if (
    upcoming < 1.5 &&
    pfAll > 3 &&
    pfToAsOf < 1.01 &&
    mAdjPf > 1e9 &&
    mNomRaw > (mAdj > 0 ? mAdj * 3 : 0)
  ) {
    return (mNomRaw + mAdjPf) / 2;
  }
  if (mAdj > 0 && mNominal > mAdj * 2.5) mNominal = 0;
  const candidates = [mNominal, mAdj, mAdjPf].filter((m) => m > 1e9 && m < 4e12).sort((a, b) => a - b);
  if (!candidates.length) return 0;
  for (let i = candidates.length - 1; i >= 1; i -= 1) {
    for (let j = i - 1; j >= 0; j -= 1) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (a / b < 1.18) return (a + b) / 2;
    }
  }
  return candidates[Math.floor(candidates.length / 2)]!;
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
