import { ALERT_MIN_ATR_PCT } from "./constants";
import { atr14 } from "./compute";
import {
  ROUND18_END,
  ROUND18_INITIAL_CASH,
  ROUND18_MOMENTUM_LOOKBACK_DAYS,
  ROUND18_MOMENTUM_SKIP_DAYS,
  ROUND18_START,
  rebalanceDates,
  type Round18EquityPoint,
} from "./round18-portfolio";
import { isIgnoredTicker } from "./holdings";
import { isSemiGroup } from "./semis";
import { themeOf } from "./themes";
import type { Bar } from "./types";
import type { Watchlist } from "./types";

export const SDI_STOCK_SLOTS = 15;
export const SDI_MAX_SEMI_SLOTS = 4;
export const SDI_SPLIT_6535 = { base: 0.65, stock: 0.35 };
export const SDI_SPLIT_5050 = { base: 0.5, stock: 0.5 };
/** @deprecated use SDI_SPLIT_6535 */
export const SDI_BASE_WEIGHT = SDI_SPLIT_6535.base;
/** @deprecated use SDI_SPLIT_6535 */
export const SDI_STOCK_SLEEVE_WEIGHT = SDI_SPLIT_6535.stock;

export type SdiSplit = { base: number; stock: number };
export const SDI_BROAD_TICKER = "SPTM";
export const SDI_BROAD_PROXY = "SPY";

export type SdiMeta = {
  ticker: string;
  semiBucket: boolean;
  firstDate: string;
};

export function buildSdiMeta(watch: Watchlist, firstDates: Map<string, string>): SdiMeta[] {
  const out: SdiMeta[] = [];
  for (const group of watch.groups) {
    if (group.id === "financials") continue;
    for (const t of group.tickers) {
      const ticker = t.ticker;
      if (isIgnoredTicker(ticker)) continue;
      if (themeOf(ticker)) continue;
      const firstDate = firstDates.get(ticker);
      if (!firstDate) continue;
      out.push({ ticker, semiBucket: isSemiGroup(group.id), firstDate });
    }
  }
  return out;
}

function barsUpTo(bars: Bar[], date: string): Bar[] {
  let lo = 0;
  let hi = bars.length - 1;
  let end = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) {
      end = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return end >= 0 ? bars.slice(0, end + 1) : [];
}

function closeOnOrBefore(bars: Bar[], date: string): number | null {
  const slice = barsUpTo(bars, date);
  return slice.length ? slice[slice.length - 1].c : null;
}

