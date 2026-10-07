import { todayEt } from "./calendar";
import { classifyEarnings } from "./earnings";
import { holdingsSource, isIgnoredTicker } from "./holdings";
import { buildHoldingsView, type HoldingsView, type QuoteInput } from "./holdings-view";
import { cachedEarningsEnrich, earningsDateUnknown } from "./earnings-enrich";
import { profitabilityFromCache } from "./profit-cache";
import { cachedEpsSnapshots, ensureSeries, quoteFromEntry, usdJpyOf } from "./market";
import { rs20 } from "./rs";
import { nextTradeDate, precheck, type PrecheckResult } from "./precheck";
import type { Bar, EarningsView, Watchlist } from "./types";
import { loadWatchlist } from "./watchlist";

/** Private. Callers must check the session or bearer token first. */
function earningsMap(list: Watchlist, today: string): Record<string, EarningsView | null> {
  const out: Record<string, EarningsView | null> = {};
  for (const group of list.groups) for (const ticker of group.tickers) out[ticker.ticker] = classifyEarnings(today, ticker.earnings);
  return out;
}

export async function getHoldingsView(now = new Date()): Promise<HoldingsView> {
  const list = loadWatchlist();
  const cache = await ensureSeries(list);
  const config = holdingsSource().load();
  const quotes: Record<string, QuoteInput> = {};
  const rs: Record<string, number | null> = {};
  const spyBars = cache.series.SPY?.bars ?? [];
  for (const holding of config.holdings) {
    const bars = cache.series[holding.ticker]?.bars;
    const built = quoteFromEntry(cache.series[holding.ticker]);
    quotes[holding.ticker] = { ...built, bars };
    rs[holding.ticker] = bars ? rs20(bars, spyBars) : null;
  }
  return buildHoldingsView({
    config,
    quotes,
    earnings: earningsMap(list, todayEt(now)),
    usdJpy: usdJpyOf(cache),
    today: todayEt(now),
    rs,
  });
}

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export type PrecheckRequest = { ticker: string; shares?: number | null; price?: number | null };

export async function runPrecheck(request: PrecheckRequest, now = new Date()): Promise<PrecheckResult | { error: string }> {
  const ticker = request.ticker.trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) return { error: "ティッカーの形が正しくない" };
  if (isIgnoredTicker(ticker)) return { error: `${ticker} は対象外` };
  const list = loadWatchlist();
  const cache = await ensureSeries(list, [ticker]);
  const entry = cache.series[ticker];
  const { quote, error } = quoteFromEntry(entry);
  if (!quote || !entry?.bars) return { error: error ?? "日足が取れない" };
  const shares = request.shares != null && request.shares > 0 ? Math.floor(request.shares) : quote.shares10;
  if (!shares) return { error: "株数を決められない" };

  const today = todayEt(now);
  const config = holdingsSource().load();
  const quotes: Record<string, QuoteInput> = {};
  const holdingBars: Record<string, Bar[] | undefined> = {};
  for (const holding of config.holdings) {
    quotes[holding.ticker] = quoteFromEntry(cache.series[holding.ticker]);
    holdingBars[holding.ticker] = cache.series[holding.ticker]?.bars;
  }
  const earnings = earningsMap(list, today);
  const view = buildHoldingsView({ config, quotes, earnings, usdJpy: usdJpyOf(cache), today });
  const eps = cachedEpsSnapshots()[ticker] ?? null;
  const enrich = cachedEarningsEnrich(ticker);
  let watchEarnings: import("./types").EarningsInput | null = null;
  let sectorId = "unknown";
  for (const group of list.groups) {
    const row = group.tickers.find((item) => item.ticker === ticker);
    if (row) {
      watchEarnings = row.earnings;
      sectorId = group.id;
      break;
    }
  }
  return precheck({
    ticker,
    shares,
    price: request.price ?? null,
    quote,
    bars: entry.bars,
    holdingBars,
    view,
    config,
    earnings: earnings[ticker] ?? null,
    earningsUnknown: earningsDateUnknown(watchEarnings, eps, enrich),
    profitability: profitabilityFromCache(ticker, eps),
    sectorId,
    tradeDate: nextTradeDate(now),
    today,
  });
}
