/**
 * Semi layer mix + SOXX low-corr screen (see docs/ROUND19_V1_SEMI_LAYER_SOXX_ja.md).
 *   NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/round19-v1-semi-layer-soxx.ts
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  SAKA_CONFIGS,
  SAKA_CORR_LOOKBACK,
  SAKA_CORR_MIN_OBS,
  SAKA_END,
  SAKA_INITIAL_CASH,
  SAKA_REBAL_MIN_TRADE_USD,
  SAKA_REBAL_REL_DRIFT,
  SAKA_START,
  applySemiCap,
  applySameCikHandoffTransfers,
  filterEligibleCandidates,
  isSemiSubIndustry,
  metricsFromCurve,
  pickHoldings,
  profitabilityStatus,
  rebalanceDates,
  targetWeights,
  tradingDaysFromBars,
  trailingLogReturnSeries,
  type ProfitabilityStatus,
  type SakaCandidateContext,
  type SakaEquityPoint,
} from "../src/lib/round19-saka";
import { pearson } from "../src/lib/corr";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { buildPitFactsIndex, loadMergedPitFacts } from "../src/lib/pit-facts-index";
import { pitMarketCapAtDate } from "../src/lib/pit-mcap";
import { mcapCloseOnOrBefore } from "../src/lib/pit-mcap-price";
import { loadPitSplits, type PitSplit } from "../src/lib/pit-splits";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "../src/lib/pit-dataset";
import { buildSameCikHandoffResolver, loadSp500PitFiles, membersOnDate, uniqueTickersInRange } from "../src/lib/sp500-pit";
import { fetchDailyBars } from "../src/lib/yahoo";
import type { Bar } from "../src/lib/types";

const OUT_SEMI_MD = path.join(process.cwd(), "docs", "ROUND19_V1_SEMI_LAYER_SOXX_ja.md");
const OUT_DIV_GOLD_MD = path.join(process.cwd(), "docs", "ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md");
const PREREG_SEMI = "docs/ROUND19_V1_SEMI_LAYER_SOXX_ja.md";
const PREREG_PARENT = "docs/ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md";

const COMMISSION = 0.35;
const PRINCIPAL = SAKA_INITIAL_CASH;
const MATERIAL = 0.01;
const BASELINE = SAKA_CONFIGS.find((c) => c.id === "plain_15__mcap");
if (!BASELINE) throw new Error("plain_15__mcap missing");

const MCAP_N = 11;
const DIV_N = 4;
const W_MCAP = 0.75;
const W_DIV = 0.2;
const W_GOLD = 0.05;
const DIV_MIN_MCAP = 30e9;
const MEGA_MAX_K2 = 2;
const SEMI_SOXX_MIN_MCAP = 20e9;
const SEMI_SCREEN_MAX_MCAP = 500e9;

const QUAD = ["NVDA", "AVGO", "AMD", "MU"] as const;
const QUAD_SET = new Set<string>(QUAD);
const EQUIP_TICKERS = ["LRCX", "KLAC", "AMAT"] as const;
const EQUIP_SET = new Set<string>(EQUIP_TICKERS);
const MATRIX_TICKERS = [...QUAD, ...EQUIP_TICKERS] as const;

const SCREEN_DATE = "2026-10-01";

const AI_PLATFORM_INFRA = new Set([
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "META",
  "FB",
  "ORCL",
  "CRM",
  "NOW",
  "ADBE",
  "NFLX",
  "PLTR",
  "SNPS",
  "CDNS",
  "PANW",
  "CRWD",
  "FTNT",
  "IBM",
  "ANET",
  "DELL",
  "INTU",
  "WDAY",
  "TEAM",
  "MDB",
  "DDOG",
  "ZS",
]);

type RunStats = {
  id: string;
  totalReturn: number;
  cagr: number;
  maxDd: number;
  principalMedian: number;
  principalP10: number;
  materialPct: number;
  aiAvg: number;
  ai2026: number;
  semiAvg: number;
  semi2026: number;
  goldTicker: string | null;
};

function normalizeMega(t: string): string {
  return t === "FB" ? "META" : t;
}

function isAiTilt(t: string, semiOf: (t: string) => boolean): boolean {
  return semiOf(t) || AI_PLATFORM_INFRA.has(t);
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

function monthStarts(calendar: string[], from: string, to: string): string[] {
  const out: string[] = [];
  let last = "";
  for (const d of calendar) {
    if (d < from || d > to) continue;
    const key = d.slice(0, 7);
    if (key !== last) {
      out.push(d);
      last = key;
    }
  }
  return out;
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! * (1 - (pos - lo)) + s[hi]! * (pos - lo);
}

function pct(x: number, d = 1): string {
  if (!Number.isFinite(x)) return "—";
  const n = x * 100;
  return `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
}

type DivEvent = { date: string; amount: number };

async function loadDividendEvents(ticker: string, cache: Map<string, DivEvent[]>): Promise<DivEvent[]> {
  const hit = cache.get(ticker);
  if (hit) return hit;
  try {
    const hosts = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
    let lastErr: Error | null = null;
    for (const host of hosts) {
      try {
        const url = `${host}/v8/finance/chart/${encodeURIComponent(ticker.replace(/\./g, "-"))}?range=10y&interval=1d&events=div`;
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          chart?: { result?: Array<{ events?: { dividends?: Record<string, { amount?: number }> } }> };
        };
        const divs = json.chart?.result?.[0]?.events?.dividends ?? {};
        const events: DivEvent[] = [];
        for (const [ts, row] of Object.entries(divs)) {
          const amount = row.amount;
          if (amount == null || !Number.isFinite(amount)) continue;
          const d = new Date(Number(ts) * 1000).toISOString().slice(0, 10);
          events.push({ date: d, amount });
        }
        events.sort((a, b) => a.date.localeCompare(b.date));
        cache.set(ticker, events);
        return events;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr ?? new Error("div fetch failed");
  } catch {
    cache.set(ticker, []);
    return [];
  }
}

function trailingDivYield(events: DivEvent[], date: string, price: number): number {
  if (!(price > 0)) return 0;
  const end = Date.parse(`${date}T12:00:00Z`);
  const start = end - 365 * 86_400_000;
  let sum = 0;
  for (const e of events) {
    const t = Date.parse(`${e.date}T12:00:00Z`);
    if (t > start && t <= end) sum += e.amount;
  }
  return sum / price;
}

function wouldExceedMega(picked: string[], t: string, megaMax: number): boolean {
  const n = normalizeMega(t);
  if (n !== "GOOGL" && n !== "MSFT" && n !== "META") return false;
  const trial = new Set(picked.map(normalizeMega));
  trial.add(n);
  let c = 0;
  if (trial.has("GOOGL")) c += 1;
  if (trial.has("MSFT")) c += 1;
  if (trial.has("META")) c += 1;
  return c > megaMax;
}

function fillMcapFromScored(scored: Array<{ t: string; m: number }>, picked: string[], megaMax: number): string[] {
  const pool = [...picked];
  for (const { t } of scored) {
    if (pool.length >= MCAP_N) break;
    if (pool.includes(t)) continue;
    if (wouldExceedMega(pool, t, megaMax)) continue;
    pool.push(t);
  }
  return pool.slice(0, MCAP_N);
}

function quadCorrHigh(
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  date: string,
  present: string[],
): { high: boolean; matrix: Record<string, Record<string, number | null>> } {
  const matrix: Record<string, Record<string, number | null>> = {};
  const series = new Map<string, ReturnType<typeof trailingLogReturnSeries>>();
  for (const t of QUAD) {
    matrix[t] = {};
    const hist = closeHistory.get(t);
    if (!hist || !present.includes(t)) continue;
    series.set(t, trailingLogReturnSeries(calendar, hist, date, SAKA_CORR_LOOKBACK));
  }
  const rhos: number[] = [];
  let highPairs = 0;
  for (let i = 0; i < QUAD.length; i += 1) {
    for (let j = i; j < QUAD.length; j += 1) {
      const a = QUAD[i]!;
      const b = QUAD[j]!;
      if (i === j) {
        matrix[a]![b] = 1;
        continue;
      }
      const sa = series.get(a);
      const sb = series.get(b);
      if (!sa || !sb) {
        matrix[a]![b] = null;
        matrix[b]![a] = null;
        continue;
      }
      const byDate = new Map<string, number>();
      for (let k = 0; k < sb.dates.length; k += 1) byDate.set(sb.dates[k]!, sb.rets[k]!);
      const xs: number[] = [];
      const ys: number[] = [];
      for (let k = 0; k < sa.dates.length; k += 1) {
        const y = byDate.get(sa.dates[k]!);
        if (y === undefined) continue;
        xs.push(sa.rets[k]!);
        ys.push(y);
      }
      const rho = xs.length >= SAKA_CORR_MIN_OBS ? pearson(xs, ys) : null;
      matrix[a]![b] = rho;
      matrix[b]![a] = rho;
      if (rho != null && present.includes(a) && present.includes(b)) {
        rhos.push(rho);
        if (rho >= 0.65) highPairs += 1;
      }
    }
  }
  const avg = rhos.length ? rhos.reduce((s, x) => s + x, 0) / rhos.length : 0;
  const high = highPairs >= 3 || avg >= 0.7;
  return { high, matrix };
}

function isSemiEquipment(t: string, ctx: SakaCandidateContext): boolean {
  if (EQUIP_SET.has(t)) return true;
  const sub = ctx.gicsOf(t)?.subIndustry ?? "";
  return sub.toLowerCase().includes("equipment");
}

function semiLayerLabel(t: string, ctx: SakaCandidateContext, semiOf: (t: string) => boolean): string {
  if (QUAD_SET.has(t)) return "quad";
  if (semiOf(t) && isSemiEquipment(t, ctx)) return "equip";
  if (semiOf(t)) return "semi";
  return "—";
}

function corrAligned(
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  date: string,
  a: string,
  b: string,
): number | null {
  const ha = closeHistory.get(a);
  const hb = closeHistory.get(b);
  if (!ha || !hb) return null;
  const sa = trailingLogReturnSeries(calendar, ha, date, SAKA_CORR_LOOKBACK);
  const sb = trailingLogReturnSeries(calendar, hb, date, SAKA_CORR_LOOKBACK);
  if (!sa || !sb) return null;
  const byDate = new Map<string, number>();
  for (let i = 0; i < sb.dates.length; i += 1) byDate.set(sb.dates[i]!, sb.rets[i]!);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < sa.dates.length; i += 1) {
    const y = byDate.get(sa.dates[i]!);
    if (y === undefined) continue;
    xs.push(sa.rets[i]!);
    ys.push(y);
  }
  return xs.length >= SAKA_CORR_MIN_OBS ? pearson(xs, ys) : null;
}

function corrToBench(
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  soxxHist: Map<string, number>,
  date: string,
  ticker: string,
): number | null {
  const hist = closeHistory.get(ticker);
  if (!hist) return null;
  const sa = trailingLogReturnSeries(calendar, hist, date, SAKA_CORR_LOOKBACK);
  const sb = trailingLogReturnSeries(calendar, soxxHist, date, SAKA_CORR_LOOKBACK);
  if (!sa || !sb) return null;
  const byDate = new Map<string, number>();
  for (let i = 0; i < sb.dates.length; i += 1) byDate.set(sb.dates[i]!, sb.rets[i]!);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < sa.dates.length; i += 1) {
    const y = byDate.get(sa.dates[i]!);
    if (y === undefined) continue;
    xs.push(sa.rets[i]!);
    ys.push(y);
  }
  return xs.length >= SAKA_CORR_MIN_OBS ? pearson(xs, ys) : null;
}

function pickMcapSleeve(
  eligible: string[],
  date: string,
  ctx: SakaCandidateContext,
  megaMax: number,
  semiThin: boolean,
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
): string[] {
  const scored = eligible
    .map((t) => ({ t, m: ctx.mcap(t, date) }))
    .filter((r) => r.m > 0)
    .sort((a, b) => b.m - a.m || a.t.localeCompare(b.t));
  let picked: string[] = [];
  for (const { t } of scored) {
    if (picked.length >= MCAP_N) break;
    if (wouldExceedMega(picked, t, megaMax)) continue;
    picked.push(t);
  }
  picked = fillMcapFromScored(scored, picked, megaMax);

  if (!semiThin) return picked;

  let pool = [...picked];
  for (let guard = 0; guard < 4; guard += 1) {
    const present = QUAD.filter((t) => pool.includes(t));
    if (present.length <= 2) break;
    const { high } = quadCorrHigh(calendar, closeHistory, date, present);
    if (!high) break;
    const weakest = [...present].sort((a, b) => ctx.mcap(a, date) - ctx.mcap(b, date))[0];
    if (!weakest) break;
    pool = pool.filter((t) => t !== weakest);
    pool = fillMcapFromScored(scored, pool, megaMax);
  }
  return pool;
}

function pickMcapLayerMix(
  eligible: string[],
  date: string,
  ctx: SakaCandidateContext,
  megaMax: number,
  semiOf: (t: string) => boolean,
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
): string[] {
  const scored = eligible
    .map((t) => ({ t, m: ctx.mcap(t, date) }))
    .filter((r) => r.m > 0)
    .sort((a, b) => b.m - a.m || a.t.localeCompare(b.t));

  let picked = pickMcapSleeve(eligible, date, ctx, megaMax, false, calendar, closeHistory);

  const quads = picked.filter((t) => QUAD_SET.has(t));
  if (quads.length > 2) {
    const dropOrder = [...quads].sort((a, b) => ctx.mcap(a, date) - ctx.mcap(b, date));
    for (const drop of dropOrder) {
      if (picked.filter((t) => QUAD_SET.has(t)).length <= 2) break;
      picked = picked.filter((t) => t !== drop);
    }
    picked = fillMcapFromScored(scored, picked, megaMax);
  }

  const hasEquip = picked.some((t) => isSemiEquipment(t, ctx));
  if (!hasEquip) {
    const equipPool = eligible
      .filter((t) => isSemiEquipment(t, ctx))
      .map((t) => ({ t, m: ctx.mcap(t, date) }))
      .filter((r) => r.m > 0)
      .sort((a, b) => b.m - a.m || a.t.localeCompare(b.t));
    const bestEquip = equipPool.find((r) => !picked.includes(r.t));
    if (bestEquip) {
      const semisInPick = picked
        .filter((t) => semiOf(t))
        .map((t) => ({ t, m: ctx.mcap(t, date) }))
        .sort((a, b) => a.m - b.m);
      const victim = semisInPick[0]?.t;
      if (victim) {
        picked = picked.filter((t) => t !== victim);
        if (!wouldExceedMega(picked, bestEquip.t, megaMax)) {
          picked.push(bestEquip.t);
        } else {
          picked.push(victim);
        }
        picked = fillMcapFromScored(scored, picked, megaMax);
      }
    }
  }

  return picked.slice(0, MCAP_N);
}

function pickMcapSoxxLow(
  eligible: string[],
  date: string,
  ctx: SakaCandidateContext,
  megaMax: number,
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  soxxHist: Map<string, number>,
  semiOf: (t: string) => boolean,
): string[] {
  const scored = eligible
    .map((t) => ({ t, m: ctx.mcap(t, date) }))
    .filter((r) => r.m > 0)
    .sort((a, b) => b.m - a.m || a.t.localeCompare(b.t));

  const picked: string[] = [];
  const reserveSemi = 3;
  const nonSemiCap = Math.max(0, MCAP_N - reserveSemi);

  for (const { t } of scored) {
    if (picked.length >= nonSemiCap) break;
    if (semiOf(t)) continue;
    if (wouldExceedMega(picked, t, megaMax)) continue;
    picked.push(t);
  }

  let semiRanked = eligible
    .filter((t) => semiOf(t))
    .map((t) => ({
      t,
      m: ctx.mcap(t, date),
      rho: corrToBench(calendar, closeHistory, soxxHist, date, t),
    }))
    .filter((r) => r.m >= SEMI_SOXX_MIN_MCAP)
    .sort((a, b) => {
      const aa = a.rho == null ? Infinity : Math.abs(a.rho);
      const bb = b.rho == null ? Infinity : Math.abs(b.rho);
      if (aa !== bb) return aa - bb;
      return b.m - a.m || a.t.localeCompare(b.t);
    });

  const semiPicked: string[] = [];
  for (const row of semiRanked) {
    if (semiPicked.length >= reserveSemi) break;
    if (picked.includes(row.t) || semiPicked.includes(row.t)) continue;
    if (semiPicked.includes("MU") && row.t === "SNDK") continue;
    const trial = [...picked, ...semiPicked, row.t];
    if (wouldExceedMega(trial, row.t, megaMax)) continue;
    semiPicked.push(row.t);
  }

  let pool = [...picked, ...semiPicked];
  pool = fillMcapFromScored(scored, pool, megaMax);
  return pool.slice(0, MCAP_N);
}

async function pickDivSleeve(
  eligible: string[],
  date: string,
  ctx: SakaCandidateContext,
  exclude: Set<string>,
  divCache: Map<string, DivEvent[]>,
  barsBy: Map<string, Bar[]>,
): Promise<string[]> {
  const cands = eligible
    .filter((t) => !exclude.has(t))
    .map((t) => ({ t, m: ctx.mcap(t, date) }))
    .filter((r) => r.m >= DIV_MIN_MCAP)
    .sort((a, b) => b.m - a.m || a.t.localeCompare(b.t))
    .slice(0, 25);
  const ranked: Array<{ t: string; y: number }> = [];
  for (const { t } of cands) {
    const bars = barsBy.get(t) ?? [];
    const px = mcapCloseOnOrBefore(bars, date) ?? closeOnOrBefore(bars, date) ?? 0;
    const events = await loadDividendEvents(t, divCache);
    ranked.push({ t, y: trailingDivYield(events, date, px) });
  }
  ranked.sort((a, b) => b.y - a.y || a.t.localeCompare(b.t));
  return ranked.slice(0, DIV_N).map((r) => r.t);
}

function mcapSleeveWeights(
  holdings: string[],
  date: string,
  ctx: SakaCandidateContext,
  semiOf: (t: string) => boolean,
): Record<string, number> {
  const raw: Record<string, number> = {};
  let sum = 0;
  for (const t of holdings) {
    const m = ctx.mcap(t, date);
    if (m > 0) {
      raw[t] = m;
      sum += m;
    }
  }
  if (sum > 0) for (const t of Object.keys(raw)) raw[t] /= sum;
  return applySemiCap(raw, semiOf);
}

function combineBook(
  mcapHoldings: string[],
  divHoldings: string[],
  goldTicker: string | null,
  date: string,
  ctx: SakaCandidateContext,
  semiOf: (t: string) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  const mw = mcapSleeveWeights(mcapHoldings, date, ctx, semiOf);
  for (const [t, w] of Object.entries(mw)) out[t] = w * W_MCAP;
  if (divHoldings.length) {
    const each = W_DIV / divHoldings.length;
    for (const t of divHoldings) out[t] = (out[t] ?? 0) + each;
  }
  if (goldTicker) out[goldTicker] = (out[goldTicker] ?? 0) + W_GOLD;
  return out;
}

function simulateDelta(
  calendar: string[],
  from: string,
  to: string,
  rebalSet: Set<string>,
  bootstrapPit: string | null,
  bookOf: (pitDate: string) => Record<string, number>,
  price: (ticker: string, date: string) => number | null,
  handoffSuccessor?: (fromTicker: string, pitDate: string) => string | null,
): SakaEquityPoint[] {
  const minTradeUsd = SAKA_REBAL_MIN_TRADE_USD;
  const relDrift = SAKA_REBAL_REL_DRIFT;
  let cash = PRINCIPAL;
  let bootstrapped = bootstrapPit == null;
  const shares: Record<string, number> = {};
  const lastPrice: Record<string, number> = {};
  const curve: SakaEquityPoint[] = [];
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
    const scheduled = rebalSet.has(date);
    const bootstrapToday = !bootstrapped && bootstrapPit != null;
    if (scheduled || bootstrapToday) {
      const pitDate = scheduled ? date : bootstrapPit!;
      if (bootstrapToday) bootstrapped = true;
      const weights = bookOf(pitDate);
      if (handoffSuccessor) {
        applySameCikHandoffTransfers(shares, weights, pitDate, price, lastPrice, handoffSuccessor);
      }
      const eq = equityOn(date);
      const targetSet = new Set(Object.keys(weights));
      for (const t of Object.keys(shares)) {
        if (targetSet.has(t)) continue;
        const p = price(t, date) ?? lastPrice[t];
        if (p && shares[t] > 0) cash += shares[t] * p - COMMISSION;
        delete shares[t];
      }
      for (const t of Object.keys(weights)) {
        const p = price(t, date);
        if (!p || p <= 0) continue;
        const targetUsd = eq * weights[t];
        const curUsd = (shares[t] ?? 0) * p;
        const delta = targetUsd - curUsd;
        const had = (shares[t] ?? 0) > 0;
        if (had) {
          const rel = curUsd > 0 ? Math.abs(delta) / curUsd : 1;
          if (Math.abs(delta) < minTradeUsd && rel < relDrift) continue;
        }
        if (delta < -minTradeUsd / 2) {
          const sellUsd = Math.min(-delta, curUsd);
          const sellSh = sellUsd / p;
          if (sellSh > 0 && sellSh <= shares[t]) {
            shares[t] -= sellSh;
            cash += sellUsd - COMMISSION;
            if (shares[t] <= 1e-9) delete shares[t];
          }
        } else if (delta > minTradeUsd / 2) {
          const buyUsd = delta;
          const cost = buyUsd + COMMISSION;
          if (cost <= cash) {
            cash -= cost;
            shares[t] = (shares[t] ?? 0) + buyUsd / p;
            lastPrice[t] = p;
          }
        } else if (!had && targetUsd >= minTradeUsd / 2) {
          const cost = targetUsd + COMMISSION;
          if (cost <= cash) {
            cash -= cost;
            shares[t] = targetUsd / p;
            lastPrice[t] = p;
          }
        }
      }
    }
    curve.push({ date, equity: equityOn(date) });
  }
  return curve;
}

function bookMetrics(weights: Record<string, number>, semiOf: (t: string) => boolean): { ai: number; semi: number } {
  let ai = 0;
  let semi = 0;
  for (const [t, w] of Object.entries(weights)) {
    if (semiOf(t)) semi += w;
    if (isAiTilt(t, semiOf)) ai += w;
  }
  return { ai, semi };
}

async function ensureGoldBars(barsBy: Map<string, Bar[]>): Promise<{ ticker: string | null; note: string }> {
  for (const sym of ["GLD", "IAU"]) {
    const cached = loadPitBars(sym, PIT_CACHE);
    if (cached.length) {
      barsBy.set(sym, cached);
      return { ticker: sym, note: sym === "GLD" ? "PIT cache" : "fallback IAU (PIT cache)" };
    }
    try {
      const { bars } = await fetchDailyBars(sym, { range: "20y", keep: 3200, totalReturn: true });
      if (bars.length) {
        barsBy.set(sym, bars);
        return { ticker: sym, note: sym === "GLD" ? "Yahoo adjclose (runtime)" : "fallback IAU Yahoo" };
      }
    } catch {
      /* try next */
    }
  }
  return { ticker: null, note: "GLD/IAU not computed" };
}

