import fs from "fs";
import path from "path";
import { todayEt } from "./calendar";
import {
  BENCHMARKS,
  CACHE_TTL_MS,
  CHART_SESSIONS,
  EPS_WARM_BATCH,
  EPS_WARM_PAUSE_MS,
  FETCH_CONCURRENCY,
} from "./constants";
import { fetchEpsBatch } from "./eps";
import { epsIsFresh, epsTtlMs, hasEpsValue, peView, pickEpsBatch } from "./pe";
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
  v: 3;
  fetchedAt: number;
  series: Record<string, SeriesEntry>;
};

const CACHE_PATH = path.join(process.cwd(), "data", ".cache", "market.json");
const EPS_CACHE_PATH = path.join(process.cwd(), "data", ".cache", "eps.json");

let memory: CacheBody | null = null;
let inflight: Promise<CacheBody> | null = null;

type StoredEps = EpsSnapshot & { fetchedAt: number };

type EpsCacheBody = {
  v: 2;
  quotes: Record<string, StoredEps>;
};

let epsMemory: EpsCacheBody | null = null;
let epsWarming = false;

const SOURCE = "Yahoo Finance の日足をサーバで計算（分割がある場合は分割調整、配当は未調整）";

export function warmMarket(): Promise<void> {
  return ensureSeries(loadWatchlist()).then(() => undefined);
}

/** Starts the EPS queue without waiting for it. Safe to call on every request and at process boot. */
export function startEpsWarm(): void {
  const symbols = loadWatchlist().groups.flatMap((group) => group.tickers.map((ticker) => ticker.ticker));
  kickEpsWarm(symbols);
}

