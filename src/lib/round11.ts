import type { Book } from "./backtest-study";
import { totalNet190 } from "./round8";
import { NUCLEAR } from "./round7b";
import { round3Verdict, SPY_BENCH, type Round3Universe, type Round3Window } from "./round3";
import { pathMarks, PUBLISHED_BASELINE, START_CAPITAL, type PublishedCell } from "./round10";
import { bootstrapMean, MAIN_Q, MAIN_Z, overallVerdict, type Verdict } from "./round2";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND11_PREREG = "5fa41617b9fb48abea6e6f45eb9d84a6bb57743a";

export const ROUND11_IDS = ["B", "X10", "X12", "X15", "EX"] as const;
export type Round11Id = (typeof ROUND11_IDS)[number];
export const WIDTH_OF: Record<"X10" | "X12" | "X15", number> = { X10: 0.1, X12: 0.12, X15: 0.15 };
export const LARGE_LOSS = -60;

/** Round-7b nuclear list. The wider generation group is not this list. */
export const NUCLEAR_EXCLUDE = ["CEG", "TLN", "OKLO", "SMR", "CCJ", "LEU"] as const;
/** Watchlist descriptions that contain マイニング. APLD and CORZ are not in this list. */
export const CRYPTO_EXCLUDE = ["IREN", "CIFR", "WULF"] as const;
/** No solar tag, group, or description exists in the repo. */
export const SOLAR_EXCLUDE = [] as const;
export const EXCEPTION_KEEP = "SPCX";
export const NAMED_TICKERS = ["NBIS", "CRWV", "CRDO", "CVNA", "ENPH", "SEDG"] as const;
export type NamedTicker = (typeof NAMED_TICKERS)[number];

const THEME = new Set<string>([...NUCLEAR_EXCLUDE, ...CRYPTO_EXCLUDE, ...SOLAR_EXCLUDE]);

export type WidthMode = { kind: "baseline" } | { kind: "width"; x: number } | { kind: "theme" };
export type DropReason = "keep" | "width" | "theme";

export type SkipCounts = {
  width: number;
  theme: number;
  lossMaker: number;
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

export type NamedStat = {
  ticker: NamedTicker;
  n: number;
  pnlUsd: number;
  removedN: number;
  removedUsd: number;
  removedLossUsd: number;
};

export type Round11Row = {
  id: Round11Id;
  universe: Round3Universe;
  window: Round3Window;
  totalUsd: number;
  totalNet190Usd: number;
  stockN: number;
  etfN: number;
  n: number;
  wins: number;
  winsLostStock: number;
  winsLostEtf: number;
  winRate: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  largeN: number;
  largeUsd: number;
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
  stockUtil: number;
  etfUtil: number;
  deployed: number;
  skipped: SkipCounts;
  etfPnlUsd: number;
  etfNDelta: number;
  etfPnlDelta: number;
  jointLossDays: number;
  names: NamedStat[];
  ratio: number | null;
  ciLow: number | null;
  nRequired: number | null;
  meanUsd: number | null;
  verdict: Verdict;
};

export type Round11Report = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  generatedAt: string;
  exclusion: {
    hindsight: true;
    judged: false;
    nuclear: readonly string[];
    crypto: readonly string[];
    solar: readonly string[];
    lossMaker: "already-in-baseline";
    exception: typeof EXCEPTION_KEEP;
  };
  spy: typeof SPY_BENCH;
  rows: Round11Row[];
  summary: Array<{ id: "X10" | "X12" | "X15"; pit: Verdict; adv: Verdict; verdict: Verdict }>;
};

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function emptySkips(): SkipCounts {
  return { width: 0, theme: 0, lossMaker: 0, budget: 0, slot: 0, cash: 0, semi: 0 };
}

/** True when the ticker is on the locked nuclear or crypto list. SPCX is never excluded. */
export function themeExcluded(ticker: string): boolean {
  if (ticker === EXCEPTION_KEEP) return false;
  return THEME.has(ticker);
}

/**
 * Width and theme drops apply only to an in-window candidate that is not voided.
 * A fraction equal to X stays. A non-positive distance stays. A missing stop on a width test throws.
 */
export function dropReason(args: {
  ticker: string;
  entry: number;
  stop: number | null | undefined;
  inWindow: boolean;
  voided: boolean;
  mode: WidthMode;
}): DropReason {
  if (!args.inWindow || args.voided || args.mode.kind === "baseline") return "keep";
  if (args.mode.kind === "theme") return themeExcluded(args.ticker) ? "theme" : "keep";
  if (!(args.entry > 0) || args.stop == null || !Number.isFinite(args.stop)) {
    throw new Error(`損切りがない ${args.ticker}`);
  }
  if ((args.entry - args.stop) / args.entry > args.mode.x) return "width";
  return "keep";
}

function keyOf(fill: SleeveFill): string {
  return `${fill.sleeve}|${fill.ticker}|${fill.entryDate}`;
}

