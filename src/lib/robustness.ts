import type { Book } from "./backtest-study";
import { POSITION_MAX } from "./backtest-study";

/** Whole shares whose loss to `stop` is about 1% of equity, and whose cost is at most $450. */
export function sharesForRisk(
  entry: number,
  stop: number | null | undefined,
  equity: number,
  riskFrac = 0.01,
  cap = POSITION_MAX,
): number | null {
  if (!(entry > 0) || stop == null || !(equity > 0)) return null;
  const distance = entry - stop;
  if (!(distance > 0)) return null;
  const qty = Math.min(Math.floor((equity * riskFrac) / distance), Math.floor(cap / entry));
  if (qty < 1) return null;
  return qty;
}

/** True when a filing date falls on the entry date, the exit date, or a day in between. */
export function spansEarnings(entryDate: string, exitDate: string, dates: readonly string[]): boolean {
  for (const date of dates) {
    if (date >= entryDate && date <= exitDate) return true;
  }
  return false;
}

/** Filing dates of 8-Ks whose item list contains 2.02. */
export function item202Dates(form: readonly string[], filingDate: readonly string[], items: readonly string[]): string[] {
  const out: string[] = [];
  const n = Math.min(form.length, filingDate.length, items.length);
  for (let i = 0; i < n; i += 1) {
    if (form[i] !== "8-K") continue;
    const parts = items[i].split(",").map((part) => part.trim());
    if (parts.includes("2.02") && filingDate[i]) out.push(filingDate[i]);
  }
  return out;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: T[], rng: () => number): void {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = list[i];
    list[i] = list[j];
    list[j] = swap;
  }
}

/** Percent of samples strictly below `mark`, one decimal. */
export function percentileBelow(samples: readonly number[], mark: number): number | null {
  if (!samples.length) return null;
  const below = samples.reduce((sum, value) => sum + (value < mark ? 1 : 0), 0);
  return Math.round((below / samples.length) * 1000) / 10;
}

export function ddRatio(total: number, drawdown: number): number | null {
  if (!(drawdown > 0)) return null;
  return Math.round((total / drawdown) * 100) / 100;
}

export type YearLeg = {
  totalUsd: number;
  mtmDdUsd: number;
  realizedDdUsd: number;
  totalOverMtm: number | null;
  totalOverRealized: number | null;
};

export type Check = {
  id: string;
  label: string;
  n: number;
  totalUsd: number;
  mtmDdUsd: number;
  realizedDdUsd: number;
  totalOverMtm: number | null;
  totalOverRealized: number | null;
  year1: YearLeg;
  year2: YearLeg;
};

function leg(total: number, mtm: number, realized: number): YearLeg {
  return {
    totalUsd: total,
    mtmDdUsd: mtm,
    realizedDdUsd: realized,
    totalOverMtm: ddRatio(total, mtm),
    totalOverRealized: ddRatio(total, realized),
  };
}

export function checkFromBook(id: string, label: string, book: Book): Check {
  return {
    id,
    label,
    n: book.n,
    ...leg(book.totalUsd, book.maxDrawdownUsd, book.realizedDrawdownUsd ?? 0),
    year1: leg(book.restartYear1.totalUsd, book.restartYear1.maxDrawdownUsd, book.restartYear1.realizedDrawdownUsd ?? 0),
    year2: leg(book.restartYear2.totalUsd, book.restartYear2.maxDrawdownUsd, book.restartYear2.realizedDrawdownUsd ?? 0),
  };
}

export type TradePnl = { ticker: string; pnlUsd: number; entryDate: string; exitDate: string };

export type SplitStats = {
  n: number;
  totalUsd: number;
  avgUsd: number | null;
  winRate: number | null;
  profitFactor: number | null;
};

export function splitStats(trades: readonly TradePnl[]): SplitStats {
  const n = trades.length;
  let total = 0;
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  for (const trade of trades) {
    total += trade.pnlUsd;
    if (trade.pnlUsd > 0) {
      wins += 1;
      grossWin += trade.pnlUsd;
    } else if (trade.pnlUsd < 0) grossLoss -= trade.pnlUsd;
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    n,
    totalUsd: round(total),
    avgUsd: n ? round(total / n) : null,
    winRate: n ? Math.round((wins / n) * 10000) / 10000 : null,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
  };
}
