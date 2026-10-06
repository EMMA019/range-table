import fs from "fs";
import path from "path";
import { BENCHMARKS, FX_USDJPY } from "./constants";
import { monitorUnionSymbols } from "./monitor-universe";
import { loadTeamPicks } from "./picks";
import { loadWatchlist } from "./watchlist";

export type TickerMetaEntry = { name: string; sector: string; industry: string };

type TickerMetaFile = { generatedAt: string; tickers: Record<string, TickerMetaEntry> };

const META_PATH = path.join(process.cwd(), "data", "ticker_meta.json");

let cached: Record<string, TickerMetaEntry> | null = null;

export function tickerMetaPath(): string {
  return META_PATH;
}

function normTicker(t: string): string {
  return t.trim().toUpperCase().replace(/\./g, "-");
}

export function loadTickerMetaMap(file = META_PATH): Record<string, TickerMetaEntry> {
  if (cached && file === META_PATH) return cached;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as TickerMetaFile;
  const map: Record<string, TickerMetaEntry> = {};
  for (const [key, entry] of Object.entries(raw.tickers)) {
    map[normTicker(key)] = entry;
  }
  if (file === META_PATH) cached = map;
  return map;
}

export function resolveTickerMeta(ticker: string, map = loadTickerMetaMap()): TickerMetaEntry {
  const hit = map[normTicker(ticker)];
  if (hit) return { ...hit };
  return { name: "", sector: "", industry: "" };
}

/** Company name and GICS sector/industry for API rows and UI. */
export function enrichTickerMeta(ticker: string): {
  name: string;
  sector: string;
  industry: string | null;
} {
  const meta = resolveTickerMeta(ticker);
  const name = meta.name.trim() || ticker;
  const sector = meta.sector.trim();
  const industry = meta.industry.trim() || null;
  return { name, sector, industry };
}

/** Watchlist + index union + benchmarks + team picks (Emma「すべて」監視範囲). */
export function monitoredUniverseSymbols(): string[] {
  const set = new Set<string>([...BENCHMARKS, FX_USDJPY]);
  for (const t of monitorUnionSymbols()) set.add(t);
  const list = loadWatchlist();
  for (const group of list.groups) {
    for (const row of group.tickers) set.add(row.ticker);
  }
  for (const pick of loadTeamPicks()) set.add(pick.ticker);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function countUniverseMetaGaps(symbols: string[], map = loadTickerMetaMap()): {
  missingName: string[];
  missingSector: string[];
} {
  const missingName: string[] = [];
  const missingSector: string[] = [];
  for (const ticker of symbols) {
    const meta = resolveTickerMeta(ticker, map);
    if (!meta.name.trim()) missingName.push(ticker);
    if (!meta.sector.trim()) missingSector.push(ticker);
  }
  return { missingName, missingSector };
}
