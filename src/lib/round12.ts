import type { Book } from "./backtest-study";
import { totalNet190 } from "./round8";
import { NUCLEAR as ROUND7B_NUCLEAR } from "./round7b";
import { round3Verdict, SPY_BENCH, type Round3Universe, type Round3Window } from "./round3";
import { pathMarks, PUBLISHED_BASELINE, START_CAPITAL, type PublishedCell } from "./round10";
import { bootstrapMean, MAIN_Q, MAIN_Z, overallVerdict, type Verdict } from "./round2";
import { etfExitPrice } from "./round11";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND12_PREREG = "a4eba5a074f72aae273651b17b277e2e4b3f08dd";

export const SOLAR = ["ENPH", "SEDG", "FSLR", "RUN", "ARRY", "NXT", "SHLS", "CSIQ", "JKS", "SPWR", "MAXN", "NOVA"] as const;
export const CRYPTO = ["COIN", "MSTR", "MARA", "RIOT", "CLSK", "HUT", "IREN", "CIFR", "WULF", "BTDR", "BITF"] as const;
export const NUCLEAR_LIST = ["CEG", "TLN", "OKLO", "SMR", "CCJ", "LEU", "NNE", "BWXT"] as const;
export const HOOD = "HOOD";
export const EXCEPTION_KEEP = "SPCX";
export const FOCUS = ["COIN", "HOOD", "MSTR"] as const;
export const LARGE_LOSS = -60;

export const ROUND12_IDS = ["B", "S", "C", "N", "A", "H"] as const;
export type Round12Id = (typeof ROUND12_IDS)[number];
export const JUDGED_IDS = ["S", "C", "N", "A", "H"] as const;

const SOLAR_SET = new Set<string>(SOLAR);
const CRYPTO_SET = new Set<string>(CRYPTO);
const NUCLEAR_SET = new Set<string>(NUCLEAR_LIST);

export type SkipCounts = {
  list: number;
  f1Only: number;
  f1Negative: number;
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

export type Round12Row = {
  id: Round12Id;
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

export type Round12Report = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  generatedAt: string;
  lists: {
    solar: readonly string[];
    crypto: readonly string[];
    nuclear: readonly string[];
    hood: typeof HOOD;
    exception: typeof EXCEPTION_KEEP;
    lossMaker: "already-in-baseline";
  };
  spy: typeof SPY_BENCH;
  rows: Round12Row[];
  summary: Array<{ id: (typeof JUDGED_IDS)[number]; pit: Verdict; adv: Verdict; verdict: Verdict }>;
};

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function emptySkips(): SkipCounts {
  return { list: 0, f1Only: 0, f1Negative: 0, budget: 0, slot: 0, cash: 0, semi: 0 };
}

export function listsAreDisjoint(): boolean {
  const all = [...SOLAR, ...CRYPTO, ...NUCLEAR_LIST, HOOD];
  return new Set(all).size === all.length && !all.includes(EXCEPTION_KEEP);
}

export function nuclearCoversRound7b(): boolean {
  return ROUND7B_NUCLEAR.every((ticker) => NUCLEAR_SET.has(ticker));
}

/** True when this row's list contains the ticker. SPCX is never excluded. HOOD is only on H. */
export function listExcluded(ticker: string, id: Round12Id): boolean {
  if (ticker === EXCEPTION_KEEP || id === "B") return false;
  if (id === "S") return SOLAR_SET.has(ticker);
  if (id === "C") return CRYPTO_SET.has(ticker);
  if (id === "N") return NUCLEAR_SET.has(ticker);
  if (id === "A") return SOLAR_SET.has(ticker) || CRYPTO_SET.has(ticker) || NUCLEAR_SET.has(ticker);
  return SOLAR_SET.has(ticker) || CRYPTO_SET.has(ticker) || NUCLEAR_SET.has(ticker) || ticker === HOOD;
}

/** In-window candidates that are not voided can be dropped. The baseline drops nobody. */
export function dropReason(args: { ticker: string; inWindow: boolean; voided: boolean; id: Round12Id }): "keep" | "list" {
  if (!args.inWindow || args.voided) return "keep";
  return listExcluded(args.ticker, args.id) ? "list" : "keep";
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

/** Per-ticker win and loss split. COIN, HOOD, and MSTR stay even when every count is zero. */
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
  id: Round12Id,
  universe: Round3Universe,
  window: Round3Window,
  skipped: SkipCounts,
  judged: boolean,
  base: { fills: readonly SleeveFill[]; etfN: number; etfPnlUsd: number } | null,
): Round12Row {
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

export function summarize(rows: readonly Round12Row[]): Round12Report["summary"] {
  const summary: Round12Report["summary"] = [];
  for (const id of JUDGED_IDS) {
    const of = (universe: Round3Universe) => rows.filter((row) => row.id === id && row.universe === universe).map((row) => row.verdict);
    const pit = overallVerdict(of("pit"));
    const adv = overallVerdict(of("adv"));
    summary.push({ id, pit, adv, verdict: overallVerdict([...of("pit"), ...of("adv")]) });
  }
  return summary;
}

export function baselineMatches(row: Round12Row, cell: PublishedCell): boolean {
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
    row.skipped.list === 0
  );
}

export { etfExitPrice, PUBLISHED_BASELINE, SPY_BENCH, START_CAPITAL };
