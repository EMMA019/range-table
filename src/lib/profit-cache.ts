import type { EpsSnapshot } from "./types";
import { cachedTtmIncome, fetchTtmIncomeForTicker } from "./edgar-companyfacts";
import { resolveProfitability, type Profitability } from "./loss-filter";

export function profitabilityFromCache(ticker: string, eps: EpsSnapshot | null): Profitability {
  const edgar = cachedTtmIncome(ticker);
  return resolveProfitability(ticker, eps, edgar);
}

export async function enrichProfitability(ticker: string, eps: EpsSnapshot | null): Promise<Profitability> {
  const base = profitabilityFromCache(ticker, eps);
  if (base.status !== "unknown") return base;
  const fetched = await fetchTtmIncomeForTicker(ticker);
  return resolveProfitability(ticker, eps, fetched);
}
