import { themeOf } from "./themes";
import { pearson } from "./corr";
import type { Bar } from "./types";

export const SAKA_START = "2016-01-01";
export const SAKA_IS_END = "2020-12-31";
export const SAKA_OOS_START = "2021-01-01";
export const SAKA_END = "2026-10-02";
export const SAKA_INITIAL_CASH = 3200;
export const SAKA_CORR_LOOKBACK = 252;
export const SAKA_CORR_MIN_OBS = 126;
export const SAKA_CORR_PAIR_MAX = 0.7;
export const SAKA_INV_VOL_WINDOW = 60;
export const SAKA_SEMI_CAP = 0.3;
export const SAKA_CAL_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026] as const;

export type SakaPickMethod = "corrdiverse" | "volprune" | "plain";

export type SakaWeightScheme = "mcap" | "mcap_cap10" | "mcap_cap5" | "equal" | "invvol";

export type SakaConfig = {
  id: string;
  pick: SakaPickMethod;
  n: 15 | 20;
  weight: SakaWeightScheme;
};

const PICK_METHODS: SakaPickMethod[] = ["corrdiverse", "volprune", "plain"];
const WEIGHT_SCHEMES: SakaWeightScheme[] = ["mcap", "mcap_cap10", "mcap_cap5", "equal", "invvol"];

export const SAKA_CONFIGS: SakaConfig[] = PICK_METHODS.flatMap((pick) =>
  ([15, 20] as const).flatMap((n) =>
    WEIGHT_SCHEMES.map((weight) => ({
      id: `${pick}_${n}__${weight}`,
      pick,
      n,
      weight,
    })),
  ),
);

export type SakaEquityPoint = { date: string; equity: number };

export type SakaMetrics = {
  cagr: number;
  maxDrawdown: number;
  recoveryDays: number | null;
  calendarYears: Record<string, number>;
  positiveYearShare: number;
};

export type SakaGicsInfo = { sector: string; subIndustry: string; semiBucket: boolean };

export function isSemiSubIndustry(subIndustry: string): boolean {
  const s = subIndustry.toLowerCase();
  return s.includes("semiconductor");
}

export function isExcludedTheme(ticker: string): boolean {
  if (ticker === "ONDS") return true;
  const t = themeOf(ticker);
  return t === "quantum" || t === "space" || t === "crypto" || t === "solar" || t === "nuclear";
}

export function isFinancialSector(sector: string): boolean {
  return sector === "Financials";
}

