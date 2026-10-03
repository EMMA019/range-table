import { closeIsProvisional, etWallTimeMs } from "./calendar";
import { computeQuote } from "./compute";
import { ALERT_MIN_ATR_PCT, EARNINGS_HOLD_DAYS, PICK_WATCH_PRICE } from "./constants";
import { classifyEarnings } from "./earnings";
import { EARNINGS_UNKNOWN, SEMI_CAP_BADGE, formatEarnings, formatRs } from "./format";
import { isIgnoredTicker } from "./holdings";
import { roundRs, rs20 } from "./rs";
import { compareEntryRs, jst, siteUrl, type AlertItem } from "./alerts";
import type { Bar, EarningsInput, Quote } from "./types";

export type EntryCandidate = {
  ticker: string;
  watchOnly: boolean;
  earnings: EarningsInput | null;
  bars: Bar[] | undefined;
  /** Bars come from an earlier fetch because the latest failed. */
  stale: boolean;
  /** Semiconductor or equipment group. */
  semi?: boolean;
};

export type EntryAlertOptions = {
  spyBars?: Bar[];
  /** HOLDINGS_JSON already holds two semiconductor or equipment names. */
  semiFull?: boolean;
};

/** Drops today's bar while its close is still provisional, so a signal never rests on it. */
export function finalBars(bars: Bar[], now: Date): Bar[] {
  const last = bars[bars.length - 1];
  if (last && closeIsProvisional(last.date, now)) return bars.slice(0, -1);
  return bars;
}

/**
 * First session of the run of consecutive in_ok closes that ends on the latest bar.
 * Null when the latest bar is not in_ok. Stable while the setup lasts, so it anchors the id.
 */
export function inOkStreakStart(bars: Bar[], maxLookback = 15): string | null {
  let start: string | null = null;
  for (let back = 0; back < maxLookback; back++) {
    const end = bars.length - back;
    if (end <= 0) break;
    const computed = computeQuote(bars.slice(0, end));
    if (!computed.ok || computed.quote.entrySignal !== "in_ok") break;
    start = computed.quote.closeDate;
  }
  return start;
}

export function atrPct(quote: Pick<Quote, "atr14" | "close">): number {
  return quote.close > 0 ? (quote.atr14 / quote.close) * 100 : 0;
}

/**
 * IN OK, ATR at least 3% of the close, and no earnings within five trading days.
 * A name with no earnings date on file is kept at low priority with the no_earnings_date flag.
 * Watch-only names and ignored tickers are skipped.
 */
export function entryAlerts(
  candidates: EntryCandidate[],
  today: string,
  now: Date,
  options: EntryAlertOptions = {},
): AlertItem[] {
  const out: AlertItem[] = [];
  const spyBars = options.spyBars ?? [];
  for (const candidate of candidates) {
    if (candidate.watchOnly || isIgnoredTicker(candidate.ticker) || !candidate.bars) continue;
    const bars = finalBars(candidate.bars, now);
    const computed = computeQuote(bars);
    if (!computed.ok) continue;
    const quote = computed.quote;
    if (quote.entrySignal !== "in_ok") continue;
    const pct = atrPct(quote);
    if (pct < ALERT_MIN_ATR_PCT) continue;
    const earnings = classifyEarnings(today, candidate.earnings);
    if (earnings?.warn) continue;
    const streakStart = inOkStreakStart(bars) ?? quote.closeDate;

    const semiCap = Boolean(candidate.semi && options.semiFull);
    const flags: string[] = [];
    if (!candidate.earnings) flags.push("no_earnings_date");
    if (quote.close > PICK_WATCH_PRICE) flags.push("price_over_450");
    if (candidate.stale) flags.push("stale_data");
    if (semiCap) flags.push("semi_cap");

    const eventAt = new Date(etWallTimeMs(quote.closeDate, 16 * 60)).toISOString();
    const box = Math.round(quote.boxPct);
    const earningsText = formatEarnings(earnings);
    const rs = roundRs(rs20(bars, spyBars));
    const sizeText =
      quote.shares10 != null && quote.cost10 != null ? `$10株数 ${quote.shares10}株 $${quote.cost10.toFixed(0)}` : "$10株数 —";

    out.push({
      id: `entry:${candidate.ticker}:${streakStart}`,
      kind: "entry_in_ok",
      priority: candidate.earnings ? "high" : "low",
      ticker: candidate.ticker,
      title: `${candidate.ticker} IN OK（箱${box}%・反発${quote.reboundDays ?? 0}日・ATR ${pct.toFixed(1)}%）${candidate.earnings ? "" : `・${EARNINGS_UNKNOWN}`}${semiCap ? `・${SEMI_CAP_BADGE}` : ""}`,
      body: [
        `終値 $${quote.close.toFixed(2)}（${quote.closeDate}）/ 15%線 $${quote.line15.toFixed(2)}・25%線 $${quote.line25.toFixed(2)}`,
        `20日安値 $${quote.low20.toFixed(2)} / ATR $${quote.atr14.toFixed(2)} / ${sizeText}`,
        earningsText,
        `対SPY ${formatRs(rs)}`,
        semiCap ? SEMI_CAP_BADGE : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
      eventAt,
      eventAtJst: jst(eventAt),
      url: siteUrl(`/?t=${encodeURIComponent(candidate.ticker)}`),
      flags,
      facts: {
        barDate: quote.closeDate,
        streakStart,
        close: quote.close,
        boxPct: Math.round(quote.boxPct * 10) / 10,
        line15: quote.line15,
        line25: quote.line25,
        low20: quote.low20,
        atr14: quote.atr14,
        atrPct: Math.round(pct * 100) / 100,
        reboundDays: quote.reboundDays,
        shares10: quote.shares10,
        cost10: quote.cost10,
        earningsDate: candidate.earnings?.date ?? null,
        earningsStatus: candidate.earnings?.status ?? null,
        earningsTradingDays: earnings?.tradingDays ?? null,
        rs20: rs,
      },
    });
  }
  out.sort(compareEntryRs);
  return out;
}

/**
 * Holdings whose next earnings date is within three trading days.
 * ONDS is ignored. Names with no date on the watchlist are not alerts.
 * The caller decides whether the reader is allowed to see holdings.
 */
export function holdingEarningsAlerts(
  holdings: readonly { ticker: string }[],
  earningsByTicker: ReadonlyMap<string, EarningsInput | null>,
  today: string,
): AlertItem[] {
  const out: AlertItem[] = [];
  const seen = new Set<string>();
  for (const holding of holdings) {
    const ticker = holding.ticker;
    if (isIgnoredTicker(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    const view = classifyEarnings(today, earningsByTicker.get(ticker) ?? null);
    if (!view || view.state === "past") continue;
    const days = view.tradingDays ?? 0;
    if (days > EARNINGS_HOLD_DAYS) continue;
    const eventAt = new Date(etWallTimeMs(today, 16 * 60)).toISOString();
    const countdown = `決算まであと${days}営業日`;
    out.push({
      id: `earn-hold:${ticker}:${view.date}`,
      kind: "earnings_hold",
      priority: "high",
      ticker,
      title: `${ticker} ${countdown}・決算前に売るか判断`,
      body: [`決算 ${view.date}（${view.status === "confirmed" ? "確" : "推定"}）`, countdown, "決算前に売るか判断"].join("\n"),
      eventAt,
      eventAtJst: jst(eventAt),
      url: siteUrl("/holdings"),
      flags: [],
      facts: {
        earningsDate: view.date,
        earningsStatus: view.status,
        earningsTradingDays: days,
      },
    });
  }
  return out;
}
