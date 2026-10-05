/**
 * Mcap + T-bill ETF + gold sleeve (see docs/ROUND19_V1_TBILL_GOLD_PREREG_ja.md).
 *   NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/round19-v1-tbill-gold-sleeve.ts
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  SAKA_CONFIGS,
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
import { fetchDailyBars } from "../src/lib/yahoo";
import type { Bar } from "../src/lib/types";

const OUT_MD = path.join(process.cwd(), "docs", "ROUND19_V1_TBILL_GOLD_RESULTS_ja.md");
const PREREG_PATH = path.join(process.cwd(), "docs", "ROUND19_V1_TBILL_GOLD_PREREG_ja.md");
const PREREG = "docs/ROUND19_V1_TBILL_GOLD_PREREG_ja.md";
const DIV_GOLD_RESULTS = "docs/ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md";
const COMMISSION = 0.35;
const PRINCIPAL = SAKA_INITIAL_CASH;
const MATERIAL = 0.01;
const BASELINE = SAKA_CONFIGS.find((c) => c.id === "plain_15__mcap")!;

const MCAP_N = 11;

/** Quoted from ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md — not re-simulated here. */
const DIV_GOLD_K2_KEEP_QUOTED = {
  id: "divGold_K2_keep",
  totalReturn: 5.585,
  cagr: 0.192,
  maxDd: -0.264,
  principalMedian: -0.051,
  principalP10: -0.181,
  materialPct: 0.77,
  aiAvg: 0.567,
  ai2026: 0.657,
  semiAvg: 0.07,
  semi2026: 0.225,
};

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