async function ensureBench(barsBy: Map<string, Bar[]>, sym: string): Promise<{ ticker: string | null; note: string }> {
  const cached = loadPitBars(sym, PIT_CACHE);
  if (cached.length) {
    barsBy.set(sym, cached);
    return { ticker: sym, note: "PIT cache" };
  }
  try {
    const { bars } = await fetchDailyBars(sym, { range: "20y", keep: 3200, totalReturn: true });
    if (bars.length) {
      barsBy.set(sym, bars);
      return { ticker: sym, note: "Yahoo adjclose (runtime)" };
    }
  } catch {
    /* fall through */
  }
  return { ticker: null, note: `${sym} not computed` };
}

function fmtR(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(2);
}

function buildSemiMatrixSection(
  date: string,
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  soxxHist: Map<string, number>,
): string {
  const header = ["", ...MATRIX_TICKERS, "SOXX"].join(" | ");
  const sep = ["---", ...MATRIX_TICKERS.map(() => "---:"), "---:"].join("|");
  const lines = [`### ${date}（252d log-return Pearson）`, "", `| ${header} |`, `| ${sep} |`];
  for (const row of MATRIX_TICKERS) {
    const cells = MATRIX_TICKERS.map((col) => {
      if (row === col) return "1.00";
      return fmtR(corrAligned(calendar, closeHistory, date, row, col));
    });
    cells.push(fmtR(corrToBench(calendar, closeHistory, soxxHist, date, row)));
    lines.push(`| ${row} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function evaluateRun(
  id: string,
  bookMap: Map<string, Record<string, number>>,
  calendar: string[],
  rebals: string[],
  rebalSet: Set<string>,
  aligned: string,
  price: (ticker: string, date: string) => number | null,
  handoffSuccessor: (fromTicker: string, pitDate: string) => string | null,
  semiOf: (t: string) => boolean,
  goldTicker: string | null,
): RunStats {
  const bookOf = (pit: string) => bookMap.get(pit) ?? {};
  const curve = simulateDelta(calendar, aligned, SAKA_END, rebalSet, null, bookOf, price, handoffSuccessor);
  const m = metricsFromCurve(curve, calendar, aligned, SAKA_END);
  const totalReturn = curve.length ? curve[curve.length - 1]!.equity / PRINCIPAL - 1 : 0;

  const starts = monthStarts(calendar, SAKA_START, SAKA_END);
  const depths: number[] = [];
  let materialN = 0;
  for (const start of starts) {
    let pitDate = "";
    for (const d of rebals) {
      if (d <= start) pitDate = d;
      else break;
    }
    if (!pitDate) continue;
    const c = simulateDelta(
      calendar,
      start,
      SAKA_END,
      rebalSet,
      rebalSet.has(start) ? null : pitDate,
      bookOf,
      price,
      handoffSuccessor,
    );
    let minEq = Infinity;
    for (const p of c) minEq = Math.min(minEq, p.equity);
    const deepest = minEq / PRINCIPAL - 1;
    depths.push(deepest);
    if (deepest < -MATERIAL) materialN += 1;
  }

  let aiSum = 0;
  let semiSum = 0;
  let n = 0;
  let ai2026 = 0;
  let semi2026 = 0;
  for (const d of rebals) {
    const w = bookOf(d);
    const { ai, semi } = bookMetrics(w, semiOf);
    aiSum += ai;
    semiSum += semi;
    n += 1;
    if (d === SCREEN_DATE) {
      ai2026 = ai;
      semi2026 = semi;
    }
  }

  return {
    id,
    totalReturn,
    cagr: m.cagr,
    maxDd: m.maxDrawdown,
    principalMedian: quantile(depths, 0.5),
    principalP10: quantile(depths, 0.1),
    materialPct: depths.length ? materialN / depths.length : 0,
    aiAvg: n ? aiSum / n : 0,
    ai2026,
    semiAvg: n ? semiSum / n : 0,
    semi2026,
    goldTicker,
  };
}

function readSemiMdPrefix(): string {
  const raw = fs.readFileSync(OUT_SEMI_MD, "utf8");
  const marker = "## （以下";
  const idx = raw.indexOf(marker);
  if (idx < 0) throw new Error(`missing marker ${marker} in ${OUT_SEMI_MD}`);
  return raw.slice(0, idx).trimEnd();
}

function writeSemiResultsMd(
  prefix: string,
  head: string,
  goldInfo: { ticker: string | null; note: string },
  soxxInfo: { ticker: string | null; note: string },
  runs: RunStats[],
  baseline: RunStats,
  screenTable: string,
  matrixSection: string,
  mcapK2OnDate: Record<string, string[]>,
): void {
  const primaryOk = (r: RunStats) =>
    (r.materialPct < baseline.materialPct || r.principalMedian > baseline.principalMedian) &&
    r.totalReturn >= baseline.totalReturn - 0.02;

  const newVariants = runs.filter((r) => r.id === "divGold_K2_layerMix" || r.id === "divGold_K2_soxxLow");
  const winners = newVariants.filter(primaryOk);
  winners.sort((a, b) => {
    if (b.totalReturn !== a.totalReturn) return b.totalReturn - a.totalReturn;
    return a.ai2026 - b.ai2026;
  });
  const winner = winners[0];

  const hold = runs.find((r) => r.id === "divGold_K2_keep")!;
  const layer = runs.find((r) => r.id === "divGold_K2_layerMix")!;
  const soxxLow = runs.find((r) => r.id === "divGold_K2_soxxLow")!;

  const body = [
    "## （以下、スクリプト実行結果）",
    "",
    `**生成:** \`scripts/round19-v1-semi-layer-soxx.ts\` · **HEAD** \`${head.slice(0, 7)}\``,
    `**親 prereg:** [\`${PREREG_PARENT}\`](ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md) · **本追補:** [\`${PREREG_SEMI}\`](ROUND19_V1_SEMI_LAYER_SOXX_ja.md)`,
    `**金 ETF:** ${goldInfo.note}${goldInfo.ticker ? ` (\`${goldInfo.ticker}\`)` : ""}`,
    `**SOXX:** ${soxxInfo.note}${soxxInfo.ticker ? ` (\`${soxxInfo.ticker}\`)` : ""}`,
    "",
    "## サマリー（vs baseline `plain_15__mcap`）",
    "",
    winner
      ? `**Primary を満たした追試 variant:** \`${winner.id}\`（総リターン ${pct(winner.totalReturn)}、材料割れ率 ${(winner.materialPct * 100).toFixed(0)}%、2026 AI ${(winner.ai2026 * 100).toFixed(1)}%）`
      : "**Primary を満たす追試 variant なし** — 元本中央は divGold 系どおり baseline より浅いが、総リターンが baseline −2%pt 以内を満たさない、または材料割れ改善なし。",
    "",
    "## Primary 判定（親 prereg §7、緩和なし）",
    "",
    "| 条件 | baseline | divGold_K2_keep | divGold_K2_layerMix | divGold_K2_soxxLow |",
    "|---|---:|---:|---:|---:|",
    `| 材料割れ率 | ${(baseline.materialPct * 100).toFixed(0)}% | ${(hold.materialPct * 100).toFixed(0)}% | ${(layer.materialPct * 100).toFixed(0)}% | ${(soxxLow.materialPct * 100).toFixed(0)}% |`,
    `| 元本最深中央 | ${pct(baseline.principalMedian)} | ${pct(hold.principalMedian)} | ${pct(layer.principalMedian)} | ${pct(soxxLow.principalMedian)} |`,
    `| 総リターン | ${pct(baseline.totalReturn)} | ${pct(hold.totalReturn)} | ${pct(layer.totalReturn)} | ${pct(soxxLow.totalReturn)} |`,
    "",
    "## 指標一覧",
    "",
    "| ID | 総リターン | CAGR | MaxDD | 元本最深中央 | 元本最深10% | 材料割れ率 | AI平均 | AI 2026 | Semi平均 | Semi 2026 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...runs.map(
      (r) =>
        `| ${r.id} | ${pct(r.totalReturn)} | ${pct(r.cagr)} | ${pct(r.maxDd)} | ${pct(r.principalMedian)} | ${pct(r.principalP10)} | ${(r.materialPct * 100).toFixed(0)}% | ${(r.aiAvg * 100).toFixed(1)}% | ${(r.ai2026 * 100).toFixed(1)}% | ${(r.semiAvg * 100).toFixed(1)}% | ${(r.semi2026 * 100).toFixed(1)}% |`,
    ),
    "",
    `### ${SCREEN_DATE} mcap スリーブ（K=2）`,
    "",
    "| variant | 銘柄 |",
    "|---|---|",
    ...Object.entries(mcapK2OnDate).map(([vid, tickers]) => `| \`${vid}\` | ${tickers.join(", ")} |`),
    "",
    "## SOXX 相関スクリーン（eligible semi、mcap 20–500B USD）",
    "",
    "quad 四銘柄の |ρ(SOXX)| **最大値**より小さい |ρ| の候補に ★ を付与。**MU が mcap スリーブに含まれる場合は SNDK を候補から除外**（下表はスクリーン時点の eligible のみ）。",
    "",
    screenTable,
    "",
    "## 半導体ペア相関 + SOXX 列",
    "",
    matrixSection,
    "",
    "## 備考",
    "",
    "- 252 日 log-return Pearson；観測不足は「—」。",
    "- シミュレーション・元本ストレス定義は div-gold スクリプトと同一（75/20/5、四半期 PIT）。",
    "- 既存 divGold_K1/K2 結果ファイルは **上書きしない**（本スクリプトは追試ドキュメントのみ更新）。",
    "",
  ].join("\n");

  fs.writeFileSync(OUT_SEMI_MD, `${prefix}\n\n${body}`);
}

