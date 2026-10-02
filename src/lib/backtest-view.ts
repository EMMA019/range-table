import summary from "../../data/backtest/summary.json";
import type { BacktestSummary } from "./backtest";

/** Committed output of `npm run backtest`. Static, so no fetch is added at runtime. */
export const BACKTEST = summary as unknown as BacktestSummary;

export function pastResult(ticker: string): BacktestSummary["byTicker"][number] | null {
  return BACKTEST.byTicker.find((row) => row.ticker === ticker) ?? null;
}
