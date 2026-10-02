import { closeIsProvisional, todayEt } from "./calendar";
import { formatJst } from "./format";
import { ensureSeries } from "./market";
import { isStale, oldestOkAt } from "./price-cache";
import { loadWatchlist } from "./watchlist";
import {
  alertSlot,
  countAlerts,
  dedupeAlerts,
  filterSince,
  sortAlerts,
  type AlertItem,
  type AlertsPayload,
} from "./alerts";
import { entryAlerts, finalBars, type EntryCandidate } from "./alerts-entry";
import { reviewAlerts } from "./alerts-review";
import { holdingsSource } from "./holdings";
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

  const candidates: EntryCandidate[] = tickers.map((ticker) => {
    const entry = cache.series[ticker.ticker];
    return {
      ticker: ticker.ticker,
      watchOnly: ticker.watchOnly,
      earnings: ticker.earnings,
      bars: entry?.bars,
      stale: isStale(entry),
    };
  });

  const items: AlertItem[] = [...entryAlerts(candidates, today, now), ...edgarItems()];
  const config = holdingsSource().load();
  const withLine = config.holdings.filter((holding) => holding.reviewLine != null);
  if (query.authorized) {
    const series = Object.fromEntries(withLine.map((holding) => [holding.ticker, cache.series[holding.ticker]?.bars]));
    items.push(...reviewAlerts(withLine, series, now));
  }
  const holdings = {
    ok: !query.authorized || withLine.every((holding) => cache.series[holding.ticker]?.bars),
    enabled: Boolean(query.authorized) && withLine.length > 0,
    checkedAtJst: query.authorized ? formatJst(now) : null,
    error: query.authorized && withLine.length === 0 ? "HOLDINGS_JSON に reviewLine のある保有がない" : null,
    complete: true,
  };

  const spy = cache.series.SPY?.bars;
  const spyFinal = spy ? finalBars(spy, now) : [];
  const barDate = spyFinal.at(-1)?.date ?? null;
  const failCount = tickers.filter((ticker) => !cache.series[ticker.ticker]?.bars).length;
  const staleCount = tickers.filter((ticker) => isStale(cache.series[ticker.ticker])).length;
  const fetchedAt = oldestOkAt(
    cache,
    tickers.map((ticker) => ticker.ticker),
    now.getTime(),
  );

  const finalItems = sortAlerts(dedupeAlerts(filterSince(items, query.since)));
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
    sources: { prices, edgar, holdings },
    counts: countAlerts(finalItems),
    items: finalItems,
  };
}
