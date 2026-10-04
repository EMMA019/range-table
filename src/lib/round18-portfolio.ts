import { isTradingDay } from "./calendar";
import { isSemiGroup } from "./semis";
import { themeOf } from "./themes";
import { isIgnoredTicker } from "./holdings";
import { resolveProfitability } from "./loss-filter";
import { cachedTtmIncome } from "./edgar-companyfacts";
import type { Bar } from "./types";
import type { Watchlist } from "./types";

export const ROUND18_START = "2016-01-01";
export const ROUND18_IS_END = "2020-12-31";
export const ROUND18_OOS_START = "2021-01-01";
export const ROUND18_END = "2026-10-02";
export const ROUND18_CAL_YEAR_START = 2017;
export const ROUND18_CAL_YEAR_END = 2026;
export const ROUND18_INITIAL_CASH = 3200;
export const ROUND18_SEMI_CAP = 0.3;
export const ROUND18_SECTOR_CAP = 0.3;
export const ROUND18_MOMENTUM_SKIP_DAYS = 21;
export const ROUND18_MOMENTUM_LOOKBACK_DAYS = 252;
export const ROUND18_INV_VOL_WINDOW = 60;

export type Round18Method = "equal" | "mcap" | "invvol" | "momentum";
export type Round18Rebal = "monthly" | "quarterly" | "annual";

export type Round18Config = {
  method: Round18Method;
  n: 10 | 20 | 30;
  rebal: Round18Rebal;
};

export type Round18Meta = {
  ticker: string;
  sectorId: string;
  semiBucket: boolean;
  profitable: boolean;
  firstDate: string;
  shares: number;
};

export type Round18EquityPoint = { date: string; equity: number };

export type Round18Metrics = {
  cagr: number;
  maxDrawdown: number;
  recoveryDays: number | null;
  calendarYears: Record<string, number>;
};

const METHOD_ORDER: Round18Method[] = ["equal", "mcap", "invvol", "momentum"];
const REBAL_ORDER: Round18Rebal[] = ["annual", "quarterly", "monthly"];

export function round18Configs(): Round18Config[] {
  const out: Round18Config[] = [];
  for (const method of METHOD_ORDER) {
    for (const n of [10, 20, 30] as const) {
      for (const rebal of ["monthly", "quarterly", "annual"] as const) {
        out.push({ method, n, rebal });
      }
    }
  }
  return out;
}

export function compareRound18Configs(a: Round18Config, b: Round18Config): number {
  if (a.method !== b.method) return METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method);
  if (a.n !== b.n) return a.n - b.n;
  return REBAL_ORDER.indexOf(a.rebal) - REBAL_ORDER.indexOf(b.rebal);
}

export function buildRound18Universe(
  watch: Watchlist,
  barsFirstDate: Map<string, string>,
  isProfitable: (ticker: string) => boolean = (ticker) =>
    resolveProfitability(ticker, null, cachedTtmIncome(ticker)).status === "profit",
): Round18Meta[] {
  const out: Round18Meta[] = [];
  for (const group of watch.groups) {
    if (group.id === "financials") continue;
    for (const t of group.tickers) {
      const ticker = t.ticker;
      if (isIgnoredTicker(ticker)) continue;
      if (themeOf(ticker)) continue;
      if (!isProfitable(ticker)) continue;
      const firstDate = barsFirstDate.get(ticker);
      if (!firstDate) continue;
      out.push({
        ticker,
        sectorId: group.id,
        semiBucket: isSemiGroup(group.id),
        profitable: true,
        firstDate,
        shares: 0,
      });
    }
  }
  return out;
}

function sectorBucket(meta: Round18Meta): string {
  return meta.semiBucket ? "semi_equipment" : meta.sectorId;
}

