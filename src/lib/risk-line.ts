import { cushionAfterLoss, policyLevels } from "./account-config";

export { cushionAfterLoss };
import type { Holding } from "./holdings";
import { isIgnoredTicker } from "./holdings";
import { stopLevel, type StopRule } from "./stops";
import type { Bar } from "./types";

export type StopPosition = {
  ticker: string;
  shares: number;
  close: number | null;
  /** Review price. Null when this name has no stop rule and no review line. */
  stop: number | null;
};

export type RiskLine = {
  defenseLineJpy: number;
  accountCenterJpy: number;
  /** Account center minus the defense line. */
  cushionJpy: number;
  /** Dollars lost if every configured stop is hit from the latest close. Null when a priced holding has no stop. */
  lossUsd: number | null;
  lossJpy: number | null;
  /** Cushion left after that loss. Null when the loss or the yen rate is missing. */
  cushionAfterJpy: number | null;
  /** Holdings that could not be included. */
  uncovered: string[];
};

export function lossIfStopsHit(positions: StopPosition[]): { usd: number; uncovered: string[] } | null {
  const uncovered: string[] = [];
  let usd = 0;
  let priced = 0;
  for (const position of positions) {
    if (isIgnoredTicker(position.ticker)) continue;
    if (position.close == null) {
      uncovered.push(position.ticker);
      continue;
    }
    priced += 1;
    if (position.stop == null) {
      uncovered.push(position.ticker);
      continue;
    }
    usd += position.shares * Math.max(0, position.close - position.stop);
  }
  if (priced === 0) return null;
  if (uncovered.length > 0 && usd === 0 && uncovered.length === priced) return { usd: 0, uncovered };
  return { usd: Math.round(usd * 100) / 100, uncovered };
}

export function buildRiskLine(input: {
  defenseLineJpy?: number | null;
  accountCenterJpy?: number | null;
  usdJpy: number | null;
  positions: StopPosition[];
}): RiskLine {
  const policy = policyLevels(input);
  const loss = input.positions.length === 0 ? null : lossIfStopsHit(input.positions);
  const lossUsd = loss == null ? null : loss.usd;
  const lossJpy = lossUsd != null && input.usdJpy != null ? Math.round(lossUsd * input.usdJpy) : null;
  const cushionAfterJpy = lossJpy != null ? policy.cushionJpy - lossJpy : null;
  return {
    defenseLineJpy: policy.defenseLineJpy,
    accountCenterJpy: policy.accountCenterJpy,
    cushionJpy: policy.cushionJpy,
    lossUsd,
    lossJpy,
    cushionAfterJpy,
    uncovered: loss?.uncovered ?? [],
  };
}

export function positionsFromHoldings(
  holdings: Holding[],
  quotes: Record<string, { close: number | null; bars?: Bar[] } | undefined>,
  rules: StopRule[],
): StopPosition[] {
  return holdings
    .filter((holding) => !isIgnoredTicker(holding.ticker))
    .map((holding) => {
      const quote = quotes[holding.ticker];
      const configured = stopLevel(holding.ticker, quote?.bars, rules);
      return {
        ticker: holding.ticker,
        shares: holding.shares,
        close: quote?.close ?? null,
        stop: configured ?? holding.reviewLine,
      };
    });
}

