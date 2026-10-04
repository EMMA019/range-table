import { excludeReasons, type ExcludeReason } from "./morning";
import type { Profitability } from "./loss-filter";
import { themeOf, type ThemeName } from "./themes";

export type ScreenRowInput = {
  ticker: string;
  sectorId: string;
  profitability: Profitability;
  brokeHigh: boolean;
  atr14: number | null;
  close: number;
};

export function screenExclusionReasons(input: ScreenRowInput): Array<ExcludeReason | `theme:${ThemeName}`> {
  return excludeReasons({
    ticker: input.ticker,
    sectorId: input.sectorId,
    profitability: input.profitability,
    brokeHigh: input.brokeHigh,
    atr14: input.atr14,
    close: input.close,
  });
}

/** Default morning UI: financials off, other exclusions hidden. */
export function passesDefaultBuyScreen(reasons: Array<ExcludeReason | `theme:${ThemeName}`>): boolean {
  if (reasons.includes("financials")) return false;
  const others = reasons.filter((reason) => reason !== "financials");
  return others.length === 0;
}

export function passesDefaultBuyScreenForRow(input: ScreenRowInput): boolean {
  return passesDefaultBuyScreen(screenExclusionReasons(input));
}
