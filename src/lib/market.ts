import fs from "fs";
import path from "path";
import { closeIsProvisional, todayEt } from "./calendar";
import {
  BENCHMARKS,
  CACHE_TTL_MS,
  CHART_SESSIONS,
  EPS_WARM_BATCH,
  EPS_WARM_PAUSE_MS,
  FETCH_CONCURRENCY,
  FX_USDJPY,
} from "./constants";
import { fetchEpsBatch } from "./eps";
import { epsIsFresh, epsTtlMs, hasEpsValue, peView, pickEpsBatch } from "./pe";
import { buildCorrelations, loadCorrBasket, type CorrPair } from "./corr";
import { chartPoints, computeQuote } from "./compute";
import {
  cachedEarningsEnrich,
  enrichEarningsDate,
  resolveEarningsInput,
  earningsDateUnknown,
  warmNasdaqEarningsCalendar,
} from "./earnings-enrich";
import { classifyEarnings } from "./earnings";
import { attachVerdict } from "./verdict";
import { fetchTtmIncomeForTicker } from "./edgar-companyfacts";
import { profitabilityFromCache } from "./profit-cache";
import { holdingsSource } from "./holdings";
import { formatJst, friendlyFetchError } from "./format";
import { buildPickCard, loadTeamPicks } from "./picks";
import { rs20 } from "./rs";
import { semiSlotsFull, semiTickerSet } from "./semis";
import type {
  ChartPayload,
  EpsSnapshot,
  IndexRow,
  MarketPayload,
  MonitorMeta,
  PickQuote,
  PicksPayload,
  Quote,
  TickerRow,
  Watchlist,
  EarningsInput,
} from "./types";
import { loadWatchlist } from "./watchlist";
import { enrichTickerMeta } from "./ticker-meta";
import {
  indexMonitorTickers,
  loadMonitorIndex,
  monitorIndexPath,
  monitorUnionSymbols,
} from "./monitor-universe";
import { fetchDailyBars } from "./yahoo";
import {
  dueSymbols,
  emptyCache,
  isStale,
  mergeOutcome,
  missingSymbols,
  oldestOkAt,
  type CacheBody,
  type FetchOutcome,
  type SeriesEntry,
} from "./price-cache";

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
let epsWatchlist: Watchlist | null = null;

const SOURCE = "Yahoo Finance の日足をサーバで計算（分割がある場合は分割調整、配当は未調整）";

export function warmMarket(): Promise<void> {
  return ensureSeries(loadWatchlist()).then(() => undefined);
}

/** Starts the EPS queue without waiting for it. Safe to call on every request and at process boot. */
export function startEpsWarm(): void {
  const list = loadWatchlist();
  const symbols = list.groups.flatMap((group) => group.tickers.map((ticker) => ticker.ticker));
  kickEpsWarm(list, symbols);
}

export async function getMarketPayload(): Promise<MarketPayload> {
  const list = loadWatchlist();
  const symbols = list.groups.flatMap((group) => group.tickers.map((ticker) => ticker.ticker));
  const cache = await ensureSeries(list);
  const payload = memoPayload(cache, list);
  kickEpsWarm(list, symbols);
  return payload;
}

/** Team picks reuse the price cache. Tickers already on the watchlist are not fetched again. */
export async function getPicksPayload(): Promise<PicksPayload> {
  const picks = loadTeamPicks();
  if (picks.length === 0) {
    const now = Date.now();
    return {
      fetchedAt: now,
      fetchedAtJst: formatJst(new Date(now)),
      empty: true,
      picks: [],
    };
  }
  const list = loadWatchlist();
  const cache = await ensureSeries(
    list,
    picks.map((pick) => pick.ticker),
  );
  const today = todayEt();
  const fetchedAt = oldestOkAt(cache, picks.map((pick) => pick.ticker), Date.now());
  const spyBars = cache.series.SPY?.bars ?? [];
  return {
    fetchedAt,
    fetchedAtJst: formatJst(new Date(fetchedAt)),
    empty: false,
    picks: picks.map((pick) => {
      const entry = cache.series[pick.ticker];
      const built = quoteFromEntry(entry);
      const relative = built.quote && entry?.bars ? rs20(entry.bars, spyBars) : null;
      return buildPickCard(pick, toPickQuote(built.quote), built.error, today, relative);
    }),
  };
}

