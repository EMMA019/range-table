import fs from "node:fs";
import path from "node:path";
import { addDays, isTradingDay } from "./calendar";
import { EPS_CACHE_TTL_MS } from "./constants";

const CACHE_PATH = path.join(process.cwd(), "data", ".cache", "nasdaq-earnings-calendar.json");
const SCAN_TRADING_DAYS = 60;
const DAY_PAUSE_MS = 120;

/** Browser-like UA; Nasdaq blocks generic bot strings on the calendar API. */
export const NASDAQ_CALENDAR_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type CacheBody = {
  v: 1;
  builtAt: number;
  anchorDate: string;
  /** Earliest scanned earnings session per symbol (YYYY-MM-DD). */
  tickerNext: Record<string, string>;
};

function readCache(): CacheBody | null {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CacheBody;
    if (raw?.v === 1 && raw.tickerNext && raw.anchorDate) return raw;
  } catch {
    /* empty */
  }
  return null;
}

function writeCache(body: CacheBody) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(body));
}

export function nasdaqCalendarFresh(anchorDate: string, now = Date.now()): boolean {
  const cache = readCache();
  if (!cache) return false;
  if (cache.anchorDate !== anchorDate) return false;
  return now - cache.builtAt <= EPS_CACHE_TTL_MS;
}

export function lookupNasdaqCalendar(ticker: string, today: string): string | null {
  const cache = readCache();
  if (!cache) return null;
  const date = cache.tickerNext[ticker.trim().toUpperCase()];
  if (!date || date < today) return null;
  return date;
}

/** Parse symbols reporting on `date` from Nasdaq's earnings calendar JSON. */
export function parseNasdaqCalendarDay(json: unknown): string[] {
  const rows = (json as { data?: { rows?: Array<{ symbol?: string }> } })?.data?.rows;
  if (!Array.isArray(rows)) return [];
  const out: string[] = [];
  for (const row of rows) {
    const sym = typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
    if (sym) out.push(sym);
  }
  return out;
}

export async function fetchNasdaqCalendarDay(date: string): Promise<string[]> {
  const url = `https://api.nasdaq.com/api/calendar/earnings?date=${date}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": NASDAQ_CALENDAR_UA,
        Referer: "https://www.nasdaq.com/",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return parseNasdaqCalendarDay(json);
  } catch {
    return [];
  }
}

function nextTradingDay(date: string): string {
  let cursor = date;
  for (let i = 0; i < 10; i++) {
    cursor = addDays(cursor, 1);
    if (isTradingDay(cursor)) return cursor;
  }
  return addDays(date, 1);
}

/** Scan the next ~60 trading sessions from `anchorDate` and cache the first earnings date per symbol. */
export async function refreshNasdaqCalendarIfNeeded(anchorDate: string, now = Date.now()): Promise<void> {
  if (nasdaqCalendarFresh(anchorDate, now)) return;
  const tickerNext: Record<string, string> = {};
  let day = anchorDate;
  let scanned = 0;
  while (scanned < SCAN_TRADING_DAYS) {
    if (!isTradingDay(day)) {
      day = nextTradingDay(day);
      continue;
    }
    const symbols = await fetchNasdaqCalendarDay(day);
    for (const symbol of symbols) {
      if (!tickerNext[symbol]) tickerNext[symbol] = day;
    }
    scanned += 1;
    day = nextTradingDay(day);
    await new Promise((resolve) => setTimeout(resolve, DAY_PAUSE_MS));
  }
  writeCache({ v: 1, builtAt: now, anchorDate, tickerNext });
}
