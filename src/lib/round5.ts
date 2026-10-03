import { RISK_BUDGET, SPY_BENCH, round3Verdict, type Round3Universe, type Round3Window } from "./round3";
import type { Verdict } from "./round2";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND5_PREREG = "d35eaff2120c385f57c561fddb05204d545a280e";

export const SEMI_GROUPS = ["semi", "equipment"] as const;
export const ADJACENT_GROUPS = ["network", "server", "power"] as const;
export const GICS_CLASS_SUBS = ["Semiconductors", "Semiconductor Materials & Equipment"] as const;

const SEMI = new Set<string>(SEMI_GROUPS);
const ADJACENT = new Set<string>(ADJACENT_GROUPS);
const GICS = new Set<string>(GICS_CLASS_SUBS);

export type Round5Stop = "S0" | "S1";
export type Round5Cap = "cap450" | "uncapped";
export type Round5Role = "baseline" | "book";

export type TickerPnl = { ticker: string; pnlUsd: number };

export type Round5Row = {
  role: Round5Role;
  stop: Round5Stop | null;
  cap: Round5Cap | null;
  universe: Round3Universe;
  window: Round3Window;
  totalUsd: number;
  n: number;
  winRate: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  mtmDdUsd: number;
  investedFraction: number | null;
  scaledSpyUsd: number | null;
  ratio: number | null;
  ciLow: number | null;
  nRequired: number | null;
  verdict: Verdict;
  topTickers: TickerPnl[];
  bottomTickers: TickerPnl[];
  /** Kept fills the second pass refused because settled cash could not pay for them. */
  unfunded: number;
};

export type Round5Report = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  generatedAt: string;
  lowCountExpected: true;
  classCounts: { core: number; pitOos: number; pitIn: number; advOos: number; advIn: number };
  spy: typeof SPY_BENCH;
  rows: Round5Row[];
  summary: Array<{ stop: Round5Stop; pit: Verdict; adv: Verdict; verdict: Verdict }>;
};

/** Watchlist group or current GICS sub-industry. AKAM is out even when its group is network. */
export function inRound5Class(ticker: string, group: string | null, sub: string | null): boolean {
  if (ticker.toUpperCase() === "AKAM") return false;
  if (group != null && (SEMI.has(group) || ADJACENT.has(group))) return true;
  return sub != null && GICS.has(sub);
}

/** floor($32 / distance), with no $450 cap. One share that risks more than $32 is skipped. */
export function uncappedRiskShares(entry: number, stop: number): number | null {
  if (!(entry > 0) || !Number.isFinite(stop)) return null;
  const distance = entry - stop;
  if (!(distance > 0) || distance > RISK_BUDGET) return null;
  const qty = Math.floor(RISK_BUDGET / distance);
  return qty >= 1 ? qty : null;
}

/** Five largest and five smallest ticker P&L sums. Ties break A–Z. */
export function tickerExtremes(fills: readonly { ticker: string; pnlUsd: number }[], n = 5): { top: TickerPnl[]; bottom: TickerPnl[] } {
  const sums = new Map<string, number>();
  for (const fill of fills) sums.set(fill.ticker, (sums.get(fill.ticker) ?? 0) + fill.pnlUsd);
  const rows = [...sums.entries()].map(([ticker, pnlUsd]) => ({ ticker, pnlUsd }));
  const byHigh = (a: TickerPnl, b: TickerPnl) => b.pnlUsd - a.pnlUsd || a.ticker.localeCompare(b.ticker);
  const byLow = (a: TickerPnl, b: TickerPnl) => a.pnlUsd - b.pnlUsd || a.ticker.localeCompare(b.ticker);
  return { top: [...rows].sort(byHigh).slice(0, n), bottom: [...rows].sort(byLow).slice(0, n) };
}

export function round5Verdict(args: {
  judged: boolean;
  totalUsd: number;
  n: number;
  ratio: number | null;
  spyRatio: number | null;
  lower: number | null;
  nRequired: number | null;
}): Verdict {
  return round3Verdict(args);
}

export { SPY_BENCH };