export function applySectorCaps(weights: Record<string, number>, metaByTicker: Map<string, Round18Meta>): Record<string, number> {
  const w = { ...weights };
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  if (total <= 0) return w;
  for (const k of Object.keys(w)) w[k] /= total;

  const cap = (bucket: string) => (bucket === "semi_equipment" ? ROUND18_SEMI_CAP : ROUND18_SECTOR_CAP);
  const bucketOf = (ticker: string) => {
    const meta = metaByTicker.get(ticker);
    return meta ? sectorBucket(meta) : "";
  };
  const bucketSum = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [ticker, weight] of Object.entries(w)) {
      const bucket = bucketOf(ticker);
      if (!bucket) continue;
      out[bucket] = (out[bucket] ?? 0) + weight;
    }
    return out;
  };
  for (let iter = 0; iter < 64; iter += 1) {
    const sums = bucketSum();
    let over = false;
    for (const [bucket, sum] of Object.entries(sums)) {
      if (sum <= cap(bucket) + 1e-9) continue;
      over = true;
      const scale = cap(bucket) / sum;
      for (const ticker of Object.keys(w)) {
        if (bucketOf(ticker) === bucket) w[ticker] *= scale;
      }
    }
    if (!over) break;
    const slack = 1 - Object.values(w).reduce((a, b) => a + b, 0);
    if (slack <= 1e-9) continue;
    const sums2 = bucketSum();
    const room: Record<string, number> = {};
    for (const bucket of new Set(Object.keys(w).map(bucketOf).filter(Boolean))) {
      room[bucket] = Math.max(0, cap(bucket) - (sums2[bucket] ?? 0));
    }
    const roomSum = Object.values(room).reduce((a, b) => a + b, 0);
    if (roomSum <= 1e-9) break;
    const add = Math.min(slack, roomSum);
    for (const ticker of Object.keys(w)) {
      const bucket = bucketOf(ticker);
      if (!bucket || room[bucket] <= 0) continue;
      w[ticker] += (room[bucket] / roomSum) * add;
    }
  }
  const sumW = Object.values(w).reduce((a, b) => a + b, 0);
  if (sumW > 1 + 1e-9) {
    for (const k of Object.keys(w)) w[k] /= sumW;
  }
  return w;
}

