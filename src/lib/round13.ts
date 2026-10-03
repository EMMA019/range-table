import type { Book } from "./backtest-study";
import { totalNet190 } from "./round8";
import { round3Verdict, SPY_BENCH, type Round3Universe, type Round3Window } from "./round3";
import { pathMarks, PUBLISHED_BASELINE, START_CAPITAL, type PublishedCell } from "./round10";
import { bootstrapMean, MAIN_Q, MAIN_Z, overallVerdict, type Verdict } from "./round2";
import { etfExitPrice } from "./round11";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND13_PREREG = "e898e80bebf281626156bd03dcde2a71d9b82dbb";

export const ROUND13_IDS = ["B", "A8", "A7", "A10"] as const;
export type Round13Id = (typeof ROUND13_IDS)[number];
export const JUDGED_IDS = ["A8"] as const;
export const ATR_OF: Record<Exclude<Round13Id, "B">, number> = { A8: 8, A7: 7, A10: 10 };
export const LARGE_LOSS = -60;
export const FOCUS = ["HIMS", "CLS", "SMCI"] as const;

export type SkipCounts = {
  atr: number;
  budget: number;
  slot: number;
  cash: number;
  semi: number;
};

export type SleeveFill = {
  ticker: string;
  entryDate: string;
  pnlUsd: number;
  sleeve: "stock" | "etf";
};

export type FlowSide = {
  n: number;
  pnlUsd: number;
  wins: number;
  winsUsd: number;
  losses: number;
  lossesUsd: number;
  flats: number;
};

export type FlowTicker = FlowSide & { ticker: string };

export type Round13Row = {
  id: Round13Id;
  universe: Round3Universe;
  window: Round3Window;
  totalUsd: number;
  totalNet190Usd: number;
  stockN: number;
  etfN: number;
  n: number;
  stockLargeN: number;
  stockLargeUsd: number;
  mtmDdUsd: number;
  pathDdUsd: number;
  peakDate: string;
  peakUsd: number;
  troughDate: string;
  troughUsd: number;
  lowDate: string;
  lowUsd: number;
  lowVsStartUsd: number;
  skipped: SkipCounts;
  etfPnlUsd: number;
  etfNDelta: number;
  etfPnlDelta: number;
  etfReplacedN: number;
  etfReplacedUsd: number;
  jointLossDays: number;
  removed: FlowSide;
  removedTickers: FlowTicker[];
  replaced: FlowSide;
  replacedTickers: FlowTicker[];
  ratio: number | null;
  ciLow: number | null;
  nRequired: number | null;
  meanUsd: number | null;
  verdict: Verdict;
};

export type Round13Report = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  generatedAt: string;
  hindsight: true;
  primary: 8;
  reference: readonly [7, 10];
  focus: readonly string[];
  spy: typeof SPY_BENCH;
  rows: Round13Row[];
  summary: Array<{ id: (typeof JUDGED_IDS)[number]; pit: Verdict; adv: Verdict; verdict: Verdict }>;
};

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function emptySkips(): SkipCounts {
  return { atr: 0, budget: 0, slot: 0, cash: 0, semi: 0 };
}

/** `(ATR14 / close) × 100` with no extra rounding. A bad input stops the study. */
export function atrPercent(atr: number, close: number): number {
  if (!(close > 0) || !Number.isFinite(close) || !Number.isFinite(atr)) throw new Error("ATRがない");
  return (atr / close) * 100;
}

/** Strictly above X. Cross-multiplied so an exact percent is not pushed over by division. */
export function atrAbove(atr: number, close: number, x: number): boolean {
  if (!(close > 0) || !Number.isFinite(close) || !Number.isFinite(atr) || !Number.isFinite(x)) throw new Error("ATRがない");
  return atr * 100 > x * close;
}

/**
 * In-window candidates that are not voided can be dropped. Equality keeps the name.
 * The baseline drops nobody. SOXX is not a stock candidate.
 */
