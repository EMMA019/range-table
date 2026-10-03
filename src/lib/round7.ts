import { sharesForBudget, type Candidate, type ExitTiming, type Feat } from "./backtest-study";
import { gapVoids, round3Verdict, SPY_BENCH, type Round3Universe, type Round3Window } from "./round3";
import { ROUND4_PREREG } from "./round4";
import type { Verdict } from "./round2";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND7_PREREG = "d5864cd146d28a9c47faee2aea9d0dc5db3aa3ac";

export const ROUND7_IDS = ["Locked", "A", "B", "C", "D"] as const;
export type Round7Id = (typeof ROUND7_IDS)[number];
export type Round7Variant = Exclude<Round7Id, "Locked">;

export const EXIT_REASONS = ["target", "stop", "breakeven", "priorLow", "timeout", "window"] as const;
export type Round7Reason = (typeof EXIT_REASONS)[number];

export type Round7Leg = {
  date: string;
  timing: ExitTiming;
  qty: number;
  price: number;
  reason: Round7Reason;
};

export type ExitBar = { date: string; o: number; h: number; l: number; c: number };

export type ExitPlan = {
  legs: Round7Leg[];
  exitIndex: number;
  exitDate: string;
  exit: number;
  reason: Round7Reason;
  timing: ExitTiming;
};

export type ExitTotals = Record<Round7Reason, { n: number; pnlUsd: number }>;

const ALT_FEE = 1.9;
const ENGINE_SELL_FEE = 0.7;

export function emptyExits(): ExitTotals {
  return {
    target: { n: 0, pnlUsd: 0 },
    stop: { n: 0, pnlUsd: 0 },
    breakeven: { n: 0, pnlUsd: 0 },
    priorLow: { n: 0, pnlUsd: 0 },
    timeout: { n: 0, pnlUsd: 0 },
    window: { n: 0, pnlUsd: 0 },
  };
}

/** Engine trade P&L with the $0.70 sells put back, then one $1.90 round trip removed. */
export function meanNet190(trades: readonly { pnlUsd: number; sells: number }[]): number | null {
  if (!trades.length) return null;
  const sum = trades.reduce((total, trade) => total + trade.pnlUsd + ENGINE_SELL_FEE * trade.sells - ALT_FEE, 0);
  return sum / trades.length;
}