/** Baseline winning positions of one sleeve whose identity is absent from the variant. */
export function winsLost(base: readonly SleeveFill[], variant: readonly SleeveFill[], sleeve: SleeveFill["sleeve"]): number {
  const left = new Map<string, number>();
  for (const fill of variant) {
    if (fill.sleeve !== sleeve) continue;
    const key = keyOf(fill);
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  let n = 0;
  for (const fill of base) {
    if (fill.sleeve !== sleeve || !(fill.pnlUsd > 0)) continue;
    const key = keyOf(fill);
    const have = left.get(key) ?? 0;
    if (have > 0) left.set(key, have - 1);
    else n += 1;
  }
  return n;
}

export function largeLoss(fills: readonly { pnlUsd: number }[]): { n: number; usd: number } {
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

/** Filled trades of one ticker, and the baseline trades of that ticker the variant did not fill. */
export function namedStat(base: readonly SleeveFill[], variant: readonly SleeveFill[], ticker: NamedTicker): NamedStat {
  const left = new Map<string, number>();
  let n = 0;
  let pnl = 0;
  for (const fill of variant) {
    if (fill.sleeve !== "stock" || fill.ticker !== ticker) continue;
    n += 1;
    pnl += fill.pnlUsd;
    const key = fill.entryDate;
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  let removedN = 0;
  let removedUsd = 0;
  let removedLossUsd = 0;
  for (const fill of base) {
    if (fill.sleeve !== "stock" || fill.ticker !== ticker) continue;
    const have = left.get(fill.entryDate) ?? 0;
    if (have > 0) {
      left.set(fill.entryDate, have - 1);
      continue;
    }
    removedN += 1;
    removedUsd += fill.pnlUsd;
    if (fill.pnlUsd < 0) removedLossUsd += fill.pnlUsd;
  }
  return { ticker, n, pnlUsd: r2(pnl), removedN, removedUsd: r2(removedUsd), removedLossUsd: r2(removedLossUsd) };
}

export function sleeveFills(book: Book): SleeveFill[] {
  const out: SleeveFill[] = [];
  for (const fill of book.fills ?? []) out.push({ ticker: fill.ticker, entryDate: fill.entryDate, pnlUsd: fill.pnlUsd, sleeve: "stock" });
  for (const fill of book.etfFills ?? []) out.push({ ticker: fill.ticker, entryDate: fill.entryDate, pnlUsd: fill.pnlUsd, sleeve: "etf" });
  return out;
}

export function scoreRow(
  book: Book,
  id: Round11Id,
  universe: Round3Universe,
  window: Round3Window,
  skipped: SkipCounts,
  judged: boolean,
  base: { fills: readonly SleeveFill[]; etfN: number; etfPnlUsd: number } | null,
): Round11Row {
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
  const own = sleeveFills(book);
  const prior = base?.fills ?? own;
  const boot = bootstrapMean(pnls, MAIN_Q, MAIN_Z);
  const ratio = book.maxDrawdownUsd > 0 ? r2(book.totalUsd / book.maxDrawdownUsd) : null;
  const spy = SPY_BENCH[window];
  const path = pathMarks(daily);
  const allLarge = largeLoss(own);
  const stockLarge = largeLoss(own.filter((fill) => fill.sleeve === "stock"));
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
    wins: wins.length,
    winsLostStock: winsLost(prior, own, "stock"),
    winsLostEtf: winsLost(prior, own, "etf"),
    winRate: pnls.length ? r4(wins.length / pnls.length) : null,
    avgWinUsd: wins.length ? r2(wins.reduce((sum, pnl) => sum + pnl, 0) / wins.length) : null,
    avgLossUsd: losses.length ? r2(losses.reduce((sum, pnl) => sum + pnl, 0) / losses.length) : null,
    largeN: allLarge.n,
    largeUsd: allLarge.usd,
    stockLargeN: stockLarge.n,
    stockLargeUsd: stockLarge.usd,
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
    etfPnlUsd,
    etfNDelta: etf.length - etfBaseN,
    etfPnlDelta: r2(etfPnlUsd - etfBasePnl),
    jointLossDays: sleeve.bothNegativeDays,
    names: NAMED_TICKERS.map((ticker) => namedStat(prior, own, ticker)),
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

export function summarize(rows: readonly Round11Row[]): Round11Report["summary"] {
  const summary: Round11Report["summary"] = [];
  for (const id of ["X10", "X12", "X15"] as const) {
    const of = (universe: Round3Universe) => rows.filter((row) => row.id === id && row.universe === universe).map((row) => row.verdict);
    const pit = overallVerdict(of("pit"));
    const adv = overallVerdict(of("adv"));
    summary.push({ id, pit, adv, verdict: overallVerdict([...of("pit"), ...of("adv")]) });
  }
  return summary;
}

export function baselineMatches(row: Round11Row, cell: PublishedCell): boolean {
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
    row.winsLostStock === 0 &&
    row.winsLostEtf === 0 &&
    row.etfNDelta === 0 &&
    row.etfPnlDelta === 0 &&
    row.skipped.width === 0 &&
    row.skipped.theme === 0 &&
    row.skipped.lossMaker === 0
  );
}

export function listsMatchRound7b(): boolean {
  return NUCLEAR_EXCLUDE.length === NUCLEAR.length && NUCLEAR_EXCLUDE.every((ticker, index) => ticker === NUCLEAR[index]);
}

/** Closing-leg fill for an ETF position. A stop through the open sells that open. A target through the open sells that open. */
export function etfExitPrice(args: {
  reason: string;
  entryDate: string;
  exitDate: string;
  open: number;
  close: number;
  stop: number;
  target: number;
}): number {
  if (args.reason === "preempted") return args.open;
  if (args.reason === "window" || args.reason === "timeout") return args.close;
  if (args.reason === "stop") return args.exitDate !== args.entryDate && args.open < args.stop ? args.open : args.close;
  if (args.reason === "target") return args.exitDate !== args.entryDate && args.open >= args.target ? args.open : args.target;
  throw new Error(`ETFの出口が不明 ${args.reason}`);
}

export { PUBLISHED_BASELINE, SPY_BENCH, START_CAPITAL };
