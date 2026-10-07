import fs from "node:fs";
import path from "node:path";
import { addDays, isTradingDay } from "./calendar";
import { EPS_CACHE_TTL_MS } from "./constants";
import { nasdaqTimeToSession, type EarningsSession } from "./earnings-session";

const CACHE_PATH = path.join(process.cwd(), "data", ".cache", "nasdaq-earnings-calendar.json");
const SCAN_TRADING_DAYS = 60;
const DAY_PAUSE_MS = 120;

/** Browser-like UA; Nasdaq blocks generic bot strings on the calendar API. */
export const NASDAQ_CALENDAR_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type CacheBody = {
  v: 1 | 2;
  builtAt: number;
  anchorDate: string;
  /** Earliest scanned earnings session per symbol (YYYY-MM-DD). */
  tickerNext: Record<string, string>;
  /** pre / post when Nasdaq sent a time. Missing means 場は未登録. */
  tickerWhen?: Record<string, EarningsSession>;
};

function readCache(): CacheBody | null {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CacheBody;
    if ((raw?.v === 1 || raw?.v === 2) && raw.tickerNext && raw.anchorDate) return raw;
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

export function lookupNasdaqSession(ticker: string): EarningsSession | null {
  return nasdaqSessionMap()[ticker.trim().toUpperCase()] ?? null;
}

export function nasdaqSessionMap(): Record<string, EarningsSession> {
  return readCache()?.tickerWhen ?? {};
}

export type NasdaqCalendarRow = { symbol: string; session: EarningsSession | null };

/** Parse symbols reporting on `date` from Nasdaq's earnings calendar JSON. */
export function parseNasdaqCalendarDay(json: unknown): string[] {
  return parseNasdaqCalendarRows(json).map((row) => row.symbol);
}

export function parseNasdaqCalendarRows(json: unknown): NasdaqCalendarRow[] {
  const rows = (json as { data?: { rows?: Array<{ symbol?: string; time?: string }> } })?.data?.rows;
  if (!Array.isArray(rows)) return [];
  const out: NasdaqCalendarRow[] = [];
  for (const row of rows) {
    const sym = typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
    if (!sym) continue;
    out.push({ symbol: sym, session: nasdaqTimeToSession(row.time) });
  }
  return out;
}

export async function fetchNasdaqCalendarDay(date: string): Promise<NasdaqCalendarRow[]> {
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
    return parseNasdaqCalendarRows(json);
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
  const tickerWhen: Record<string, EarningsSession> = {};
  let day = anchorDate;
  let scanned = 0;
  while (scanned < SCAN_TRADING_DAYS) {
    if (!isTradingDay(day)) {
      day = nextTradingDay(day);
      continue;
    }
    const rows = await fetchNasdaqCalendarDay(day);
    for (const row of rows) {
      if (!tickerNext[row.symbol]) tickerNext[row.symbol] = day;
      if (row.session && !tickerWhen[row.symbol]) tickerWhen[row.symbol] = row.session;
    }
    scanned += 1;
    day = nextTradingDay(day);
    await new Promise((resolve) => setTimeout(resolve, DAY_PAUSE_MS));
  }
  writeCache({ v: 2, builtAt: now, anchorDate, tickerNext, tickerWhen });
}
