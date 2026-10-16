import fs from "fs";
import path from "path";
import bundledMonitorRaw from "../../data/monitor_index.json";
import type { Watchlist } from "./types";

export type MonitorIndexFile = {
  generatedAt: string;
  asOfDate: string;
  sources: { sp500: string; ndx100: string; sp400?: string; sp600?: string };
  sp500: string[];
  ndx100: string[];
  /** S&P MidCap 400 (optional; older files omit it). */
  sp400: string[];
  /** S&P SmallCap 600 (optional; older files omit it). */
  sp600: string[];
  union: string[];
};

const MONITOR_PATH = path.join(process.cwd(), "data", "monitor_index.json");

export function monitorIndexPath(): string {
  return MONITOR_PATH;
}

/**
 * A shorter on-disk list must not hide constituents that shipped in this build.
 * Render's disk is ephemeral, but a leftover `data/monitor_index.json` (or a
 * mount over `data/`) used to leave the API on the old 518-name union.
 */
export function preferMonitorIndex(
  disk: MonitorIndexFile | null,
  bundled: MonitorIndexFile,
): MonitorIndexFile {
  if (!disk || disk.union.length < bundled.union.length) return bundled;
  return disk;
}

const bundledMonitor = validateMonitorIndex(bundledMonitorRaw);

export function loadMonitorIndex(file = MONITOR_PATH): MonitorIndexFile {
  if (file === MONITOR_PATH) {
    let disk: MonitorIndexFile | null = null;
    try {
      disk = validateMonitorIndex(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
    } catch {
      disk = null;
    }
    return preferMonitorIndex(disk, bundledMonitor);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  return validateMonitorIndex(raw);
}

export function validateMonitorIndex(raw: unknown): MonitorIndexFile {
  if (!raw || typeof raw !== "object") throw new Error("monitor_index.json がオブジェクトではない");
  const doc = raw as Record<string, unknown>;
  const sp500 = stringArray(doc.sp500, "sp500");
  const ndx100 = stringArray(doc.ndx100, "ndx100");
  const sp400 = doc.sp400 === undefined ? [] : stringArray(doc.sp400, "sp400");
  const sp600 = doc.sp600 === undefined ? [] : stringArray(doc.sp600, "sp600");
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
  const src = sources as Record<string, unknown>;
  const extra: { sp400?: string; sp600?: string } = {};
  if (typeof src.sp400 === "string") extra.sp400 = src.sp400;
  if (typeof src.sp600 === "string") extra.sp600 = src.sp600;
  return {
    generatedAt,
    asOfDate,
    sources: { sp500: spSrc, ndx100: ndxSrc, ...extra },
    sp500,
    ndx100,
    sp400,
    sp600,
    union,
  };
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

export type IndexTag = "sp500" | "ndx100" | "sp400" | "sp600";

export const INDEX_TAG_LABEL: Record<IndexTag, string> = {
  sp500: "S&P500",
  ndx100: "NDX100",
  sp400: "S&P400",
  sp600: "S&P600",
};

/** Ticker -> index memberships, in display order. */
export function indexTagMap(file = MONITOR_PATH): Map<string, IndexTag[]> {
  const map = new Map<string, IndexTag[]>();
  let index: MonitorIndexFile;
  try {
    index = loadMonitorIndex(file);
  } catch {
    return map;
  }
  const order: IndexTag[] = ["sp500", "ndx100", "sp400", "sp600"];
  for (const tag of order) {
    for (const t of index[tag]) {
      const list = map.get(t);
      if (list) list.push(tag);
      else map.set(t, [tag]);
    }
  }
  return map;
}

export function indexTagsLabel(tags: IndexTag[]): string {
  return tags.map((tag) => INDEX_TAG_LABEL[tag]).join(" · ");
}
