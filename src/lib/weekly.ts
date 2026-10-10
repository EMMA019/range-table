import { ALERT_MIN_ATR_PCT, BOX_WINDOW, CORR_LOW_MAX, EARNINGS_WARN_DAYS } from "./constants";
import { boxShown, formatBox, formatDollar } from "./format";
import type { Bar, EarningsView, Quote, SoxxTag, WeeklyCall, WeeklyStats } from "./types";

/** Sessions in "this week" and in the one-week-ago box. */
export const WEEK_SESSIONS = 5;
/** Sparkline length. Each point is that day's own box position. */
export const SPARK_SESSIONS = 10;
/** Loss budget from the close down to the weekly stop. */
export const WEEKLY_RISK_USD = 15;
/** Shares are also capped so the position cost stays within this. */
export const WEEKLY_COST_CAP = 450;
/** Bottom slice of that day's 20-day box. */
const BOTTOM_FRACTION = 0.15;
/** 底で待ち when the shown box position is under this. */
const WAIT_BOX_PCT = 25;
/** Upper half of the week's high–low. */
const UPPER_HALF = 50;
/** Two-decimal SOXX correlation at or above this is 半導体・AI寄り. */
const SOXX_SEMI_MIN = 0.5;

const EPS = 1e-6;

export const WEEKLY_CALL = {
  rebound: "週内で底タッチ→反発",
  wait: "底で待ち",
  avoid: "安値更新＋20日線が下向き",
  earnings: "決算5営業日以内",
} as const satisfies Record<string, WeeklyCall>;

export const SOXX_TAG = {
  semi: "半導体・AI寄り",
  mid: "中間",
  low: "低相関",
} as const satisfies Record<string, SoxxTag>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 20-day box ending at `end` (exclusive). Uses only bars[0..end). */
function boxEnding(bars: Bar[], end: number): { low: number; high: number; line15: number; boxPct: number } | null {
  if (end < BOX_WINDOW || end > bars.length) return null;
  const window = bars.slice(end - BOX_WINDOW, end);
  let low = window[0].l;
  let high = window[0].h;
  for (const bar of window) {
    if (bar.l < low) low = bar.l;
    if (bar.h > high) high = bar.h;
  }
  const range = high - low;
  const close = window[window.length - 1].c;
  return {
    low,
    high,
    line15: low + BOTTOM_FRACTION * range,
    boxPct: range <= 0 ? 0 : ((close - low) / range) * 100,
  };
}

export function emptyWeekly(partial: Partial<WeeklyStats> = {}): WeeklyStats {
  return {
    boxPctPrev: null,
    boxPctSpark: [],
    weekChangePct: null,
    weekClosePos: null,
    upDays: null,
    touchedBottom: false,
    newLowLast: false,
    stop: 0,
    shares: 0,
    riskUsd: 0,
    atrPct: 0,
    narrowRange: true,
    reboundSetup: false,
    ...partial,
  };
}

/**
 * Weekly read of `bars`, which must already end on the latest completed session.
 * A day's box, touch, and low use only that day and earlier bars.
 */
export function weeklyStats(bars: Bar[], atr: number, close: number, line15: number): WeeklyStats {
  const blank = emptyWeekly();
  if (bars.length < BOX_WINDOW || !(close > 0) || !Number.isFinite(atr)) return blank;

  const last = bars[bars.length - 1];
  const current = boxEnding(bars, bars.length);
  if (!current) return blank;

  const spark: number[] = [];
  const sparkStart = Math.max(BOX_WINDOW, bars.length - (SPARK_SESSIONS - 1));
  for (let end = sparkStart; end <= bars.length; end++) {
    const box = boxEnding(bars, end);
    if (box) spark.push(round4(box.boxPct));
  }

  const prevEnd = bars.length - WEEK_SESSIONS;
  const prev = boxEnding(bars, prevEnd);

  let weekChangePct: number | null = null;
  let upDays: number | null = null;
  if (bars.length > WEEK_SESSIONS) {
    const priorClose = bars[bars.length - 1 - WEEK_SESSIONS].c;
    if (priorClose > 0) weekChangePct = round4((close / priorClose - 1) * 100);
    let ups = 0;
    for (let i = bars.length - WEEK_SESSIONS; i < bars.length; i++) {
      if (bars[i].c > bars[i - 1].c) ups += 1;
    }
    upDays = ups;
  }

  const week = bars.slice(-Math.min(WEEK_SESSIONS, bars.length));
  let weekLow = week[0].l;
  let weekHigh = week[0].h;
  for (const bar of week) {
    if (bar.l < weekLow) weekLow = bar.l;
    if (bar.h > weekHigh) weekHigh = bar.h;
  }
  const weekRange = weekHigh - weekLow;
  const weekClosePos = weekRange <= 0 ? 0 : round4(((close - weekLow) / weekRange) * 100);

  let touchedBottom = false;
  const weekFrom = Math.max(BOX_WINDOW, bars.length - WEEK_SESSIONS + 1);
  for (let end = weekFrom; end <= bars.length; end++) {
    const box = boxEnding(bars, end);
    const bar = bars[end - 1];
    if (box && bar.l <= box.line15 + EPS) touchedBottom = true;
  }

  const newLowLast = Math.abs(last.l - current.low) <= EPS;
  const stop = round4(current.low - 0.5 * atr);
  const perShare = close - stop;
  let shares = 0;
  if (perShare > 0) {
    const byRisk = Math.floor(WEEKLY_RISK_USD / perShare);
    const byCost = close > 0 ? Math.floor(WEEKLY_COST_CAP / close) : 0;
    shares = Math.max(0, Math.min(byRisk, byCost));
  }
  const riskUsd = shares > 0 ? round2(shares * perShare) : 0;
  const atrPct = round2((atr / close) * 100);
  const narrowRange = atrPct < ALERT_MIN_ATR_PCT;
  const upperHalf = boxShown(weekClosePos) >= UPPER_HALF;
  const reboundSetup =
    touchedBottom && close > line15 && upperHalf && !newLowLast && atrPct >= ALERT_MIN_ATR_PCT;

  return {
    boxPctPrev: prev ? round4(prev.boxPct) : null,
    boxPctSpark: spark,
    weekChangePct,
    weekClosePos,
    upDays,
    touchedBottom,
    newLowLast,
    stop,
    shares,
    riskUsd,
    atrPct,
    narrowRange,
    reboundSetup,
  };
}

