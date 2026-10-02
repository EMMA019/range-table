import { computeQuote, sharesForMove } from "./compute";
import { CHART_SESSIONS, GAP_THRESHOLD } from "./constants";
import type { Bar, Quote } from "./types";

/**
 * Offline test of the range pattern. Runs from scripts/backtest.ts, never on the server.
 * Signals come from the same computeQuote the table uses, on the same 66-bar window.
 */

export type EntryRule = "rebound15" | "in_ok";
export type EntryFill = "next_open" | "signal_close";
export type StopFill = "close" | "next_open";

export type BacktestRules = {
  entry: EntryRule;
  fill: EntryFill;
  stopFill: StopFill;
  /** Exit at the close of this many sessions after entry when neither target nor stop hit. */
  maxHoldSessions: number;
  /** Round-trip commission in USD. */
  roundTripFee: number;
};

export const DEFAULT_RULES: BacktestRules = {
  entry: "rebound15",
  fill: "next_open",
  stopFill: "close",
  maxHoldSessions: 20,
  roundTripFee: 0.7,
};

export type ExitReason = "target" | "stop" | "timeout";

export type Trade = {
  ticker: string;
  signalDate: string;
  entryDate: string;
  exitDate: string;
  entry: number;
  exit: number;
  atr: number;
  /** ATR(14) ÷ signal close, in percent. */
  atrPct: number;
  qty: number;
  pnlUsd: number;
  /** (exit − entry) ÷ ATR. */
  pnlAtr: number;
  holdSessions: number;
  reason: ExitReason;
};

/** The signal rule on one completed bar. rebound15: a rebound has started and the close is at or above the 15% line. */
export function isSignal(quote: Quote, rule: EntryRule): boolean {
  if (quote.reboundDays == null || quote.reboundDays < 1 || quote.close < quote.line15) return false;
  return rule === "rebound15" || quote.entrySignal === "in_ok";
}

function gapInside(bars: Bar[], from: number, to: number): boolean {
  for (let k = Math.max(1, from); k <= to; k += 1) {
    if (bars[k - 1].c > 0 && Math.abs(bars[k].c / bars[k - 1].c - 1) >= GAP_THRESHOLD) return true;
  }
  return false;
}

/**
 * Walks one ticker's bars. One position at a time; a new signal can come on the exit day's close.
 * Target is entry + ATR(14) of the signal day: a gap open above it fills at the open, otherwise a
 * high that reaches it fills at the target. Stop is a close under the signal day's 20-day low,
 * filled at that close (or the next open). When a day reaches the target and also closes under the
 * stop, the target wins: the limit order fills during the session before the close.
 */
export function runTicker(ticker: string, bars: Bar[], rules: BacktestRules = DEFAULT_RULES): { trades: Trade[]; open: number } {
  const trades: Trade[] = [];
  let open = 0;
  let i = 0;
  while (i < bars.length - 1) {
    const result = computeQuote(bars.slice(Math.max(0, i + 1 - CHART_SESSIONS), i + 1));
    if (!result.ok || result.quote.gapWarning || !isSignal(result.quote, rules.entry)) {
      i += 1;
      continue;
    }
    const quote = result.quote;
    const entryIndex = rules.fill === "next_open" ? i + 1 : i;
    const entry = rules.fill === "next_open" ? bars[i + 1].o : bars[i].c;
    const target = entry + quote.atr14;
    const stop = quote.low20;
    const qty = sharesForMove(quote.atr14, entry).shares10;
    if (qty == null || !(entry > 0)) {
      i += 1;
      continue;
    }

    let exitIndex = -1;
    let exit = 0;
    let reason: ExitReason = "timeout";
    const firstCheck = rules.fill === "next_open" ? entryIndex : entryIndex + 1;
    const lastIndex = Math.min(bars.length - 1, entryIndex + rules.maxHoldSessions);
    for (let j = firstCheck; j <= lastIndex; j += 1) {
      const bar = bars[j];
      if (j > entryIndex && bar.o >= target) {
        exitIndex = j;
        exit = bar.o;
        reason = "target";
        break;
      }
      if (bar.h >= target) {
        exitIndex = j;
        exit = target;
        reason = "target";
        break;
      }
      if (bar.c < stop) {
        reason = "stop";
        if (rules.stopFill === "close") {
          exitIndex = j;
          exit = bar.c;
        } else if (j + 1 < bars.length) {
          exitIndex = j + 1;
          exit = bars[j + 1].o;
        }
        break;
      }
      if (j === entryIndex + rules.maxHoldSessions) {
        exitIndex = j;
        exit = bar.c;
        reason = "timeout";
        break;
      }
    }
    if (exitIndex < 0) {
      open += 1;
      break;
    }
    if (!gapInside(bars, entryIndex, exitIndex)) {
      trades.push({
        ticker,
        signalDate: bars[i].date,
        entryDate: bars[entryIndex].date,
        exitDate: bars[exitIndex].date,
        entry,
        exit,
        atr: quote.atr14,
        atrPct: (quote.atr14 / quote.close) * 100,
        qty,
        pnlUsd: qty * (exit - entry) - rules.roundTripFee,
        pnlAtr: (exit - entry) / quote.atr14,
        holdSessions: exitIndex - entryIndex,
        reason,
      });
    }
    i = Math.max(exitIndex, i + 1);
  }
  return { trades, open };
}

