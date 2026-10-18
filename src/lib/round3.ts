import { GAP_THRESHOLD } from "./constants";
import { windowVerdict, type Verdict } from "./round2";

/** Pre-registration commit. Results must cite this and must not relax the rules below. */
export const ROUND3_PREREG = "65bd4a01312cad804a4cbcb302d8c18eb1d2788a";
export const RISK_BUDGET = 32;
export const NOTIONAL_CAP = 450;
export const FEE_ROOM = 7;
export const MIN_TRADES = 100;

export const ROUND3_IDS = ["base", "R1", "R2", "R3", "R4", "R5", "R6", "R7"] as const;
export type Round3Id = (typeof ROUND3_IDS)[number];
export type Round3Universe = "core" | "pit" | "adv";
export type Round3Window = "oos" | "in";

export const SPY_BENCH: Record<Round3Window, { totalUsd: number; mtmDdUsd: number; ratio: number }> = {
  oos: { totalUsd: 1661.54, mtmDdUsd: 379.84, ratio: 4.37 },
  in: { totalUsd: 982.45, mtmDdUsd: 582.25, ratio: 1.69 },
};

/** Whole shares from a $32 risk budget, capped at $450 notional. Null skips the name. */
export function riskShares(entry: number, stop: number): number | null {
  if (!(entry > 0) || !Number.isFinite(stop)) return null;
  const distance = entry - stop;
  if (!(distance > 0) || distance > RISK_BUDGET) return null;
  if (entry > NOTIONAL_CAP) return null;
  const qty = Math.min(Math.floor(RISK_BUDGET / distance), Math.floor(NOTIONAL_CAP / entry));
  return qty >= 1 ? qty : null;
}

/** (mid − entry) × shares must cover ten times the $0.70 sell fee. */
export function feeRoomOk(mid: number | null, entry: number, shares: number): boolean {
  if (mid == null || !(mid > entry) || !(shares > 0)) return false;
  return (mid - entry) * shares >= FEE_ROOM;
}

/** A null side is false. Both null skips the name. */
export function strengthOk(rs20: number | null, close: number, ma50: number | null): boolean {
  return (rs20 != null && rs20 > 0) || (ma50 != null && close > ma50);
}

/** A scale price at or below the entry is already passed. */
export function activeScale(entry: number, mid: number | null, top: number | null): { mid: number | null; top: number | null } {
  return {
    mid: mid != null && mid > entry ? mid : null,
    top: top != null && top > entry ? top : null,
  };
}

/** Mean of P&L / initial risk. Non-positive risk is left out. */
export function expectancyR(pnls: readonly number[], risks: readonly (number | null)[]): number | null {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < pnls.length; i += 1) {
    const risk = risks[i];
    if (risk == null || !(risk > 0)) continue;
    sum += pnls[i] / risk;
    n += 1;
  }
  return n ? sum / n : null;
}

export function gapVoids(closes: readonly number[], from: number, to: number): boolean {
  for (let k = Math.max(1, from); k <= to; k += 1) {
    const prev = closes[k - 1];
    if (prev > 0 && Math.abs(closes[k] / prev - 1) >= GAP_THRESHOLD) return true;
  }
  return false;
}

export type BoxedExit = {
  exitIndex: number;
  exit: number;
  reason: "target" | "stop" | "timeout" | "window";
  timing: "open" | "intraday" | "close";
};

/** Box target and stop, plus the one-time day-5 close check when `timeStop` is set. */
export function boxedExit(
  bars: readonly { o: number; h: number; c: number }[],
  entryIndex: number,
  target: number | null,
  stop: number | null,
  maxHold: number,
  timeStop: boolean,
): BoxedExit | null {
  if (entryIndex >= bars.length) return null;
  const entry = bars[entryIndex].o;
  if (!(entry > 0)) return null;
  const holdEnd = Math.min(bars.length - 1, entryIndex + maxHold);
  const timeIndex = timeStop ? entryIndex + 5 : null;
  for (let j = entryIndex; j <= holdEnd; j += 1) {
    const bar = bars[j];
    if (target != null && j > entryIndex && bar.o >= target) return { exitIndex: j, exit: bar.o, reason: "target", timing: "open" };
    if (stop != null && j > entryIndex && bar.o < stop) return { exitIndex: j, exit: bar.o, reason: "stop", timing: "open" };
    if (target != null && bar.h >= target) return { exitIndex: j, exit: target, reason: "target", timing: "intraday" };
    if (stop != null && bar.c < stop) return { exitIndex: j, exit: bar.c, reason: "stop", timing: "close" };
    if (timeIndex === j && bar.c <= entry) return { exitIndex: j, exit: bar.c, reason: "window", timing: "close" };
    if (j === entryIndex + maxHold) return { exitIndex: j, exit: bar.c, reason: "timeout", timing: "close" };
  }
  return { exitIndex: holdEnd, exit: bars[holdEnd].c, reason: "window", timing: "close" };
}

/** Below 100 trades is a hold before a loss can fail the window. Unjudged rows stay unjudged. */
export function round3Verdict(args: {
  judged: boolean;
  totalUsd: number;
  n: number;
  ratio: number | null;
  spyRatio: number | null;
  lower: number | null;
  nRequired: number | null;
}): Verdict {
  if (!args.judged) return "not-judged";
  if (args.n < MIN_TRADES) return "hold";
  return windowVerdict(args);
}

export type Round3Row = {
  id: Round3Id;
  universe: Round3Universe;
  window: Round3Window;
  totalUsd: number;
  n: number;
  winRate: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  worstUsd: number | null;
  mtmDdUsd: number;
  daysMtm10Share: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  investedFraction: number | null;
  daysOpenShare: number | null;
  scaledSpyUsd: number | null;
  ratio: number | null;
  ciLow: number | null;
  nRequired: number | null;
  verdict: Verdict;
};

export type Round3Report = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  generatedAt: string;
  undated: number;
  spy: typeof SPY_BENCH;
  rows: Round3Row[];
  summary: Array<{ id: Round3Id; pit: Verdict; adv: Verdict; verdict: Verdict }>;
};