type TbillVariant = {
  id: string;
  megaMax: number;
  tbillEtf: string;
  mcapPct: number;
  tbillPct: number;
  goldPct: number;
  refOnly?: boolean;
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

function pickMcapSleeve(
  eligible: string[],
  date: string,
  ctx: SakaCandidateContext,
  megaMax: number,
  semiThin: boolean,
  _calendar: string[],
  _closeHistory: Map<string, Map<string, number>>,
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
  return picked;
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
  tbillTicker: string | null,
  goldTicker: string | null,
  mcapBookPct: number,
  tbillPct: number,
  goldPct: number,
  date: string,
  ctx: SakaCandidateContext,
  semiOf: (t: string) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  const mw = mcapSleeveWeights(mcapHoldings, date, ctx, semiOf);
  const mcapFrac = mcapBookPct / 100;
  const tbillFrac = tbillPct / 100;
  const goldFrac = goldPct / 100;
  for (const [t, w] of Object.entries(mw)) out[t] = w * mcapFrac;
  if (tbillTicker && tbillFrac > 0) out[tbillTicker] = (out[tbillTicker] ?? 0) + tbillFrac;
  if (goldTicker && goldFrac > 0) out[goldTicker] = (out[goldTicker] ?? 0) + goldFrac;
  return out;
}

function loadVariantsFromPrereg(preregText: string): TbillVariant[] {
  const variants: TbillVariant[] = [];
  for (const line of preregText.split("\n")) {
    const tableMatch = line.match(
      /^\|\s*`(tbill_[^`]+)`\s*\|\s*(\d+)\s*\|\s*([A-Z]+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/,
    );
    if (tableMatch) {
      variants.push({
        id: tableMatch[1]!,
        megaMax: Number(tableMatch[2]),
        tbillEtf: tableMatch[3]!,
        mcapPct: Number(tableMatch[4]),
        tbillPct: Number(tableMatch[5]),
        goldPct: Number(tableMatch[6]),
      });
    }
  }
  if (!variants.some((v) => v.id === "tbill_K2_SGOV20_G5")) {
    const sgovLine = preregText.match(/`(tbill_K2_SGOV20_G5)`/);
    if (sgovLine) {
      variants.push({
        id: "tbill_K2_SGOV20_G5",
        megaMax: 2,
        tbillEtf: "SGOV",
        mcapPct: 75,
        tbillPct: 20,
        goldPct: 5,
      });
    }
  }
  if (!variants.some((v) => v.id === "ref_IEF20_G5")) {
    if (preregText.includes("ref_IEF20_G5")) {
      variants.push({
        id: "ref_IEF20_G5",
        megaMax: 2,
        tbillEtf: "IEF",
        mcapPct: 75,
        tbillPct: 20,
        goldPct: 5,
        refOnly: true,
      });
    }
  }
  return variants;
}

async function ensureEtf(barsBy: Map<string, Bar[]>, sym: string): Promise<{ ok: boolean; note: string }> {
  const cached = loadPitBars(sym, PIT_CACHE);
  if (cached.length) {
    barsBy.set(sym, cached);
    return { ok: true, note: "PIT cache" };
  }
  try {
    const { bars } = await fetchDailyBars(sym, { range: "20y", keep: 3200, totalReturn: true });
    if (bars.length) {
      barsBy.set(sym, bars);
      return { ok: true, note: "Yahoo adjclose (runtime `.cache`)" };
    }
  } catch {
    /* unavailable */
  }
  return { ok: false, note: "取得不能（本 run では当該 variant 未計算）" };
}

async function ensureGold(barsBy: Map<string, Bar[]>): Promise<{ ticker: string | null; note: string }> {
  for (const sym of ["GLD", "IAU"]) {
    const r = await ensureEtf(barsBy, sym);
    if (r.ok) {
      return {
        ticker: sym,
        note: sym === "GLD" ? r.note : `fallback IAU (${r.note})`,
      };
    }
  }
  return { ticker: null, note: "GLD/IAU 取得不能" };
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
  tbillEtf?: string;
  quoted?: boolean;
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
  tbillEtf?: string,
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
    if (d === "2026-10-01") {
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
    tbillEtf,
  };
}

function runStatsRow(r: RunStats, suffix = ""): string {
  const tag = r.quoted ? "（引用）" : suffix;
  return `| ${r.id}${tag} | ${pct(r.totalReturn)} | ${pct(r.cagr)} | ${pct(r.maxDd)} | ${pct(r.principalMedian)} | ${pct(r.principalP10)} | ${(r.materialPct * 100).toFixed(0)}% | ${(r.aiAvg * 100).toFixed(1)}% | ${(r.ai2026 * 100).toFixed(1)}% | ${(r.semiAvg * 100).toFixed(1)}% | ${(r.semi2026 * 100).toFixed(1)}% |`;
}

async function main() {
  const t0 = Date.now();
  const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const preregText = fs.readFileSync(PREREG_PATH, "utf8");
  const variants = loadVariantsFromPrereg(preregText);
  if (!variants.length) throw new Error("no tbill variants parsed from prereg");

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

  const goldInfo = await ensureGold(barsBy);
  const etfNotes = new Map<string, string>();
  const etfOk = new Map<string, boolean>();
  for (const sym of ["SHY", "SGOV", "IEF"]) {
    const r = await ensureEtf(barsBy, sym);
    etfNotes.set(sym, r.note);
    etfOk.set(sym, r.ok);
  }

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

  const books = new Map<string, Map<string, Record<string, number>>>();
  books.set("plain_15__mcap", new Map());
  const simVariants = variants.filter((v) => {
    const tbillOk = etfOk.get(v.tbillEtf) === true;
    const goldOk = v.goldPct === 0 || goldInfo.ticker != null;
    return tbillOk && goldOk;
  });
  for (const v of simVariants) books.set(v.id, new Map());

  console.log("building books…");
  for (const date of rebals) {
    const eligible = filterEligibleCandidates(membersOn(date), date, ctx);
    const baseHold = pickHoldings(BASELINE, eligible, date, ctx);
    const baseW = targetWeights(BASELINE, baseHold, date, ctx, semiOf);
    books.get("plain_15__mcap")!.set(date, baseW);

    for (const v of simVariants) {
      const mcapH = pickMcapSleeve(eligible, date, ctx, v.megaMax, false, calendar, ctx.closeHistory);
      const w = combineBook(
        mcapH,
        v.tbillEtf,
        v.goldPct > 0 ? goldInfo.ticker : null,
        v.mcapPct,
        v.tbillPct,
        v.goldPct,
        date,
        ctx,
        semiOf,
      );
      books.get(v.id)!.set(date, w);
    }
    console.log(`  ${date}`);
  }

  const aligned = rebals[0]!;
  const runs: RunStats[] = [];
  runs.push(
    evaluateRun(
      "plain_15__mcap",
      books.get("plain_15__mcap")!,
      calendar,
      rebals,
      rebalSet,
      aligned,
      price,
      handoffSuccessor,
      semiOf,
      null,
    ),
  );
  for (const v of simVariants) {
    runs.push(
      evaluateRun(
        v.id,
        books.get(v.id)!,
        calendar,
        rebals,
        rebalSet,
        aligned,
        price,
        handoffSuccessor,
        semiOf,
        goldInfo.ticker,
        v.tbillEtf,
      ),
    );
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

  const tbillCandidates = runs.filter((r) => r.id !== "plain_15__mcap" && !r.id.startsWith("ref_"));
  const winners = tbillCandidates.filter(primaryOk);
  winners.sort((a, b) => {
    if (b.totalReturn !== a.totalReturn) return b.totalReturn - a.totalReturn;
    if (a.ai2026 !== b.ai2026) return a.ai2026 - b.ai2026;
    const aK1 = a.id.includes("_K1_") ? 0 : 1;
    const bK1 = b.id.includes("_K1_") ? 0 : 1;
    return aK1 - bK1;
  });
  const winner = winners[0];

  const shy20K2 = runs.find((r) => r.id === "tbill_K2_SHY20_G5");
  const sgov20K2 = runs.find((r) => r.id === "tbill_K2_SGOV20_G5");
  let shySgovNote =
    "**SHY vs SGOV:** 代表ペア `tbill_K2_SHY20_G5` と `tbill_K2_SGOV20_G5`（いずれも mcap 75 / T-bill 20 / GLD 5）。";
  if (shy20K2 && sgov20K2) {
    shySgovNote += ` 総リターン ${pct(shy20K2.totalReturn)} vs ${pct(sgov20K2.totalReturn)}、元本中央 ${pct(shy20K2.principalMedian)} vs ${pct(sgov20K2.principalMedian)}、材料割れ ${(shy20K2.materialPct * 100).toFixed(0)}% vs ${(sgov20K2.materialPct * 100).toFixed(0)}%。`;
  } else if (!etfOk.get("SGOV")) {
    shySgovNote += " **SGOV 価格系列が取得できず** `tbill_K2_SGOV20_G5` は未計算 — doc に明記。";
  } else if (!shy20K2 || !sgov20K2) {
    shySgovNote += " いずれかの variant がデータ不足で未計算。";
  }

  const divGoldQuoted: RunStats = {
    ...DIV_GOLD_K2_KEEP_QUOTED,
    goldTicker: "GLD",
    quoted: true,
  };

  const skipped = variants.filter((v) => !simVariants.some((s) => s.id === v.id));
  const variantGridLines = variants.map(
    (v) =>
      `| \`${v.id}\` | ${v.megaMax} | ${v.tbillEtf} | ${v.mcapPct} | ${v.tbillPct} | ${v.goldPct} | ${v.refOnly ? "参考のみ" : ""} |`,
  );

  const md = [
    "# Round 19 v1 mcap + 短期国債 ETF + 金 — 結果",
    "",
    `**Prereg:** [\`${PREREG}\`](ROUND19_V1_TBILL_GOLD_PREREG_ja.md)`,
    `**生成:** \`scripts/round19-v1-tbill-gold-sleeve.ts\` · **HEAD** \`${head.slice(0, 7)}\``,
    `**金 ETF:** ${goldInfo.note}${goldInfo.ticker ? ` (\`${goldInfo.ticker}\`)` : ""}`,
    "",
    "## データ取得（T-bill / 金）",
    "",
    "| ETF | ソース |",
    "|---|---|",
    ...["SHY", "SGOV", "IEF"].map((sym) => `| ${sym} | ${etfNotes.get(sym) ?? "—"} |`),
    `| 金 | ${goldInfo.note}${goldInfo.ticker ? ` (\`${goldInfo.ticker}\`)` : ""} |`,
    "",
    "## Prereg variant grid（読み取り）",
    "",
    "| ID | K | T-bill | Mcap % | T-bill % | GLD % | 備考 |",
    "|---|---:|---|---:|---:|---:|---|",
    ...variantGridLines,
    "",
    skipped.length
      ? `**未計算 variant:** ${skipped.map((v) => `\`${v.id}\``).join(", ")}（ETF 系列不足）`
      : "**未計算 variant:** なし",
    "",
    "## サマリー（vs ベースライン `plain_15__mcap`）",
    "",
    winner
      ? `**Prereg Primary を満たした先頭 tbill variant:** \`${winner.id}\`（総リターン ${pct(winner.totalReturn)}、材料割れ率 ${(winner.materialPct * 100).toFixed(0)}%、2026 AI ${(winner.ai2026 * 100).toFixed(1)}%）`
      : "**Prereg Primary を満たす tbill variant なし** — 下表参照（判定は prereg §6–7、divGold 参照行は採用対象外）。",
    "",
    shySgovNote,
    "",
    "**IEF 参考行:** `ref_IEF20_G5` は中期国債（Emma 非優先）の **採用判定外** 参考。Primary 勝者選定から除外。",
    "",
    `**divGold 参照（再計算なし）:** \`divGold_K2_keep\` の数値は [\`${DIV_GOLD_RESULTS}\`](ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md) から引用（総リターン +558.5%、元本中央 −5.1%、材料割れ 77%、AI 2026 65.7%）。`,
    "",
    "## Primary 判定（prereg §6–7 · divGold prereg §7 同型）",
    "",
    "| 条件 | baseline | 最良 tbill（Primary 内） | divGold_K2_keep（引用） |",
    "|---|---:|---:|---:|",
    `| 材料割れ率 | ${(baseline.materialPct * 100).toFixed(0)}% | ${winner ? `${(winner.materialPct * 100).toFixed(0)}% (\`${winner.id}\`)` : "—"} | ${(divGoldQuoted.materialPct * 100).toFixed(0)}% |`,
    `| 元本最深中央 | ${pct(baseline.principalMedian)} | ${winner ? pct(winner.principalMedian) : "—"} | ${pct(divGoldQuoted.principalMedian)} |`,
    `| 総リターン | ${pct(baseline.totalReturn)} | ${winner ? pct(winner.totalReturn) : "—"} | ${pct(divGoldQuoted.totalReturn)} |`,
    "",
    "## 指標一覧",
    "",
    "| ID | 総リターン | CAGR | MaxDD | 元本最深中央 | 元本最深10% | 材料割れ率 | AI平均 | AI 2026 | Semi平均 | Semi 2026 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...runs.map((r) => runStatsRow(r)),
    runStatsRow(divGoldQuoted),
    `| SPY | ${pct(spyRet)} | ${pct(spyM.cagr)} | ${pct(spyM.maxDrawdown)} | — | — | — | — | — | — | — |`,
    "",
    "## Mega-tech K=1 vs K=2（SHY grid）",
    "",
    "| ウェイト | K1 TR | K2 TR | K1 元本中央 | K2 元本中央 | K1 材料割れ | K2 材料割れ | K1 AI 2026 | K2 AI 2026 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...(["SHY20_G5", "SHY25_G0", "SHY15_G5"] as const).map((suffix) => {
      const k1 = runs.find((r) => r.id === `tbill_K1_${suffix}`);
      const k2 = runs.find((r) => r.id === `tbill_K2_${suffix}`);
      if (!k1 || !k2) return `| ${suffix} | — | — | — | — | — | — | — | — |`;
      return `| ${suffix} | ${pct(k1.totalReturn)} | ${pct(k2.totalReturn)} | ${pct(k1.principalMedian)} | ${pct(k2.principalMedian)} | ${(k1.materialPct * 100).toFixed(0)}% | ${(k2.materialPct * 100).toFixed(0)}% | ${(k1.ai2026 * 100).toFixed(1)}% | ${(k2.ai2026 * 100).toFixed(1)}% |`;
    }),
    "",
    "## 備考",
    "",
    "- Mcap スリーブ: PIT 比例 → `applySemiCap` 30% → prereg の Mcap % を乗算。**semiThin=off 固定。**",
    "- 総リターンは PIT/Yahoo **adjclose 系**（配当込み調整）+ ETF は実行時 `.cache` のみ（git 非コミット）。",
    "- 元本ストレスは prereg どおり月初開始・四半期 PIT ブック固定。",
    "- ベースラインとの差分採否は Primary/Secondary（総リターン ≥ baseline − 2.0%pt 必須）。",
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