export function round7Verdict(args: {
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

type PlanArgs = {
  variant: Round7Variant;
  bars: readonly ExitBar[];
  entryIndex: number;
  atr: number;
  stop: number;
  high20: number | null;
  qty: number;
  maxHold?: number;
};

export function planRound7Exit(args: PlanArgs): ExitPlan | null {
  const maxHold = args.maxHold ?? 20;
  const { bars, entryIndex, qty } = args;
  if (entryIndex >= bars.length || !(qty >= 1) || !(args.atr > 0) || !Number.isFinite(args.stop)) return null;
  const entry = bars[entryIndex].o;
  if (!(entry > 0)) return null;
  if (args.variant === "B" && qty === 1) return planSingle(args, entry + args.atr, qty, maxHold);
  if (args.variant === "B") return planHalf(args, maxHold);
  if (args.variant === "D") return planTrail(args, maxHold);
  const target = args.variant === "C" ? args.high20 : entry + args.atr;
  return planSingle(args, target, qty, maxHold);
}

function planFrom(legs: Round7Leg[]): ExitPlan | null {
  const last = legs[legs.length - 1];
  if (!last) return null;
  return { legs, exitIndex: indexOf(legs), exitDate: last.date, exit: last.price, reason: last.reason, timing: last.timing };
}

function indexOf(legs: Round7Leg[]): number {
  return legs.reduce((max, leg) => Math.max(max, legIndex(leg)), 0);
}

const legIndex = (leg: Round7Leg & { index?: number }): number => leg.index ?? 0;

function push(legs: Array<Round7Leg & { index: number }>, bar: ExitBar, index: number, qty: number, price: number, timing: ExitTiming, reason: Round7Reason) {
  if (!(qty > 0)) return;
  legs.push({ date: bar.date, index, timing, qty, price, reason });
}

/** One lot. A stop that shares the bar with a target fills, and the target does not. */
function planSingle(args: PlanArgs, target: number | null, qty: number, maxHold: number): ExitPlan | null {
  const { bars, entryIndex, stop } = args;
  const lastIndex = Math.min(bars.length - 1, entryIndex + maxHold);
  const legs: Array<Round7Leg & { index: number }> = [];
  for (let j = entryIndex; j <= lastIndex; j += 1) {
    const bar = bars[j];
    const after = j > entryIndex;
    const gapStop = after && bar.o < stop;
    const closeStop = bar.c < stop;
    const gapTarget = target != null && after && bar.o >= target;
    const highTarget = target != null && bar.h >= target;
    if ((gapStop || closeStop) && (gapTarget || highTarget)) {
      push(legs, bar, j, qty, gapStop ? bar.o : bar.c, gapStop ? "open" : "close", "stop");
      return planFrom(legs);
    }
    if (gapTarget && target != null) {
      push(legs, bar, j, qty, bar.o, "open", "target");
      return planFrom(legs);
    }
    if (gapStop) {
      push(legs, bar, j, qty, bar.o, "open", "stop");
      return planFrom(legs);
    }
    if (highTarget && target != null) {
      push(legs, bar, j, qty, target, "intraday", "target");
      return planFrom(legs);
    }
    if (closeStop) {
      push(legs, bar, j, qty, bar.c, "close", "stop");
      return planFrom(legs);
    }
    if (j === entryIndex + maxHold) {
      push(legs, bar, j, qty, bar.c, "close", "timeout");
      return planFrom(legs);
    }
  }
  const bar = bars[lastIndex];
  push(legs, bar, lastIndex, qty, bar.c, "close", "window");
  return planFrom(legs);
}

function planHalf(args: PlanArgs, maxHold: number): ExitPlan | null {
  const { bars, entryIndex, atr, stop, high20, qty } = args;
  const entry = bars[entryIndex].o;
  const t1 = entry + atr;
  const two = entry + 2 * atr;
  const box = high20 != null && high20 > entry ? high20 : null;
  const t2 = box == null ? two : Math.min(box, two);
  let half = Math.floor(qty / 2);
  let rest = qty - half;
  const legs: Array<Round7Leg & { index: number }> = [];
  const lastIndex = Math.min(bars.length - 1, entryIndex + maxHold);
  const done = () => planFrom(legs);

  for (let j = entryIndex; j <= lastIndex; j += 1) {
    const bar = bars[j];
    const after = j > entryIndex;
    if (after) {
      if (half > 0 && bar.o < stop) {
        push(legs, bar, j, half + rest, bar.o, "open", "stop");
        return done();
      }
      if (half === 0 && rest > 0 && bar.o < entry) {
        push(legs, bar, j, rest, bar.o, "open", "breakeven");
        return done();
      }
      if (rest > 0 && bar.o >= t2) {
        push(legs, bar, j, rest, bar.o, "open", "target");
        rest = 0;
      }
      if (half > 0 && bar.o >= t1) {
        push(legs, bar, j, half, bar.o, "open", "target");
        half = 0;
      }
      if (half === 0 && rest === 0) return done();
    }
    if (half > 0 && bar.c < stop) {
      push(legs, bar, j, half + rest, bar.c, "close", "stop");
      return done();
    }
    if (half > 0 && bar.h >= t1) {
      push(legs, bar, j, half, t1, "intraday", "target");
      half = 0;
      if (rest > 0 && bar.c < entry) {
        push(legs, bar, j, rest, bar.c, "close", "breakeven");
        return done();
      }
      if (rest > 0 && bar.h >= t2) {
        push(legs, bar, j, rest, t2, "intraday", "target");
        return done();
      }
    } else if (half === 0 && rest > 0 && bar.c < entry) {
      push(legs, bar, j, rest, bar.c, "close", "breakeven");
      return done();
    } else if (rest > 0 && bar.h >= t2) {
      push(legs, bar, j, rest, t2, "intraday", "target");
      rest = 0;
      if (half === 0) return done();
    }
    if (half === 0 && rest === 0) return done();
    if (j === entryIndex + maxHold) {
      push(legs, bar, j, half + rest, bar.c, "close", "timeout");
      return done();
    }
  }
  const bar = bars[lastIndex];
  push(legs, bar, lastIndex, half + rest, bar.c, "close", "window");
  return done();
}

function planTrail(args: PlanArgs, maxHold: number): ExitPlan | null {
  const { bars, entryIndex, atr, stop, qty } = args;
  const entry = bars[entryIndex].o;
  const t1 = entry + atr;
  const lastIndex = Math.min(bars.length - 1, entryIndex + maxHold);
  const legs: Array<Round7Leg & { index: number }> = [];
  let armed = false;
  for (let j = entryIndex; j <= lastIndex; j += 1) {
    const bar = bars[j];
    const after = j > entryIndex;
    const prior = j > 0 ? bars[j - 1].l : bar.l;
    if (!armed) {
      if (after && bar.o < stop) {
        push(legs, bar, j, qty, bar.o, "open", "stop");
        return planFrom(legs);
      }
      if (bar.c < stop) {
        push(legs, bar, j, qty, bar.c, "close", "stop");
        return planFrom(legs);
      }
      if ((after && bar.o >= t1) || bar.h >= t1) armed = true;
      if (j === entryIndex + maxHold) {
        push(legs, bar, j, qty, bar.c, "close", "timeout");
        return planFrom(legs);
      }
    } else {
      if (after && bar.o < stop) {
        push(legs, bar, j, qty, bar.o, "open", "stop");
        return planFrom(legs);
      }
      if (bar.o < prior) {
        push(legs, bar, j, qty, bar.o, "open", "priorLow");
        return planFrom(legs);
      }
      if (bar.l <= prior) {
        push(legs, bar, j, qty, prior, "intraday", "priorLow");
        return planFrom(legs);
      }
      if (bar.c < stop) {
        push(legs, bar, j, qty, bar.c, "close", "stop");
        return planFrom(legs);
      }
      if (j === entryIndex + maxHold) {
        push(legs, bar, j, qty, bar.c, "close", "timeout");
        return planFrom(legs);
      }
    }
  }
  const bar = bars[lastIndex];
  push(legs, bar, lastIndex, qty, bar.c, "close", "window");
  return planFrom(legs);
}

/** Replace the exit. The entry, stop, and lot stay. A missing lot leaves the locked exit. */
export function withRound7Exit(cand: Candidate, feats: readonly Feat[], variant: Round7Variant): Candidate {
  const qty = sharesForBudget(cand.entry);
  if (qty == null) return cand;
  if (cand.stop == null || !Number.isFinite(cand.stop)) throw new Error(`損切りがない ${cand.ticker} ${cand.entryDate}`);
  const bars: ExitBar[] = feats.map((bar) => ({ date: bar.date, o: bar.o, h: bar.h, l: bar.l, c: bar.c }));
  const plan = planRound7Exit({
    variant,
    bars,
    entryIndex: cand.entryIndex,
    atr: cand.atr,
    stop: cand.stop,
    high20: feats[cand.signalIndex]?.high20 ?? null,
    qty,
  });
  if (!plan) throw new Error(`出口がない ${cand.ticker} ${cand.entryDate}`);
  const reason = plan.reason === "target" ? "target" : plan.reason === "timeout" ? "timeout" : plan.reason === "window" ? "window" : "stop";
  return {
    ...cand,
    exitIndex: plan.exitIndex,
    exitDate: plan.exitDate,
    exit: plan.exit,
    exitTiming: plan.timing,
    reason,
    voided: gapVoids(
      bars.map((bar) => bar.c),
      cand.entryIndex,
      plan.exitIndex,
    ),
    round7Legs: plan.legs.map(({ date, timing, qty: shares, price, reason: legReason }) => ({
      date,
      timing,
      qty: shares,
      price,
      reason: legReason,
    })),
  };
}

export type Round7Row = {
  id: Round7Id;
  universe: Round3Universe;
  window: Round3Window;
  totalUsd: number;
  n: number;
  winRate: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  mtmDdUsd: number;
  meanUsd: number | null;
  meanNet190Usd: number | null;
  avgHold: number | null;
  exits: ExitTotals;
  investedFraction: number | null;
  scaledSpyUsd: number | null;
  ratio: number | null;
  ciLow: number | null;
  nRequired: number | null;
  verdict: Verdict;
};

export type Round7Report = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  round4Commit: string;
  generatedAt: string;
  spy: typeof SPY_BENCH;
  rows: Round7Row[];
  summary: Array<{ id: Round7Id; pit: Verdict; adv: Verdict; verdict: Verdict }>;
};

export { ROUND4_PREREG, SPY_BENCH };
