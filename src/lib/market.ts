import fs from "fs";
import path from "path";
import { todayEt } from "./calendar";
import { BENCHMARKS, CACHE_TTL_MS, EPS_CACHE_TTL_MS, FETCH_CONCURRENCY } from "./constants";
import { fetchEpsMap } from "./eps";
import { peView } from "./pe";
import { chartPoints, computeQuote } from "./compute";
import { classifyEarnings } from "./earnings";
import { formatJst, friendlyFetchError } from "./format";
import type {
  Bar,
  ChartPayload,
  EpsSnapshot,
  IndexRow,
  MarketPayload,
  Quote,
  TickerRow,
  Watchlist,
} from "./types";
import { loadWatchlist } from "./watchlist";
import { fetchDailyBars } from "./yahoo";

type SeriesEntry = {
  bars?: Bar[];
  error?: string;
  droppedPartial?: boolean;
};

type CacheBody = {
  v: 2;
  fetchedAt: number;
  series: Record<string, SeriesEntry>;
};

const CACHE_PATH = path.join(process.cwd(), "data", ".cache", "market.json");
const EPS_CACHE_PATH = path.join(process.cwd(), "data", ".cache", "eps.json");

let memory: CacheBody | null = null;
let inflight: Promise<CacheBody> | null = null;

type EpsCacheBody = {
  v: 1;
  fetchedAt: number;
  quotes: Record<string, EpsSnapshot>;
};

let epsMemory: EpsCacheBody | null = null;
let epsInflight: Promise<Record<string, EpsSnapshot>> | null = null;

const SOURCE = "Yahoo Finance の日足をサーバで計算（分割がある場合は分割調整、配当は未調整）";

export function warmMarket(): Promise<void> {
  return ensureSeries(loadWatchlist()).then(() => undefined);
}

export async function getMarketPayload(): Promise<MarketPayload> {
  const list = loadWatchlist();
  const symbols = list.groups.flatMap((group) => group.tickers.map((ticker) => ticker.ticker));
  const [cache, eps] = await Promise.all([ensureSeries(list), loadEps(symbols)]);
  return buildPayload(cache, list, eps);
}

export async function getChart(ticker: string): Promise<ChartPayload | { error: string }> {
  const symbol = ticker.toUpperCase();
  const list = loadWatchlist();
  const known = new Set(list.groups.flatMap((group) => group.tickers.map((item) => item.ticker)));
  if (!known.has(symbol)) return { error: "リストにないティッカー" };

  const cache = await ensureSeries(list);
  const entry = cache.series[symbol];
  if (!entry) return { error: "日足がまだない" };
  if (entry.error || !entry.bars) return { error: friendlyFetchError(entry.error || "日足がない") };

  const computed = computeQuote(entry.bars);
  if (!computed.ok) return { error: computed.error };
  return {
    ticker: symbol,
    bars: chartPoints(entry.bars),
    low20: computed.quote.low20,
    high20: computed.quote.high20,
    priorHigh20: computed.quote.priorHigh20,
    closeDate: computed.quote.closeDate,
  };
}

function symbolsFor(list: Watchlist): string[] {
  const set = new Set<string>(BENCHMARKS);
  for (const group of list.groups) {
    for (const ticker of group.tickers) set.add(ticker.ticker);
  }
  return [...set];
}