export async function getMarketPayload(): Promise<MarketPayload> {
  const list = loadWatchlist();
  const symbols = list.groups.flatMap((group) => group.tickers.map((ticker) => ticker.ticker));
  const cache = await ensureSeries(list);
  const payload = memoPayload(cache, list);
  kickEpsWarm(symbols);
  return payload;
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
    v: 3,
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

async function waitForPrices(): Promise<void> {
  while (inflight) {
    try {
      await inflight;
    } catch {
      return;
    }
  }
}

let payloadMemo: { key: string; payload: MarketPayload } | null = null;

function memoPayload(cache: CacheBody, list: Watchlist): MarketPayload {
  const key = `${cache.fetchedAt}:${epsStamp()}`;
  if (payloadMemo?.key === key) return payloadMemo.payload;
  const payload = buildPayload(cache, list, readCachedEps());
  payloadMemo = { key, payload };
  return payload;
}

function epsStamp(): string {
  const quotes = (epsMemory ?? readEps())?.quotes;
  if (!quotes) return "0";
  let count = 0;
  let latest = 0;
  for (const entry of Object.values(quotes)) {
    count += 1;
    if (entry.fetchedAt > latest) latest = entry.fetchedAt;
  }
  return `${count}:${latest}`;
}

function kickEpsWarm(symbols: string[]): void {
  if (epsWarming) return;
  epsWarming = true;
  void warmEps(symbols)
    .catch((error) => console.error("[range] eps warm", error))
    .finally(() => {
      epsWarming = false;
    });
}

async function warmEps(symbols: string[]): Promise<void> {
  await waitForPrices();
  const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
  let extraPasses = 0;
  for (;;) {
    const now = Date.now();
    const cache = epsMemory ?? readEps();
    const quotes: Record<string, StoredEps> = { ...(cache?.quotes ?? {}) };
    const batch = pickEpsBatch(unique, quotes, now, EPS_WARM_BATCH);
    if (batch.length === 0) {
      const ok = unique.filter((symbol) => quotes[symbol] && hasEpsValue(quotes[symbol])).length;
      console.log(`[range] eps warm caught up ok=${ok} total=${unique.length}`);
      if (extraPasses >= 2) return;
      const wait = msUntilEpsRetry(unique, quotes, now);
      if (wait == null || wait > 90_000) return;
      extraPasses += 1;
      await sleep(wait + 100);
      continue;
    }
    await waitForPrices();
    const pending = unique.filter((symbol) => !epsIsFresh(quotes[symbol], now)).length;
    console.log(`[range] eps warm batch=${batch.join(",")} pending=${pending}`);
    let fetched: Record<string, EpsSnapshot> = {};
    try {
      fetched = await fetchEpsBatch(batch, (symbol, snap) => {
        rememberEps(quotes, symbol, snap);
      });
    } catch (error) {
      console.error("[range] eps batch", error);
    }
    let limited = 0;
    for (const symbol of batch) {
      const snap = fetched[symbol] ?? quotes[symbol] ?? { trailingEps: null, forwardEps: null, error: "timeout" };
      if (!fetched[symbol]) rememberEps(quotes, symbol, { trailingEps: null, forwardEps: null, error: "timeout" });
      if (/429/.test(snap.error ?? "")) limited += 1;
    }
    const ok = unique.filter((symbol) => quotes[symbol] && hasEpsValue(quotes[symbol])).length;
    console.log(`[range] eps warm saved ok=${ok} total=${unique.length}`);
    if (limited >= Math.ceil(batch.length / 2)) {
      console.error(`[range] eps warm backing off 429s=${limited}`);
      await sleep(30_000);
    } else {
      await sleep(EPS_WARM_PAUSE_MS);
    }
  }
}

function rememberEps(quotes: Record<string, StoredEps>, symbol: string, snap: EpsSnapshot) {
  quotes[symbol] = { ...snap, fetchedAt: Date.now() };
  epsMemory = { v: 2, quotes };
  try {
    writeJson(EPS_CACHE_PATH, epsMemory);
  } catch (error) {
    console.error("[range] eps cache write failed", error);
  }
}

function msUntilEpsRetry(symbols: string[], quotes: Record<string, StoredEps>, now: number): number | null {
  let wait: number | null = null;
  for (const symbol of symbols) {
    const entry = quotes[symbol];
    if (!entry || hasEpsValue(entry)) continue;
    if (!epsIsFresh(entry, now)) return 0;
    const remain = entry.fetchedAt + epsTtlMs(entry) - now;
    if (wait == null || remain < wait) wait = remain;
  }
  return wait;
}

function readCachedEps(): Record<string, EpsSnapshot> {
  const cache = epsMemory ?? readEps();
  if (!cache) return {};
  epsMemory = cache;
  return projectEps(cache.quotes);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function projectEps(quotes: Record<string, StoredEps>): Record<string, EpsSnapshot> {
  const out: Record<string, EpsSnapshot> = {};
  for (const [symbol, entry] of Object.entries(quotes)) {
    out[symbol] = {
      trailingEps: entry.trailingEps,
      forwardEps: entry.forwardEps,
      error: entry.error,
    };
  }
  return out;
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
    if (parsed?.v !== 3 || typeof parsed.fetchedAt !== "number" || !parsed.series) return null;
    for (const entry of Object.values(parsed.series)) {
      if (entry?.bars && entry.bars.length > CHART_SESSIONS) {
        entry.bars = entry.bars.slice(-CHART_SESSIONS);
      }
    }
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
    if (parsed?.v !== 2 || !parsed.quotes) return null;
    const quotes: Record<string, StoredEps> = {};
    for (const [symbol, value] of Object.entries(parsed.quotes)) {
      if (!isStoredEps(value)) continue;
      quotes[symbol] = value;
    }
    return { v: 2, quotes };
  } catch {
    return null;
  }
}

function isStoredEps(value: unknown): value is StoredEps {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return (
    nullableNumber(snapshot.trailingEps) &&
    nullableNumber(snapshot.forwardEps) &&
    (snapshot.error === null || typeof snapshot.error === "string") &&
    typeof snapshot.fetchedAt === "number"
  );
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
