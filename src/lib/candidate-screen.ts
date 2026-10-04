import { excludeReasons, type ExcludeReason } from "./morning";
import type { Profitability } from "./loss-filter";
import type { PrecheckFlag } from "./precheck-flags";
import type { ThemeName } from "./themes";

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

const THEME_PRECHECK: Record<ThemeName, PrecheckFlag> = {
  solar: "themeSolar",
  crypto: "themeCrypto",
  nuclear: "themeNuclear",
  quantum: "themeQuantum",
  space: "themeSpace",
};

/** Precheck flags aligned with `screenExclusionReasons` / the morning screen. */
export function exclusionPrecheckFlags(reasons: Array<ExcludeReason | `theme:${ThemeName}`>): PrecheckFlag[] {
  const flags: PrecheckFlag[] = [];
  for (const reason of reasons) {
    if (reason === "loss") flags.push("lossExcluded");
    else if (reason === "aboveBox") flags.push("aboveBox");
    else if (reason === "financials") flags.push("financialsSector");
    else if (reason === "atr") flags.push("atrUnder3");
    else if (reason.startsWith("theme:")) {
      const theme = reason.slice(6) as ThemeName;
      const flag = THEME_PRECHECK[theme];
      if (flag) flags.push(flag);
    }
  }
  return flags;
}
