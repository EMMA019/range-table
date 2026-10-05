import {
  SAKA_END,
  SAKA_INITIAL_CASH,
  SAKA_INV_VOL_WINDOW,
  SAKA_IS_END,
  SAKA_OOS_START,
  SAKA_START,
  applySingleNameCap,
  buildCorrInputs,
  correlationMatrix,
  filterEligibleCandidates,
  isSemiSubIndustry,
  maxPairwiseCorr,
  metricsFromCurve,
  rebalanceDates,
  pickCorrGreedyTraced,
  selectSakaConfig,
  trailingLogReturns,
  type SakaCandidateContext,
  type SakaEquityPoint,
  type SakaGicsInfo,
  type SakaMetrics,
} from "./round19-saka";

export {
  SAKA_START,
  SAKA_IS_END,
  SAKA_OOS_START,
  SAKA_END,
  SAKA_INITIAL_CASH,
  filterEligibleCandidates,
  metricsFromCurve,
  rebalanceDates,
  calendarYearReturn,
  feeDragSummary,
  maxPairwiseCorr,
  buildCorrInputs,
  correlationMatrix,
} from "./round19-saka";

export type V2Design = "emma_quota" | "sector_neutral" | "core_satellite";
export type V2Weight = "equal" | "mcap_cap10" | "invvol";

export type SakaV2Config = {
  id: string;
  design: V2Design;
  n: 15 | 20;
  weight: V2Weight;
};

const DESIGNS: V2Design[] = ["emma_quota", "sector_neutral", "core_satellite"];
const WEIGHTS: V2Weight[] = ["equal", "mcap_cap10", "invvol"];

export const SAKA_V2_CONFIGS: SakaV2Config[] = DESIGNS.flatMap((design) =>
  ([15, 20] as const).flatMap((n) =>
    WEIGHTS.map((weight) => ({
      id: `${design}_${n}__${weight}`,
      design,
      n,
      weight,
    })),
  ),
);

export const V2_CORR_FLAG = 0.6;
export const V2_TECH_SEMI_MIN = 0.15;
export const V2_TECH_SEMI_MAX = 0.3;
export const V2_SECTOR_MAX = 0.25;

export function isTechSemi(g: SakaGicsInfo | null): boolean {
  if (!g) return false;
  return g.sector === "Information Technology" || isSemiSubIndustry(g.subIndustry);
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

function relMomVsSpy(
  ticker: string,
  date: string,
  ctx: SakaCandidateContext,
  spyCloses: Map<string, number>,
  days = 126,
): number {
  const hist = ctx.closeHistory.get(ticker);
  if (!hist) return -Infinity;
  const idx = tradingDayIndex(ctx.calendar, date);
  if (idx < days) return -Infinity;
  const d0 = ctx.calendar[idx - days];
  const d1 = date;
  const p0 = hist.get(d0);
  const p1 = hist.get(d1);
  const s0 = spyCloses.get(d0);
  const s1 = spyCloses.get(d1);
  if (!p0 || !p1 || !s0 || !s1 || p0 <= 0 || s0 <= 0) return -Infinity;
  return p1 / p0 - s1 / s0;
}

function avgCorrTo(t: string, chosen: string[], corr: Map<string, Map<string, number>>): number {
  if (!chosen.length) return 0;
  let s = 0;
  for (const c of chosen) s += corr.get(t)?.get(c) ?? 0;
  return s / chosen.length;
}

/**
 * Correlation-based greedy pick **within `pool` only** (same sector bucket).
 * Cross-sector correlation does not eliminate names from other sectors.
 */
export function pickCorrdiverseWithinPool(
  pool: string[],
  count: number,
  ctx: SakaCandidateContext,
  date: string,
): string[] {
  if (count <= 0 || !pool.length) return [];
  const inputs = buildCorrInputs(pool, ctx.calendar, ctx.closeHistory, date);
  if (!inputs) return pool.slice(0, count).sort((a, b) => a.localeCompare(b));
  const corr = correlationMatrix(inputs);
  const { holdings } = pickCorrGreedyTraced(inputs.tickers, corr, count);
  return holdings;
}

function pickGreedyInPool(
  pool: string[],
  count: number,
  chosenGlobal: string[],
  ctx: SakaCandidateContext,
  date: string,
  spyCloses: Map<string, number>,
): string[] {
  if (count <= 0 || !pool.length) return [];
  const inputs = buildCorrInputs(pool, ctx.calendar, ctx.closeHistory, date);
  const corr = inputs ? correlationMatrix(inputs) : new Map();
  const picked: string[] = [];
  const remain = new Set(pool);
  while (picked.length < count && remain.size) {
    let best: string | null = null;
    let bestScore: [number, number, number] = [Infinity, -Infinity, -Infinity];
    for (const t of remain) {
      const ac = avgCorrTo(t, picked, corr);
      const mom = relMomVsSpy(t, date, ctx, spyCloses);
      const mc = ctx.mcap(t, date);
      const score: [number, number, number] = [ac, -mom, -mc];
      if (
        best == null ||
        score[0] < bestScore[0] ||
        (score[0] === bestScore[0] && score[1] < bestScore[1]) ||
        (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] < bestScore[2])
      ) {
        best = t;
        bestScore = score;
      }
    }
    if (!best) break;
    picked.push(best);
    remain.delete(best);
  }
  return picked;
}

