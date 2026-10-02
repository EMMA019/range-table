import { CLOSE_FINAL_MINUTES, etWallTimeMs, todayEt } from "./calendar";
import { CACHE_TTL_MS, ERROR_RETRY_MS } from "./constants";
import type { Bar } from "./types";

/**
 * One symbol in the shared daily-bar cache. After a failed refetch the previous bars are
 * kept and `error` records the failure, so the row keeps its numbers and shows them as old.
 */
export type SeriesEntry = {
  bars?: Bar[];
  error?: string;
  droppedPartial?: boolean;
  /** Last attempt, success or failure. */
  at: number;
  /** When the last successful fetch happened. */
  okAt?: number;
  /** Refetch no later than this, e.g. when today's close was still provisional. */
  refreshAfter?: number;
};

export type CacheBody = {
  v: 4;
  /** Bumped on every refresh so derived payloads can be memoized. */
  version: number;
  series: Record<string, SeriesEntry>;
};

export type FetchOutcome = { bars: Bar[]; droppedPartial: boolean } | { error: string };

export function emptyCache(): CacheBody {
  return { v: 4, version: 0, series: {} };
}

/** A good entry lives for the price TTL. A failed one is retried after ERROR_RETRY_MS. */
export function isDue(entry: SeriesEntry | undefined, now: number): boolean {
  if (!entry) return true;
  const life = entry.error ? ERROR_RETRY_MS : CACHE_TTL_MS;
  if (now - entry.at >= life) return true;
  return entry.refreshAfter != null && now >= entry.refreshAfter;
}

export function dueSymbols(cache: CacheBody | null, symbols: string[], now: number): string[] {
  return symbols.filter((symbol) => isDue(cache?.series[symbol], now));
}

export function missingSymbols(cache: CacheBody | null, symbols: string[]): string[] {
  return symbols.filter((symbol) => !cache?.series[symbol]);
}

/**
 * New bars replace the old. A failure keeps the previous bars and marks the error.
 * A bar for today fetched before the close is final is refetched once it is.
 */
export function mergeOutcome(prev: SeriesEntry | undefined, outcome: FetchOutcome, now: number): SeriesEntry {
  if ("error" in outcome) {
    return {
      bars: prev?.bars,
      droppedPartial: prev?.droppedPartial,
      error: outcome.error,
      at: now,
      okAt: prev?.okAt,
    };
  }
  const today = todayEt(new Date(now));
  const last = outcome.bars[outcome.bars.length - 1];
  let refreshAfter: number | undefined;
  if (last?.date === today) {
    const final = etWallTimeMs(today, CLOSE_FINAL_MINUTES);
    if (now < final) refreshAfter = final;
  }
  return {
    bars: outcome.bars,
    droppedPartial: outcome.droppedPartial,
    at: now,
    okAt: now,
    refreshAfter,
  };
}

/** Oldest successful fetch among the symbols that have bars. Drives "取得 hh:mm" and the client reload. */
export function oldestOkAt(cache: CacheBody, symbols: string[], fallback: number): number {
  let oldest: number | null = null;
  for (const symbol of symbols) {
    const okAt = cache.series[symbol]?.okAt;
    if (okAt == null) continue;
    if (oldest == null || okAt < oldest) oldest = okAt;
  }
  return oldest ?? fallback;
}

/** Rows that show bars from an earlier fetch because the latest one failed. */
export function isStale(entry: SeriesEntry | undefined): boolean {
  return Boolean(entry?.bars && entry.error);
}
