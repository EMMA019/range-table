import { BOX_WINDOW, MA_SLOPE_FLAT_PCT } from "./constants";
import type { Bar, Quote } from "./types";

export type DowntrendView = {
  active: boolean;
  /** Human-readable rule hit (Japanese). Null when inactive. */
  reason: string | null;
  /** Sessions from the latest bar to the last print of the 20-day low/high. */
  lowDaysAgo: number;
  highDaysAgo: number;
};

const EPS = 1e-6;

/**
 * Downtrend rule (swing / falling-knife guard):
 * 1) Three consecutive 5-session blocks (sessions −15..−11, −10..−6, −5..−1) each have
 *    strictly lower highs AND strictly lower lows than the block before (older → newer).
 * 2) 20-day MA slope is clearly down (≤ −MA_SLOPE_FLAT_PCT%, same threshold as the 下向き label).
 *
 * Needs at least 15 daily bars before the latest close, plus 25 for maSlopePct (checked upstream).
 */
export const DOWNTREND_REASON =
  "5日足×3で高値・安値切り下げ＋20日線下向き";

function blockHigh(bars: Bar[]): number {
  return Math.max(...bars.map((b) => b.h));
}

function blockLow(bars: Bar[]): number {
  return Math.min(...bars.map((b) => b.l));
}

/** Strictly descending highs and lows across three 5-bar blocks (oldest → newest). */
export function lowerHighsAndLows5x3(bars: Bar[]): boolean {
  if (bars.length < 15) return false;
  const tail = bars.slice(-15);
  const a = tail.slice(0, 5);
  const b = tail.slice(5, 10);
  const c = tail.slice(10, 15);
  const ha = blockHigh(a);
  const hb = blockHigh(b);
  const hc = blockHigh(c);
  const la = blockLow(a);
  const lb = blockLow(b);
  const lc = blockLow(c);
  return hc < hb && hb < ha && lc < lb && lb < la;
}

function sessionsAgo(bars: Bar[], sessionDate: string): number {
  const last = bars.length - 1;
  for (let i = last; i >= 0; i--) {
    if (bars[i].date === sessionDate) return last - i;
  }
  return last;
}

/** Last session in the 20-day window that printed this extreme (most recent touch). */
export function lastTouchInWindow(
  window: Bar[],
  extreme: number,
  field: "l" | "h",
): string {
  for (let i = window.length - 1; i >= 0; i--) {
    const v = field === "l" ? window[i].l : window[i].h;
    if (Math.abs(v - extreme) <= EPS) return window[i].date;
  }
  return window[window.length - 1].date;
}

export function boxExtremeAges(bars: Bar[], low20: number, high20: number): {
  lowDaysAgo: number;
  highDaysAgo: number;
} {
  const window = bars.slice(-BOX_WINDOW);
  const lowDate = lastTouchInWindow(window, low20, "l");
  const highDate = lastTouchInWindow(window, high20, "h");
  return {
    lowDaysAgo: sessionsAgo(bars, lowDate),
    highDaysAgo: sessionsAgo(bars, highDate),
  };
}

export function detectDowntrend(bars: Bar[], maSlopePct: number | null, low20: number, high20: number): DowntrendView {
  const ages = boxExtremeAges(bars, low20, high20);
  const maDown = maSlopePct != null && maSlopePct <= -MA_SLOPE_FLAT_PCT;
  const lhll = lowerHighsAndLows5x3(bars);
  const active = lhll && maDown;
  return {
    active,
    reason: active ? DOWNTREND_REASON : null,
    lowDaysAgo: ages.lowDaysAgo,
    highDaysAgo: ages.highDaysAgo,
  };
}

export function quoteDowntrendActive(quote: Quote | null | undefined): boolean {
  return quote?.downtrend.active === true;
}
