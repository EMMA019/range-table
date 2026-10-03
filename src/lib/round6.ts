import { ROUND4_PREREG, type Flow } from "./round4";
import { SPY_BENCH, round3Verdict, type Round3Universe, type Round3Window } from "./round3";
import { ROUND5_PREREG, type TickerPnl } from "./round5";
import type { Verdict } from "./round2";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND6_PREREG = "5c53ac7d0eea6ccbbbc21db44adaf5e901b9cf6a";

export type Round6Size = "lot" | "risk";
export type Round6Role = "baseline" | "book";

export type Round6Row = {
  role: Round6Role;
  size: Round6Size | null;
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
  /** Second-run total minus the reproduced round-4 F1iF2 total. Null on the baseline rows. */
  deltaUsd: number | null;
  /** Unfiltered fills in the round-5 class, at their unfiltered P&L. */
  droppedSemi: Flow | null;
  unfunded: number;
};

export type Round6Report = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  round4Commit: string;
  round5ClassCommit: string;
  generatedAt: string;
  spy: typeof SPY_BENCH;
  rows: Round6Row[];
  summary: { pit: Verdict; adv: Verdict; verdict: Verdict };
};

/** A class fill is a semi drop even when it also fails F1i or F2. */
export function dropKind(inClass: boolean, passesFilter: boolean): "semi" | "filter" | "keep" {
  if (inClass) return "semi";
  if (!passesFilter) return "filter";
  return "keep";
}

/** Book total minus the round-4 total, in cents. */
export function pnlDelta(book: number, baseline: number): number {
  return Math.round(book * 100 - baseline * 100) / 100;
}

export function round6Verdict(args: {
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

export { ROUND4_PREREG, ROUND5_PREREG, SPY_BENCH };