/** 0.50以上 半導体・AI寄り、0.30以下 低相関、その間は中間。 Same rounding as the correlation figure. */
export function soxxCorrelationTag(corr: number | null): SoxxTag | null {
  if (corr == null || !Number.isFinite(corr)) return null;
  const shown = Math.round(corr * 100) / 100;
  if (shown >= SOXX_SEMI_MIN) return SOXX_TAG.semi;
  if (shown <= CORR_LOW_MAX) return SOXX_TAG.low;
  return SOXX_TAG.mid;
}

/** Next earnings strictly after today, inside 5 trading days. Today and past dates stay off this list. */
export function earningsBlocksWeeklyRebound(earnings: EarningsView | null): boolean {
  if (!earnings || earnings.state !== "upcoming") return false;
  return earnings.tradingDays != null && earnings.tradingDays <= EARNINGS_WARN_DAYS;
}

/**
 * One badge. A fresh 20-day low with a falling 20-day average wins.
 * The rebound badge drops off when earnings are inside 5 trading days.
 * 底で待ち is a box under 25% that has not met the rebound rules.
 */
export function resolveWeeklyCall(
  quote: Pick<Quote, "boxPct" | "maSlopePct" | "weekly">,
  earnings: EarningsView | null,
): WeeklyCall | null {
  const falling = quote.maSlopePct != null && quote.maSlopePct < 0;
  if (quote.weekly.newLowLast && falling) return WEEKLY_CALL.avoid;
  if (quote.weekly.reboundSetup) {
    return earningsBlocksWeeklyRebound(earnings) ? WEEKLY_CALL.earnings : WEEKLY_CALL.rebound;
  }
  if (boxShown(quote.boxPct) < WAIT_BOX_PCT) return WEEKLY_CALL.wait;
  return null;
}

export function weeklyBadgeText(call: WeeklyCall): string {
  if (call === WEEKLY_CALL.rebound) return `🟢 ${call}`;
  if (call === WEEKLY_CALL.wait) return `🟡 ${call}`;
  if (call === WEEKLY_CALL.avoid) return `🔴 ${call}`;
  return call;
}

export type BoxWeekDirection = "up" | "down" | "flat" | "none";

/** 先週の箱% → 今週の箱%, with an arrow for the change in the shown one-decimal figure. */
export function boxWeekText(prev: number | null, now: number): { text: string; direction: BoxWeekDirection } {
  if (prev == null || !Number.isFinite(prev)) return { text: formatBox(now), direction: "none" };
  const from = boxShown(prev);
  const to = boxShown(now);
  const direction: BoxWeekDirection = to > from ? "up" : to < from ? "down" : "flat";
  const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  return { text: `${formatBox(from)} → ${formatBox(to)} ${arrow}`, direction };
}

export function formatWeekChange(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const shown = round2(pct);
  if (shown === 0) return "0.00%";
  const sign = shown > 0 ? "+" : "−";
  return `${sign}${Math.abs(shown).toFixed(2)}%`;
}

export function formatWeekClosePos(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return formatBox(pct);
}

export function formatUpDays(days: number | null): string {
  if (days == null || !Number.isFinite(days)) return "—";
  return `${days}/${WEEK_SESSIONS}`;
}

/** Share count beside the stop. 0 names the reason. Not an order. */
export function weeklySharesText(weekly: WeeklyStats, close: number): string {
  if (weekly.shares <= 0) {
    const perShare = close - weekly.stop;
    if (perShare > WEEKLY_RISK_USD) return "0株（1株で$15を超える）";
    if (!(close > 0) || close > WEEKLY_COST_CAP) return "0株（1株が$450を超える）";
    return "0株";
  }
  return `${weekly.shares}株（損失 ${formatDollar(weekly.riskUsd)}）`;
}
