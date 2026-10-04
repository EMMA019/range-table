import type { Book } from "./backtest-study";
import { pathMarks, PUBLISHED_BASELINE, type PublishedCell } from "./round10";
import { type Round3Universe, type Round3Window } from "./round3";
import { totalNet190 } from "./round8";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND15_PREREG = "f7d4d3a5284961cb58948fce6e4812e6e782b3e5";

/** Current Wikipedia column `GICS Sector`. Not the watchlist group `financials`. */
export const FINANCIALS_GICS = "Financials";

export const ROUND15_IDS = ["baseline", "ex-financials"] as const;
export type Round15Id = (typeof ROUND15_IDS)[number];

export function isGicsFinancials(sector: string | null | undefined): boolean {
  return sector === FINANCIALS_GICS;
}

/**
 * Drop in-window, not-voided candidates whose current GICS sector is Financials.
 * A name outside the window, or a voided name, stays in the list the walk already ignores.
 */
export function dropFinancials<T extends { ticker: string; voided: boolean }>(
  cands: readonly T[],
  inWindow: (cand: T) => boolean,
  sectorOf: (ticker: string) => string | null,
  enabled: boolean,
): { taken: T[]; dropped: number } {
  if (!enabled) return { taken: [...cands], dropped: 0 };
  const taken: T[] = [];
  let dropped = 0;
  for (const cand of cands) {
    if (inWindow(cand) && !cand.voided && isGicsFinancials(sectorOf(cand.ticker))) {
      dropped += 1;
      continue;
    }
    taken.push(cand);
  }
  return { taken, dropped };
}

export function winRateOf(pnls: readonly number[]): number | null {
  if (!pnls.length) return null;
  const wins = pnls.reduce((count, pnl) => count + (pnl > 0 ? 1 : 0), 0);
  return Math.round((wins / pnls.length) * 10000) / 10000;
}

export type StockPnl = { ticker: string; entryDate: string; pnlUsd: number; sells: number };

export type RemovedFinancials = {
  n: number;
  engineUsd: number;
  net190Usd: number;
  tickers: string[];
};

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Baseline stock fills whose current GICS sector is exactly Financials. */
export function removedFinancials(fills: readonly StockPnl[], sectorOf: (ticker: string) => string | null): RemovedFinancials {
  const kept = fills.filter((fill) => isGicsFinancials(sectorOf(fill.ticker)));
  const tickers = [...new Set(kept.map((fill) => fill.ticker))].sort();
  return {
    n: kept.length,
    engineUsd: r2(kept.reduce((sum, fill) => sum + fill.pnlUsd, 0)),
    net190Usd: totalNet190(kept.map((fill) => ({ pnlUsd: fill.pnlUsd, sells: fill.sells }))),
    tickers,
  };
}

/**
 * Baseline stock fills in the watchlist group `financials` whose GICS sector is not Financials.
 * They stay in the book. The list is the gap between the two definitions.
 */
export function watchlistNotGics(fills: readonly StockPnl[], sectorOf: (ticker: string) => string | null, watchFinancials: ReadonlySet<string>): string[] {
  const tickers = new Set<string>();
  for (const fill of fills) {
    if (watchFinancials.has(fill.ticker) && !isGicsFinancials(sectorOf(fill.ticker))) tickers.add(fill.ticker);
  }
  return [...tickers].sort();
}

export type Round15Row = {
  id: Round15Id;
  universe: Round3Universe;
  window: Round3Window;
  totalUsd: number;
  totalNet190Usd: number;
  stockN: number;
  etfN: number;
  n: number;
  winRate: number | null;
  mtmDdUsd: number;
  lowDate: string;
  lowUsd: number;
  etfPnlUsd: number;
  jointLossDays: number;
  dropped: number;
};

export function scoreRow(book: Book, id: Round15Id, universe: Round3Universe, window: Round3Window, dropped: number): Round15Row {
  const stock = book.fills;
  const etf = book.etfFills;
  const daily = book.daily;
  if (!stock || !etf || !book.sleeve || !daily) throw new Error(`内訳がない ${id} ${universe} ${window}`);
  const trades: Array<{ pnlUsd: number; sells: number }> = [];
  for (const fill of stock) trades.push({ pnlUsd: fill.pnlUsd, sells: fill.legs?.length || 1 });
  for (const fill of etf) {
    if (!fill.legs.length) throw new Error(`ETFの足がない ${fill.entryDate}`);
    trades.push({ pnlUsd: fill.pnlUsd, sells: fill.legs.length });
  }
  const path = pathMarks(daily);
  return {
    id,
    universe,
    window,
    totalUsd: book.totalUsd,
    totalNet190Usd: totalNet190(trades),
    stockN: stock.length,
    etfN: etf.length,
    n: trades.length,
    winRate: winRateOf(trades.map((trade) => trade.pnlUsd)),
    mtmDdUsd: book.maxDrawdownUsd,
    lowDate: path.lowDate,
    lowUsd: path.lowUsd,
    etfPnlUsd: r2(etf.reduce((sum, fill) => sum + fill.pnlUsd, 0)),
    jointLossDays: book.sleeve.bothNegativeDays,
    dropped,
  };
}

export function baselineMatches(row: Round15Row, cell: PublishedCell): boolean {
  return (
    row.id === "baseline" &&
    row.universe === cell.universe &&
    row.window === cell.window &&
    row.totalUsd === cell.totalUsd &&
    row.mtmDdUsd === cell.mtmDdUsd &&
    row.etfPnlUsd === cell.etfPnlUsd &&
    row.etfN === cell.etfN &&
    row.stockN === cell.stockN &&
    row.jointLossDays === cell.jointLossDays &&
    row.totalNet190Usd === cell.totalNet190Usd &&
    row.dropped === 0
  );
}

export const PUBLISHED_PIT_ADV = PUBLISHED_BASELINE.filter((cell) => cell.universe === "pit" || cell.universe === "adv");

export type QuantumTtm = { status: "negative" | "nonnegative" | "unknown"; ttm: number | null };

export type QuantumMembership = {
  ticker: string;
  inWatchlist: boolean;
  inSp500: boolean;
  inSp400: boolean;
  hasBars: boolean;
  pitMember: { oos: boolean; in: boolean };
  pitEligible: { oos: boolean; in: boolean };
  advSessions: { oos: number; in: number };
  edgarCik: string | null;
  slimFacts: boolean;
  ttm: { oos: QuantumTtm; in: QuantumTtm; lastBar: QuantumTtm };
};

export type YahooEps = { trailingEps: number | null; forwardEps: number | null; error: string | null };

export type Round15Cell = {
  universe: Round3Universe;
  window: Round3Window;
  baseline: Round15Row;
  exFinancials: Round15Row;
  removed: RemovedFinancials;
  watchlistNotGics: string[];
};

export type Round15Report = {
  v: 1;
  prereg: string;
  generatedAt: string;
  gicsSource: string;
  selection: string;
  quantumNote: string;
  quantum: QuantumMembership[];
  yahoo: { retrievedOn: string; source: string; byTicker: Record<string, YahooEps> } | { error: string };
  cells: Round15Cell[];
};