export function dropReason(args: { atr: number; close: number; inWindow: boolean; voided: boolean; id: Round13Id }): "keep" | "atr" {
  if (!args.inWindow || args.voided || args.id === "B") return "keep";
  if (atrAbove(args.atr, args.close, ATR_OF[args.id])) return "atr";
  return "keep";
}

function keyOf(fill: SleeveFill): string {
  return `${fill.ticker}|${fill.entryDate}`;
}

/** Fills on `source` whose identity is not consumed by `other`. */
export function absentFills(source: readonly SleeveFill[], other: readonly SleeveFill[], sleeve: SleeveFill["sleeve"]): SleeveFill[] {
  const left = new Map<string, number>();
  for (const fill of other) {
    if (fill.sleeve !== sleeve) continue;
    const key = keyOf(fill);
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  const out: SleeveFill[] = [];
  for (const fill of source) {
    if (fill.sleeve !== sleeve) continue;
    const key = keyOf(fill);
    const have = left.get(key) ?? 0;
    if (have > 0) left.set(key, have - 1);
    else out.push(fill);
  }
  return out;
}

function emptySide(): FlowSide {
  return { n: 0, pnlUsd: 0, wins: 0, winsUsd: 0, losses: 0, lossesUsd: 0, flats: 0 };
}

function addFill(side: FlowSide, pnl: number): void {
  side.n += 1;
  side.pnlUsd += pnl;
  if (pnl > 0) {
    side.wins += 1;
    side.winsUsd += pnl;
  } else if (pnl < 0) {
    side.losses += 1;
    side.lossesUsd += pnl;
  } else side.flats += 1;
}

function finish(side: FlowSide): FlowSide {
  return {
    n: side.n,
    pnlUsd: r2(side.pnlUsd),
    wins: side.wins,
    winsUsd: r2(side.winsUsd),
    losses: side.losses,
    lossesUsd: r2(side.lossesUsd),
    flats: side.flats,
  };
}

/** Per-ticker win and loss split. HIMS, CLS, and SMCI stay even when every count is zero. */
export function flowOf(fills: readonly SleeveFill[]): { side: FlowSide; tickers: FlowTicker[] } {
  const byTicker = new Map<string, FlowSide>();
  const total = emptySide();
  for (const fill of fills) {
    addFill(total, fill.pnlUsd);
    const row = byTicker.get(fill.ticker) ?? emptySide();
    addFill(row, fill.pnlUsd);
    byTicker.set(fill.ticker, row);
  }
  for (const ticker of FOCUS) if (!byTicker.has(ticker)) byTicker.set(ticker, emptySide());
  const tickers = [...byTicker.entries()]
    .filter(([ticker, side]) => side.n > 0 || (FOCUS as readonly string[]).includes(ticker))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ticker, side]) => ({ ticker, ...finish(side) }));
  return { side: finish(total), tickers };
}

export function sleeveFills(book: Book): SleeveFill[] {
  const out: SleeveFill[] = [];
  for (const fill of book.fills ?? []) out.push({ ticker: fill.ticker, entryDate: fill.entryDate, pnlUsd: fill.pnlUsd, sleeve: "stock" });
  for (const fill of book.etfFills ?? []) out.push({ ticker: fill.ticker, entryDate: fill.entryDate, pnlUsd: fill.pnlUsd, sleeve: "etf" });
  return out;
}

export function stockLargeLoss(fills: readonly { pnlUsd: number }[]): { n: number; usd: number } {
  let n = 0;
  let usd = 0;
  for (const fill of fills) {
    if (fill.pnlUsd <= LARGE_LOSS) {
      n += 1;
      usd += fill.pnlUsd;
    }
  }
  return { n, usd: r2(usd) };
}