export type Stats = {
  n: number;
  winRate: number | null;
  avgHoldSessions: number | null;
  expectancyUsd: number | null;
  expectancyAtr: number | null;
  /** Gross wins ÷ gross losses. Null without a loss. */
  profitFactor: number | null;
  totalUsd: number;
  maxConsecLosses: number;
  targets: number;
  stops: number;
  timeouts: number;
};

const r = (n: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Losing streaks are counted in exit-date order across tickers, as they would be felt. */
export function statsOf(trades: Trade[]): Stats {
  const n = trades.length;
  const wins = trades.filter((trade) => trade.pnlUsd > 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const grossLoss = trades.filter((trade) => trade.pnlUsd <= 0).reduce((sum, trade) => sum - trade.pnlUsd, 0);
  const total = trades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  let streak = 0;
  let worst = 0;
  for (const trade of [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate) || a.ticker.localeCompare(b.ticker))) {
    streak = trade.pnlUsd > 0 ? 0 : streak + 1;
    worst = Math.max(worst, streak);
  }
  return {
    n,
    winRate: n ? r(wins.length / n, 4) : null,
    avgHoldSessions: n ? r(trades.reduce((sum, trade) => sum + trade.holdSessions, 0) / n, 1) : null,
    expectancyUsd: n ? r(total / n) : null,
    expectancyAtr: n ? r(trades.reduce((sum, trade) => sum + trade.pnlAtr, 0) / n, 3) : null,
    profitFactor: grossLoss > 0 ? r(grossWin / grossLoss) : null,
    totalUsd: r(total),
    maxConsecLosses: worst,
    targets: trades.filter((trade) => trade.reason === "target").length,
    stops: trades.filter((trade) => trade.reason === "stop").length,
    timeouts: trades.filter((trade) => trade.reason === "timeout").length,
  };
}

export const ATR_THRESHOLDS = [2, 3, 4] as const;

export const ATR_BANDS = [
  { band: "<2%", min: 0, max: 2 },
  { band: "2-3%", min: 2, max: 3 },
  { band: "3-4%", min: 3, max: 4 },
  { band: "4-6%", min: 4, max: 6 },
  { band: "≥6%", min: 6, max: Infinity },
] as const;

export function atrBandOf(atrPct: number): (typeof ATR_BANDS)[number]["band"] {
  return (ATR_BANDS.find((band) => atrPct >= band.min && atrPct < band.max) ?? ATR_BANDS[ATR_BANDS.length - 1]).band;
}

export type BacktestSummary = {
  v: 1;
  generatedAt: string;
  period: { from: string; to: string; sessions: number };
  universe: { tickers: number; withData: number; missing: string[] };
  rules: {
    signal: string;
    entry: string;
    target: string;
    stop: string;
    timeout: string;
    sizing: string;
    fees: string;
  };
  /** The headline: ATR% of the signal day at or above each threshold. */
  byAtrThreshold: Array<{ minAtrPct: number | null; rebound15: Stats; in_ok: Stats }>;
  byAtrBand: Array<{ band: string } & Stats>;
  variants: Record<string, Stats>;
  byTicker: Array<{ ticker: string; n: number; winRate: number | null; expectancyUsd: number | null; totalUsd: number }>;
  openAtEnd: number;
  biases: string[];
};

export const BIASES = [
  "生存・選択バイアス: 今のウォッチリストで過去を測っている",
  "配当は未調整（分割は調整済み）",
  "同じ日に利確値と損切りの両方に届いた日は、場中に指値が先に約定したとみなす",
  "過去の決算日が無いので、決算をまたぐトレードを除けていない",
  "スリッページは見ていない。手数料は往復$0.70",
];

export type TickerBars = { ticker: string; bars: Bar[] };

export function summarize(series: TickerBars[], missing: string[], now = new Date()): BacktestSummary {
  const run = (rules: BacktestRules) => {
    const trades: Trade[] = [];
    let open = 0;
    for (const { ticker, bars } of series) {
      const result = runTicker(ticker, bars, rules);
      trades.push(...result.trades);
      open += result.open;
    }
    return { trades, open };
  };
  const main = run(DEFAULT_RULES);
  const inOk = run({ ...DEFAULT_RULES, entry: "in_ok" });
  const closeFill = run({ ...DEFAULT_RULES, fill: "signal_close" });
  const nextOpenStop = run({ ...DEFAULT_RULES, stopFill: "next_open" });
  const atLeast = (trades: Trade[], min: number | null) => (min == null ? trades : trades.filter((trade) => trade.atrPct >= min));

  const dates = series.flatMap(({ bars }) => (bars.length ? [bars[0].date, bars[bars.length - 1].date] : [])).sort();
  const byTicker = new Map<string, Trade[]>();
  for (const trade of main.trades) byTicker.set(trade.ticker, [...(byTicker.get(trade.ticker) ?? []), trade]);

  return {
    v: 1,
    generatedAt: now.toISOString(),
    period: {
      from: dates[0] ?? "",
      to: dates[dates.length - 1] ?? "",
      sessions: Math.max(0, ...series.map(({ bars }) => bars.length)),
    },
    universe: { tickers: series.length + missing.length, withData: series.length, missing },
    rules: {
      signal: "反発1日以上（安値後の陽線続き）かつ終値が15%ライン以上。in_ok は25%ライン以下も条件",
      entry: "シグナル翌日の始値で買う",
      target: "買値 + シグナル日のATR14。始値が上なら始値、高値が届けば利確値で約定",
      stop: "終値がシグナル日の20日安値を下回った日の終値",
      timeout: `${DEFAULT_RULES.maxHoldSessions}営業日で終値決済`,
      sizing: "ceil($10 ÷ ATR14) 株（表の$10株数と同じ）",
      fees: `往復 $${DEFAULT_RULES.roundTripFee.toFixed(2)}`,
    },
    byAtrThreshold: [null, ...ATR_THRESHOLDS].map((min) => ({
      minAtrPct: min,
      rebound15: statsOf(atLeast(main.trades, min)),
      in_ok: statsOf(atLeast(inOk.trades, min)),
    })),
    byAtrBand: ATR_BANDS.map(({ band }) => ({ band, ...statsOf(main.trades.filter((trade) => atrBandOf(trade.atrPct) === band)) })),
    variants: {
      main: statsOf(main.trades),
      in_ok: statsOf(inOk.trades),
      signal_close_entry: statsOf(closeFill.trades),
      next_open_stop: statsOf(nextOpenStop.trades),
    },
    byTicker: [...byTicker.entries()]
      .map(([ticker, trades]) => {
        const stats = statsOf(trades);
        return { ticker, n: stats.n, winRate: stats.winRate, expectancyUsd: stats.expectancyUsd, totalUsd: stats.totalUsd };
      })
      .sort((a, b) => a.ticker.localeCompare(b.ticker)),
    openAtEnd: main.open,
    biases: BIASES,
  };
}
