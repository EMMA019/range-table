import { totalNet190 } from "./round8";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND12B_PREREG = "d8716af07cc58fdead478be5bddc16f92aaa4f6b";

export const LARGE_LOSS = -60;
export const BUCKETS = ["<3", "3-4", "4-5", "5-6", "6-8", "8-10", ">=10"] as const;
export type Bucket = (typeof BUCKETS)[number];

export type SectorSource = "gics" | "watchlist" | "unknown";

export type StockTrade = {
  ticker: string;
  entryDate: string;
  pnlUsd: number;
  sells: number;
  sector: string;
  source: SectorSource;
  atrPct: number;
};

export type GroupStat = {
  key: string;
  n: number;
  wins: number;
  winRate: number | null;
  avgUsd: number | null;
  totalUsd: number;
  largeN: number;
  source?: SectorSource;
};

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Below 3, then half-open buckets. A percent of exactly 10 is `>=10`. */
export function bucketOf(percent: number): Bucket {
  if (!(percent >= 0) || !Number.isFinite(percent)) throw new Error("ATR%がない");
  if (percent < 3) return "<3";
  if (percent < 4) return "3-4";
  if (percent < 5) return "4-5";
  if (percent < 6) return "5-6";
  if (percent < 8) return "6-8";
  if (percent < 10) return "8-10";
  return ">=10";
}

export function groupStats(trades: readonly StockTrade[], keyOf: (trade: StockTrade) => string): GroupStat[] {
  const rows = new Map<string, GroupStat & { source: SectorSource }>();
  for (const trade of trades) {
    const key = keyOf(trade);
    const row = rows.get(key) ?? { key, n: 0, wins: 0, winRate: null, avgUsd: null, totalUsd: 0, largeN: 0, source: trade.source };
    row.n += 1;
    row.totalUsd += trade.pnlUsd;
    if (trade.pnlUsd > 0) row.wins += 1;
    if (trade.pnlUsd <= LARGE_LOSS) row.largeN += 1;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((row) => ({
      key: row.key,
      n: row.n,
      wins: row.wins,
      winRate: row.n ? r4(row.wins / row.n) : null,
      avgUsd: row.n ? r2(row.totalUsd / row.n) : null,
      totalUsd: r2(row.totalUsd),
      largeN: row.largeN,
      source: row.source,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd || a.key.localeCompare(b.key));
}

export function sectorTable(trades: readonly StockTrade[]): GroupStat[] {
  return groupStats(trades, (trade) => trade.sector);
}

export function bucketTable(trades: readonly StockTrade[]): GroupStat[] {
  const found = new Map(groupStats(trades, (trade) => bucketOf(trade.atrPct)).map((row) => [row.key, row]));
  return BUCKETS.map(
    (key) => found.get(key) ?? { key, n: 0, wins: 0, winRate: null, avgUsd: null, totalUsd: 0, largeN: 0 },
  );
}

export function flowOf(trades: readonly { pnlUsd: number; sells: number }[]): { n: number; pnlUsd: number; netUsd: number } {
  return {
    n: trades.length,
    pnlUsd: r2(trades.reduce((sum, trade) => sum + trade.pnlUsd, 0)),
    netUsd: totalNet190(trades),
  };
}

/** GICS wins over the watchlist. An empty label is unknown. */
export function sectorOf(gics: string | null, watch: string | null): { sector: string; source: SectorSource } {
  if (gics) return { sector: gics, source: "gics" };
  if (watch) return { sector: watch, source: "watchlist" };
  return { sector: "unknown", source: "unknown" };
}

export type Flow = { n: number; pnlUsd: number; netUsd: number };

export type Round12bCell = {
  universe: "core" | "pit" | "adv";
  window: "oos" | "in";
  baselineUsd: number;
  baselineNetUsd: number;
  baselineStockN: number;
  baselineEtfN: number;
  stockN: number;
  stockUsd: number;
  stockNetUsd: number;
  soxxN: number;
  soxxUsd: number;
  soxxNetUsd: number;
  deployedUsd: number;
  deployedDate: string;
  returnOnDeployed: number;
  engineReturnOnDeployed: number;
  cash: Flow;
  cashUnfilled: number;
  path: { n: number; pnlUsd: number };
  slot: { n: number; pnlUsd: number };
  semi: { n: number; pnlUsd: number };
  sectors: GroupStat[];
  topSector: string | null;
  bottomSector: string | null;
  buckets: GroupStat[];
  sources: { gics: number; watchlist: number; unknown: number };
};

export type Round12bReport = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  generatedAt: string;
  hypothesisOnly: true;
  cells: Round12bCell[];
};
