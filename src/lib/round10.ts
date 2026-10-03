import type { Book, Candidate, Feat } from "./backtest-study";
import { totalNet190 } from "./round8";
import { gapVoids, round3Verdict, SPY_BENCH, type Round3Universe, type Round3Window } from "./round3";
import { planRound7Exit } from "./round7";
import { bootstrapMean, MAIN_Q, MAIN_Z, overallVerdict, type Verdict } from "./round2";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND10_PREREG = "573cc7409decf183db4714ddb0bc795e51e811b6";

export const NOTIONAL_CAP = 500;
export const START_CAPITAL = 3200;
export const ROUND10_IDS = ["B", "R30", "R35"] as const;
export type Round10Id = (typeof ROUND10_IDS)[number];
export const RISK_OF: Record<Exclude<Round10Id, "B">, number> = { R30: 30, R35: 35 };

export type SizingSkip = "flat" | "wide" | "cap";
export type SkipCounts = {
  flat: number;
  wide: number;
  cap: number;
  budget: number;
  slot: number;
  cash: number;
  semi: number;
};

export type Round10Row = {
  id: Round10Id;
  universe: Round3Universe;
  window: Round3Window;
  totalUsd: number;
  totalNet190Usd: number;
  stockN: number;
  etfN: number;
  n: number;
  winRate: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  worstUsd: number | null;
  gapN: number | null;
  gapUsd: number[] | null;
  otherN: number | null;
  otherUsd: number[] | null;
  mtmDdUsd: number;
  pathDdUsd: number;
  peakDate: string;
  peakUsd: number;
  troughDate: string;
  troughUsd: number;
  lowDate: string;
  lowUsd: number;
  lowVsStartUsd: number;
  stockUtil: number;
  etfUtil: number;
  deployed: number;
  skipped: SkipCounts;
  etfPnlUsd: number;
  jointLossDays: number;
  ratio: number | null;
  ciLow: number | null;
  nRequired: number | null;
  meanUsd: number | null;
  verdict: Verdict;
};

export type Round10Report = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  generatedAt: string;
  spy: typeof SPY_BENCH;
  rows: Round10Row[];
  summary: Array<{ id: Exclude<Round10Id, "B">; pit: Verdict; adv: Verdict; verdict: Verdict }>;
};

export type PublishedCell = {
  universe: Round3Universe;
  window: Round3Window;
  totalUsd: number;
  etfPnlUsd: number;
  etfN: number;
  stockN: number;
  mtmDdUsd: number;
  jointLossDays: number;
  totalNet190Usd: number;
};

/** Round-9 F-off SOXX E30 box cells. A mismatch stops the run. */
export const PUBLISHED_BASELINE: PublishedCell[] = [
  { universe: "core", window: "oos", totalUsd: 2174.12, etfPnlUsd: 371.05, etfN: 29, stockN: 245, mtmDdUsd: 639.82, jointLossDays: 79, totalNet190Usd: 1855.86 },
  { universe: "core", window: "in", totalUsd: 949.29, etfPnlUsd: 293.12, etfN: 23, stockN: 265, mtmDdUsd: 918.14, jointLossDays: 66, totalNet190Usd: 617.01 },
  { universe: "pit", window: "oos", totalUsd: 670.37, etfPnlUsd: 334.61, etfN: 30, stockN: 319, mtmDdUsd: 646.89, jointLossDays: 82, totalNet190Usd: 261.36 },
  { universe: "pit", window: "in", totalUsd: 560.29, etfPnlUsd: 258.05, etfN: 23, stockN: 340, mtmDdUsd: 954.41, jointLossDays: 63, totalNet190Usd: 129.58 },
  { universe: "adv", window: "oos", totalUsd: 1105.85, etfPnlUsd: 351.2, etfN: 29, stockN: 236, mtmDdUsd: 621.54, jointLossDays: 78, totalNet190Usd: 799.74 },
  { universe: "adv", window: "in", totalUsd: 1069.65, etfPnlUsd: 364.6, etfN: 23, stockN: 261, mtmDdUsd: 804.17, jointLossDays: 60, totalNet190Usd: 735.84 },
];

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Whole shares from a fixed dollar risk to the signal 20-session low, capped at $500 notional.
 * `flat` is a non-positive distance. `wide` is one share risking more than `risk`. `cap` is one share costing more than $500.
 */