async function ensureSeries(list: Watchlist): Promise<CacheBody> {
  if (inflight) return inflight;
  inflight = refresh(list).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function refresh(list: Watchlist): Promise<CacheBody> {
  const symbols = symbolsFor(list);
  const cache = memory ?? readDisk();
  const age = cache ? Date.now() - cache.fetchedAt : Number.POSITIVE_INFINITY;
  const fresh = Boolean(cache) && age < CACHE_TTL_MS;
  const missing = fresh
    ? symbols.filter((symbol) => !cache?.series[symbol])
    : symbols;

  if (cache && fresh && missing.length === 0) {
    memory = cache;
    return cache;
  }

  const toFetch = missing;
  const started = Date.now();
  console.log(`[range] fetching ${toFetch.length} symbols`);
  const fetched = await mapPool(toFetch, FETCH_CONCURRENCY, fetchOne);
  const series: Record<string, SeriesEntry> =
    cache && fresh ? { ...cache.series } : {};
  for (const item of fetched) series[item.symbol] = item.entry;

  const next: CacheBody = {
    v: 2,
    fetchedAt: cache && fresh ? cache.fetchedAt : Date.now(),
    series,
  };
  memory = next;
  try {
    writeDisk(next);
  } catch (error) {
    console.error("[range] cache write failed", error);
  }
  const ok = toFetch.filter((symbol) => series[symbol]?.bars).length;
  const fail = toFetch.length - ok;
  console.log(`[range] ready in ${Date.now() - started}ms ok=${ok} fail=${fail}`);
  return next;
}

async function fetchOne(symbol: string): Promise<{ symbol: string; entry: SeriesEntry }> {
  try {
    const parsed = await fetchDailyBars(symbol);
    return {
      symbol,
      entry: { bars: parsed.bars, droppedPartial: parsed.droppedPartial },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "取得失敗";
    return { symbol, entry: { error: message.slice(0, 180) } };
  }
}

async function loadEps(symbols: string[]): Promise<Record<string, EpsSnapshot>> {
  if (epsInflight) return epsInflight;
  epsInflight = ensureEps(symbols)
    .catch((error) => {
      console.error("[range] eps", error);
      return epsMemory?.quotes ?? readEps()?.quotes ?? {};
    })
    .finally(() => {
      epsInflight = null;
    });
  return epsInflight;
}

async function ensureEps(symbols: string[]): Promise<Record<string, EpsSnapshot>> {
  const cache = epsMemory ?? readEps();
  const age = cache ? Date.now() - cache.fetchedAt : Number.POSITIVE_INFINITY;
  const fresh = Boolean(cache) && age < EPS_CACHE_TTL_MS;
  const missing = fresh ? symbols.filter((symbol) => !cache?.quotes[symbol]) : symbols;
  if (cache && fresh && missing.length === 0) {
    epsMemory = cache;
    return cache.quotes;
  }

  const fetched = await fetchEpsMap(missing);
  if (Object.keys(fetched).length === 0 && missing.length > 0) {
    return cache?.quotes ?? {};
  }

  const quotes = { ...(cache?.quotes ?? {}), ...fetched };
  const next: EpsCacheBody = {
    v: 1,
    fetchedAt: fresh && cache ? cache.fetchedAt : Date.now(),
    quotes,
  };
  epsMemory = next;
  try {
    writeJson(EPS_CACHE_PATH, next);
  } catch (error) {
    console.error("[range] eps cache write failed", error);
  }
  return quotes;
}

function buildPayload(
  cache: CacheBody,
  list: Watchlist,
  eps: Record<string, EpsSnapshot>,
): MarketPayload {
  const today = todayEt();
  const rows: TickerRow[] = [];
  for (const group of list.groups) {
    for (const ticker of group.tickers) {
      const entry = cache.series[ticker.ticker];
      const built = quoteFromEntry(entry);
      rows.push({
        ticker: ticker.ticker,
        sectorId: group.id,
        sector: group.name,
        description: ticker.description,
        notes: ticker.notes,
        tags: ticker.tags,
        watchOnly: ticker.watchOnly,
        earnings: classifyEarnings(today, ticker.earnings),
        quote: built.quote,
        pe: peView(built.quote?.close, eps[ticker.ticker] ?? null),
        error: built.error,
        errorDetail: built.errorDetail,
      });
    }
  }

  const indices: IndexRow[] = BENCHMARKS.map((ticker) => {
    const built = quoteFromEntry(cache.series[ticker]);
    return { ticker, quote: built.quote, error: built.error };
  });

  const failCount = rows.filter((row) => !row.quote).length;
  const excludedPartial = BENCHMARKS.some(
    (ticker) => cache.series[ticker]?.droppedPartial,
  );

  return {
    fetchedAt: cache.fetchedAt,
    fetchedAtJst: formatJst(new Date(cache.fetchedAt)),
    ttlMs: CACHE_TTL_MS,
    barDate: modeDate(indices, rows),
    excludedPartial,
    source: SOURCE,
    indices,
    rows,
    okCount: rows.length - failCount,
    failCount,
  };
}

function quoteFromEntry(entry: SeriesEntry | undefined): {
  quote: Quote | null;
  error: string | null;
  errorDetail: string | null;
} {
  if (!entry) return { quote: null, error: "日足がまだない", errorDetail: null };
  if (entry.error || !entry.bars) {
    const detail = entry.error || "日足がない";
    return { quote: null, error: friendlyFetchError(detail), errorDetail: detail };
  }
  const computed = computeQuote(entry.bars);
  if (!computed.ok) return { quote: null, error: computed.error, errorDetail: null };
  return { quote: computed.quote, error: null, errorDetail: null };
}

function modeDate(indices: IndexRow[], rows: TickerRow[]): string | null {
  const spy = indices.find((index) => index.ticker === "SPY")?.quote?.closeDate;
  if (spy) return spy;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const date = row.quote?.closeDate;
    if (!date) continue;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [date, count] of counts) {
    if (count > n) {
      best = date;
      n = count;
    }
  }
  return best;
}

function readDisk(): CacheBody | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CacheBody;
    if (parsed?.v !== 2 || typeof parsed.fetchedAt !== "number" || !parsed.series) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDisk(body: CacheBody) {
  writeJson(CACHE_PATH, body);
}

function writeJson(file: string, body: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body));
  fs.renameSync(tmp, file);
}

function readEps(): EpsCacheBody | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(EPS_CACHE_PATH, "utf8")) as EpsCacheBody;
    if (parsed?.v !== 1 || typeof parsed.fetchedAt !== "number" || !parsed.quotes) return null;
    const quotes: Record<string, EpsSnapshot> = {};
    for (const [symbol, value] of Object.entries(parsed.quotes)) {
      if (!isEpsSnapshot(value)) continue;
      quotes[symbol] = value;
    }
    return { v: 1, fetchedAt: parsed.fetchedAt, quotes };
  } catch {
    return null;
  }
}

function isEpsSnapshot(value: unknown): value is EpsSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return nullableNumber(snapshot.trailingEps) && nullableNumber(snapshot.forwardEps);
}

function nullableNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
