import { ALERT_MIN_ATR_PCT } from "./constants";
import { isIgnoredTicker } from "./holdings";
import { isLossExcluded, type Profitability } from "./loss-filter";
import { themeOf, type ThemeName } from "./themes";

/** Same first session as the frozen paper books. Display only. */
export const PAPER_SCREEN_START = "2026-10-05";

/** Dollars of loss at the box low for one paper lot. Emma set this at $30. */
export const PAPER_RISK_USD = 30;
/** Usual position cost. Shares are also capped so the entry cost stays within this. */
export const USUAL_COST_CAP = 450;
/** Same 3% of the close the detail page's ATR(14) implies, and the same cutoff as entry alerts. */
export const MIN_ATR_PCT = ALERT_MIN_ATR_PCT;
/** Share price at or above this is flagged. */
export const SHARE_PRICE_FLAG = 550;
/** Box-position points. A close within this of a recovery line counts as on that line. */
export const LINE_BAND = 2;

export const BAND_LOW_PCT = 25 - LINE_BAND;
export const BAND_HIGH_PCT = 35 + LINE_BAND;

/** First buy at the 25% line, second at the 35% line (Round 16 morning band). */
export type LineHit = "25" | "35";
export type BuySlot = 1 | 2;

export type SpyFilter = "on" | "off" | "unknown";
export type ExcludeReason = "loss" | "aboveBox" | "theme" | "financials" | "atr";

export type MorningQuote = {
  close: number;
  low20: number;
  high20: number;
  line25: number;
  line35: number;
  boxPct: number;
  brokeHigh: boolean;
  ma20?: number;
  reboundDays?: number | null;
};

/** Whole shares so a drop from the entry line to the box low loses at most $30. */
export function sharesForRisk30(entry: number, stop: number): number | null {
  if (!(entry > 0) || !Number.isFinite(stop) || !(entry > stop)) return null;
  return Math.floor(PAPER_RISK_USD / (entry - stop));
}

export function lotCost(shares: number, entry: number): number | null {
  if (!(shares >= 1) || !(entry > 0)) return null;
  return Math.round(shares * entry * 100) / 100;
}

export function inMorningBand(boxPct: number): boolean {
  return Number.isFinite(boxPct) && boxPct >= BAND_LOW_PCT && boxPct <= BAND_HIGH_PCT;
}

export function buySlot(line: LineHit): BuySlot {
  return line === "25" ? 1 : 2;
}

/**
 * Buy lines to show today. In the 25–35% band (±2 pt outside). Near 25% and/or 35% lines when within LINE_BAND;
 * otherwise the nearer of the two recovery lines.
 */
export function morningBuyLines(quote: MorningQuote): LineHit[] {
  if (!inMorningBand(quote.boxPct)) return [];
  const lines: LineHit[] = [];
  if (Math.abs(quote.boxPct - 25) <= LINE_BAND) lines.push("25");
  if (Math.abs(quote.boxPct - 35) <= LINE_BAND) lines.push("35");
  if (lines.length > 0) return lines;
  return [Math.abs(quote.boxPct - 25) <= Math.abs(quote.boxPct - 35) ? "25" : "35"];
}

/** @deprecated Use morningBuyLines. */
export function lineHit(quote: MorningQuote): LineHit | null {
  const lines = morningBuyLines(quote);
  return lines[0] ?? null;
}

export function entryPrice(quote: MorningQuote, line: LineHit): number {
  return line === "25" ? quote.line25 : quote.line35;
}

export type LotFlags = { overCost: boolean; overPrice: boolean; oneShareTooWide: boolean; capBinding: boolean };

export type LotSize = { shares: number | null; cost: number | null; maxLoss: number | null; flags: LotFlags };

/**
 * Shares are the smaller of the $30 risk count and floor($450 / entry).
 * The entry is the price paid. When that price is above $450, one share does not fit,
 * so the risk count stands and the old cost and $550 flags stay.
 * `capBinding` means the $450 count is the one that reduced the lot.
 * `maxLoss` is that share count times the distance from the entry to the box low.
 */
export function lotFlags(quote: MorningQuote, line: LineHit): LotSize {
  const entry = entryPrice(quote, line);
  const riskShares = sharesForRisk30(entry, quote.low20);
  const capShares = entry > 0 ? Math.floor(USUAL_COST_CAP / entry) : 0;
  const priceTooHigh = capShares === 0;
  const shares = priceTooHigh || riskShares == null ? riskShares : Math.min(riskShares, capShares);
  const cost = shares == null ? null : lotCost(shares, entry);
  const distance = entry - quote.low20;
  const maxLoss = shares != null && shares >= 1 && distance > 0 ? Math.round(shares * distance * 100) / 100 : null;
  return {
    shares,
    cost,
    maxLoss,
    flags: {
      overCost: priceTooHigh && cost != null && cost > USUAL_COST_CAP,
      overPrice: quote.close >= SHARE_PRICE_FLAG || entry >= SHARE_PRICE_FLAG,
      oneShareTooWide: shares === 0,
      capBinding: !priceTooHigh && riskShares != null && capShares < riskShares && capShares >= 1,
    },
  };
}

/** ATR(14) as a percent of the close. Same ratio as the dollar ATR on the detail page. */
export function atrPctOf(atr14: number, close: number): number {
  if (!(close > 0) || !Number.isFinite(atr14)) return 0;
  return (atr14 / close) * 100;
}

export function atrBelowMin(atr14: number | null | undefined, close: number): boolean {
  if (atr14 == null || !Number.isFinite(atr14)) return true;
  return atrPctOf(atr14, close) < MIN_ATR_PCT;
}

/** On when SPY's close is at or above its 20-day average. */
export function spyFilter(quote: { close: number; ma20: number } | null | undefined): SpyFilter {
  if (!quote || !(quote.ma20 > 0) || !Number.isFinite(quote.close)) return "unknown";
  return quote.close >= quote.ma20 ? "on" : "off";
}

export function excludeReasons(input: {
  ticker: string;
  sectorId: string;
  profitability: Profitability;
  brokeHigh: boolean;
  atr14: number | null;
  close: number;
}): Array<ExcludeReason | `theme:${ThemeName}`> {
  const reasons: Array<ExcludeReason | `theme:${ThemeName}`> = [];
  const ticker = input.ticker.trim().toUpperCase();
  if (isLossExcluded(ticker, input.profitability)) reasons.push("loss");
  if (input.brokeHigh) reasons.push("aboveBox");
  const theme = themeOf(ticker);
  if (theme) reasons.push(`theme:${theme}`);
  if (input.sectorId === "financials") reasons.push("financials");
  if (atrBelowMin(input.atr14, input.close)) reasons.push("atr");
  return reasons;
}

export function isPaperCandidate(ticker: string, quote: MorningQuote | null): boolean {
  if (isIgnoredTicker(ticker) || !quote) return false;
  return morningBuyLines(quote).length > 0;
}

export function reboundConfirmed(quote: MorningQuote): boolean {
  return (quote.reboundDays ?? 0) >= 1;
}
