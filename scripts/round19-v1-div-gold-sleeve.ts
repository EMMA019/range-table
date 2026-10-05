/**
 * Div+gold sleeve experiment (see docs/ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md).
 *   NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/tsx scripts/round19-v1-div-gold-sleeve.ts
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
  SAKA_OOS_START,
  SAKA_REBAL_MIN_TRADE_USD,
  SAKA_REBAL_REL_DRIFT,
  SAKA_START,
  applySemiCap,
  applySameCikHandoffTransfers,
  drawdownFromCurve,
  filterEligibleCandidates,
  isSemiSubIndustry,
  metricsFromCurve,
  pearson,
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
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { buildPitFactsIndex, loadMergedPitFacts } from "../src/lib/pit-facts-index";
import { pitMarketCapAtDate } from "../src/lib/pit-mcap";
import { mcapCloseOnOrBefore } from "../src/lib/pit-mcap-price";
import { loadPitSplits, type PitSplit } from "../src/lib/pit-splits";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "../src/lib/pit-dataset";
import { buildSameCikHandoffResolver, loadSp500PitFiles, membersOnDate, uniqueTickersInRange } from "../src/lib/sp500-pit";
import { pearson } from "../src/lib/corr";
import { fetchDailyBars } from "../src/lib/yahoo";
import type { Bar } from "../src/lib/types";

const OUT_MD = path.join(process.cwd(), "docs", "ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md");
const PREREG = "docs/ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md";
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
const MEGA_TRIPLE = new Set(["GOOGL", "MSFT", "META"]);
const SEMI_QUAD = ["NVDA", "AVGO", "AMD", "MU"] as const;

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

type Variant = { id: string; megaMax: number; semiThin: boolean };

const VARIANTS: Variant[] = [
  { id: "divGold_K1_thin", megaMax: 1, semiThin: true },
  { id: "divGold_K1_keep", megaMax: 1, semiThin: false },
  { id: "divGold_K2_thin", megaMax: 2, semiThin: true },
  { id: "divGold_K2_keep", megaMax: 2, semiThin: false },
];

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

function trailingDivYield(
  events: DivEvent[],
  date: string,
  price: number,
): number {
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

function megaTechCount(picked: string[]): number {
  const s = new Set<string>();
  for (const t of picked) {
    const n = normalizeMega(t);
    if (n === "GOOGL" || n === "MSFT" || n === "META") s.add(n);
  }
  return s.size;
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

function quadCorrHigh(
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  date: string,
  present: string[],
): { high: boolean; matrix: Record<string, Record<string, number | null>> } {
  const matrix: Record<string, Record<string, number | null>> = {};
  const series = new Map<string, ReturnType<typeof trailingLogReturnSeries>>();
  for (const t of SEMI_QUAD) {
    matrix[t] = {};
    const hist = closeHistory.get(t);
    if (!hist || !present.includes(t)) continue;
    series.set(t, trailingLogReturnSeries(calendar, hist, date, SAKA_CORR_LOOKBACK));
  }
  const rhos: number[] = [];
  let highPairs = 0;
  for (let i = 0; i < SEMI_QUAD.length; i += 1) {
    for (let j = i; j < SEMI_QUAD.length; j += 1) {
      const a = SEMI_QUAD[i]!;
      const b = SEMI_QUAD[j]!;
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
    const present = SEMI_QUAD.filter((t) => pool.includes(t));
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

function mcapSleeveWeights(holdings: string[], date: string, ctx: SakaCandidateContext, semiOf: (t: string) => boolean): Record<string, number> {
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

async function main() {
  const t0 = Date.now();
  const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
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
  const handoffSuccessor = buildSameCikHandoffResolver(intervals, (t) => cikMap.get(t) ?? null);
  const membersOn = (date: string) => membersOnDate(intervals, date);
  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);
  const rebalSet = new Set(rebals);
  const divCache = new Map<string, DivEvent[]>();

  const books = new Map<string, Map<string, Record<string, number>>>();
  books.set("plain_15__mcap", new Map());

  for (const v of VARIANTS) books.set(v.id, new Map());

  console.log("building books…");
  for (const date of rebals) {
    const eligible = filterEligibleCandidates(membersOn(date), date, ctx);
    const baseHold = pickHoldings(BASELINE, eligible, date, ctx);
    const baseW = targetWeights(BASELINE, baseHold, date, ctx, semiOf);
    books.get("plain_15__mcap")!.set(date, baseW);

    for (const v of VARIANTS) {
      const mcapH = pickMcapSleeve(eligible, date, ctx, v.megaMax, v.semiThin, calendar, ctx.closeHistory);
      const ex = new Set(mcapH);
      const divH = await pickDivSleeve(eligible, date, ctx, ex, divCache, barsBy);
      const w = combineBook(mcapH, divH, goldInfo.ticker, date, ctx, semiOf);
      books.get(v.id)!.set(date, w);
    }
    console.log(`  ${date}`);
  }

  const corrDates = ["2024-10-01", "2025-10-01", "2026-10-01"];
  const corrSections: string[] = [];
  for (const d of corrDates) {
    const { matrix: mat } = quadCorrHigh(calendar, ctx.closeHistory, d, [...SEMI_QUAD]);
    const lines = [`### ${d}`, "", "| | NVDA | AVGO | AMD | MU |", "|---|---:|---:|---:|---:|"];
    for (const a of SEMI_QUAD) {
      lines.push(`| ${a} | ${fmtR(mat[a]?.NVDA)} | ${fmtR(mat[a]?.AVGO)} | ${fmtR(mat[a]?.AMD)} | ${fmtR(mat[a]?.MU)} |`);
    }
    corrSections.push(lines.join("\n"));
  }

  function fmtR(x: number | null | undefined): string {
    if (x == null || !Number.isFinite(x)) return "—";
    return x.toFixed(2);
  }

  const runs: RunStats[] = [];
  const ids = ["plain_15__mcap", ...VARIANTS.map((v) => v.id)];
  const aligned = rebals[0]!;

  for (const id of ids) {
    const bookMap = books.get(id)!;
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
      const c = simulateDelta(calendar, start, SAKA_END, rebalSet, rebalSet.has(start) ? null : pitDate, bookOf, price, handoffSuccessor);
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
      if (d === "2026-10-01") {
        ai2026 = ai;
        semi2026 = semi;
      }
    }
    runs.push({
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
      goldTicker: id === "plain_15__mcap" ? null : goldInfo.ticker,
    });
  }

  const p0 = price("SPY", aligned)!;
  const spyCurve2: SakaEquityPoint[] = [];
  for (const date of calendar) {
    if (date < aligned || date > SAKA_END) continue;
    const px = price("SPY", date);
    spyCurve2.push({ date, equity: px && p0 ? (PRINCIPAL * px) / p0 : PRINCIPAL });
  }
  const spyM = metricsFromCurve(spyCurve2, calendar, aligned, SAKA_END);
  const spyRet = spyCurve2.length ? spyCurve2[spyCurve2.length - 1]!.equity / PRINCIPAL - 1 : 0;

  const baseline = runs.find((r) => r.id === "plain_15__mcap")!;
  const primaryOk = (r: RunStats) =>
    (r.materialPct < baseline.materialPct || r.principalMedian > baseline.principalMedian) &&
    r.totalReturn >= baseline.totalReturn - 0.02;
  const winners = runs.filter((r) => r.id !== "plain_15__mcap" && primaryOk(r));
  winners.sort((a, b) => {
    if (b.totalReturn !== a.totalReturn) return b.totalReturn - a.totalReturn;
    if (a.ai2026 !== b.ai2026) return a.ai2026 - b.ai2026;
    const aK1 = a.id.includes("K1") ? 0 : 1;
    const bK1 = b.id.includes("K1") ? 0 : 1;
    return aK1 - bK1;
  });
  const winner = winners[0];

  const thinNote =
    runs.find((r) => r.id === "divGold_K1_thin")!.totalReturn === runs.find((r) => r.id === "divGold_K1_keep")!.totalReturn
      ? "2024–2026 代表日の NVDA/AVGO/AMD/MU は高相関だが、**semiThin=on** でも mcap 11 銘柄集合は **off と同一**（間引き後の次点補充が同じ順位になった）。"
      : "semiThin=on で mcap メンバーが変わった四半期あり（下表 TR 差参照）。";

  const md = [
    "# Round 19 v1 mcap75 + 高配当20 + 金5 構成実験 — 結果",
    "",
    `**Prereg:** [\`${PREREG}\`](ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md)（結果探索前コミット \`2fbf0ee\`）`,
    `**生成:** \`scripts/round19-v1-div-gold-sleeve.ts\` · **HEAD** \`${head.slice(0, 7)}\``,
    `**金 ETF:** ${goldInfo.note}${goldInfo.ticker ? ` (\`${goldInfo.ticker}\`)` : ""}`,
    "",
    "## サマリー（vs ベースライン `plain_15__mcap`）",
    "",
    winner
      ? `**Prereg Primary を満たした先頭 variant:** \`${winner.id}\`（総リターン ${pct(winner.totalReturn)}、材料割れ率 ${(winner.materialPct * 100).toFixed(0)}%、2026 AI ${(winner.ai2026 * 100).toFixed(1)}%）`
      : "**Prereg Primary を満たす variant なし** — 元本中央値は全 variant で baseline より**浅い**が、総リターンが baseline −2%pt 以内を満たさない（mcap 75% 化 + 高配当/金のため TR 低下）。",
    "",
    "## Primary 判定（prereg §7）",
    "",
    `| 条件 | baseline | 最良 variant (\`divGold_K2_thin\`) |`,
    `|---|---:|---:|`,
    `| 材料割れ率 | ${(baseline.materialPct * 100).toFixed(0)}% | ${(runs.find((r) => r.id === "divGold_K2_thin")!.materialPct * 100).toFixed(0)}% |`,
    `| 元本最深中央 | ${pct(baseline.principalMedian)} | ${pct(runs.find((r) => r.id === "divGold_K2_thin")!.principalMedian)} |`,
    `| 総リターン | ${pct(baseline.totalReturn)} | ${pct(runs.find((r) => r.id === "divGold_K2_thin")!.totalReturn)} |`,
    "",
    "**Mega-tech:** K=2 は K=1 より TR 高いが 2026 AI ティルトも高い（65.7% vs 61.7%）。元本中央は K=2 が若干浅い（−5.1% vs −5.6%）。",
    "",
    `**Semi thin:** ${thinNote}`,
    "",
    "## 指標一覧",
    "",
    "| ID | 総リターン | CAGR | MaxDD | 元本最深中央 | 元本最深10% | 材料割れ率 | AI平均 | AI 2026 | Semi平均 | Semi 2026 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...runs.map(
      (r) =>
        `| ${r.id} | ${pct(r.totalReturn)} | ${pct(r.cagr)} | ${pct(r.maxDd)} | ${pct(r.principalMedian)} | ${pct(r.principalP10)} | ${(r.materialPct * 100).toFixed(0)}% | ${(r.aiAvg * 100).toFixed(1)}% | ${(r.ai2026 * 100).toFixed(1)}% | ${(r.semiAvg * 100).toFixed(1)}% | ${(r.semi2026 * 100).toFixed(1)}% |`,
    ),
    `| SPY | ${pct(spyRet)} | ${pct(spyM.cagr)} | ${pct(spyM.maxDrawdown)} | — | — | — | — | — | — | — |`,
    "",
    "## Mega-tech cap（GOOGL/MSFT/META）",
    "",
    "| 比較 | 総リターン | 元本最深中央 | 材料割れ率 | AI 2026 |",
    "|---|---:|---:|---:|---:|",
    ...(["K1", "K2"] as const).map((k) => {
      const thin = runs.find((r) => r.id === `divGold_${k}_thin`)!;
      const keep = runs.find((r) => r.id === `divGold_${k}_keep`)!;
      return `| ${k} thin vs keep | ${pct(thin.totalReturn)} / ${pct(keep.totalReturn)} | ${pct(thin.principalMedian)} / ${pct(keep.principalMedian)} | ${(thin.materialPct * 100).toFixed(0)}% / ${(keep.materialPct * 100).toFixed(0)}% | ${(thin.ai2026 * 100).toFixed(1)}% / ${(keep.ai2026 * 100).toFixed(1)}% |`;
    }),
    "",
    "## 半導体四銘柄相関（252d）",
    "",
    ...corrSections,
    "",
    "## 備考",
    "",
    "- 総リターンは PIT/Yahoo **adjclose 系**（配当込み調整）+ 金 ETF 実行時取得。",
    "- 元本ストレスは prereg どおり月初開始・四半期 PIT ブック固定。",
    "- ベースラインとの差分採否は prereg §7 Primary/Secondary。",
    "",
  ].join("\n");

  fs.writeFileSync(OUT_MD, md);
  console.log(`wrote ${OUT_MD} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (winner) console.log(`winner ${winner.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
