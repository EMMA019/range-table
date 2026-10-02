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
  type AlertSourceStatus,
  type AlertsPayload,
} from "./alerts";
import { entryAlerts, finalBars, type EntryCandidate } from "./alerts-entry";

export type AlertsQuery = {
  since: string | null;
};

const EDGAR_OFF: AlertSourceStatus = {
  ok: true,
  enabled: false,
  checkedAtJst: null,
  error: null,
  complete: true,
};

/** Waits for due prices (unlike the table) so a poll right after the close sees the final bar. */
export async function getAlertsPayload(query: AlertsQuery, now = new Date()): Promise<AlertsPayload> {
  const list = loadWatchlist();
  const cache = await ensureSeries(list, [], { fresh: true });
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

  const items: AlertItem[] = [...entryAlerts(candidates, today, now)];

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
  const edgar = EDGAR_OFF;
  return {
    v: 1,
    generatedAt: now.toISOString(),
    generatedAtJst: formatJst(now),
    slot: alertSlot(now),
    barDate,
    complete: prices.complete && edgar.complete,
    sources: { prices, edgar },
    counts: countAlerts(finalItems),
    items: finalItems,
  };
}
