import { addDays, isTradingDay, minutesEt, todayEt } from "./calendar";
import { ALERT_MIN_ATR_PCT, ATR_COST_WARN, CORR_HIGH, CORR_WINDOW, PICK_WATCH_PRICE } from "./constants";
import { basketReturnSeries, corrOnWindow, dailyReturns } from "./corr";
import type { HoldingsConfig } from "./holdings";
import type { HoldingsView } from "./holdings-view";
import { settleDate } from "./settlement";
import { lossUnknown } from "./loss-filter";
import { profitabilityFromCache } from "./profit-cache";
import { exclusionPrecheckFlags, screenExclusionReasons } from "./candidate-screen";
import { morningBuyLines } from "./morning";
import type { Profitability } from "./loss-filter";
import type { PrecheckFlag } from "./precheck-flags";
import type { Bar, EarningsView, Quote } from "./types";

export type PrecheckResult = {
  ticker: string;
  shares: number;
  price: number;
  priceBasis: "close" | "input";
  closeDate: string;
  cost: number;
  atr14: number;
  atrPct: number;
  entrySignal: Quote["entrySignal"];
  postWeights: Array<{ ticker: string; weight: number }>;
  corr: Array<{ ticker: string; value: number | null; high: boolean }>;
  corrBasket: number | null;
  lossToLow20: { low20: number; usd: number; jpy: number | null; pctOfAccount: number | null; cushionAfterJpy: number | null };
  earnings: EarningsView | null;
  flags: PrecheckFlag[];
  settlement: { tradeDate: string; settleDate: string; fundsSettleBy: string | null; note: string | null };
};

/** The session an order placed now would fill in: today before the close on a trading day, else the next one. */
export function nextTradeDate(now = new Date()): string {
  let date = todayEt(now);
  if (isTradingDay(date) && minutesEt(now) < 16 * 60) return date;
  for (let i = 0; i < 10; i += 1) {
    date = addDays(date, 1);
    if (isTradingDay(date)) return date;
  }
  return date;
}

export function precheck(input: {
  ticker: string;
  shares: number;
  price?: number | null;
  quote: Quote;
  bars: Bar[];
  holdingBars: Record<string, Bar[] | undefined>;
  view: HoldingsView;
  config: HoldingsConfig;
  earnings: EarningsView | null;
  earningsUnknown?: boolean;
  profitability?: Profitability;
  sectorId: string;
  tradeDate: string;
  today: string;
}): PrecheckResult {
  const { ticker, shares, quote, view, config, tradeDate, today } = input;
  const price = input.price != null && input.price > 0 ? input.price : quote.close;
  const cost = shares * price;
  const atrPct = quote.close > 0 ? (quote.atr14 / quote.close) * 100 : 0;
  const flags: PrecheckFlag[] = [];

  const values = new Map<string, number>();
  for (const row of view.rows) if (row.value != null) values.set(row.ticker, row.value);
  values.set(ticker, (values.get(ticker) ?? 0) + cost);
  const total = [...values.values()].reduce((sum, value) => sum + value, 0);
  const postWeights = [...values.entries()]
    .map(([name, value]) => ({ ticker: name, weight: total > 0 ? value / total : 0 }))
    .sort((a, b) => b.weight - a.weight);

  const mine = dailyReturns(input.bars);
  const others = view.rows.filter((row) => row.ticker !== ticker);
  const corr = others.map((row) => {
    const bars = input.holdingBars[row.ticker];
    const value = bars ? corrOnWindow(mine, dailyReturns(bars), CORR_WINDOW) : null;
    return { ticker: row.ticker, value, high: value != null && value > CORR_HIGH };
  });
  const weighted = others.flatMap((row) => {
    const bars = input.holdingBars[row.ticker];
    return bars && row.value ? [{ weight: row.value, returns: dailyReturns(bars) }] : [];
  });
  const corrBasket = weighted.length ? corrOnWindow(mine, basketReturnSeries(weighted), CORR_WINDOW) : null;

  const rate = view.account.usdJpy;
  const lossUsd = Math.max(0, shares * (price - quote.low20));
  const lossJpy = rate != null ? lossUsd * rate : null;
  const cushionAfterJpy = view.account.cushionJpy != null && lossJpy != null ? view.account.cushionJpy - lossJpy : null;

  const settledCash = config.cash.usdSettled ?? 0;
  const pending = config.cash.usdUnsettled.filter((item) => item.settleDate > today).sort((a, b) => a.settleDate.localeCompare(b.settleDate));
  const matured = config.cash.usdUnsettled.filter((item) => item.settleDate <= today).reduce((sum, item) => sum + item.amountUsd, 0);
  let available = settledCash + matured;
  let fundsSettleBy: string | null = null;
  if (cost > available) {
    for (const item of pending) {
      available += item.amountUsd;
      fundsSettleBy = item.settleDate;
      if (available >= cost) break;
    }
  }

  if (input.earnings?.warn) flags.push("earnings5d");
  if (cushionAfterJpy != null && cushionAfterJpy < 0) flags.push("belowDefense");
  if (cost > available) flags.push("cashShort");
  if (price > PICK_WATCH_PRICE) flags.push("priceOver450");
  if (cost > ATR_COST_WARN) flags.push("costOver450");
  if (atrPct < ALERT_MIN_ATR_PCT) flags.push("atrUnder3");
  if (corr.some((row) => row.high)) flags.push("corrHigh");
  if (
    morningBuyLines({
      close: quote.close,
      low20: quote.low20,
      high20: quote.high20,
      line25: quote.line25,
      line35: quote.line35,
      boxPct: quote.boxPct,
      brokeHigh: quote.brokeHigh,
      reboundDays: quote.reboundDays,
    }).length === 0
  ) {
    flags.push("notInOk");
  }
  const profit = input.profitability ?? profitabilityFromCache(input.ticker, null);
  if (lossUnknown(profit, input.ticker)) flags.push("lossUnknown");
  if (input.earningsUnknown) flags.push("earningsUnknown");
  if (input.earnings?.status === "estimated" && !input.earningsUnknown) flags.push("earningsEstimated");
  if (fundsSettleBy) flags.push("usesUnsettled");

  const screenFlags = exclusionPrecheckFlags(
    screenExclusionReasons({
      ticker,
      sectorId: input.sectorId,
      profitability: profit,
      brokeHigh: quote.brokeHigh,
      atr14: quote.atr14,
      close: quote.close,
    }),
  );
  for (const flag of screenFlags) {
    if (!flags.includes(flag)) flags.push(flag);
  }

  const buySettles = settleDate(tradeDate);
  return {
    ticker,
    shares,
    price,
    priceBasis: input.price != null && input.price > 0 ? "input" : "close",
    closeDate: quote.closeDate,
    cost,
    atr14: quote.atr14,
    atrPct,
    entrySignal: quote.entrySignal,
    postWeights,
    corr,
    corrBasket,
    lossToLow20: {
      low20: quote.low20,
      usd: lossUsd,
      jpy: lossJpy,
      pctOfAccount: lossJpy != null && view.account.accountJpy ? (lossJpy / view.account.accountJpy) * 100 : null,
      cushionAfterJpy,
    },
    earnings: input.earnings,
    flags,
    settlement: {
      tradeDate,
      settleDate: buySettles,
      fundsSettleBy,
      note: fundsSettleBy
        ? `未決済の資金（${fundsSettleBy} 決済）を使う買い。${fundsSettleBy} より前にこの株を売ると GFV（グッドフェイス違反）`
        : null,
    },
  };
}
