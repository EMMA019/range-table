import {
  ATR_TARGET_DOLLARS,
  ATR_WINDOW,
  BOX_WINDOW,
  CHART_SESSIONS,
  GAP_THRESHOLD,
  MA_SLOPE_LOOKBACK,
  REBOUND_SESSIONS,
} from "./constants";
import type { Bar, ChartBar, Quote } from "./types";

export type QuoteResult =
  | { ok: true; quote: Quote }
  | { ok: false; error: string };

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * 14-day ATR as the simple average of the last 14 true ranges.
 * (The team's morning sheet matches this, not Wilder smoothing.)
 */
export function atr14(bars: Bar[]): number | null {
  if (bars.length < ATR_WINDOW + 1) return null;
  let sum = 0;
  const start = bars.length - ATR_WINDOW;
  for (let i = start; i < bars.length; i++) {
    const bar = bars[i];
    const prevClose = bars[i - 1].c;
    const tr = Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - prevClose),
      Math.abs(bar.l - prevClose),
    );
    sum += tr;
  }
  return sum / ATR_WINDOW;
}

export function hasLargeGap(bars: Bar[]): boolean {
  const start = Math.max(1, bars.length - BOX_WINDOW);
  for (let i = start; i < bars.length; i++) {
    const prev = bars[i - 1].c;
    if (!(prev > 0)) continue;
    if (Math.abs(bars[i].c / prev - 1) >= GAP_THRESHOLD) return true;
  }
  return false;
}

/**
 * Box = last 20 completed daily bars, including the latest close.
 * 上抜け = latest close is above the high of the 20 bars before that close.
 */
export function computeQuote(bars: Bar[]): QuoteResult {
  if (bars.length < BOX_WINDOW + 1) {
    return {
      ok: false,
      error: `確定日足が${bars.length}本で、20日の箱に足りない`,
    };
  }

  const last = bars[bars.length - 1];
  const window = bars.slice(-BOX_WINDOW);
  const prior = bars.slice(-(BOX_WINDOW + 1), -1);

  const ma20 = window.reduce((sum, bar) => sum + bar.c, 0) / BOX_WINDOW;
  const low20 = Math.min(...window.map((bar) => bar.l));
  const high20 = Math.max(...window.map((bar) => bar.h));
  const priorHigh20 = Math.max(...prior.map((bar) => bar.h));
  const range = high20 - low20;
  const boxPct = range <= 0 ? 0 : ((last.c - low20) / range) * 100;
  const devPct = ma20 === 0 ? 0 : ((last.c - ma20) / ma20) * 100;
  const atr = atr14(bars);
  if (atr == null) {
    return { ok: false, error: "ATRを計算できない" };
  }

  const guides = entryGuides(low20, high20);
  const close = round4(last.c);
  const atrRounded = round4(atr);
  const ten = sharesForMove(atrRounded, close);
  return {
    ok: true,
    quote: {
      close,
      closeDate: last.date,
      ma20: round4(ma20),
      devPct: round4(devPct),
      low20: round4(low20),
      high20: round4(high20),
      priorHigh20: round4(priorHigh20),
      boxPct: round4(boxPct),
      atr14: atrRounded,
      shares10: ten.shares10,
      cost10: ten.cost10,
      brokeHigh: last.c > priorHigh20,
      gapWarning: hasLargeGap(bars),
      maSlopePct: maSlopePct(bars),
      ...volumeStats(bars),
      line15: guides.line15,
      line25: guides.line25,
      reboundDays: reboundDays(bars),
    },
  };
}

/** Shares so one ATR move is worth about $10, and what those shares cost at the close. */
export function sharesForMove(
  atr: number | null | undefined,
  close: number | null | undefined,
  dollars = ATR_TARGET_DOLLARS,
): { shares10: number | null; cost10: number | null } {
  if (
    atr == null ||
    close == null ||
    !Number.isFinite(atr) ||
    !Number.isFinite(close) ||
    !(atr > 0) ||
    !(close > 0) ||
    !(dollars > 0)
  ) {
    return { shares10: null, cost10: null };
  }
  const shares10 = Math.ceil(Number((dollars / atr).toFixed(8)));
  const cost10 = Math.round(shares10 * close * 100) / 100;
  return { shares10, cost10 };
}

