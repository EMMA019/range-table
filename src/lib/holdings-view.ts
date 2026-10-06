import type { HoldingsConfig } from "./holdings";
import { isIgnoredTicker } from "./holdings";
import { enrichTickerMeta } from "./ticker-meta";
import type { EarningsView, EntrySignal, Quote } from "./types";

export type HoldingRow = {
  ticker: string;
  name: string;
  sector: string;
  industry: string | null;
  shares: number;
  close: number | null;
  closeDate: string | null;
  value: number | null;
  /** Share of the stock value, 0–1. */
  weight: number | null;
  avgCost: number | null;
  unrealizedUsd: number | null;
  unrealizedPct: number | null;
  reviewLine: number | null;
  /** (close − review line) ÷ close, in percent. Negative once under the line. */
  toReviewPct: number | null;
  /** (close − review line) ÷ ATR(14): how many average days of range are left. */
  toReviewAtr: number | null;
  /** shares × ATR(14): what one average daily range is worth. */
  dollarsPerAtr: number | null;
  atr14: number | null;
  entrySignal: EntrySignal | null;
  earnings: EarningsView | null;
  /** 20-session return minus SPY. Null when either series is short. */
  rs20: number | null;
  stale: boolean;
  error: string | null;
  note: string | null;
};

export type AccountView = {
  stockUsd: number;
  cashSettledUsd: number;
  cashUnsettledUsd: number;
  usdJpy: number | null;
  usdJpyDate: string | null;
  jpyCash: number;
  /** (stocks + USD cash) × USDJPY + JPY cash. Null without a rate. */
  accountJpy: number | null;
  defenseLineJpy: number | null;
  cushionJpy: number | null;
  cushionPct: number | null;
  /** The same account if every holding fell to its review line (holdings without one stay at the close). */
  atReviewJpy: number | null;
  cushionAtReviewJpy: number | null;
  unsettled: Array<{ amountUsd: number; settleDate: string; settled: boolean }>;
  /** Holdings left out of the totals because they have no price. */
  unpriced: string[];
};

export type HoldingsView = { rows: HoldingRow[]; account: AccountView; warnings: string[] };

export type QuoteInput = { quote: Quote | null; stale: boolean; error: string | null };

export function buildHoldingsView(input: {
  config: HoldingsConfig;
  quotes: Record<string, QuoteInput | undefined>;
  earnings: Record<string, EarningsView | null | undefined>;
  usdJpy: { rate: number; date: string } | null;
  today: string;
  rs?: Record<string, number | null | undefined>;
}): HoldingsView {
  const { config, quotes, earnings, usdJpy, today, rs } = input;
  const holdings = config.holdings.filter((holding) => !isIgnoredTicker(holding.ticker));
  const base = holdings.map((holding) => {
    const entry = quotes[holding.ticker];
    const quote = entry?.quote ?? null;
    const close = quote?.close ?? null;
    const atr = quote?.atr14 ?? null;
    const value = close != null ? holding.shares * close : null;
    const gap = close != null && holding.reviewLine != null ? close - holding.reviewLine : null;
    const meta = enrichTickerMeta(holding.ticker);
    return {
      ticker: holding.ticker,
      name: meta.name,
      sector: meta.sector,
      industry: meta.industry,
      shares: holding.shares,
      close,
      closeDate: quote?.closeDate ?? null,
      value,
      weight: null as number | null,
      avgCost: holding.avgCost,
      unrealizedUsd: close != null && holding.avgCost != null ? holding.shares * (close - holding.avgCost) : null,
      unrealizedPct: close != null && holding.avgCost != null ? (close / holding.avgCost - 1) * 100 : null,
      reviewLine: holding.reviewLine,
      toReviewPct: gap != null && close ? (gap / close) * 100 : null,
      toReviewAtr: gap != null && atr ? gap / atr : null,
      dollarsPerAtr: atr != null ? holding.shares * atr : null,
      atr14: atr,
      entrySignal: quote?.entrySignal ?? null,
      earnings: earnings[holding.ticker] ?? null,
      rs20: rs?.[holding.ticker] ?? null,
      stale: entry?.stale ?? false,
      error: quote ? null : (entry?.error ?? "日足がまだない"),
      note: holding.note,
    } satisfies HoldingRow;
  });
  const stockUsd = base.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const rows = base
    .map((row) => ({ ...row, weight: row.value != null && stockUsd > 0 ? row.value / stockUsd : null }))
    .sort((a, b) => (a.toReviewAtr ?? Infinity) - (b.toReviewAtr ?? Infinity) || a.ticker.localeCompare(b.ticker));

  const settled = config.cash.usdSettled ?? 0;
  const unsettled = config.cash.usdUnsettled.map((item) => ({ ...item, settled: item.settleDate <= today }));
  const unsettledUsd = unsettled.reduce((sum, item) => sum + item.amountUsd, 0);
  const jpy = config.cash.jpy ?? 0;
  const rate = usdJpy?.rate ?? null;
  const toJpy = (usd: number) => (rate != null ? usd * rate + jpy : null);
  const accountJpy = toJpy(stockUsd + settled + unsettledUsd);
  const atReviewStock = base.reduce((sum, row) => {
    if (row.close == null) return sum;
    const floor = row.reviewLine != null ? Math.min(row.reviewLine, row.close) : row.close;
    return sum + row.shares * floor;
  }, 0);
  const atReviewJpy = toJpy(atReviewStock + settled + unsettledUsd);
  const defense = config.defenseLineJpy;
  const cushionJpy = accountJpy != null && defense != null ? accountJpy - defense : null;

  const warnings = [...config.warnings];
  if (rate == null) warnings.push("ドル円が取れていないので、円建ての合計を出せない");
  return {
    rows,
    account: {
      stockUsd,
      cashSettledUsd: settled,
      cashUnsettledUsd: unsettledUsd,
      usdJpy: rate,
      usdJpyDate: usdJpy?.date ?? null,
      jpyCash: jpy,
      accountJpy,
      defenseLineJpy: defense,
      cushionJpy,
      cushionPct: cushionJpy != null && accountJpy ? (cushionJpy / accountJpy) * 100 : null,
      atReviewJpy,
      cushionAtReviewJpy: atReviewJpy != null && defense != null ? atReviewJpy - defense : null,
      unsettled,
      unpriced: base.filter((row) => row.close == null).map((row) => row.ticker),
    },
    warnings,
  };
}