function sectorKey(t: string, ctx: SakaCandidateContext): string {
  const g = ctx.gicsOf(t);
  if (isTechSemi(g)) return "__semis_tech__";
  return g?.sector ?? "Unknown";
}

function allocateSlots(
  eligible: string[],
  n: number,
  ctx: SakaCandidateContext,
  date: string,
  techSemiMinShare: number,
  techSemiMaxShare: number,
): Map<string, number> {
  const mcapByKey = new Map<string, number>();
  for (const t of eligible) {
    const k = sectorKey(t, ctx);
    mcapByKey.set(k, (mcapByKey.get(k) ?? 0) + ctx.mcap(t, date));
  }
  const total = [...mcapByKey.values()].reduce((a, b) => a + b, 0) || 1;
  const slots = new Map<string, number>();
  const techKey = "__semis_tech__";
  const techM = mcapByKey.get(techKey) ?? 0;
  let nTech = Math.round(n * (techM / total));
  nTech = Math.max(1, Math.min(n, nTech));
  nTech = Math.max(Math.ceil(n * techSemiMinShare), Math.min(nTech, Math.floor(n * techSemiMaxShare)));
  slots.set(techKey, nTech);
  const left = n - nTech;
  const others = [...mcapByKey.keys()].filter((k) => k !== techKey);
  const otherMcap = others.reduce((s, k) => s + (mcapByKey.get(k) ?? 0), 0) || 1;
  for (const k of others) {
    const share = (mcapByKey.get(k) ?? 0) / otherMcap;
    const s = Math.max(0, Math.round(left * share));
    slots.set(k, s);
  }
  let sum = [...slots.values()].reduce((a, b) => a + b, 0);
  while (sum > n) {
    const k = others.find((x) => (slots.get(x) ?? 0) > 0);
    if (!k) break;
    slots.set(k, (slots.get(k) ?? 0) - 1);
    sum -= 1;
  }
  while (sum < n) {
    const k = others[0] ?? techKey;
    slots.set(k, (slots.get(k) ?? 0) + 1);
    sum += 1;
  }
  return slots;
}

