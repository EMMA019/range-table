import type { Book } from "./backtest-study";
import { lineOf } from "./etf-sleeve";
import { MAIN_Q, MAIN_Z, bootstrapMean, overallVerdict, type Verdict } from "./round2";
import { SPY_BENCH, round3Verdict, type Round3Universe, type Round3Window } from "./round3";
import { totalNet190 } from "./round8";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND9_PREREG = "be25969bcf1986a6bd4461943554ad64ae4c8ac1";

export const SMA_WINDOW = 20;

export const ROUND9_BASES = ["C", "SOXX"] as const;
export type Round9Base = (typeof ROUND9_BASES)[number];

export const ROUND9_FILTERS = ["off", "stop", "strict", "stop-all"] as const;
export type RegimeFilter = (typeof ROUND9_FILTERS)[number];

/** Tie break for the best active book. Earlier pairs win an equal sum. */
export const ACTIVE_ORDER = [
  ["C", "stop"],
  ["C", "strict"],
  ["C", "stop-all"],
  ["SOXX", "stop"],
  ["SOXX", "strict"],
  ["SOXX", "stop-all"],
] as const;

const JUDGED_CELLS: Array<{ universe: Round3Universe; window: Round3Window }> = [
  { universe: "pit", window: "oos" },
  { universe: "pit", window: "in" },
  { universe: "adv", window: "oos" },
  { universe: "adv", window: "in" },
];

export type Round9Row = {
  base: Round9Base;
  filter: RegimeFilter;
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
  mtmDdUsd: number;
  jointLossDays: number;
  stockUtil: number;
  etfUtil: number;
  belowShare: number;
  etfPnlUsd: number;
  ratio: number | null;
  ciLow: number | null;
  nRequired: number | null;
  meanUsd: number | null;
  verdict: Verdict;
};

export type Round9CellDelta = {
  universe: Round3Universe;
  window: Round3Window;
  deltaUsd: number;
};

export type Round9Selection = {
  books: 8;
  active: 6;
  bestBase: Round9Base;
  bestFilter: Exclude<RegimeFilter, "off">;
  sumDeltaUsd: number;
  consistent: boolean;
  cells: Round9CellDelta[];
};

export type Round9Report = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  generatedAt: string;
  sma: 20;
  spy: typeof SPY_BENCH;
  rows: Round9Row[];
  summary: Array<{ base: Round9Base; filter: RegimeFilter; pit: Verdict; adv: Verdict; verdict: Verdict }>;
  selection: Round9Selection;
};

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** True when the SPY close is strictly below the 20-close average ending that session. */
export function belowByDate(bars: readonly { date: string; c: number }[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars[i].c;
    if (i >= SMA_WINDOW) sum -= bars[i - SMA_WINDOW].c;
    const ready = i >= SMA_WINDOW - 1;
    out.set(bars[i].date, ready && bars[i].c < sum / SMA_WINDOW);
  }
  return out;
}

/** Share of the listed sessions that are below. A missing session counts as not below. */
export function belowShare(sessions: readonly string[], below: ReadonlyMap<string, boolean>): number {
  if (!sessions.length) return 0;
  let n = 0;
  for (const date of sessions) if (below.get(date) === true) n += 1;
  return n / sessions.length;
}

/**
 * Stock gate. `F-off` keeps the candidate. A session that is not below keeps it.
 * `F-stop` and `F-stop-all` drop it on a below session.
 * `F-strict` keeps it on a below session only when the close is at or above the 30% line.
 */
export function keepStock(
  filter: RegimeFilter,
  signalDate: string,
  below: ReadonlyMap<string, boolean>,
  close: number,
  low: number | null,
  high: number | null,
): boolean {
  if (filter === "off" || below.get(signalDate) !== true) return true;
  if (filter === "stop" || filter === "stop-all") return false;
  if (low == null || high == null) return false;
  const line = lineOf(low, high, 0.3);
  if (line == null) return false;
  return close >= line;
}

/** SOXX gate. Only `F-stop-all` drops an order whose signal session is below. */
export function keepEtfOrder(filter: RegimeFilter, signalDate: string | undefined, below: ReadonlyMap<string, boolean>): boolean {
  if (filter !== "stop-all" || !signalDate) return true;
  return below.get(signalDate) !== true;
}

export function scoreRow(
  book: Book,
  base: Round9Base,
  filter: RegimeFilter,
  universe: Round3Universe,
  window: Round3Window,
  share: number,
  judged: boolean,
): Round9Row {
  const stock = book.fills;
  const etf = book.etfFills;
  const sleeve = book.sleeve;
  if (!stock || !etf || !sleeve) throw new Error(`内訳がない ${base} ${filter} ${universe} ${window}`);
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
  return {
    base,
    filter,
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
    mtmDdUsd: book.maxDrawdownUsd,
    jointLossDays: sleeve.bothNegativeDays,
    stockUtil: sleeve.stockUtil,
    etfUtil: sleeve.etfUtil,
    belowShare: r4(share),
    etfPnlUsd: r2(etf.reduce((sum, fill) => sum + fill.pnlUsd, 0)),
    ratio,
    ciLow: boot.lower == null ? null : r4(boot.lower),
    nRequired: boot.nRequired == null ? null : r2(boot.nRequired),
    meanUsd: pnls.length ? r2(pnls.reduce((sum, pnl) => sum + pnl, 0) / pnls.length) : null,
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

/** Largest four-cell engine-P&L improvement over F-off. Ties keep the earlier pair in ACTIVE_ORDER. */
export function selectBest(rows: readonly Round9Row[]): Round9Selection {
  const find = (base: Round9Base, filter: RegimeFilter, universe: Round3Universe, window: Round3Window) =>
    rows.find((row) => row.base === base && row.filter === filter && row.universe === universe && row.window === window);
  let winner: { base: Round9Base; filter: Exclude<RegimeFilter, "off">; sum: number; cells: Round9CellDelta[] } | null = null;
  for (const [base, filter] of ACTIVE_ORDER) {
    const cells: Round9CellDelta[] = [];
    let sum = 0;
    for (const cell of JUDGED_CELLS) {
      const row = find(base, filter, cell.universe, cell.window);
      const off = find(base, "off", cell.universe, cell.window);
      if (!row || !off) throw new Error(`セルがない ${base} ${filter} ${cell.universe} ${cell.window}`);
      const deltaUsd = r2(row.totalUsd - off.totalUsd);
      sum += deltaUsd;
      cells.push({ universe: cell.universe, window: cell.window, deltaUsd });
    }
    sum = r2(sum);
    if (!winner || sum > winner.sum) winner = { base, filter, sum, cells };
  }
  if (!winner) throw new Error("比較がない");
  return {
    books: 8,
    active: 6,
    bestBase: winner.base,
    bestFilter: winner.filter,
    sumDeltaUsd: winner.sum,
    consistent: winner.cells.every((cell) => cell.deltaUsd > 0),
    cells: winner.cells,
  };
}

export function summarize(rows: readonly Round9Row[]): Round9Report["summary"] {
  const summary: Round9Report["summary"] = [];
  for (const base of ROUND9_BASES) {
    for (const filter of ROUND9_FILTERS) {
      const of = (universe: Round3Universe) =>
        rows.filter((row) => row.base === base && row.filter === filter && row.universe === universe).map((row) => row.verdict);
      const pit = overallVerdict(of("pit"));
      const adv = overallVerdict(of("adv"));
      summary.push({ base, filter, pit, adv, verdict: overallVerdict([...of("pit"), ...of("adv")]) });
    }
  }
  return summary;
}

export { SPY_BENCH };
