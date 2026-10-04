import { LOSS_UNKNOWN_TAG } from "./constants";
import type { EpsSnapshot, Profitability } from "./types";
import { THEME_KEEP } from "./themes";
type TtmIncome = { ttmNetIncome: number; source: string };

export { LOSS_UNKNOWN_TAG };

export type { Profitability, ProfitabilityStatus } from "./types";

export function resolveProfitability(ticker: string, eps: EpsSnapshot | null, edgar: TtmIncome | null = null): Profitability {
  const key = ticker.trim().toUpperCase();
  const trailingEps = eps?.trailingEps ?? null;
  const yahooIncome = eps?.ttmNetIncome ?? null;
  const incomeSource = eps?.profitSource ?? null;

  if (key === THEME_KEEP) {
    return { status: "profit", source: "spcx:exempt", ttmNetIncome: null, trailingEps };
  }

  if (trailingEps != null && Number.isFinite(trailingEps)) {
    return {
      status: trailingEps < 0 ? "loss" : "profit",
      source: "yahoo:trailingEps",
      ttmNetIncome: yahooIncome,
      trailingEps,
    };
  }

  if (yahooIncome != null && Number.isFinite(yahooIncome)) {
    return {
      status: yahooIncome < 0 ? "loss" : "profit",
      source: incomeSource ?? "yahoo:netIncome",
      ttmNetIncome: yahooIncome,
      trailingEps,
    };
  }

  if (edgar?.ttmNetIncome != null && Number.isFinite(edgar.ttmNetIncome)) {
    return {
      status: edgar.ttmNetIncome < 0 ? "loss" : "profit",
      source: edgar.source,
      ttmNetIncome: edgar.ttmNetIncome,
      trailingEps,
    };
  }

  return { status: "unknown", source: null, ttmNetIncome: null, trailingEps };
}

export function lossUnknown(profit: Profitability, ticker: string): boolean {
  if (ticker.trim().toUpperCase() === THEME_KEEP) return false;
  return profit.status === "unknown";
}

/** Whether the morning screen should grey out the card for a loss-making name. */
export function isLossExcluded(ticker: string, profit: Profitability): boolean {
  if (ticker.trim().toUpperCase() === THEME_KEEP) return false;
  return profit.status === "loss";
}
