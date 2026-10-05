import fs from "fs";
import path from "path";
import type { Watchlist } from "./types";

export type MonitorIndexFile = {
  generatedAt: string;
  asOfDate: string;
  sources: { sp500: string; ndx100: string };
  sp500: string[];
  ndx100: string[];
  union: string[];
};

const MONITOR_PATH = path.join(process.cwd(), "data", "monitor_index.json");

export function monitorIndexPath(): string {
  return MONITOR_PATH;
}

export function loadMonitorIndex(file = MONITOR_PATH): MonitorIndexFile {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  return validateMonitorIndex(raw);
}

export function validateMonitorIndex(raw: unknown): MonitorIndexFile {
  if (!raw || typeof raw !== "object") throw new Error("monitor_index.json がオブジェクトではない");
  const doc = raw as Record<string, unknown>;
  const sp500 = stringArray(doc.sp500, "sp500");
  const ndx100 = stringArray(doc.ndx100, "ndx100");
  const union = stringArray(doc.union, "union");
  const generatedAt = typeof doc.generatedAt === "string" ? doc.generatedAt : "";
  const asOfDate = typeof doc.asOfDate === "string" ? doc.asOfDate : "";
  const sources = doc.sources;
  if (!sources || typeof sources !== "object") throw new Error("monitor_index.json sources がない");
  const spSrc = (sources as Record<string, unknown>).sp500;
  const ndxSrc = (sources as Record<string, unknown>).ndx100;
  if (typeof spSrc !== "string" || typeof ndxSrc !== "string") {
    throw new Error("monitor_index.json sources が不正");
  }
  return { generatedAt, asOfDate, sources: { sp500: spSrc, ndx100: ndxSrc }, sp500, ndx100, union };
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((t) => typeof t !== "string" || !t.trim())) {
    throw new Error(`monitor_index.json ${label} が文字列配列ではない`);
  }
  return value.map((t) => t.trim().toUpperCase());
}

export function watchlistTickerSet(list: Watchlist): Set<string> {
  const set = new Set<string>();
  for (const group of list.groups) {
    for (const t of group.tickers) set.add(t.ticker);
  }
  return set;
}

/** Index union tickers not already on the curated watchlist (monitor-only). */
export function indexMonitorTickers(list: Watchlist, file = MONITOR_PATH): string[] {
  let index: MonitorIndexFile;
  try {
    index = loadMonitorIndex(file);
  } catch {
    return [];
  }
  const wl = watchlistTickerSet(list);
  return index.union.filter((t) => !wl.has(t));
}

/** All symbols to keep in the price cache (watchlist + index union). */
export function monitorUnionSymbols(file = MONITOR_PATH): string[] {
  try {
    return loadMonitorIndex(file).union;
  } catch {
    return [];
  }
}
