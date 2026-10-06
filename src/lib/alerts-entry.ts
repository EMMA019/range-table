import { closeIsProvisional, etWallTimeMs } from "./calendar";
import { passesDefaultBuyScreen, screenExclusionReasons } from "./candidate-screen";
import { computeQuote } from "./compute";
import { EARNINGS_HOLD_DAYS } from "./constants";
import { EARNINGS_UNKNOWN_PROMINENT } from "./constants";
import { classifyEarnings } from "./earnings";
import { SEMI_CAP_BADGE, formatAtrAlertFragment, formatDollar, formatRs, formatEarningsForAlert } from "./format";
import { isIgnoredTicker } from "./holdings";
import { LOSS_UNKNOWN_TAG } from "./constants";
import { lossUnknown, type Profitability } from "./loss-filter";
import {
  BAND_HIGH_PCT,
  BAND_LOW_PCT,
  USUAL_COST_CAP,
  atrPctOf,
  buySlot,
  entryPrice,
  inMorningBand,
  lotFlags,
  morningBuyLines,
  reboundConfirmed,
  type LineHit,
} from "./morning";
import { roundRs, rs20 } from "./rs";
import { compareEntryRs, jst, siteUrl, type AlertItem } from "./alerts";
import { enrichTickerMeta } from "./ticker-meta";
import type { Bar, EarningsInput, Quote } from "./types";