export async function getChart(ticker: string): Promise<ChartPayload | { error: string }> {
  const symbol = ticker.toUpperCase();
  const list = loadWatchlist();
  const known = new Set([
    ...list.groups.flatMap((group) => group.tickers.map((item) => item.ticker)),
    ...indexMonitorTickers(list),
    ...monitorUnionSymbols(),
  ]);
  if (!known.has(symbol)) return { error: "リストにないティッカー" };

  const cache = await ensureSeries(list);
  const entry = cache.series[symbol];
  if (!entry) return { error: "日足がまだない" };
  if (!entry.bars) return { error: friendlyFetchError(entry.error || "日足がない") };

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
  const set = new Set<string>([...BENCHMARKS, FX_USDJPY]);
  for (const group of list.groups) {
    for (const ticker of group.tickers) set.add(ticker.ticker);
  }
  for (const holding of holdingsSource().load().holdings) set.add(holding.ticker);
  for (const t of monitorUnionSymbols()) set.add(t);
  return [...set];
}

export type EnsureOptions = {
  /** Wait for due symbols to be refetched instead of answering from the older cache. */
  fresh?: boolean;
};

/**
 * Answers from the cache when every symbol has an entry and refreshes due symbols in the
 * background (stale-while-revalidate). Waits only on a cold cache, new symbols, or `fresh`.
 */
export async function ensureSeries(list: Watchlist, extra: string[] = [], options: EnsureOptions = {}): Promise<CacheBody> {
  const symbols = withExtra(symbolsFor(list), extra);
  if (!memory) memory = readDisk();
  const cache = memory;
  const due = dueSymbols(cache, symbols, Date.now());
  if (cache && due.length === 0) return cache;
  const run = startRefresh(due);
  if (!cache || options.fresh || missingSymbols(cache, symbols).length > 0) return run;
  void run.catch((error) => console.error("[range] background refresh", error));
  return cache;
}

function startRefresh(symbols: string[]): Promise<CacheBody> {
  const pending = inflight;
  if (pending) {
    return pending.then(
      () => {
        const again = dueSymbols(memory, symbols, Date.now());
        return again.length > 0 ? startRefresh(again) : (memory ?? emptyCache());
      },
      () => startRefresh(symbols),
    );
  }
  const run = refresh(symbols).finally(() => {
    if (inflight === run) inflight = null;
  });
  inflight = run;
  return run;
}

function withExtra(symbols: string[], extra: string[]): string[] {
  if (extra.length === 0) return symbols;
  const set = new Set(symbols);
  for (const symbol of extra) {
    const upper = symbol.trim().toUpperCase();
    if (upper) set.add(upper);
  }
  return [...set];
}

async function refresh(symbols: string[]): Promise<CacheBody> {
  const started = Date.now();
  console.log(`[range] fetching ${symbols.length} symbols`);
  const fetched = await mapPool(symbols, FETCH_CONCURRENCY, fetchOne);
  const base = memory ?? emptyCache();
  const series: Record<string, SeriesEntry> = { ...base.series };
  const now = Date.now();
  let ok = 0;
  let kept = 0;
  for (const item of fetched) {
    const merged = mergeOutcome(series[item.symbol], item.outcome, now);
    series[item.symbol] = merged;
    if (!merged.error) ok += 1;
    else if (merged.bars) kept += 1;
  }
  const next: CacheBody = { v: 4, version: base.version + 1, series };
  memory = next;
  try {
    writeDisk(next);
  } catch (error) {
    console.error("[range] cache write failed", error);
  }
  console.log(
    `[range] ready in ${Date.now() - started}ms ok=${ok} keptOld=${kept} fail=${symbols.length - ok - kept}`,
  );
  return next;
}