export function pickHoldingsV2(
  config: SakaV2Config,
  eligible: string[],
  date: string,
  ctx: SakaCandidateContext,
  spyCloses: Map<string, number>,
): string[] {
  if (!eligible.length) return [];
  const n = config.n;

  if (config.design === "core_satellite") {
    const nCore = Math.max(1, Math.round(0.7 * n));
    const nSat = n - nCore;
    const byMcap = [...eligible].sort((a, b) => ctx.mcap(b, date) - ctx.mcap(a, date) || a.localeCompare(b));
    const core = byMcap.slice(0, nCore);
    const satPool = eligible.filter((t) => !core.includes(t));
    const sat = pickGreedyInPool(satPool, nSat, core, ctx, date, spyCloses);
    return [...core, ...sat].sort((a, b) => a.localeCompare(b));
  }

  if (config.design === "sector_neutral") {
    const slots = allocateSlots(eligible, n, ctx, date, V2_TECH_SEMI_MIN, V2_TECH_SEMI_MAX);
    const chosen: string[] = [];
    for (const [key, count] of slots) {
      const pool = eligible.filter((t) => sectorKey(t, ctx) === key);
      const sorted = [...pool].sort(
        (a, b) =>
          relMomVsSpy(b, date, ctx, spyCloses) - relMomVsSpy(a, date, ctx, spyCloses) ||
          ctx.mcap(b, date) - ctx.mcap(a, date),
      );
      chosen.push(...pickGreedyInPool(sorted, count, chosen, ctx, date, spyCloses));
    }
    return chosen.slice(0, n);
  }

  // emma_quota
  const slots = allocateSlots(eligible, n, ctx, date, V2_TECH_SEMI_MIN, V2_TECH_SEMI_MAX);
  const chosen: string[] = [];
  for (const [key, count] of slots) {
    const pool = eligible.filter((t) => sectorKey(t, ctx) === key);
    chosen.push(...pickGreedyInPool(pool, count, chosen, ctx, date, spyCloses));
  }
  return chosen.slice(0, n);
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
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const var_ = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  const vol = Math.sqrt(var_) * Math.sqrt(252);
  return vol > 0 ? 1 / vol : null;
}

function applySectorCaps(weights: Record<string, number>, ctx: SakaCandidateContext): Record<string, number> {
  const w = { ...weights };
  let sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (sum <= 0) return w;
  for (const k of Object.keys(w)) w[k] /= sum;

  for (let iter = 0; iter < 32; iter += 1) {
    const bySector = new Map<string, number>();
    let techSemi = 0;
    for (const [t, wt] of Object.entries(w)) {
      const g = ctx.gicsOf(t);
      if (isTechSemi(g)) techSemi += wt;
      else {
        const s = g?.sector ?? "Unknown";
        bySector.set(s, (bySector.get(s) ?? 0) + wt);
      }
    }
    let excess = 0;
    if (techSemi > V2_TECH_SEMI_MAX) excess += techSemi - V2_TECH_SEMI_MAX;
    if (techSemi < V2_TECH_SEMI_MIN && techSemi > 0) {
      /* soft min — scale up tech semi tickers if below min */
    }
    for (const [s, wt] of bySector) {
      if (wt > V2_SECTOR_MAX) excess += wt - V2_SECTOR_MAX;
    }
    if (excess <= 1e-6) break;
    for (const [t, wt] of Object.entries(w)) {
      const g = ctx.gicsOf(t);
      if (isTechSemi(g) && techSemi > V2_TECH_SEMI_MAX) {
        w[t] = wt * (V2_TECH_SEMI_MAX / techSemi);
      } else if (!isTechSemi(g)) {
        const s = g?.sector ?? "Unknown";
        const sw = bySector.get(s) ?? 0;
        if (sw > V2_SECTOR_MAX) w[t] = wt * (V2_SECTOR_MAX / sw);
      }
    }
    sum = Object.values(w).reduce((a, b) => a + b, 0);
    if (sum > 0) for (const k of Object.keys(w)) w[k] /= sum;
  }
  return w;
}

