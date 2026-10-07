import { closeIsProvisional, todayEt } from "./calendar";
import { formatJst } from "./format";
import { cachedEarningsEnrich, earningsDateUnknown, resolveEarningsInput } from "./earnings-enrich";
import { profitabilityFromCache } from "./profit-cache";
import { cachedEpsSnapshots, ensureSeries } from "./market";
import { isStale, oldestOkAt } from "./price-cache";
import { loadWatchlist } from "./watchlist";
import { indexMonitorTickers } from "./monitor-universe";
import {
  alertSlot,
  countAlerts,
  dedupeAlerts,
  filterSince,
  orderEntryAlertsByRs,
  sortAlerts,
  type AlertItem,
  type AlertsPayload,
} from "./alerts";
import { entryAlerts, finalBars, holdingEarningsAlerts, type EntryCandidate } from "./alerts-entry";
import { reviewAlerts } from "./alerts-review";
import { holdingsSource, isIgnoredTicker } from "./holdings";
import { loadStopRules, stopLevel } from "./stops";
import { loadMaterialNews, materialNewsAlerts } from "./material-news";
import { semiSlotsFull, semiTickerSet } from "./semis";
import { edgarItems, edgarStatus, refreshEdgar } from "./edgar-feed";

export type AlertsQuery = {
  since: string | null;
  /** Override for how long to wait on a running EDGAR sweep. */
  edgarWaitMs?: number;
  /** The caller proved access to the private holdings (bearer token or passcode session). */
  authorized?: boolean;
};

/** How long one poll waits for a running EDGAR sweep before answering with what is done. */
const EDGAR_WAIT_MS = 12_000;

/** Waits for due prices (unlike the table) so a poll right after the close sees the final bar. */
export async function getAlertsPayload(query: AlertsQuery, now = new Date()): Promise<AlertsPayload> {
  const list = loadWatchlist();
  const [cache] = await Promise.all([ensureSeries(list, [], { fresh: true }), refreshEdgar(query.edgarWaitMs ?? EDGAR_WAIT_MS, now)]);
  const today = todayEt(now);
  const tickers = list.groups.flatMap((group) => group.tickers);
  const semis = semiTickerSet(list.groups);
  const config = holdingsSource().load();
  const semiFull = semiSlotsFull(config.holdings, semis);
  const spy = cache.series.SPY?.bars;
  const spyFinal = spy ? finalBars(spy, now) : [];

  const eps = cachedEpsSnapshots();
  const candidates: EntryCandidate[] = [];
  for (const group of list.groups) {
    for (const ticker of group.tickers) {
      const entry = cache.series[ticker.ticker];
      const epsSnap = eps[ticker.ticker] ?? null;
      const enrich = cachedEarningsEnrich(ticker.ticker);
      candidates.push({
        ticker: ticker.ticker,
        watchOnly: ticker.watchOnly,
        earnings: resolveEarningsInput(ticker.earnings, epsSnap, enrich),
        earningsUnknown: earningsDateUnknown(ticker.earnings, epsSnap, enrich),
        bars: entry?.bars,
        stale: isStale(entry),
        semi: semis.has(ticker.ticker),
        sectorId: group.id,
        profitability: profitabilityFromCache(ticker.ticker, epsSnap),
      });
    }
  }

  for (const ticker of indexMonitorTickers(list)) {
    const entry = cache.series[ticker];
    const epsSnap = eps[ticker] ?? null;
    candidates.push({
      ticker,
      watchOnly: true,
      earnings: null,
      earningsUnknown: true,
      bars: entry?.bars,
      stale: isStale(entry),
      semi: false,
      sectorId: "index",
      profitability: profitabilityFromCache(ticker, epsSnap),
    });
  }

  const items: AlertItem[] = [
    ...entryAlerts(candidates, today, now, { spyBars: spyFinal, semiFull }),
    ...edgarItems(),
  ];
  const rules = loadStopRules();
  const reviewTargets = config.holdings.flatMap((holding) => {
    if (isIgnoredTicker(holding.ticker)) return [];
    const bars = cache.series[holding.ticker]?.bars;
    const level = stopLevel(holding.ticker, bars, rules) ?? holding.reviewLine;
    if (level == null) return [];
    return [{ ...holding, reviewLine: level }];
  });
  const news = loadMaterialNews();
  if (query.authorized) {
    const series = Object.fromEntries(reviewTargets.map((holding) => [holding.ticker, cache.series[holding.ticker]?.bars]));
    items.push(...reviewAlerts(reviewTargets, series, now));
    const earningsByTicker = new Map(tickers.map((ticker) => [ticker.ticker, ticker.earnings]));
    items.push(...holdingEarningsAlerts(config.holdings, earningsByTicker, today));
    items.push(...materialNewsAlerts(config.holdings, news.items, now));
  }
  const holdings = {
    ok: !query.authorized || reviewTargets.every((holding) => cache.series[holding.ticker]?.bars),
    enabled: Boolean(query.authorized) && reviewTargets.length > 0,
    checkedAtJst: query.authorized ? formatJst(now) : null,
    error: query.authorized && reviewTargets.length === 0 ? "HOLDINGS_JSON に見直しラインのある保有がない" : null,
    complete: true,
  };
  const newsSource = {
    ok: !news.error,
    enabled: Boolean(query.authorized),
    checkedAtJst: query.authorized ? formatJst(now) : null,
    error: news.error,
    complete: true,
  };

  const barDate = spyFinal.at(-1)?.date ?? null;
  const failCount = tickers.filter((ticker) => !cache.series[ticker.ticker]?.bars).length;
  const staleCount = tickers.filter((ticker) => isStale(cache.series[ticker.ticker])).length;
  const fetchedAt = oldestOkAt(
    cache,
    tickers.map((ticker) => ticker.ticker),
    now.getTime(),
  );

  const finalItems = orderEntryAlertsByRs(sortAlerts(dedupeAlerts(filterSince(items, query.since))));
  const prices = {
    ok: failCount < tickers.length / 2,
    enabled: true,
    checkedAtJst: formatJst(new Date(fetchedAt)),
    error: failCount > 0 ? `${failCount}銘柄の日足が無い` : null,
    complete: true,
    provisional: closeIsProvisional(spy?.at(-1)?.date ?? null, now),
    failCount,
    staleCount,
  };
  const edgar = edgarStatus();
  return {
    v: 1,
    generatedAt: now.toISOString(),
    generatedAtJst: formatJst(now),
    slot: alertSlot(now),
    barDate,
    complete: prices.complete && edgar.complete,
    sources: { prices, edgar, holdings, news: newsSource },
    counts: countAlerts(finalItems),
    items: finalItems,
  };
}