/** 15% and 25% of the same 20-day high-low box used for box position. */
export function entryGuides(low20: number, high20: number): { line15: number; line25: number } {
  const range = high20 - low20;
  return {
    line15: round4(low20 + 0.15 * range),
    line25: round4(low20 + 0.25 * range),
  };
}

/**
 * Consecutive bullish candles (close above open) after the most recent 20-day low.
 * Returns 0 when that low is the latest bar, and null when the low is outside the
 * last 10 sessions or a later candle is not bullish.
 */
export function reboundDays(bars: Bar[]): number | null {
  const window = bars.slice(-BOX_WINDOW);
  if (window.length < BOX_WINDOW) return null;
  let low = window[0].l;
  for (const bar of window) {
    if (bar.l < low) low = bar.l;
  }
  let lowIndex = 0;
  for (let i = 0; i < window.length; i++) {
    if (window[i].l === low) lowIndex = i;
  }
  const last = window[window.length - 1];
  if (lowIndex === window.length - 1 || last.c === low) return 0;
  if (lowIndex < window.length - REBOUND_SESSIONS) return null;
  let days = 0;
  for (let i = lowIndex + 1; i < window.length; i++) {
    if (!(window[i].c > window[i].o)) return null;
    days += 1;
  }
  return days > 0 ? days : null;
}

/** Latest volume against the prior 20 completed bars, which are excluded from the average. */
export function volumeStats(bars: Bar[]): {
  volume: number | null;
  avgVolume20: number | null;
  volumeRatio: number | null;
  avgDollarVolume20: number | null;
} {
  const empty = { volume: null, avgVolume20: null, volumeRatio: null, avgDollarVolume20: null };
  if (bars.length < BOX_WINDOW + 1) return empty;
  const last = bars[bars.length - 1];
  const prior = bars.slice(-(BOX_WINDOW + 1), -1);
  if (!Number.isFinite(last.v) || prior.some((bar) => !Number.isFinite(bar.v) || !Number.isFinite(bar.c))) {
    return empty;
  }
  const avgVolume20 = prior.reduce((sum, bar) => sum + bar.v, 0) / BOX_WINDOW;
  const avgDollarVolume20 = prior.reduce((sum, bar) => sum + bar.c * bar.v, 0) / BOX_WINDOW;
  return {
    volume: Math.round(last.v),
    avgVolume20: round4(avgVolume20),
    volumeRatio: avgVolume20 > 0 ? round4(last.v / avgVolume20) : null,
    avgDollarVolume20: round4(avgDollarVolume20),
  };
}

/** (SMA today / SMA 5 trading days ago − 1) in percent. Needs 25 completed closes. */
export function maSlopePct(bars: Bar[]): number | null {
  if (bars.length < BOX_WINDOW + MA_SLOPE_LOOKBACK) return null;
  const sma = (end: number) => {
    let sum = 0;
    for (let i = end - BOX_WINDOW; i < end; i++) sum += bars[i].c;
    return sum / BOX_WINDOW;
  };
  const today = sma(bars.length);
  const prior = sma(bars.length - MA_SLOPE_LOOKBACK);
  if (!(prior > 0) || !Number.isFinite(today)) return null;
  return round4((today / prior - 1) * 100);
}

export function chartPoints(bars: Bar[], sessions = CHART_SESSIONS): ChartBar[] {
  const start = Math.max(0, bars.length - sessions);
  const points: ChartBar[] = [];
  for (let i = start; i < bars.length; i++) {
    let ma20: number | null = null;
    if (i >= BOX_WINDOW - 1) {
      let sum = 0;
      for (let k = i - (BOX_WINDOW - 1); k <= i; k++) sum += bars[k].c;
      ma20 = sum / BOX_WINDOW;
    }
    const bar = bars[i];
    points.push({
      date: bar.date,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      ma20,
    });
  }
  return points;
}