function appendDivGoldAdditive(runs: RunStats[], baseline: RunStats, head: string): void {
  const sectionTitle = "## 半導体レイヤー追試（additive）";
  let existing = fs.readFileSync(OUT_DIV_GOLD_MD, "utf8");
  if (existing.includes(sectionTitle)) return;

  const primaryOk = (r: RunStats) =>
    (r.materialPct < baseline.materialPct || r.principalMedian > baseline.principalMedian) &&
    r.totalReturn >= baseline.totalReturn - 0.02;

  const layer = runs.find((r) => r.id === "divGold_K2_layerMix")!;
  const soxxLow = runs.find((r) => r.id === "divGold_K2_soxxLow")!;
  const okLayer = primaryOk(layer);
  const okSoxx = primaryOk(soxxLow);

  const block = [
    "",
    sectionTitle,
    "",
    `**追補 prereg:** [\`ROUND19_V1_SEMI_LAYER_SOXX_ja.md\`](ROUND19_V1_SEMI_LAYER_SOXX_ja.md) · **生成:** \`scripts/round19-v1-semi-layer-soxx.ts\` · **HEAD** \`${head.slice(0, 7)}\``,
    "",
    "親 prereg §7 Primary **緩和なし**。既存 divGold_K1/K2 表は維持；以下は **additive** 追試のみ。",
    "",
    "| variant | Primary | 総リターン | 元本最深中央 | 材料割れ率 | AI 2026 |",
    "|---|:---:|---:|---:|---:|---:|",
    `| \`divGold_K2_layerMix\` | ${okLayer ? "✓" : "—"} | ${pct(layer.totalReturn)} | ${pct(layer.principalMedian)} | ${(layer.materialPct * 100).toFixed(0)}% | ${(layer.ai2026 * 100).toFixed(1)}% |`,
    `| \`divGold_K2_soxxLow\` | ${okSoxx ? "✓" : "—"} | ${pct(soxxLow.totalReturn)} | ${pct(soxxLow.principalMedian)} | ${(soxxLow.materialPct * 100).toFixed(0)}% | ${(soxxLow.ai2026 * 100).toFixed(1)}% |`,
    "",
    `詳細（SOXX スクリーン表・相関行列・mcap 11 内訳）: [\`ROUND19_V1_SEMI_LAYER_SOXX_ja.md\`](ROUND19_V1_SEMI_LAYER_SOXX_ja.md)。`,
    "",
  ].join("\n");

  existing = existing.trimEnd() + block + "\n";
  fs.writeFileSync(OUT_DIV_GOLD_MD, existing);
}