export function stopDistanceShares(entry: number, low: number, risk: number): { units: number } | { skip: SizingSkip } {
  if (!(entry > 0) || !Number.isFinite(low) || !(risk > 0)) return { skip: "flat" };
  const distance = entry - low;
  if (!(distance > 0)) return { skip: "flat" };
  const riskUnits = Math.floor(risk / distance);
  if (riskUnits < 1) return { skip: "wide" };
  const room = Math.floor(NOTIONAL_CAP / entry);
  if (room < 1) return { skip: "cap" };
  return { units: Math.min(riskUnits, room) };
}

/** Replan exit C at `units`. The same count keeps the existing legs. The path does not depend on the count. */
export function withCQty(cand: Candidate, feats: readonly Feat[], units: number): Candidate {
  if (!(units >= 1)) throw new Error(`株数が違う ${cand.ticker} ${cand.entryDate}`);
  const planned = cand.round7Legs?.reduce((sum, leg) => sum + leg.qty, 0) ?? null;
  if (planned === units) return cand;
  if (cand.stop == null || !Number.isFinite(cand.stop)) throw new Error(`損切りがない ${cand.ticker} ${cand.entryDate}`);
  const bars = feats.map((bar) => ({ date: bar.date, o: bar.o, h: bar.h, l: bar.l, c: bar.c }));
  const plan = planRound7Exit({
    variant: "C",
    bars,
    entryIndex: cand.entryIndex,
    atr: cand.atr,
    stop: cand.stop,
    high20: feats[cand.signalIndex]?.high20 ?? null,
    qty: units,
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
    round7Legs: plan.legs.map(({ date, timing, qty, price, reason: legReason }) => ({
      date,
      timing,
      qty,
      price,
      reason: legReason,
    })),
  };
}

/** `gap` is a stop sold at an open strictly below the signal low, with a loss strictly past `risk`. */
export function lossPastRisk(args: { pnlUsd: number; risk: number; reason: string; exitOpen: number; low: number }): "gap" | "other" | null {
  if (!(args.pnlUsd < -args.risk)) return null;
  if (args.reason === "stop" && Number.isFinite(args.exitOpen) && Number.isFinite(args.low) && args.exitOpen < args.low) return "gap";
  return "other";
}

export function emptySkips(): SkipCounts {
  return { flat: 0, wide: 0, cap: 0, budget: 0, slot: 0, cash: 0, semi: 0 };
}

/** Peak and trough of the cent-rounded close marks. The peak starts at the account capital. */
export function pathMarks(daily: readonly { date: string; equity: number }[], capital = START_CAPITAL): {
  pathDdUsd: number;
  peakDate: string;
  peakUsd: number;
  troughDate: string;
  troughUsd: number;
  lowDate: string;
  lowUsd: number;
  lowVsStartUsd: number;
} {
  let peak = capital;
  let peakDate = "start";
  let bestDd = 0;
  let bestPeak = capital;
  let bestPeakDate = "start";
  let bestTrough = capital;
  let bestTroughDate = daily[0]?.date ?? "";
  let low = Number.POSITIVE_INFINITY;
  let lowDate = "";
  for (const point of daily) {
    if (point.equity > peak) {
      peak = point.equity;
      peakDate = point.date;
    }
    const dd = r2(peak - point.equity);
    if (dd > bestDd) {
      bestDd = dd;
      bestPeak = peak;
      bestPeakDate = peakDate;
      bestTrough = point.equity;
      bestTroughDate = point.date;
    }
    if (point.equity < low) {
      low = point.equity;
      lowDate = point.date;
    }
  }
  const lowUsd = Number.isFinite(low) ? low : capital;
  return {
    pathDdUsd: bestDd,
    peakDate: bestPeakDate,
    peakUsd: bestPeak,
    troughDate: bestTroughDate,
    troughUsd: bestTrough,
    lowDate: lowDate || bestTroughDate,
    lowUsd,
    lowVsStartUsd: r2(lowUsd - capital),
  };
}

export function scoreRow(
  book: Book,
  id: Round10Id,
  universe: Round3Universe,
  window: Round3Window,
  skipped: SkipCounts,
  judged: boolean,
  exceed: { gapUsd: number[]; otherUsd: number[] } | null,
): Round10Row {
  const stock = book.fills;
  const etf = book.etfFills;
  const sleeve = book.sleeve;
  const daily = book.daily;
  if (!stock || !etf || !sleeve || !daily) throw new Error(`内訳がない ${id} ${universe} ${window}`);
  const trades: Array<{ pnlUsd: number; sells: number }> = [];
  const pnls: number[] = [];
  for (const fill of stock) {
    trades.push({ pnlUsd: fill.pnlUsd, sells: fill.legs?.length || 1 });
    pnls.push(fill.pnlUsd);
  }
  for (const fill of etf) {
    if (!fill.legs.length) throw new Error(`ETFの足がない ${fill.entryDate}`);
    trades.push({ pnlUsd: fill.pnlUsd, sells: fill.legs.length });
    pnls.push(fill.pnlUsd);
  }
  const wins = pnls.filter((pnl) => pnl > 0);
  const losses = pnls.filter((pnl) => pnl < 0);
  const boot = bootstrapMean(pnls, MAIN_Q, MAIN_Z);
  const ratio = book.maxDrawdownUsd > 0 ? r2(book.totalUsd / book.maxDrawdownUsd) : null;
  const spy = SPY_BENCH[window];
  const path = pathMarks(daily);
  const gapUsd = exceed ? [...exceed.gapUsd].sort((a, b) => a - b) : null;
  const otherUsd = exceed ? [...exceed.otherUsd].sort((a, b) => a - b) : null;
  return {
    id,
    universe,
    window,
    totalUsd: book.totalUsd,
    totalNet190Usd: totalNet190(trades),
    stockN: stock.length,
    etfN: etf.length,
    n: pnls.length,
    winRate: pnls.length ? r4(wins.length / pnls.length) : null,
    avgWinUsd: wins.length ? r2(wins.reduce((sum, pnl) => sum + pnl, 0) / wins.length) : null,
    avgLossUsd: losses.length ? r2(losses.reduce((sum, pnl) => sum + pnl, 0) / losses.length) : null,
    worstUsd: pnls.length ? r2(Math.min(...pnls)) : null,
    gapN: gapUsd ? gapUsd.length : null,
    gapUsd,
    otherN: otherUsd ? otherUsd.length : null,
    otherUsd,
    mtmDdUsd: book.maxDrawdownUsd,
    pathDdUsd: path.pathDdUsd,
    peakDate: path.peakDate,
    peakUsd: path.peakUsd,
    troughDate: path.troughDate,
    troughUsd: path.troughUsd,
    lowDate: path.lowDate,
    lowUsd: path.lowUsd,
    lowVsStartUsd: path.lowVsStartUsd,
    stockUtil: sleeve.stockUtil,
    etfUtil: sleeve.etfUtil,
    deployed: r4(sleeve.stockUtil + sleeve.etfUtil),
    skipped,
    etfPnlUsd: r2(etf.reduce((sum, fill) => sum + fill.pnlUsd, 0)),
    jointLossDays: sleeve.bothNegativeDays,
    ratio,
    ciLow: boot.lower == null ? null : r4(boot.lower),
    nRequired: boot.nRequired == null ? null : r2(boot.nRequired),
    meanUsd: pnls.length ? r2(pnls.reduce((sum, value) => sum + value, 0) / pnls.length) : null,
    verdict: round3Verdict({
      judged,
      totalUsd: book.totalUsd,
      n: pnls.length,
      ratio,
      spyRatio: spy.ratio,
      lower: boot.lower,
      nRequired: boot.nRequired,
    }),
  };
}

export function summarize(rows: readonly Round10Row[]): Round10Report["summary"] {
  const summary: Round10Report["summary"] = [];
  for (const id of ["R30", "R35"] as const) {
    const of = (universe: Round3Universe) => rows.filter((row) => row.id === id && row.universe === universe).map((row) => row.verdict);
    const pit = overallVerdict(of("pit"));
    const adv = overallVerdict(of("adv"));
    summary.push({ id, pit, adv, verdict: overallVerdict([...of("pit"), ...of("adv")]) });
  }
  return summary;
}

export { SPY_BENCH };

export function baselineMatches(row: Round10Row, cell: PublishedCell): boolean {
  return (
    row.id === "B" &&
    row.universe === cell.universe &&
    row.window === cell.window &&
    row.totalUsd === cell.totalUsd &&
    row.mtmDdUsd === cell.mtmDdUsd &&
    row.etfPnlUsd === cell.etfPnlUsd &&
    row.etfN === cell.etfN &&
    row.stockN === cell.stockN &&
    row.jointLossDays === cell.jointLossDays &&
    row.totalNet190Usd === cell.totalNet190Usd
  );
}