async function fetchOne(symbol: string): Promise<{ symbol: string; outcome: FetchOutcome }> {
  try {
    const parsed = await fetchDailyBars(symbol);
    return { symbol, outcome: { bars: parsed.bars, droppedPartial: parsed.droppedPartial } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "取得失敗";
    return { symbol, outcome: { error: message.slice(0, 180) } };
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
  const key = `${cache.version}:${epsStamp()}:${basketStamp()}:${monitorStamp()}`;
  if (payloadMemo?.key === key) return payloadMemo.payload;
  const payload = buildPayload(cache, list, readCachedEps());
  payloadMemo = { key, payload };
  return payload;
}

function monitorStamp(): string {
  try {
    return String(fs.statSync(monitorIndexPath()).mtimeMs);
  } catch {
    return "0";
  }
}

function basketStamp(): string {
  let mtime = "0";
  try {
    mtime = String(fs.statSync(path.join(process.cwd(), "data", "corr_basket.json")).mtimeMs);
  } catch {
    // Settings file is optional; defaults apply.
  }
  return `${mtime}:${holdingsSource().stamp()}`;
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

function kickEpsWarm(list: Watchlist, symbols: string[]): void {
  epsWatchlist = list;
  if (epsWarming) return;
  epsWarming = true;
  void warmEps(symbols)
    .catch((error) => console.error("[range] eps warm", error))
    .finally(() => {
      epsWarming = false;
    });
}

async function warmProfitability(symbols: string[], quotes: Record<string, StoredEps>): Promise<void> {
  for (const symbol of symbols) {
    const snap = quotes[symbol] ?? readCachedEps()[symbol] ?? null;
    const profit = profitabilityFromCache(symbol, snap);
    if (profit.status !== "unknown") continue;
    try {
      await fetchTtmIncomeForTicker(symbol);
    } catch (error) {
      console.error(`[range] companyfacts ${symbol}`, error instanceof Error ? error.message : error);
    }
    await sleep(120);
  }
}

async function warmEarningsDates(symbols: string[]): Promise<void> {
  const list = epsWatchlist;
  if (!list) return;
  await warmNasdaqEarningsCalendar(todayEt());
  const byTicker = new Map<string, { earnings: EarningsInput | null }>();
  for (const group of list.groups) {
    for (const row of group.tickers) byTicker.set(row.ticker, { earnings: row.earnings });
  }
  for (const symbol of symbols) {
    const watch = byTicker.get(symbol)?.earnings ?? null;
    if (watch?.date) continue;
    const cached = cachedEarningsEnrich(symbol);
    if (cached?.date) continue;
    try {
      await enrichEarningsDate(symbol, watch, readCachedEps()[symbol] ?? null);
    } catch (error) {
      console.error(`[range] earnings enrich ${symbol}`, error instanceof Error ? error.message : error);
    }
    await sleep(80);
  }
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
      await warmProfitability(unique, quotes);
      void warmEarningsDates(unique);
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

/** Latest EPS snapshots from the on-disk cache (may be empty before warm). */
export function cachedEpsSnapshots(): Record<string, EpsSnapshot> {
  return readCachedEps();
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
  const corr = correlationsOf(cache);
  const spyBars = cache.series.SPY?.bars ?? [];
  const semis = semiTickerSet(list.groups);
  const semiFull = semiSlotsFull(holdingsSource().load().holdings, semis);
  const rows: TickerRow[] = [];
  for (const group of list.groups) {
    for (const ticker of group.tickers) {
      const entry = cache.series[ticker.ticker];
      const built = quoteFromEntry(entry);
      const pair = corr.get(ticker.ticker);
      const epsSnap = eps[ticker.ticker] ?? null;
      const enrich = cachedEarningsEnrich(ticker.ticker);
      const earningsInput = resolveEarningsInput(ticker.earnings, epsSnap, enrich);
      const profitability = profitabilityFromCache(ticker.ticker, epsSnap);
      const earningsView = classifyEarnings(today, earningsInput);
      const meta = enrichTickerMeta(ticker.ticker);
      const quote = built.quote ? attachVerdict(built.quote, earningsView) : null;
      rows.push({
        ticker: ticker.ticker,
        name: meta.name,
        sector: meta.sector,
        industry: meta.industry,
        sectorId: group.id,
        groupName: group.name,
        sectorLabel: ticker.sectorLabel,
        description: ticker.description,
        notes: ticker.notes,
        tags: ticker.tags,
        watchOnly: ticker.watchOnly,
        earnings: earningsView,
        earningsUnknown: earningsDateUnknown(ticker.earnings, epsSnap, enrich),
        profitability,
        corrBasket: pair?.basket ?? null,
        corrSoxx: pair?.soxx ?? null,
        rs20: built.quote && entry?.bars ? rs20(entry.bars, spyBars) : null,
        semi: semis.has(ticker.ticker),
        semiFull,
        quote,
        pe: peView(built.quote?.close, eps[ticker.ticker] ?? null),
        error: built.error,
        errorDetail: built.errorDetail,
        stale: built.stale,
      });
    }
  }

  const indices: IndexRow[] = BENCHMARKS.map((ticker) => {
    const built = quoteFromEntry(cache.series[ticker]);
    return { ticker, quote: built.quote, error: built.error };
  });

  const failCount = rows.filter((row) => !row.quote).length;
  const staleCount = rows.filter((row) => row.stale).length;
  const indexBuilt = buildIndexMonitorRows(cache, list, corr, spyBars, eps);
  let monitor: MonitorMeta | null = null;
  try {
    const indexFile = loadMonitorIndex();
    monitor = {
      asOfDate: indexFile.asOfDate,
      unionCount: indexFile.union.length,
      watchlistCount: rows.length,
      indexOnlyCount: indexBuilt.rows.length,
    };
  } catch {
    monitor = null;
  }
  const fetchedAt = oldestOkAt(cache, rows.map((row) => row.ticker), Date.now());
  const barDate = modeDate(indices, rows);
  const excludedPartial = BENCHMARKS.some(
    (ticker) => cache.series[ticker]?.droppedPartial,
  );

  return {
    fetchedAt,
    fetchedAtJst: formatJst(new Date(fetchedAt)),
    ttlMs: CACHE_TTL_MS,
    barDate,
    provisional: closeIsProvisional(barDate),
    excludedPartial,
    source: SOURCE,
    indices,
    rows,
    indexRows: indexBuilt.rows,
    monitor,
    okCount: rows.length - failCount,
    failCount,
    indexFailCount: indexBuilt.failCount,
    staleCount,
    usdJpy: usdJpyOf(cache),
  };
}

let indexTickerNames: Record<string, string> | null = null;

function indexTickerDescription(ticker: string): string {
  if (!indexTickerNames) {
    try {
      indexTickerNames = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "data", "pit_ticker_names.json"), "utf8"),
      ) as Record<string, string>;
    } catch {
      indexTickerNames = {};
    }
  }
  const name = indexTickerNames[ticker];
  return name ? `${name}（指数監視）` : `${ticker}（S&P500 / Nasdaq-100 監視）`;
}

function buildIndexMonitorRows(
  cache: CacheBody,
  list: Watchlist,
  corr: Map<string, CorrPair>,
  spyBars: NonNullable<CacheBody["series"][string]["bars"]>,
  eps: Record<string, EpsSnapshot>,
): { rows: TickerRow[]; failCount: number } {
  let sp500 = new Set<string>();
  let ndx = new Set<string>();
  try {
    const indexFile = loadMonitorIndex();
    sp500 = new Set(indexFile.sp500);
    ndx = new Set(indexFile.ndx100);
  } catch {
    return { rows: [], failCount: 0 };
  }
  const tickers = indexMonitorTickers(list).sort((a, b) => a.localeCompare(b));
  const rows: TickerRow[] = [];
  let failCount = 0;
  for (const ticker of tickers) {
    const entry = cache.series[ticker];
    const built = quoteFromEntry(entry);
    if (!built.quote) failCount += 1;
    const pair = corr.get(ticker);
    const epsSnap = eps[ticker] ?? null;
    const indexLabel =
      sp500.has(ticker) && ndx.has(ticker)
        ? "S&P500 · NDX100"
        : sp500.has(ticker)
          ? "S&P500"
          : "Nasdaq-100";
    const meta = enrichTickerMeta(ticker);
    rows.push({
      ticker,
      name: meta.name,
      sector: meta.sector,
      industry: meta.industry,
      sectorId: "index",
      groupName: indexLabel,
      sectorLabel: "指数監視",
      description: indexTickerDescription(ticker),
      notes: "",
      tags: [],
      watchOnly: true,
      earnings: null,
      earningsUnknown: true,
      profitability: profitabilityFromCache(ticker, epsSnap),
      corrBasket: pair?.basket ?? null,
      corrSoxx: pair?.soxx ?? null,
      rs20: built.quote && entry?.bars ? rs20(entry.bars, spyBars) : null,
      semi: false,
      semiFull: false,
      quote: built.quote ? attachVerdict(built.quote, null) : null,
      pe: peView(built.quote?.close, epsSnap),
      error: built.error,
      errorDetail: built.errorDetail,
      stale: built.stale,
    });
  }
  return { rows, failCount };
}

function toPickQuote(quote: Quote | null): PickQuote | null {
  if (!quote) return null;
  return {
    close: quote.close,
    closeDate: quote.closeDate,
    boxPct: quote.boxPct,
    low20: quote.low20,
    high20: quote.high20,
    volumeRatio: quote.volumeRatio,
    atr14: quote.atr14,
    shares10: quote.shares10,
    cost10: quote.cost10,
    line15: quote.line15,
    line25: quote.line25,
    reboundDays: quote.reboundDays,
    entrySignal: quote.entrySignal,
    low20DaysAgo: quote.low20DaysAgo,
    high20DaysAgo: quote.high20DaysAgo,
    downtrend: quote.downtrend,
    verdict: quote.verdict,
  };
}

function correlationsOf(cache: CacheBody): Map<string, CorrPair> {
  const basket = loadCorrBasket();
  if (!basket) return new Map();
  const closes: Record<string, Array<{ date: string; c: number }>> = {};
  for (const [symbol, entry] of Object.entries(cache.series)) {
    if (!entry.bars?.length) continue;
    closes[symbol] = entry.bars.map((bar) => ({ date: bar.date, c: bar.c }));
  }
  try {
    return buildCorrelations(closes, basket);
  } catch (error) {
    console.error("[range] corr", error);
    return new Map();
  }
}

/** Latest USD/JPY daily close. Null until Yahoo returns it. */
export function usdJpyOf(cache: CacheBody): { rate: number; date: string } | null {
  const last = cache.series[FX_USDJPY]?.bars?.at(-1);
  if (!last || !(last.c > 0)) return null;
  return { rate: last.c, date: last.date };
}

/** Bars kept from an earlier fetch still produce a quote; `stale` tells the UI they are old. */
export function quoteFromEntry(entry: SeriesEntry | undefined): {
  quote: Quote | null;
  error: string | null;
  errorDetail: string | null;
  stale: boolean;
} {
  if (!entry) return { quote: null, error: "日足がまだない", errorDetail: null, stale: false };
  if (!entry.bars) {
    const detail = entry.error || "日足がない";
    return { quote: null, error: friendlyFetchError(detail), errorDetail: detail, stale: false };
  }
  const computed = computeQuote(entry.bars);
  if (!computed.ok) return { quote: null, error: computed.error, errorDetail: null, stale: false };
  return { quote: computed.quote, error: null, errorDetail: entry.error ?? null, stale: isStale(entry) };
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
    if (parsed?.v !== 4 || typeof parsed.version !== "number" || !parsed.series) return null;
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