export function tradingDaysFromBars(bars: Bar[]): string[] {
  return bars.map((b) => b.date);
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

function closeOnOrBefore(bars: Bar[], date: string): number | null {
  let lo = 0;
  let hi = bars.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) {
      best = bars[mid].c;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

export function trailingLogReturns(
  calendar: string[],
  closes: Map<string, number>,
  date: string,
  lookback = SAKA_CORR_LOOKBACK,
): number[] | null {
  const endIdx = tradingDayIndex(calendar, date);
  if (endIdx < lookback - 1) return null;
  const rets: number[] = [];
  for (let i = endIdx - lookback + 1; i <= endIdx; i += 1) {
    const p0 = closes.get(calendar[i - 1]);
    const p1 = closes.get(calendar[i]);
    if (p0 == null || p1 == null || p0 <= 0 || p1 <= 0) return null;
    rets.push(Math.log(p1 / p0));
  }
  return rets.length === lookback ? rets : null;
}

export function hasCorrHistoryAtDate(
  calendar: string[],
  closes: Map<string, number>,
  date: string,
): boolean {
  const rets = trailingLogReturns(calendar, closes, date);
  return rets != null && rets.length >= SAKA_CORR_MIN_OBS;
}

function annualizedVol(rets: number[]): number {
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const var_ = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(var_) * Math.sqrt(252);
}

type CorrInputs = { tickers: string[]; returns: Map<string, number[]>; vol: Map<string, number> };

export function buildCorrInputs(
  tickers: string[],
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  date: string,
): CorrInputs | null {
  const returns = new Map<string, number[]>();
  const vol = new Map<string, number>();
  const ok: string[] = [];
  for (const t of tickers) {
    const hist = closeHistory.get(t);
    if (!hist) continue;
    const rets = trailingLogReturns(calendar, hist, date);
    if (!rets || rets.length < SAKA_CORR_MIN_OBS) continue;
    returns.set(t, rets);
    vol.set(t, annualizedVol(rets));
    ok.push(t);
  }
  if (ok.length < 2) return null;
  ok.sort((a, b) => a.localeCompare(b));
  return { tickers: ok, returns, vol };
}

export function correlationMatrix(inputs: CorrInputs): Map<string, Map<string, number>> {
  const { tickers, returns } = inputs;
  const out = new Map<string, Map<string, number>>();
  for (const a of tickers) {
    const row = new Map<string, number>();
    const ra = returns.get(a)!;
    for (const b of tickers) {
      if (a === b) {
        row.set(b, 1);
        continue;
      }
      const rb = returns.get(b)!;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < ra.length; i += 1) {
        xs.push(ra[i]);
        ys.push(rb[i]);
      }
      row.set(b, pearson(xs, ys) ?? 0);
    }
    out.set(a, row);
  }
  return out;
}

export function avgCorr(ticker: string, universe: string[], corr: Map<string, Map<string, number>>): number {
  let sum = 0;
  let n = 0;
  for (const o of universe) {
    if (o === ticker) continue;
    sum += corr.get(ticker)?.get(o) ?? 0;
    n += 1;
  }
  return n > 0 ? sum / n : Infinity;
}

function pruneHighCorr(tickers: string[], corr: Map<string, Map<string, number>>, vol: Map<string, number>): string[] {
  let pool = [...tickers].sort((a, b) => a.localeCompare(b));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        const a = pool[i];
        const b = pool[j];
        if ((corr.get(a)?.get(b) ?? 0) <= SAKA_CORR_PAIR_MAX) continue;
        const va = vol.get(a) ?? Infinity;
        const vb = vol.get(b) ?? Infinity;
        let drop: string;
        if (va > vb) drop = a;
        else if (vb > va) drop = b;
        else drop = a.localeCompare(b) > 0 ? a : b;
        pool = pool.filter((t) => t !== drop);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return pool;
}

function pickCorrGreedy(pool: string[], corr: Map<string, Map<string, number>>, slots: number): string[] {
  const universe = [...pool].sort((a, b) => a.localeCompare(b));
  const order = [...universe].sort((a, b) => {
    const aa = avgCorr(a, universe, corr);
    const bb = avgCorr(b, universe, corr);
    if (aa !== bb) return aa - bb;
    return a.localeCompare(b);
  });
  const chosen: string[] = [];
  for (const c of order) {
    if (chosen.length >= slots) break;
    let ok = true;
    for (const s of chosen) {
      if ((corr.get(c)?.get(s) ?? 0) > SAKA_CORR_PAIR_MAX) {
        ok = false;
        break;
      }
    }
    if (ok) chosen.push(c);
  }
  return chosen;
}

export type CorrPickTrace = {
  pickOrder: number;
  ticker: string;
  avgCorrToPool: number;
  avgCorrToChosen: number;
  maxRhoToChosen: number;
  skippedDueToRho: boolean;
};

/** Same logic as pickCorrGreedy with per-step diagnostics (for audits). */
export function pickCorrGreedyTraced(
  pool: string[],
  corr: Map<string, Map<string, number>>,
  slots: number,
): { holdings: string[]; trace: CorrPickTrace[]; attemptLog: CorrPickTrace[] } {
  const universe = [...pool].sort((a, b) => a.localeCompare(b));
  const order = [...universe].sort((a, b) => {
    const aa = avgCorr(a, universe, corr);
    const bb = avgCorr(b, universe, corr);
    if (aa !== bb) return aa - bb;
    return a.localeCompare(b);
  });
  const chosen: string[] = [];
  const trace: CorrPickTrace[] = [];
  const attemptLog: CorrPickTrace[] = [];
  for (const c of order) {
    if (chosen.length >= slots) break;
    const avgPool = avgCorr(c, universe, corr);
    const avgChosen = chosen.length ? avgCorr(c, chosen, corr) : 0;
    let maxRho = 0;
    let ok = true;
    for (const s of chosen) {
      const r = corr.get(c)?.get(s) ?? 0;
      if (r > maxRho) maxRho = r;
      if (r > SAKA_CORR_PAIR_MAX) ok = false;
    }
    const row: CorrPickTrace = {
      pickOrder: ok ? chosen.length + 1 : 0,
      ticker: c,
      avgCorrToPool: avgPool,
      avgCorrToChosen: avgChosen,
      maxRhoToChosen: maxRho,
      skippedDueToRho: !ok,
    };
    attemptLog.push(row);
    if (ok) {
      chosen.push(c);
      trace.push({ ...row, pickOrder: chosen.length });
    }
  }
  return { holdings: chosen, trace, attemptLog };
}

function invVolWeight(calendar: string[], closes: Map<string, number>, date: string): number | null {
  const idx = tradingDayIndex(calendar, date);
  if (idx < SAKA_INV_VOL_WINDOW) return null;
  const rets: number[] = [];
  for (let i = idx - SAKA_INV_VOL_WINDOW + 1; i <= idx; i += 1) {
    const p0 = closes.get(calendar[i - 1]);
    const p1 = closes.get(calendar[i]);
    if (p0 == null || p1 == null || p0 <= 0) return null;
    rets.push(Math.log(p1 / p0));
  }
  const vol = annualizedVol(rets);
  return vol > 0 ? 1 / vol : null;
}

export function applySingleNameCap(weights: Record<string, number>, cap: number): Record<string, number> {
  const w = { ...weights };
  let sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (sum <= 0) return w;
  for (const k of Object.keys(w)) w[k] /= sum;
  for (let iter = 0; iter < 64; iter += 1) {
    let excess = 0;
    const free: string[] = [];
    for (const [t, wt] of Object.entries(w)) {
      if (wt > cap + 1e-9) {
        excess += wt - cap;
        w[t] = cap;
      } else free.push(t);
    }
    if (excess <= 1e-9) break;
    const freeSum = free.reduce((a, t) => a + w[t], 0);
    if (freeSum <= 1e-9) break;
    for (const t of free) w[t] += excess * (w[t] / freeSum);
  }
  sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (sum > 0) for (const k of Object.keys(w)) w[k] /= sum;
  return w;
}

export function applySemiCap(weights: Record<string, number>, semiOf: (t: string) => boolean): Record<string, number> {
  const w = { ...weights };
  let sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (sum <= 0) return w;
  for (const k of Object.keys(w)) w[k] /= sum;
  const semiSum = Object.entries(w).filter(([t]) => semiOf(t)).reduce((a, [, v]) => a + v, 0);
  if (semiSum <= SAKA_SEMI_CAP) return w;
  const scale = SAKA_SEMI_CAP / semiSum;
  for (const t of Object.keys(w)) {
    if (semiOf(t)) w[t] *= scale;
  }
  const nonSemi = Object.entries(w).filter(([t]) => !semiOf(t));
  const slack = 1 - Object.values(w).reduce((a, b) => a + b, 0);
  const nonSum = nonSemi.reduce((a, [, v]) => a + v, 0);
  if (slack > 0 && nonSum > 0) {
    for (const [t, v] of nonSemi) w[t] = v + (v / nonSum) * slack;
  }
  return w;
}

export type SharesLookup = (ticker: string, date: string) => { shares: number; stale: boolean };

export type SakaCandidateContext = {
  calendar: string[];
  closeHistory: Map<string, Map<string, number>>;
  gicsOf: (t: string) => SakaGicsInfo | null;
  mcap: (t: string, date: string) => number;
  sharesLookup: SharesLookup;
  profitable: (t: string, date: string) => boolean;
  hasPrice: (t: string, date: string) => boolean;
};

export function filterEligibleCandidates(members: string[], date: string, ctx: SakaCandidateContext): string[] {
  const out: string[] = [];
  for (const t of members) {
    if (isExcludedTheme(t)) continue;
    const g = ctx.gicsOf(t);
    if (g && isFinancialSector(g.sector)) continue;
    if (!ctx.hasPrice(t, date)) continue;
    if (!ctx.profitable(t, date)) continue;
    out.push(t);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function pickHoldings(config: SakaConfig, eligible: string[], date: string, ctx: SakaCandidateContext): string[] {
  if (config.pick === "corrdiverse" || config.pick === "volprune") {
    const inputs = buildCorrInputs(eligible, ctx.calendar, ctx.closeHistory, date);
    if (!inputs) return [];
    const corr = correlationMatrix(inputs);
    let pool = inputs.tickers;
    if (config.pick === "volprune") pool = pruneHighCorr(pool, corr, inputs.vol);
    return pickCorrGreedy(pool, corr, config.n);
  }
  const scored = eligible
    .map((t) => ({ t, m: ctx.mcap(t, date) }))
    .filter((r) => r.m > 0)
    .sort((a, b) => b.m - a.m || a.t.localeCompare(b.t));
  return scored.slice(0, config.n).map((r) => r.t);
}

export function targetWeights(
  config: SakaConfig,
  holdings: string[],
  date: string,
  ctx: SakaCandidateContext,
  semiOf: (t: string) => boolean,
): Record<string, number> {
  if (!holdings.length) return {};
  const raw: Record<string, number> = {};
  if (config.weight === "invvol") {
    let sum = 0;
    for (const t of holdings) {
      const hist = ctx.closeHistory.get(t);
      if (!hist) continue;
      const iv = invVolWeight(ctx.calendar, hist, date);
      if (iv == null) continue;
      raw[t] = iv;
      sum += iv;
    }
    if (sum > 0) for (const t of Object.keys(raw)) raw[t] /= sum;
  } else if (config.weight === "equal") {
    for (const t of holdings) raw[t] = 1 / holdings.length;
  } else {
    let sum = 0;
    for (const t of holdings) {
      const m = ctx.mcap(t, date);
      if (m > 0) {
        raw[t] = m;
        sum += m;
      }
    }
    if (sum > 0) for (const t of Object.keys(raw)) raw[t] /= sum;
  }
  let w = raw;
  if (config.weight === "mcap_cap10") w = applySingleNameCap(w, 0.1);
  if (config.weight === "mcap_cap5") w = applySingleNameCap(w, 0.05);
  return applySemiCap(w, semiOf);
}

export function rebalanceDates(calendar: string[], from: string, to: string): string[] {
  const dates = calendar.filter((d) => d >= from && d <= to);
  const out: string[] = [];
  let lastKey = "";
  for (const d of dates) {
    const [y, m] = d.split("-").map(Number);
    const key = `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    if (key !== lastKey) {
      out.push(d);
      lastKey = key;
    }
  }
  return out;
}

/** Calendar-year return: prior year last session close → this year last session close on equity curve. */
export function calendarYearReturn(curve: SakaEquityPoint[], calendar: string[], year: number, endCap: string): number | null {
  const yEnd = year === 2026 ? endCap : `${year}-12-31`;
  const prevYear = year - 1;
  const yStartAnchor = `${prevYear}-12-31`;
  const idxStart = tradingDayIndex(calendar, yStartAnchor);
  const idxEnd = tradingDayIndex(calendar, yEnd);
  if (idxStart < 0 || idxEnd < 0) return null;
  const d0 = calendar[idxStart];
  const d1 = calendar[idxEnd];
  const e0 = equityOnOrBefore(curve, d0);
  const e1 = equityOnOrBefore(curve, d1);
  if (e0 == null || e1 == null || e0 <= 0) return null;
  return e1 / e0 - 1;
}

function equityOnOrBefore(curve: SakaEquityPoint[], date: string): number | null {
  let best: number | null = null;
  for (const p of curve) {
    if (p.date <= date) best = p.equity;
    else break;
  }
  return best;
}

export function metricsFromCurve(
  curve: SakaEquityPoint[],
  calendar: string[],
  from: string,
  to: string,
): SakaMetrics {
  const slice = curve.filter((p) => p.date >= from && p.date <= to);
  if (slice.length < 2) {
    return { cagr: 0, maxDrawdown: 0, recoveryDays: null, calendarYears: {}, positiveYearShare: 0 };
  }
  const start = slice[0].equity;
  const end = slice[slice.length - 1].equity;
  const years = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / (365.25 * 86_400_000);
  const cagr = years > 0 && start > 0 ? (end / start) ** (1 / years) - 1 : 0;

  let peak = slice[0].equity;
  let maxDd = 0;
  let troughDate = slice[0].date;
  let peakAtMaxDd = peak;
  for (const p of slice) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak > 0 ? (p.equity - peak) / peak : 0;
    if (dd < maxDd) {
      maxDd = dd;
      troughDate = p.date;
      peakAtMaxDd = peak;
    }
  }
  let recoveryDays: number | null = null;
  const troughIdx = slice.findIndex((p) => p.date === troughDate);
  if (troughIdx >= 0) {
    const target = peakAtMaxDd;
    for (let i = troughIdx + 1; i < slice.length; i += 1) {
      if (slice[i].equity >= target) {
        recoveryDays = i - troughIdx;
        break;
      }
    }
  }

  const calendarYears: Record<string, number> = {};
  let pos = 0;
  let counted = 0;
  for (const y of SAKA_CAL_YEARS) {
    const r = calendarYearReturn(curve, calendar, y, to);
    if (r == null) continue;
    calendarYears[String(y)] = r;
    counted += 1;
    if (r > 0) pos += 1;
  }
  const positiveYearShare = counted > 0 ? pos / counted : 0;
  return { cagr, maxDrawdown: maxDd, recoveryDays, calendarYears, positiveYearShare };
}

export function maxPairwiseCorr(holdings: string[], corr: Map<string, Map<string, number>>): number {
  let max = -Infinity;
  for (let i = 0; i < holdings.length; i += 1) {
    for (let j = i + 1; j < holdings.length; j += 1) {
      const r = corr.get(holdings[i])?.get(holdings[j]) ?? 0;
      if (r > max) max = r;
    }
  }
  return holdings.length < 2 ? 0 : max;
}

export function selectSakaConfig(
  rows: Array<{ config: SakaConfig; is: SakaMetrics; turnover: number }>,
  spyIsMaxDd: number,
): SakaConfig | null {
  const eligible = rows.filter((r) => r.is.maxDrawdown > spyIsMaxDd);
  if (!eligible.length) return null;
  eligible.sort((a, b) => {
    if (b.is.cagr !== a.is.cagr) return b.is.cagr - a.is.cagr;
    return a.turnover - b.turnover;
  });
  return eligible[0].config;
}

export type SakaSimResult = {
  curve: SakaEquityPoint[];
  ordersPerYear: Record<string, number>;
  turnoverPerRebal: number;
};

export function simulateSaka(
  config: SakaConfig,
  calendar: string[],
  membersOn: (date: string) => string[],
  ctx: SakaCandidateContext,
  semiOf: (t: string) => boolean,
  price: (ticker: string, date: string) => number | null,
  commission: number,
  from: string,
  to: string,
): SakaSimResult {
  const rebal = new Set(rebalanceDates(calendar, from, to));
  let cash = SAKA_INITIAL_CASH;
  const shares: Record<string, number> = {};
  const lastPrice: Record<string, number> = {};
  const curve: SakaEquityPoint[] = [];
  const ordersPerYear: Record<string, number> = {};
  let turnoverSum = 0;
  let rebalCount = 0;
  let prevWeights: Record<string, number> = {};

  const markOrders = (date: string, n: number) => {
    const y = date.slice(0, 4);
    ordersPerYear[y] = (ordersPerYear[y] ?? 0) + n;
  };

  const equityOn = (date: string) => {
    let eq = cash;
    for (const [t, sh] of Object.entries(shares)) {
      const p = price(t, date) ?? lastPrice[t] ?? 0;
      eq += sh * p;
    }
    return eq;
  };

  for (const date of calendar) {
    if (date < from) continue;
    if (date > to) break;

    for (const t of Object.keys(shares)) {
      const p = price(t, date);
      if (p != null) lastPrice[t] = p;
    }

    if (rebal.has(date)) {
      const eligible = filterEligibleCandidates(membersOn(date), date, ctx);
      const holdings = pickHoldings(config, eligible, date, ctx);
      const weights = targetWeights(config, holdings, date, ctx, semiOf);
      const tickersUnion = new Set([...Object.keys(prevWeights), ...Object.keys(weights)]);
      let to = 0;
      for (const t of tickersUnion) to += Math.abs((weights[t] ?? 0) - (prevWeights[t] ?? 0));
      turnoverSum += to / 2;
      rebalCount += 1;
      prevWeights = { ...weights };
      markOrders(date, Object.keys(shares).length);
      for (const t of Object.keys(shares)) {
        const p = price(t, date) ?? lastPrice[t];
        if (p && shares[t] > 0) cash += shares[t] * p - commission;
        delete shares[t];
      }
      const tickers = Object.keys(weights);
      const buyLegs = tickers.length;
      const reserve = commission * buyLegs;
      const investable = cash - reserve;
      markOrders(date, buyLegs);
      for (const t of tickers) {
        const p = price(t, date);
        if (!p || p <= 0) continue;
        const targetUsd = investable * weights[t];
        const sh = targetUsd / p;
        const cost = targetUsd + commission;
        if (cost > cash) continue;
        cash -= cost;
        shares[t] = sh;
        lastPrice[t] = p;
      }
    }

    curve.push({ date, equity: equityOn(date) });
  }
  return { curve, ordersPerYear, turnoverPerRebal: rebalCount > 0 ? turnoverSum / rebalCount : 0 };
}

type FactPoint = { end: string; val: number; fp?: string; form?: string };

/** TTM net income using quarters with `end` <= asOf only (PIT). */
type ShareFact = { end: string; val: number };

function collectSharePoints(json: unknown): ShareFact[] {
  if (!json || typeof json !== "object" || !("facts" in json)) return [];
  const facts = (json as { facts: Record<string, Record<string, { units?: Record<string, ShareFact[]> }>> }).facts;
  const tags = [
    ["dei", "EntityCommonStockSharesOutstanding"],
    ["us-gaap", "CommonStockSharesOutstanding"],
    ["us-gaap", "CommonStockSharesIssued"],
  ];
  const out: ShareFact[] = [];
  for (const [ns, tag] of tags) {
    const block = facts[ns]?.[tag]?.units?.shares;
    if (!block) continue;
    for (const p of block) {
      if (p.end && Number.isFinite(p.val) && p.val > 0) out.push({ end: p.end, val: p.val });
    }
  }
  return out;
}

/** Latest shares outstanding with period end <= asOf (PIT). */
export function sharesOutstandingAsOf(json: unknown, asOf: string): number | null {
  const points = collectSharePoints(json)
    .filter((p) => p.end <= asOf)
    .sort((a, b) => b.end.localeCompare(a.end));
  return points[0]?.val ?? null;
}

export function ttmNetIncomeAsOf(json: unknown, asOf: string): number | null {
  if (!json || typeof json !== "object" || !("facts" in json)) return null;
  const facts = (json as { facts: Record<string, Record<string, { units?: Record<string, FactPoint[]> }>> }).facts;
  const tags = ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"];
  const namespaces = ["us-gaap", "us-gaap", "ifrs-full"];
  for (let i = 0; i < tags.length; i += 1) {
    const block = facts[namespaces[i]]?.[tags[i]]?.units?.USD;
    if (!block) continue;
    const quarterly = block
      .filter(
        (p) =>
          p.end <= asOf &&
          p.fp &&
          /^Q[1-4]$/i.test(p.fp) &&
          p.form !== "10-K" &&
          p.form !== "20-F" &&
          p.form !== "40-F" &&
          Number.isFinite(p.val),
      )
      .sort((a, b) => b.end.localeCompare(a.end));
    const seen = new Set<string>();
    const uniq: FactPoint[] = [];
    for (const point of quarterly) {
      if (seen.has(point.end)) continue;
      seen.add(point.end);
      uniq.push(point);
      if (uniq.length >= 4) break;
    }
    if (uniq.length >= 4) {
      const sum = uniq.reduce((t, p) => t + p.val, 0);
      return Number.isFinite(sum) ? sum : null;
    }
  }
  return null;
}

export function feeDragSummary(
  ordersPerYear: Record<string, number>,
  curve: SakaEquityPoint[],
  commission: number,
): { byYear: Record<string, { orders: number; feesUsd: number; avgEquity: number; feePct: number }>; totalFees: number } {
  const byYear: Record<string, { orders: number; feesUsd: number; avgEquity: number; feePct: number }> = {};
  let totalFees = 0;
  for (const [y, orders] of Object.entries(ordersPerYear)) {
    const feesUsd = orders * commission;
    totalFees += feesUsd;
    const pts = curve.filter((p) => p.date.startsWith(y));
    const avgEquity = pts.length ? pts.reduce((a, p) => a + p.equity, 0) / pts.length : SAKA_INITIAL_CASH;
    byYear[y] = { orders, feesUsd, avgEquity, feePct: avgEquity > 0 ? feesUsd / avgEquity : 0 };
  }
  return { byYear, totalFees };
}