function tradingDayIndex(calendar: string[], date: string): number {
  let lo = 0;
  let hi = calendar.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (calendar[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function windowReturn(calendar: string[], closes: Map<string, number>, date: string): number | null {
  const idx = tradingDayIndex(calendar, date);
  if (idx < 0) return null;
  const endIdx = idx - ROUND18_MOMENTUM_SKIP_DAYS;
  const startIdx = idx - ROUND18_MOMENTUM_SKIP_DAYS - ROUND18_MOMENTUM_LOOKBACK_DAYS;
  if (startIdx < 0 || endIdx < 0) return null;
  const c0 = closes.get(calendar[startIdx]);
  const c1 = closes.get(calendar[endIdx]);
  if (c0 == null || c1 == null || c0 <= 0) return null;
  return c1 / c0 - 1;
}

export function broadIndexForDate(date: string, sptmFirstDate: string | null): typeof SDI_BROAD_TICKER | typeof SDI_BROAD_PROXY {
  if (sptmFirstDate && sptmFirstDate <= date) return SDI_BROAD_TICKER;
  return SDI_BROAD_PROXY;
}

export function isSdiEligible(
  meta: SdiMeta,
  date: string,
  bars: Bar[],
  isProfitable: (ticker: string) => boolean,
): boolean {
  if (meta.firstDate > date) return false;
  if (!isProfitable(meta.ticker)) return false;
  const slice = barsUpTo(bars, date);
  const px = slice.length ? slice[slice.length - 1].c : null;
  const atr = atr14(slice);
  if (px == null || atr == null || px <= 0) return false;
  return (atr / px) * 100 >= ALERT_MIN_ATR_PCT;
}

export function excessReturnVsSpy(
  ticker: string,
  date: string,
  calendar: string[],
  stockCloses: Map<string, number>,
  spyCloses: Map<string, number>,
): number | null {
  const stock = windowReturn(calendar, stockCloses, date);
  const spy = windowReturn(calendar, spyCloses, date);
  if (stock == null || spy == null) return null;
  return stock - spy;
}

/** Deterministic selection: excess vs SPY desc, ticker asc. Respects max semi slots. */
export function pickSdiStocks(
  survivors: string[],
  candidates: string[],
  metaBy: Map<string, SdiMeta>,
  scores: Map<string, number>,
  slots = SDI_STOCK_SLOTS,
  maxSemi = SDI_MAX_SEMI_SLOTS,
): string[] {
  const out = [...survivors];
  const semiCount = () => out.filter((t) => metaBy.get(t)?.semiBucket).length;
  const pool = candidates
    .filter((t) => !out.includes(t))
    .sort((a, b) => {
      const sa = scores.get(a) ?? -Infinity;
      const sb = scores.get(b) ?? -Infinity;
      if (sb !== sa) return sb - sa;
      return a.localeCompare(b);
    });
  for (const t of pool) {
    if (out.length >= slots) break;
    const meta = metaBy.get(t);
    if (!meta) continue;
    if (meta.semiBucket && semiCount() >= maxSemi) continue;
    out.push(t);
  }
  return out.slice(0, slots);
}

export type SdiSimResult = {
  curve: Round18EquityPoint[];
  broadProxyDays: number;
  broadSptmDays: number;
};

export function simulateSdi(
  calendar: string[],
  metaList: SdiMeta[],
  barsBy: Map<string, Bar[]>,
  isProfitable: (ticker: string) => boolean,
  commission: number,
  sptmFirstDate: string | null,
  split: SdiSplit = SDI_SPLIT_6535,
  from = ROUND18_START,
  to = ROUND18_END,
): SdiSimResult {
  const metaBy = new Map(metaList.map((m) => [m.ticker, m]));
  const rebal = new Set(rebalanceDates(calendar, "quarterly", from, to));
  const stockCloses = new Map<string, Map<string, number>>();
  for (const [ticker, bars] of barsBy) {
    const m = new Map<string, number>();
    for (const b of bars) m.set(b.date, b.c);
    stockCloses.set(ticker, m);
  }
  const spyCloses = stockCloses.get(SDI_BROAD_PROXY) ?? new Map();

  let cash = ROUND18_INITIAL_CASH;
  let broadShares = 0;
  let broadSymbol: string = SDI_BROAD_PROXY;
  const stockShares: Record<string, number> = {};
  let holdings: string[] = [];
  const curve: Round18EquityPoint[] = [];
  let broadProxyDays = 0;
  let broadSptmDays = 0;

  const price = (sym: string, date: string) => closeOnOrBefore(barsBy.get(sym) ?? [], date);
  const equityOn = (date: string) => {
    let eq = cash;
    if (broadShares > 0) eq += broadShares * (price(broadSymbol, date) ?? 0);
    for (const [t, sh] of Object.entries(stockShares)) {
      eq += sh * (price(t, date) ?? 0);
    }
    return eq;
  };

  const tradeStock = (sym: string, targetShares: number, date: string) => {
    const p = price(sym, date);
    if (p == null) return;
    const current = stockShares[sym] ?? 0;
    const delta = targetShares - current;
    if (Math.abs(delta) < 1e-8) return;
    if (delta > 0) {
      const cost = delta * p + commission;
      if (cost > cash) return;
      cash -= cost;
    } else {
      cash += -delta * p - commission;
    }
    if (targetShares < 1e-8) delete stockShares[sym];
    else stockShares[sym] = targetShares;
  };

  const tradeBroad = (sym: string, targetShares: number, date: string) => {
    const p = price(sym, date);
    if (p == null) return;
    if (sym !== broadSymbol && broadShares > 0) {
      const oldP = price(broadSymbol, date);
      if (oldP) {
        cash += broadShares * oldP - commission;
        broadShares = 0;
      }
      broadSymbol = sym;
    }
    const current = broadShares;
    const delta = targetShares - current;
    if (Math.abs(delta) < 1e-8) return;
    if (delta > 0) {
      const cost = delta * p + commission;
      if (cost > cash) return;
      cash -= cost;
    } else {
      cash += -delta * p - commission;
    }
    broadShares = targetShares;
    broadSymbol = sym;
  };

  for (const date of calendar) {
    if (date < from) continue;
    if (date > to) break;

    if (rebal.has(date)) {
      const broad = broadIndexForDate(date, sptmFirstDate);
      broadSymbol = broad;
      if (broad === SDI_BROAD_TICKER) broadSptmDays += 1;
      else broadProxyDays += 1;

      const survivors = holdings.filter((t) => {
        const meta = metaBy.get(t);
        if (!meta) return false;
        const bars = barsBy.get(t);
        if (!bars) return false;
        return isSdiEligible(meta, date, bars, isProfitable);
      });

      const scores = new Map<string, number>();
      const eligible: string[] = [];
      for (const meta of metaList) {
        const bars = barsBy.get(meta.ticker);
        if (!bars || !isSdiEligible(meta, date, bars, isProfitable)) continue;
        const ex = excessReturnVsSpy(meta.ticker, date, calendar, stockCloses.get(meta.ticker)!, spyCloses);
        if (ex == null) continue;
        scores.set(meta.ticker, ex);
        eligible.push(meta.ticker);
      }

      holdings = pickSdiStocks(survivors, eligible, metaBy, scores);

      const eq = equityOn(date);
      const targetBroad = eq * split.base;
      const perStock = holdings.length ? (eq * split.stock) / holdings.length : 0;
      const bp = price(broad, date);
      if (bp && bp > 0) tradeBroad(broad, targetBroad / bp, date);

      for (const t of Object.keys(stockShares)) {
        if (!holdings.includes(t)) tradeStock(t, 0, date);
      }
      for (const t of holdings) {
        const p = price(t, date);
        if (p && p > 0) tradeStock(t, perStock / p, date);
      }
    }

    curve.push({ date, equity: equityOn(date) });
  }

  return { curve, broadProxyDays, broadSptmDays };
}