async function main() {
  const t0 = Date.now();
  const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const semiPrefix = readSemiMdPrefix();

  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const overrides = loadPitCikOverrides().cik;
  const cikResolved = await buildPitCikMapForTickers(PIT_CACHE, gics, tickers, overrides);
  const cikMap = new Map([...cikResolved.entries()].map(([t, r]) => [t, r.cik]));
  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const factByTicker = new Map<string, unknown | undefined>();
  const factForTicker = (t: string): unknown | undefined => {
    if (factByTicker.has(t)) return factByTicker.get(t);
    const json = loadMergedPitFacts(t, cikMap.get(t) ?? null, factsIndex, PIT_CACHE);
    factByTicker.set(t, json);
    return json;
  };
  const profitCache = new Map<string, ProfitabilityStatus>();
  const profitOf = (t: string, date: string): ProfitabilityStatus => {
    const k = `${t}|${date}`;
    const hit = profitCache.get(k);
    if (hit) return hit;
    const st = profitabilityStatus(factForTicker(t), date);
    profitCache.set(k, st);
    return st;
  };

  const barsBy = new Map<string, Bar[]>();
  const splitsBy = new Map<string, PitSplit[]>();
  for (const t of tickers) {
    const bars = loadPitBars(t, PIT_CACHE);
    if (bars.length) barsBy.set(t, bars);
    splitsBy.set(t, loadPitSplits(t, PIT_CACHE));
  }
  const spyBars = loadPitBars("SPY", PIT_CACHE);
  const calendar = tradingDaysFromBars(spyBars);
  const goldInfo = await ensureGoldBars(barsBy);
  const soxxInfo = await ensureBench(barsBy, "SOXX");

  const price = (ticker: string, date: string) =>
    closeOnOrBefore(barsBy.get(ticker) ?? (ticker === "SPY" ? spyBars : []), date);

  const mcapCache = new Map<string, number>();
  const mcapOf = (t: string, date: string) => {
    const k = `${t}|${date}`;
    const hit = mcapCache.get(k);
    if (hit != null) return hit;
    const v = pitMarketCapAtDate(barsBy.get(t) ?? [], factForTicker(t), date, splitsBy.get(t) ?? []);
    mcapCache.set(k, v);
    return v;
  };

  const hasPriceCache = new Map<string, boolean>();
  const ctx: SakaCandidateContext = {
    calendar,
    closeHistory: new Map(),
    gicsOf: (t) => {
      const g = gics.get(t);
      if (!g) return null;
      return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
    },
    mcap: mcapOf,
    sharesLookup: () => ({ shares: 0, stale: true }),
    profitable: (t, date) => profitOf(t, date) === "profitable",
    hasPrice: (t, date) => {
      const k = `${t}|${date}`;
      const hit = hasPriceCache.get(k);
      if (hit != null) return hit;
      const v = mcapCloseOnOrBefore(barsBy.get(t) ?? [], date) != null;
      hasPriceCache.set(k, v);
      return v;
    },
    cikOf: (t) => cikMap.get(t) ?? null,
  };

  const semiOf = (t: string) => ctx.gicsOf(t)?.semiBucket ?? false;
  for (const t of tickers) {
    const bars = barsBy.get(t);
    if (!bars) continue;
    const m = new Map<string, number>();
    for (const b of bars) m.set(b.date, b.c);
    ctx.closeHistory.set(t, m);
  }

  const soxxBars = barsBy.get("SOXX") ?? [];
  const soxxHist = new Map<string, number>();
  for (const b of soxxBars) soxxHist.set(b.date, b.c);

  const handoffSuccessor = buildSameCikHandoffResolver(intervals, (t) => cikMap.get(t) ?? null);
  const membersOn = (date: string) => membersOnDate(intervals, date);
  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);
  const rebalSet = new Set(rebals);
  const divCache = new Map<string, DivEvent[]>();

  const books = new Map<string, Map<string, Record<string, number>>>();
  const mcapHoldingsByVariant = new Map<string, Map<string, string[]>>();
  for (const id of ["plain_15__mcap", "divGold_K2_keep", "divGold_K2_layerMix", "divGold_K2_soxxLow"]) {
    books.set(id, new Map());
    if (id !== "plain_15__mcap") mcapHoldingsByVariant.set(id, new Map());
  }

  console.log("building books…");
  for (const date of rebals) {
    const eligible = filterEligibleCandidates(membersOn(date), date, ctx);

    const baseHold = pickHoldings(BASELINE, eligible, date, ctx);
    const baseW = targetWeights(BASELINE, baseHold, date, ctx, semiOf);
    books.get("plain_15__mcap")!.set(date, baseW);

    const mcapKeep = pickMcapSleeve(eligible, date, ctx, MEGA_MAX_K2, false, calendar, ctx.closeHistory);
    const mcapLayer = pickMcapLayerMix(eligible, date, ctx, MEGA_MAX_K2, semiOf, calendar, ctx.closeHistory);
    const mcapSoxx = soxxInfo.ticker
      ? pickMcapSoxxLow(eligible, date, ctx, MEGA_MAX_K2, calendar, ctx.closeHistory, soxxHist, semiOf)
      : pickMcapSleeve(eligible, date, ctx, MEGA_MAX_K2, false, calendar, ctx.closeHistory);

    mcapHoldingsByVariant.get("divGold_K2_keep")!.set(date, mcapKeep);
    mcapHoldingsByVariant.get("divGold_K2_layerMix")!.set(date, mcapLayer);
    mcapHoldingsByVariant.get("divGold_K2_soxxLow")!.set(date, mcapSoxx);

    for (const [vid, mcapH] of [
      ["divGold_K2_keep", mcapKeep],
      ["divGold_K2_layerMix", mcapLayer],
      ["divGold_K2_soxxLow", mcapSoxx],
    ] as const) {
      const ex = new Set(mcapH);
      const divH = await pickDivSleeve(eligible, date, ctx, ex, divCache, barsBy);
      const w = combineBook(mcapH, divH, goldInfo.ticker, date, ctx, semiOf);
      books.get(vid)!.set(date, w);
    }

    console.log(`  ${date}`);
  }

  const screenDate = SCREEN_DATE;
  const screenEligible = filterEligibleCandidates(membersOn(screenDate), screenDate, ctx);
  const quadRhos = QUAD.map((t) => Math.abs(corrToBench(calendar, ctx.closeHistory, soxxHist, screenDate, t) ?? 0));
  const quadRhoMax = quadRhos.length ? Math.max(...quadRhos) : 0;

  const mcapOnScreen =
    mcapHoldingsByVariant.get("divGold_K2_soxxLow")!.get(screenDate) ??
    mcapHoldingsByVariant.get("divGold_K2_keep")!.get(screenDate) ??
    [];
  const muInMcapSleeve = mcapOnScreen.includes("MU");

  const screenRows = screenEligible
    .filter((t) => semiOf(t))
    .map((t) => ({
      t,
      m: ctx.mcap(t, screenDate),
      layer: semiLayerLabel(t, ctx, semiOf),
      rho: corrToBench(calendar, ctx.closeHistory, soxxHist, screenDate, t),
    }))
    .filter((r) => r.m >= SEMI_SOXX_MIN_MCAP && r.m <= SEMI_SCREEN_MAX_MCAP)
    .filter((r) => !(muInMcapSleeve && r.t === "SNDK"))
    .sort((a, b) => {
      const aa = a.rho == null ? Infinity : Math.abs(a.rho);
      const bb = b.rho == null ? Infinity : Math.abs(b.rho);
      if (aa !== bb) return aa - bb;
      return b.m - a.m || a.t.localeCompare(b.t);
    });

  const screenLines = [
    "| ticker | layer | mcapB | ρSOXX | note |",
    "|---|---|---:|---:|---|",
    ...screenRows.map((r) => {
      const absR = r.rho == null ? NaN : Math.abs(r.rho);
      const star = Number.isFinite(absR) && absR < quadRhoMax ? "★" : "";
      const sndkNote = r.t === "SNDK" ? "SNDK rule (MU)" : "";
      const note = [star, sndkNote].filter(Boolean).join(" ");
      return `| ${r.t} | ${r.layer} | ${(r.m / 1e9).toFixed(1)} | ${fmtR(r.rho)} | ${note || "—"} |`;
    }),
    "",
    `quad |ρ(SOXX)| max = **${quadRhoMax.toFixed(2)}**（NVDA ${fmtR(corrToBench(calendar, ctx.closeHistory, soxxHist, screenDate, "NVDA"))}, AVGO ${fmtR(
      corrToBench(calendar, ctx.closeHistory, soxxHist, screenDate, "AVGO"),
    )}, AMD ${fmtR(corrToBench(calendar, ctx.closeHistory, soxxHist, screenDate, "AMD"))}, MU ${fmtR(
      corrToBench(calendar, ctx.closeHistory, soxxHist, screenDate, "MU"),
    )}）。`,
  ];
  const screenTable = screenLines.join("\n");

  const matrixSection = buildSemiMatrixSection(screenDate, calendar, ctx.closeHistory, soxxHist);

  const mcapK2OnDate: Record<string, string[]> = {};
  for (const vid of ["divGold_K2_keep", "divGold_K2_layerMix", "divGold_K2_soxxLow"] as const) {
    mcapK2OnDate[vid] = mcapHoldingsByVariant.get(vid)!.get(screenDate) ?? [];
  }

  const aligned = rebals[0]!;
  const runIds = ["plain_15__mcap", "divGold_K2_keep", "divGold_K2_layerMix", "divGold_K2_soxxLow"] as const;
  const runs: RunStats[] = [];
  for (const id of runIds) {
    runs.push(
      evaluateRun(
        id,
        books.get(id)!,
        calendar,
        rebals,
        rebalSet,
        aligned,
        price,
        handoffSuccessor,
        semiOf,
        id === "plain_15__mcap" ? null : goldInfo.ticker,
      ),
    );
  }

  const baseline = runs.find((r) => r.id === "plain_15__mcap")!;

  writeSemiResultsMd(
    semiPrefix,
    head,
    goldInfo,
    soxxInfo,
    runs,
    baseline,
    screenTable,
    matrixSection,
    mcapK2OnDate,
  );
  appendDivGoldAdditive(runs, baseline, head);

  console.log(`wrote ${OUT_SEMI_MD}`);
  console.log(`appended additive section to ${OUT_DIV_GOLD_MD} (if missing)`);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