export type EntryCandidate = {
  ticker: string;
  watchOnly: boolean;
  earnings: EarningsInput | null;
  earningsUnknown: boolean;
  bars: Bar[] | undefined;
  /** Bars come from an earlier fetch because the latest failed. */
  stale: boolean;
  /** Semiconductor or equipment group. */
  semi?: boolean;
  sectorId: string;
  profitability: Profitability;
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
 * First session of the run of consecutive closes in the morning band that ends on the latest bar.
 * Null when the latest bar is outside the band. Stable while the setup lasts, so it anchors the id.
 */
export function bandStreakStart(bars: Bar[], maxLookback = 15): string | null {
  let start: string | null = null;
  for (let back = 0; back < maxLookback; back++) {
    const end = bars.length - back;
    if (end <= 0) break;
    const computed = computeQuote(bars.slice(0, end));
    if (!computed.ok || !inMorningBand(computed.quote.boxPct)) break;
    start = computed.quote.closeDate;
  }
  return start;
}

/** @deprecated Use bandStreakStart. */
export function inOkStreakStart(bars: Bar[], maxLookback = 15): string | null {
  return bandStreakStart(bars, maxLookback);
}

function morningQuoteFrom(quote: Quote) {
  return {
    close: quote.close,
    low20: quote.low20,
    high20: quote.high20,
    line25: quote.line25,
    line35: quote.line35,
    boxPct: quote.boxPct,
    brokeHigh: quote.brokeHigh,
    reboundDays: quote.reboundDays,
  };
}

function entryAlertForLine(
  candidate: EntryCandidate,
  quote: Quote,
  line: LineHit,
  bars: Bar[],
  earnings: ReturnType<typeof classifyEarnings>,
  pct: number,
  rs: number | null,
  semiCap: boolean,
): AlertItem {
  const mq = morningQuoteFrom(quote);
  const lot = lotFlags(mq, line);
  const slot = buySlot(line);
  const entry = entryPrice(mq, line);
  const reboundTag = reboundConfirmed(mq) ? "・反発あり" : "";
  const streakStart = bandStreakStart(bars) ?? quote.closeDate;
  const lossTag = lossUnknown(candidate.profitability, candidate.ticker) ? `・${LOSS_UNKNOWN_TAG}` : "";

  const flags: string[] = [];
  if (candidate.earningsUnknown) flags.push("no_earnings_date");
  if (lossUnknown(candidate.profitability, candidate.ticker)) flags.push("loss_unknown");
  if (lot.flags.overPrice) flags.push("price_over_450");
  if (lot.flags.capBinding) flags.push("cap_450");
  if (candidate.stale) flags.push("stale_data");
  if (semiCap) flags.push("semi_cap");

  const box = Math.round(quote.boxPct);
  const earningsText = formatEarningsForAlert(earnings, candidate.earningsUnknown);
  const sizeText =
    lot.shares != null && lot.cost != null
      ? `${lot.shares}株 ${formatDollar(lot.cost)}（入り ${formatDollar(entry)}）`
      : "株数 —";

  const capNote = lot.flags.capBinding && lot.maxLoss != null ? `損切り損 ${formatDollar(lot.maxLoss)}（$${USUAL_COST_CAP}上限）` : null;

  const eventAt = new Date(etWallTimeMs(quote.closeDate, 16 * 60)).toISOString();
  const earningsTitle =
    candidate.earningsUnknown ? `・${EARNINGS_UNKNOWN_PROMINENT}` : earnings ? "" : `・${EARNINGS_UNKNOWN_PROMINENT}`;

  const meta = enrichTickerMeta(candidate.ticker);
  const metaParts = [
    meta.name !== candidate.ticker ? meta.name : "",
    meta.sector,
  ].filter((part) => part.trim().length > 0);
  const metaTag = metaParts.join(" · ");

  return {
    id: `entry:${candidate.ticker}:${line}:${streakStart}`,
    kind: "entry_in_ok",
    priority: candidate.earningsUnknown || !candidate.earnings ? "low" : "high",
    ticker: candidate.ticker,
    title: `${candidate.ticker}${metaTag ? ` ${metaTag}` : ""} ${slot}回目（${line}%線・箱${box}%${reboundTag}${lossTag}・${formatAtrAlertFragment(quote.atr14, quote.close)}）${earningsTitle}${semiCap ? `・${SEMI_CAP_BADGE}` : ""}`,
    body: [
      metaTag || null,
      `終値 ${formatDollar(quote.close)}（${quote.closeDate}）/ 25%線 ${formatDollar(quote.line25)}・35%線 ${formatDollar(quote.line35)}`,
      `入り ${line}%線 ${formatDollar(entry)} / ${sizeText} / 損切り 箱の安値 ${formatDollar(quote.low20)}`,
      capNote,
      lossUnknown(candidate.profitability, candidate.ticker) ? LOSS_UNKNOWN_TAG : null,
      earningsText,
      `対SPY ${formatRs(rs)}`,
      `帯 ${BAND_LOW_PCT}〜${BAND_HIGH_PCT}%（25〜35%±2pt）`,
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
      buyLine: line,
      buySlot: slot,
      close: quote.close,
      boxPct: Math.round(quote.boxPct * 10) / 10,
      line25: quote.line25,
      line35: quote.line35,
      entry,
      low20: quote.low20,
      atr14: quote.atr14,
      atrPct: Math.round(pct * 100) / 100,
      reboundDays: quote.reboundDays,
      shares: lot.shares,
      cost: lot.cost,
      maxLoss: lot.maxLoss,
      capBinding: lot.flags.capBinding,
      profitStatus: candidate.profitability.status,
      profitSource: candidate.profitability.source,
      ttmNetIncome: candidate.profitability.ttmNetIncome,
      earningsDate: candidate.earnings?.date ?? null,
      earningsStatus: candidate.earnings?.status ?? null,
      earningsTradingDays: earnings?.tradingDays ?? null,
      rs20: rs,
    },
  };
}

/**
 * Morning-band entry (23–37% of the 20-day box), ATR at least 3%, exclusions aligned with the morning screen,
 * and no earnings inside the warn window (5 sessions confirmed, 10 estimated). Up to two alerts per ticker (25% and 35% lines).
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
    if (isIgnoredTicker(candidate.ticker) || !candidate.bars) continue;
    if (candidate.watchOnly && candidate.sectorId !== "index") continue;
    const bars = finalBars(candidate.bars, now);
    const computed = computeQuote(bars);
    if (!computed.ok) continue;
    const quote = computed.quote;
    if (quote.corpActionWarning) continue;
    const mq = morningQuoteFrom(quote);
    const lines = morningBuyLines(mq);
    if (lines.length === 0) continue;

    const reasons = screenExclusionReasons({
      ticker: candidate.ticker,
      sectorId: candidate.sectorId,
      profitability: candidate.profitability,
      brokeHigh: quote.brokeHigh,
      atr14: quote.atr14,
      close: quote.close,
    });
    if (!passesDefaultBuyScreen(reasons)) continue;

    const pct = atrPctOf(quote.atr14, quote.close);
    const earnings = classifyEarnings(today, candidate.earnings);
    if (earnings?.warn) continue;

    const semiCap = Boolean(candidate.semi && options.semiFull);
    const rs = roundRs(rs20(bars, spyBars));

    for (const line of lines) {
      out.push(entryAlertForLine(candidate, quote, line, bars, earnings, pct, rs, semiCap));
    }
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
