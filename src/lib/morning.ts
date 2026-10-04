import { isIgnoredTicker } from "./holdings";
import { themeOf, type ThemeName } from "./themes";

/** Same first session as the frozen paper books. Display only. */
export const PAPER_SCREEN_START = "2026-10-05";

/** Dollars of loss at the box low for one paper lot. Emma set this at $30. */
export const PAPER_RISK_USD = 30;
/** Usual position cost. A larger lot is shown and flagged. */
export const USUAL_COST_CAP = 450;
/** Share price at or above this is flagged. */
export const SHARE_PRICE_FLAG = 550;
/** Box-position points. A close within this of 15 or 25 is on that recovery line. */
export const LINE_BAND = 2;

export type LineHit = "15" | "25";
export type SpyFilter = "on" | "off" | "unknown";
export type ExcludeReason = "loss" | "aboveBox" | "theme" | "financials";

export type MorningQuote = {
  close: number;
  low20: number;
  high20: number;
  line15: number;
  line25: number;
  boxPct: number;
  brokeHigh: boolean;
  ma20?: number;
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

export function lineHit(quote: MorningQuote): LineHit | null {
  if (!Number.isFinite(quote.boxPct)) return null;
  const from15 = Math.abs(quote.boxPct - 15);
  const from25 = Math.abs(quote.boxPct - 25);
  if (from15 <= LINE_BAND && from15 <= from25) return "15";
  if (from25 <= LINE_BAND) return "25";
  return null;
}

export function entryPrice(quote: MorningQuote, line: LineHit): number {
  return line === "15" ? quote.line15 : quote.line25;
}

export type LotFlags = { overCost: boolean; overPrice: boolean; oneShareTooWide: boolean };

export function lotFlags(quote: MorningQuote, line: LineHit): { shares: number | null; cost: number | null; flags: LotFlags } {
  const entry = entryPrice(quote, line);
  const shares = sharesForRisk30(entry, quote.low20);
  const cost = shares == null ? null : lotCost(shares, entry);
  return {
    shares,
    cost,
    flags: {
      overCost: cost != null && cost > USUAL_COST_CAP,
      overPrice: quote.close >= SHARE_PRICE_FLAG || entry >= SHARE_PRICE_FLAG,
      oneShareTooWide: shares === 0,
    },
  };
}

/** On when SPY's close is at or above its 20-day average. */
export function spyFilter(quote: { close: number; ma20: number } | null | undefined): SpyFilter {
  if (!quote || !(quote.ma20 > 0) || !Number.isFinite(quote.close)) return "unknown";
  return quote.close >= quote.ma20 ? "on" : "off";
}

export function excludeReasons(input: {
  ticker: string;
  sectorId: string;
  trailingEps: number | null;
  brokeHigh: boolean;
}): Array<ExcludeReason | `theme:${ThemeName}`> {
  const reasons: Array<ExcludeReason | `theme:${ThemeName}`> = [];
  const ticker = input.ticker.trim().toUpperCase();
  if (ticker !== "SPCX" && input.trailingEps != null && input.trailingEps < 0) reasons.push("loss");
  if (input.brokeHigh) reasons.push("aboveBox");
  const theme = themeOf(ticker);
  if (theme) reasons.push(`theme:${theme}`);
  if (input.sectorId === "financials") reasons.push("financials");
  return reasons;
}

export function isPaperCandidate(ticker: string, quote: MorningQuote | null): boolean {
  if (isIgnoredTicker(ticker) || !quote) return false;
  return lineHit(quote) != null;
}