export function scoreRow(
  book: Book,
  id: Round13Id,
  universe: Round3Universe,
  window: Round3Window,
  skipped: SkipCounts,
  judged: boolean,
  base: { fills: readonly SleeveFill[]; etfN: number; etfPnlUsd: number } | null,
): Round13Row {
  const stock = book.fills;
  const etf = book.etfFills;
  const daily = book.daily;
  if (!stock || !etf || !book.sleeve || !daily) throw new Error(`内訳がない ${id} ${universe} ${window}`);
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
  const own = sleeveFills(book);
  const prior = base?.fills ?? own;
  const removed = flowOf(absentFills(prior, own, "stock"));
  const replaced = flowOf(absentFills(own, prior, "stock"));
  const etfNew = flowOf(absentFills(own, prior, "etf"));
  const boot = bootstrapMean(pnls, MAIN_Q, MAIN_Z);
  const ratio = book.maxDrawdownUsd > 0 ? r2(book.totalUsd / book.maxDrawdownUsd) : null;
  const path = pathMarks(daily);
  const large = stockLargeLoss(own.filter((fill) => fill.sleeve === "stock"));
  const etfPnlUsd = r2(etf.reduce((sum, fill) => sum + fill.pnlUsd, 0));
  const etfBaseN = base?.etfN ?? etf.length;
  const etfBasePnl = base?.etfPnlUsd ?? etfPnlUsd;
  return {
    id,
    universe,
    window,
    totalUsd: book.totalUsd,
    totalNet190Usd: totalNet190(trades),
    stockN: stock.length,
    etfN: etf.length,
    n: pnls.length,
    stockLargeN: large.n,
    stockLargeUsd: large.usd,
    mtmDdUsd: book.maxDrawdownUsd,
    pathDdUsd: path.pathDdUsd,
    peakDate: path.peakDate,
    peakUsd: path.peakUsd,
    troughDate: path.troughDate,
    troughUsd: path.troughUsd,
    lowDate: path.lowDate,
    lowUsd: path.lowUsd,
    lowVsStartUsd: path.lowVsStartUsd,
    skipped,
    etfPnlUsd,
    etfNDelta: etf.length - etfBaseN,
    etfPnlDelta: r2(etfPnlUsd - etfBasePnl),
    etfReplacedN: etfNew.side.n,
    etfReplacedUsd: etfNew.side.pnlUsd,
    jointLossDays: book.sleeve.bothNegativeDays,
    removed: removed.side,
    removedTickers: removed.tickers,
    replaced: replaced.side,
    replacedTickers: replaced.tickers,
    ratio,
    ciLow: boot.lower == null ? null : r4(boot.lower),
    nRequired: boot.nRequired == null ? null : r2(boot.nRequired),
    meanUsd: pnls.length ? r2(pnls.reduce((sum, value) => sum + value, 0) / pnls.length) : null,
    verdict: round3Verdict({
      judged,
      totalUsd: book.totalUsd,
      n: pnls.length,
      ratio,
      spyRatio: SPY_BENCH[window].ratio,
      lower: boot.lower,
      nRequired: boot.nRequired,
    }),
  };
}

export function summarize(rows: readonly Round13Row[]): Round13Report["summary"] {
  const summary: Round13Report["summary"] = [];
  for (const id of JUDGED_IDS) {
    const of = (universe: Round3Universe) => rows.filter((row) => row.id === id && row.universe === universe).map((row) => row.verdict);
    const pit = overallVerdict(of("pit"));
    const adv = overallVerdict(of("adv"));
    summary.push({ id, pit, adv, verdict: overallVerdict([...of("pit"), ...of("adv")]) });
  }
  return summary;
}

export function baselineMatches(row: Round13Row, cell: PublishedCell): boolean {
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
    row.totalNet190Usd === cell.totalNet190Usd &&
    row.removed.n === 0 &&
    row.replaced.n === 0 &&
    row.etfNDelta === 0 &&
    row.etfPnlDelta === 0 &&
    row.etfReplacedN === 0 &&
    row.skipped.atr === 0
  );
}

export { etfExitPrice, PUBLISHED_BASELINE, SPY_BENCH, START_CAPITAL };
