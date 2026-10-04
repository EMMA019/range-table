import fs from "node:fs";
import path from "node:path";
import { EPS_CACHE_TTL_MS } from "./constants";
import type { EarningsInput, EarningsStatus } from "./types";

const CACHE_PATH = path.join(process.cwd(), "data", ".cache", "earnings-enrich.json");

export type EarningsEnrichSource = "watchlist" | "yahoo" | "nasdaq" | "nasdaq-calendar" | "estimate";

export type EarningsEnrichEntry = {
  date: string | null;
  status: EarningsStatus | null;
  source: EarningsEnrichSource | null;
  error: string | null;
  fetchedAt: number;
  estimateEarliest?: string | null;
  estimateLatest?: string | null;
  estimateLabel?: string | null;
};

type CacheBody = { v: 1; quotes: Record<string, EarningsEnrichEntry> };

function readCache(): CacheBody {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CacheBody;
    if (raw?.v === 1 && raw.quotes) return raw;
  } catch {
    /* empty */
  }
  return { v: 1, quotes: {} };
}

function writeCache(body: CacheBody) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(body));
}

export function cachedEarningsEnrich(ticker: string, now = Date.now()): EarningsEnrichEntry | null {
  const entry = readCache().quotes[ticker.trim().toUpperCase()];
  if (!entry) return null;
  if (now - entry.fetchedAt > EPS_CACHE_TTL_MS) return null;
  return entry;
}

export function resolveEarningsInput(
  watch: EarningsInput | null,
  eps: { nextEarningsDate?: string | null } | null,
  enrich: EarningsEnrichEntry | null,
): EarningsInput | null {
  if (watch?.date) return watch;
  if (enrich?.date && enrich.status) {
    const out: EarningsInput = { date: enrich.date, status: enrich.status };
    if (enrich.estimateEarliest) out.estimateEarliest = enrich.estimateEarliest;
    if (enrich.estimateLatest) out.estimateLatest = enrich.estimateLatest;
    if (enrich.estimateLabel) out.estimateLabel = enrich.estimateLabel;
    return out;
  }
  if (eps?.nextEarningsDate) return { date: eps.nextEarningsDate, status: "estimated" };
  return null;
}

export function earningsDateUnknown(
  watch: EarningsInput | null,
  eps: { nextEarningsDate?: string | null } | null,
  enrich: EarningsEnrichEntry | null,
): boolean {
  return resolveEarningsInput(watch, eps, enrich) == null;
}

import { EARNINGS_UNKNOWN_PROMINENT } from "./constants";
import { fetchEdgarItem202Dates } from "./edgar-earnings-date";
import {
  estimateNextFrom202Dates,
  legacyMixedFilingEstimate,
  mergeEstimatedWithHistory,
  type EarningsEstimate,
} from "./earnings-estimate";
import { lookupNasdaqCalendar, refreshNasdaqCalendarIfNeeded } from "./nasdaq-earnings-calendar";
import { todayEt } from "./calendar";

export { EARNINGS_UNKNOWN_PROMINENT };

export async function warmNasdaqEarningsCalendar(anchorDate = todayEt()): Promise<void> {
  try {
    await refreshNasdaqCalendarIfNeeded(anchorDate);
  } catch {
    /* calendar is optional */
  }
}

/** Nasdaq earnings-assets next report date (YYYY-MM-DD). */
export async function fetchNasdaqNextEarnings(ticker: string): Promise<string | null> {
  const symbol = encodeURIComponent(ticker.trim().toUpperCase());
  const url = `https://api.nasdaq.com/api/quote/${symbol}/summary?assetclass=stocks`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "range-table/1.0 (earnings-enrich)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { summaryData?: { EarningsDate?: { value?: string } } };
    };
    const value = json.data?.summaryData?.EarningsDate?.value;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return null;
  } catch {
    return null;
  }
}

/** @deprecated Legacy 91-session projection from a mixed filing date. */
export function estimateNextEarningsFromLast(lastDate: string): EarningsInput {
  const est = legacyMixedFilingEstimate(lastDate);
  return {
    date: est.date,
    status: "estimated",
    estimateEarliest: est.earliest,
    estimateLatest: est.latest,
    estimateLabel: est.label,
  };
}

function cacheEntry(entry: EarningsEnrichEntry, key: string, now: number): EarningsEnrichEntry {
  const out = { ...entry, fetchedAt: now };
  const cache = readCache();
  cache.quotes[key] = out;
  writeCache(cache);
  return out;
}

function estimatedEntry(
  candidateDate: string,
  source: EarningsEnrichSource,
  edgarEst: EarningsEstimate | null,
  now: number,
  key: string,
): EarningsEnrichEntry {
  const merged = mergeEstimatedWithHistory(candidateDate, edgarEst);
  return cacheEntry(
    {
      date: merged.date,
      status: "estimated",
      source,
      error: null,
      estimateEarliest: merged.estimateEarliest,
      estimateLatest: merged.estimateLatest,
      estimateLabel: merged.estimateLabel,
      fetchedAt: now,
    },
    key,
    now,
  );
}

export async function enrichEarningsDate(
  ticker: string,
  watch: EarningsInput | null,
  eps: { nextEarningsDate?: string | null } | null,
  now = Date.now(),
): Promise<EarningsEnrichEntry> {
  const key = ticker.trim().toUpperCase();
  if (watch?.date) {
    return { date: watch.date, status: watch.status, source: "watchlist", error: null, fetchedAt: now };
  }

  const today = todayEt();
  const item202 = await fetchEdgarItem202Dates(key);
  const edgarEst = item202.length ? estimateNextFrom202Dates(item202, today) : null;

  const yahoo = eps?.nextEarningsDate ?? null;
  if (yahoo) {
    return estimatedEntry(yahoo, "yahoo", edgarEst, now, key);
  }

  await warmNasdaqEarningsCalendar(today);
  const cal = lookupNasdaqCalendar(key, today);
  if (cal) {
    const entry: EarningsEnrichEntry = {
      date: cal,
      status: "confirmed",
      source: "nasdaq-calendar",
      error: null,
      fetchedAt: now,
    };
    const cache = readCache();
    cache.quotes[key] = entry;
    writeCache(cache);
    return entry;
  }

  const nasdaq = await fetchNasdaqNextEarnings(key);
  if (nasdaq) {
    return estimatedEntry(nasdaq, "nasdaq", edgarEst, now, key);
  }

  if (edgarEst) {
    return cacheEntry(
      {
        date: edgarEst.date,
        status: "estimated",
        source: "estimate",
        error: null,
        estimateEarliest: edgarEst.earliest,
        estimateLatest: edgarEst.latest,
        estimateLabel: edgarEst.label,
        fetchedAt: now,
      },
      key,
      now,
    );
  }

  return cacheEntry({ date: null, status: null, source: null, error: "決算日が見つからない", fetchedAt: now }, key, now);
}