function closeOnOrBefore(bars: Bar[], date: string): number | null {
  let lo = 0;
  let hi = bars.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = bars[mid].date;
    if (d <= date) {
      best = bars[mid].c;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
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

function momentumReturn(calendar: string[], closes: Map<string, number>, date: string): number | null {
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

function invVolWeight(calendar: string[], closes: Map<string, number>, date: string): number | null {
  const idx = tradingDayIndex(calendar, date);
  if (idx < ROUND18_INV_VOL_WINDOW) return null;
  const rets: number[] = [];
  for (let i = idx - ROUND18_INV_VOL_WINDOW + 1; i <= idx; i += 1) {
    const p0 = closes.get(calendar[i - 1]);
    const p1 = closes.get(calendar[i]);
    if (p0 == null || p1 == null || p0 <= 0) return null;
    rets.push(Math.log(p1 / p0));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const var_ = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  const vol = Math.sqrt(var_) * Math.sqrt(252);
  if (!(vol > 0)) return null;
  return 1 / vol;
}

export function targetWeights(
  config: Round18Config,
  date: string,
  eligible: Round18Meta[],
  calendar: string[],
  price: (ticker: string) => number | null,
  closeHistory: Map<string, Map<string, number>>,
): Record<string, number> {
  const metaBy = new Map(eligible.map((m) => [m.ticker, m]));
  const scored: Array<{ ticker: string; score: number }> = [];

  for (const m of eligible) {
    const p = price(m.ticker);
    if (p == null || p <= 0) continue;
    const mcap = p * (m.shares > 0 ? m.shares : 1);
    if (config.method === "momentum") {
      const hist = closeHistory.get(m.ticker);
      if (!hist) continue;
      const mom = momentumReturn(calendar, hist, date);
      if (mom == null) continue;
      scored.push({ ticker: m.ticker, score: mom });
    } else {
      scored.push({ ticker: m.ticker, score: mcap });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, config.n);
  if (!picked.length) return {};

  const raw: Record<string, number> = {};
  if (config.method === "mcap") {
    let sum = 0;
    for (const row of picked) {
      const p = price(row.ticker)!;
      const m = metaBy.get(row.ticker)!;
      const w = p * (m.shares > 0 ? m.shares : 1);
      raw[row.ticker] = w;
      sum += w;
    }
    if (sum > 0) for (const t of Object.keys(raw)) raw[t] /= sum;
  } else if (config.method === "invvol") {
    let sum = 0;
    for (const row of picked) {
      const hist = closeHistory.get(row.ticker);
      if (!hist) continue;
      const iv = invVolWeight(calendar, hist, date);
      if (iv == null) continue;
      raw[row.ticker] = iv;
      sum += iv;
    }
    if (sum > 0) for (const t of Object.keys(raw)) raw[t] /= sum;
  } else {
    for (const row of picked) raw[row.ticker] = 1 / picked.length;
  }

  return applySectorCaps(raw, metaBy);
}

export function rebalanceDates(calendar: string[], rebal: Round18Rebal, from: string, to: string): string[] {
  const dates = calendar.filter((d) => d >= from && d <= to);
  if (!dates.length) return [];
  const out: string[] = [];
  let lastKey = "";
  for (const d of dates) {
    const [y, m] = d.split("-").map(Number);
    let key = "";
    if (rebal === "monthly") key = `${y}-${m}`;
    else if (rebal === "quarterly") key = `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    else key = `${y}`;
    if (key !== lastKey) {
      out.push(d);
      lastKey = key;
    }
  }
  return out;
}

export function simulateRound18(
  config: Round18Config,
  calendar: string[],
  universe: Round18Meta[],
  barsByTicker: Map<string, Bar[]>,
  commission: number,
  from: string,
  to: string,
): Round18EquityPoint[] {
  const closeHistory = new Map<string, Map<string, number>>();
  for (const [ticker, bars] of barsByTicker) {
    const m = new Map<string, number>();
    for (const b of bars) m.set(b.date, b.c);
    closeHistory.set(ticker, m);
  }

  const price = (ticker: string, date: string) => closeOnOrBefore(barsByTicker.get(ticker) ?? [], date);

  let cash = ROUND18_INITIAL_CASH;
  const shares: Record<string, number> = {};
  const curve: Round18EquityPoint[] = [];

  const rebalSet = new Set(rebalanceDates(calendar, config.rebal, from, to));

  for (const date of calendar) {
    if (date < from) continue;
    if (date > to) break;

    if (rebalSet.has(date)) {
      const eligible = universe.filter((m) => m.firstDate <= date);
      const weights = targetWeights(
        config,
        date,
        eligible,
        calendar,
        (t) => price(t, date),
        closeHistory,
      );
      const equityBefore =
        cash + Object.entries(shares).reduce((sum, [t, sh]) => sum + sh * (price(t, date) ?? 0), 0);

      for (const t of Object.keys(shares)) {
        const p = price(t, date);
        if (p == null || shares[t] <= 0) continue;
        cash += shares[t] * p - commission;
        shares[t] = 0;
      }

      const tickers = Object.keys(weights);
      for (const t of tickers) {
        const p = price(t, date);
        if (p == null) continue;
        const targetUsd = equityBefore * weights[t];
        const sh = Math.floor(targetUsd / p);
        if (sh <= 0) continue;
        const cost = sh * p + commission;
        if (cost > cash) continue;
        cash -= cost;
        shares[t] = (shares[t] ?? 0) + sh;
      }
    }

    const equity =
      cash + Object.entries(shares).reduce((sum, [t, sh]) => sum + sh * (price(t, date) ?? 0), 0);
    curve.push({ date, equity });
  }
  return curve;
}

export function metricsFromCurve(curve: Round18EquityPoint[], from: string, to: string): Round18Metrics {
  const slice = curve.filter((p) => p.date >= from && p.date <= to);
  if (slice.length < 2) {
    return { cagr: 0, maxDrawdown: 0, recoveryDays: null, calendarYears: {} };
  }
  const start = slice[0].equity;
  const end = slice[slice.length - 1].equity;
  const years = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / (365.25 * 86_400_000);
  const cagr = years > 0 && start > 0 ? (end / start) ** (1 / years) - 1 : 0;

  let peak = slice[0].equity;
  let maxDd = 0;
  let troughDate = slice[0].date;
  for (const p of slice) {
    if (p.equity > peak) {
      peak = p.equity;
    }
    const dd = peak > 0 ? (p.equity - peak) / peak : 0;
    if (dd < maxDd) {
      maxDd = dd;
      troughDate = p.date;
    }
  }

  let recoveryDays: number | null = null;
  const troughIdx = slice.findIndex((p) => p.date === troughDate);
  if (troughIdx >= 0) {
    const target = peak;
    for (let i = troughIdx + 1; i < slice.length; i += 1) {
      if (slice[i].equity >= target) {
        recoveryDays = i - troughIdx;
        break;
      }
    }
  }

  const calendarYears: Record<string, number> = {};
  for (let y = ROUND18_CAL_YEAR_START; y <= ROUND18_CAL_YEAR_END; y += 1) {
    const yStart = `${y}-01-01`;
    const yEnd = y === ROUND18_CAL_YEAR_END ? to : `${y}-12-31`;
    const ys = slice.filter((p) => p.date >= yStart && p.date <= yEnd);
    if (ys.length < 2) continue;
    const e0 = ys[0].equity;
    const e1 = ys[ys.length - 1].equity;
    calendarYears[String(y)] = e0 > 0 ? e1 / e0 - 1 : 0;
  }

  return { cagr, maxDrawdown: maxDd, recoveryDays, calendarYears };
}

export function selectRound18Config(
  results: Array<{ config: Round18Config; cagr: number; maxDrawdown: number }>,
): Round18Config {
  const sorted = [...results].sort((a, b) => {
    if (b.cagr !== a.cagr) return b.cagr - a.cagr;
    if (b.maxDrawdown !== a.maxDrawdown) return b.maxDrawdown - a.maxDrawdown;
    return compareRound18Configs(a.config, b.config);
  });
  return sorted[0]!.config;
}

/** First NYSE session on or after `iso` (weekends/holidays in calendar.ts only — study uses SPY bar dates). */
export function tradingDaysFromBars(bars: Bar[]): string[] {
  return bars.map((b) => b.date).filter((d) => isTradingDay(d));
}

export function firstBarDate(bars: Bar[]): string | null {
  return bars.length ? bars[0].date : null;
}
