import fs from "fs";
import path from "path";
import { todayEt } from "./calendar";
import { BENCHMARKS, CACHE_TTL_MS, FETCH_CONCURRENCY } from "./constants";
import { chartPoints, computeQuote } from "./compute";
import { classifyEarnings } from "./earnings";
import { formatJst, friendlyFetchError } from "./format";
import type {
  Bar,
  ChartPayload,
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

let memory: CacheBody | null = null;
let inflight: Promise<CacheBody> | null = null;

const SOURCE = "Yahoo Finance の日足をサーバで計算（分割がある場合は分割調整、配当は未調整）";

export function warmMarket(): Promise<void> {
  return ensureSeries(loadWatchlist()).then(() => undefined);
}

export async function getMarketPayload(): Promise<MarketPayload> {
  const list = loadWatchlist();
  const cache = await ensureSeries(list);
  return buildPayload(cache, list);
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

function buildPayload(cache: CacheBody, list: Watchlist): MarketPayload {
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
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  const tmp = `${CACHE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body));
  fs.renameSync(tmp, CACHE_PATH);
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