export function targetWeightsV2(
  config: SakaV2Config,
  holdings: string[],
  date: string,
  ctx: SakaCandidateContext,
): Record<string, number> {
  if (!holdings.length) return {};
  const raw: Record<string, number> = {};

  if (config.design === "core_satellite" && config.weight === "mcap_cap10") {
    let sum = 0;
    for (const t of holdings) {
      const m = ctx.mcap(t, date);
      if (m > 0) {
        raw[t] = m;
        sum += m;
      }
    }
    if (sum > 0) for (const t of Object.keys(raw)) raw[t] /= sum;
    const nCore = Math.max(1, Math.round(0.7 * holdings.length));
    const core = holdings.slice(0, nCore);
    const coreW: Record<string, number> = {};
    let cs = 0;
    for (const t of core) {
      coreW[t] = raw[t] ?? 0;
      cs += coreW[t];
    }
    if (cs > 0) for (const t of core) coreW[t] /= cs;
    const capped = applySingleNameCap(coreW, 0.1);
    const csum = Object.values(capped).reduce((a, b) => a + b, 0);
    const out: Record<string, number> = {};
    for (const t of holdings) out[t] = 0;
    for (const [t, v] of Object.entries(capped)) out[t] = v * 0.7;
    const sat = holdings.filter((t) => !core.includes(t));
    const satEach = sat.length ? 0.3 / sat.length : 0;
    for (const t of sat) out[t] = satEach;
    return applySectorCaps(out, ctx);
  }

  if (config.weight === "equal") {
    for (const t of holdings) raw[t] = 1 / holdings.length;
  } else if (config.weight === "invvol") {
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
    if (config.weight === "mcap_cap10") {
      const capped = applySingleNameCap(raw, 0.1);
      return applySectorCaps(capped, ctx);
    }
  }
  return applySectorCaps(raw, ctx);
}

export function countPairsAboveRho(
  holdings: string[],
  corr: Map<string, Map<string, number>>,
  threshold: number,
): number {
  let n = 0;
  for (let i = 0; i < holdings.length; i += 1) {
    for (let j = i + 1; j < holdings.length; j += 1) {
      const r = corr.get(holdings[i])?.get(holdings[j]) ?? 0;
      if (r > threshold) n += 1;
    }
  }
  return n;
}

export function simulateSakaV2(
  config: SakaV2Config,
  calendar: string[],
  membersOn: (date: string) => string[],
  ctx: SakaCandidateContext,
  spyCloses: Map<string, number>,
  price: (ticker: string, date: string) => number | null,
  commission: number,
  from: string,
  to: string,
): { curve: SakaEquityPoint[]; ordersPerYear: Record<string, number>; turnoverPerRebal: number } {
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
      const holdings = pickHoldingsV2(config, eligible, date, ctx, spyCloses);
      const weights = targetWeightsV2(config, holdings, date, ctx);
      const tickersUnion = new Set([...Object.keys(prevWeights), ...Object.keys(weights)]);
      let toT = 0;
      for (const t of tickersUnion) toT += Math.abs((weights[t] ?? 0) - (prevWeights[t] ?? 0));
      turnoverSum += toT / 2;
      rebalCount += 1;
      prevWeights = { ...weights };
      markOrders(date, Object.keys(shares).length);
      for (const t of Object.keys(shares)) {
        const p = price(t, date) ?? lastPrice[t];
        if (p && shares[t] > 0) cash += shares[t] * p - commission;
        delete shares[t];
      }
      const tickers = Object.keys(weights);
      const reserve = commission * tickers.length;
      const investable = cash - reserve;
      markOrders(date, tickers.length);
      for (const t of tickers) {
        const p = price(t, date);
        if (!p || p <= 0) continue;
        const targetUsd = investable * weights[t];
        const cost = targetUsd + commission;
        if (cost > cash) continue;
        cash -= cost;
        shares[t] = targetUsd / p;
        lastPrice[t] = p;
      }
    }
    curve.push({ date, equity: equityOn(date) });
  }
  return { curve, ordersPerYear, turnoverPerRebal: rebalCount > 0 ? turnoverSum / rebalCount : 0 };
}

export function selectSakaV2Config(
  rows: { config: SakaV2Config; is: SakaMetrics; turnover: number }[],
  spyIsMaxDd: number,
): SakaV2Config | null {
  const eligible = rows.filter((r) => r.is.maxDrawdown > spyIsMaxDd);
  if (!eligible.length) return null;
  eligible.sort((a, b) => {
    if (b.is.cagr !== a.is.cagr) return b.is.cagr - a.is.cagr;
    return a.turnover - b.turnover;
  });
  return eligible[0].config;
}
