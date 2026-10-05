/**
 * OOS 2021–2026 composition scorecard (see docs/ROUND19_V1_OOS_2021_26_COMPOSITION_ja.md).
 *   NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/round19-v1-oos-composition-scorecard.ts
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  SAKA_CONFIGS,
  SAKA_END,
  SAKA_INITIAL_CASH,
  SAKA_OOS_START,
  SAKA_REBAL_MIN_TRADE_USD,
  SAKA_REBAL_REL_DRIFT,
  SAKA_START,
  applySemiCap,
  applySameCikHandoffTransfers,
  calendarYearReturn,
  drawdownFromCurve,
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

const OUT = path.join(process.cwd(), "docs", "ROUND19_V1_OOS_2021_26_COMPOSITION_ja.md");
const COMMISSION = 0.35;
const PRINCIPAL = SAKA_INITIAL_CASH;
const MATERIAL = 0.01;
const BASELINE = SAKA_CONFIGS.find((c) => c.id === "plain_15__mcap")!;
const MCAP_N = 11;
const DIV_N = 4;
const DIV_MIN_MCAP = 30e9;
const W_MCAP = 0.75;
const W_DIV = 0.2;
const W_GOLD = 0.05;
const OOS_YEARS = [2021, 2022, 2023, 2024, 2025, 2026] as const;

type DivEvent = { date: string; amount: number };

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

function normalizeMega(t: string): string {
  return t === "FB" ? "META" : t;
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

function pickMcapSleeve(eligible: string[], date: string, ctx: SakaCandidateContext, megaMax: number): string[] {
  const scored = eligible
    .map((t) => ({ t, m: ctx.mcap(t, date) }))
    .filter((r) => r.m > 0)
    .sort((a, b) => b.m - a.m || a.t.localeCompare(b.t));
  const picked: string[] = [];
  for (const { t } of scored) {
    if (picked.length >= MCAP_N) break;
    if (wouldExceedMega(picked, t, megaMax)) continue;
    picked.push(t);
  }
  return fillMcapFromScored(scored, picked, megaMax);
}

async function loadDividendEvents(ticker: string, cache: Map<string, DivEvent[]>): Promise<DivEvent[]> {
  const hit = cache.get(ticker);
  if (hit) return hit;
  try {
    for (const host of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
      const url = `${host}/v8/finance/chart/${encodeURIComponent(ticker.replace(/\./g, "-"))}?range=10y&interval=1d&events=div`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        chart?: { result?: Array<{ events?: { dividends?: Record<string, { amount?: number }> } }> };
      };
      const divs = json.chart?.result?.[0]?.events?.dividends ?? {};
      const events: DivEvent[] = [];
      for (const [ts, row] of Object.entries(divs)) {
        if (row.amount == null || !Number.isFinite(row.amount)) continue;
        events.push({ date: new Date(Number(ts) * 1000).toISOString().slice(0, 10), amount: row.amount });
      }
      events.sort((a, b) => a.date.localeCompare(b.date));
      cache.set(ticker, events);
      return events;
    }
  } catch {
    /* */
  }
  cache.set(ticker, []);
  return [];
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

function combineDivGold(
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

function combineTbill(
  mcapHoldings: string[],
  tbillTicker: string,
  goldTicker: string | null,
  date: string,
  ctx: SakaCandidateContext,
  semiOf: (t: string) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  const mw = mcapSleeveWeights(mcapHoldings, date, ctx, semiOf);
  for (const [t, w] of Object.entries(mw)) out[t] = w * 0.75;
  out[tbillTicker] = (out[tbillTicker] ?? 0) + 0.2;
  if (goldTicker) out[goldTicker] = (out[goldTicker] ?? 0) + 0.05;
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

type OosRow = {
  id: string;
  tr: number;
  cagr: number;
  maxDd: number;
  principalMedian: number;
  principalP10: number;
  principalWorst: number;
  underwaterMedian: number;
  posYears: string;
  materialOos: number;
};

function stressOos(
  calendar: string[],
  rebals: string[],
  rebalSet: Set<string>,
  bookOf: (pit: string) => Record<string, number>,
  price: (t: string, d: string) => number | null,
  handoff: ReturnType<typeof buildSameCikHandoffResolver>,
): Omit<OosRow, "id" | "tr" | "cagr" | "maxDd" | "posYears"> & { depths: number[] } {
  const starts = monthStarts(calendar, SAKA_OOS_START, SAKA_END);
  const depths: number[] = [];
  const underwater: number[] = [];
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
      handoff,
    );
    let minEq = Infinity;
    let daysUnder = 0;
    for (const p of c) {
      minEq = Math.min(minEq, p.equity);
      if (p.equity < PRINCIPAL) daysUnder += 1;
    }
    const deepest = minEq / PRINCIPAL - 1;
    depths.push(deepest);
    underwater.push(daysUnder);
    if (deepest < -MATERIAL) materialN += 1;
  }
  return {
    depths,
    principalMedian: quantile(depths, 0.5),
    principalP10: quantile(depths, 0.1),
    principalWorst: depths.length ? Math.min(...depths) : NaN,
    underwaterMedian: quantile(underwater, 0.5),
    materialOos: depths.length ? materialN / depths.length : 0,
  };
}

function posYearLabel(curve: SakaEquityPoint[], calendar: string[]): string {
  const parts: string[] = [];
  let pos = 0;
  let n = 0;
  for (const y of OOS_YEARS) {
    const r = calendarYearReturn(curve, calendar, y, SAKA_END);
    if (r == null) continue;
    n += 1;
    if (r > 0) pos += 1;
    const tag = y === 2026 ? "YTD" : "暦年";
    parts.push(`${y}(${tag})${pct(r)}`);
  }
  return `${pos}/${n}（${parts.join(" · ")}）`;
}

async function ensureEtf(barsBy: Map<string, Bar[]>, sym: string): Promise<boolean> {
  if (loadPitBars(sym, PIT_CACHE).length) {
    barsBy.set(sym, loadPitBars(sym, PIT_CACHE));
    return true;
  }
  try {
    const { bars } = await fetchDailyBars(sym, { range: "20y", keep: 3200, totalReturn: true });
    if (bars.length) {
      barsBy.set(sym, bars);
      return true;
    }
  } catch {
    /* */
  }
  return false;
}

async function main() {
  const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim().slice(0, 7);
  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const overrides = loadPitCikOverrides().cik;
  const cikResolved = await buildPitCikMapForTickers(PIT_CACHE, gics, tickers, overrides);
  const cikMap = new Map([...cikResolved.entries()].map(([t, r]) => [t, r.cik]));
  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const factByTicker = new Map<string, unknown | undefined>();
  const factFor = (t: string) => {
    if (factByTicker.has(t)) return factByTicker.get(t);
    const j = loadMergedPitFacts(t, cikMap.get(t) ?? null, factsIndex, PIT_CACHE);
    factByTicker.set(t, j);
    return j;
  };
  const profitCache = new Map<string, ProfitabilityStatus>();
  const barsBy = new Map<string, Bar[]>();
  const splitsBy = new Map<string, PitSplit[]>();
  for (const t of tickers) {
    const bars = loadPitBars(t, PIT_CACHE);
    if (bars.length) barsBy.set(t, bars);
    splitsBy.set(t, loadPitSplits(t, PIT_CACHE));
  }
  const spyBars = loadPitBars("SPY", PIT_CACHE);
  const calendar = tradingDaysFromBars(spyBars);
  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);
  const rebalSet = new Set(rebals);
  const firstOosRebal = rebals.find((d) => d >= SAKA_OOS_START)!;
  const aligned = rebals[0]!;

  const goldOk = await ensureEtf(barsBy, "GLD");
  if (!goldOk) await ensureEtf(barsBy, "IAU");
  const goldTicker = barsBy.has("GLD") ? "GLD" : barsBy.has("IAU") ? "IAU" : null;
  const shyOk = await ensureEtf(barsBy, "SHY");
  if (!shyOk) throw new Error("SHY bars unavailable");

  const price = (ticker: string, date: string) =>
    closeOnOrBefore(barsBy.get(ticker) ?? (ticker === "SPY" ? spyBars : []), date);
  const mcapCache = new Map<string, number>();
  const ctx: SakaCandidateContext = {
    calendar,
    closeHistory: new Map(),
    gicsOf: (t) => {
      const g = gics.get(t);
      if (!g) return null;
      return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
    },
    mcap: (t, d) => {
      const k = `${t}|${d}`;
      const hit = mcapCache.get(k);
      if (hit != null) return hit;
      const v = pitMarketCapAtDate(barsBy.get(t) ?? [], factFor(t), d, splitsBy.get(t) ?? []);
      mcapCache.set(k, v);
      return v;
    },
    sharesLookup: () => ({ shares: 0, stale: true }),
    profitable: (t, d) => {
      const k = `${t}|${d}`;
      const hit = profitCache.get(k);
      if (hit) return hit;
      const st = profitabilityStatus(factFor(t), d);
      profitCache.set(k, st);
      return st;
    },
    hasPrice: (t, d) => mcapCloseOnOrBefore(barsBy.get(t) ?? [], d) != null,
    cikOf: (t) => cikMap.get(t) ?? null,
  };
  const semiOf = (t: string) => ctx.gicsOf(t)?.semiBucket ?? false;
  const handoff = buildSameCikHandoffResolver(intervals, (t) => cikMap.get(t) ?? null);
  const divCache = new Map<string, DivEvent[]>();

  const bookIds = ["plain_15__mcap", "divGold_K1_keep", "divGold_K2_keep", "tbill_K2_SHY20_G5"] as const;
  const books = new Map<string, Map<string, Record<string, number>>>();
  for (const id of bookIds) books.set(id, new Map());

  console.log("building books…");
  for (const date of rebals) {
    const eligible = filterEligibleCandidates(membersOnDate(intervals, date), date, ctx);
    const plainH = pickHoldings(BASELINE, eligible, date, ctx);
    books.get("plain_15__mcap")!.set(date, targetWeights(BASELINE, plainH, date, ctx, semiOf));

    for (const megaMax of [1, 2] as const) {
      const id = megaMax === 1 ? "divGold_K1_keep" : "divGold_K2_keep";
      const mcapH = pickMcapSleeve(eligible, date, ctx, megaMax);
      const divH = await pickDivSleeve(eligible, date, ctx, new Set(mcapH), divCache, barsBy);
      books.get(id)!.set(date, combineDivGold(mcapH, divH, goldTicker, date, ctx, semiOf));
    }

    const mcapH = pickMcapSleeve(eligible, date, ctx, 2);
    books.get("tbill_K2_SHY20_G5")!.set(
      date,
      combineTbill(mcapH, "SHY", goldTicker, date, ctx, semiOf),
    );
    console.log(`  ${date}`);
  }

  const rows: OosRow[] = [];
  for (const id of [...bookIds, "SPY"] as const) {
    if (id === "SPY") {
      const p0 = price("SPY", SAKA_OOS_START) ?? price("SPY", firstOosRebal)!;
      const spyCurve: SakaEquityPoint[] = [];
      for (const date of calendar) {
        if (date < SAKA_OOS_START || date > SAKA_END) continue;
        const px = price("SPY", date);
        spyCurve.push({ date, equity: px && p0 ? (PRINCIPAL * px) / p0 : PRINCIPAL });
      }
      const m = metricsFromCurve(spyCurve, calendar, SAKA_OOS_START, SAKA_END);
      const slice = spyCurve.filter((p) => p.date >= SAKA_OOS_START);
      const tr = slice.length >= 2 ? slice[slice.length - 1]!.equity / slice[0]!.equity - 1 : 0;
      rows.push({
        id: "SPY",
        tr,
        cagr: m.cagr,
        maxDd: drawdownFromCurve(spyCurve, SAKA_OOS_START, SAKA_END).maxDd,
        principalMedian: NaN,
        principalP10: NaN,
        principalWorst: NaN,
        underwaterMedian: NaN,
        posYears: posYearLabel(spyCurve, calendar),
        materialOos: NaN,
      });
      continue;
    }

    const bookMap = books.get(id)!;
    const bookOf = (pit: string) => bookMap.get(pit) ?? {};
    const curve = simulateDelta(calendar, aligned, SAKA_END, rebalSet, null, bookOf, price, handoff);
    const oosM = metricsFromCurve(curve, calendar, SAKA_OOS_START, SAKA_END);
    const oosSlice = curve.filter((p) => p.date >= SAKA_OOS_START && p.date <= SAKA_END);
    const tr = oosSlice.length >= 2 ? oosSlice[oosSlice.length - 1]!.equity / oosSlice[0]!.equity - 1 : 0;
    const st = stressOos(calendar, rebals, rebalSet, bookOf, price, handoff);
    rows.push({
      id,
      tr,
      cagr: oosM.cagr,
      maxDd: drawdownFromCurve(curve, SAKA_OOS_START, SAKA_END).maxDd,
      principalMedian: st.principalMedian,
      principalP10: st.principalP10,
      principalWorst: st.principalWorst,
      underwaterMedian: st.underwaterMedian,
      posYears: posYearLabel(curve, calendar),
      materialOos: st.materialOos,
    });
  }

  const md = [
    "# Round 19 v1 OOS 構成スコアカード（2021–2026）",
    "",
    "**窓:** Saka OOS — エクイティ評価 **2021-01-01** ～ **2026-10-02**（初回 OOS 四半期リバランス **" + firstOosRebal + "**）。",
    "**取引:** 差分リバランス **$0.35/注文**（SPY は手数料なし B&H）。",
    "**元本ストレス:** 月初開始 × 固定四半期 PIT ブック（RESULTS 同型）を **2021-01 以降の月初のみ**に限定。",
    `**生成:** \`scripts/round19-v1-oos-composition-scorecard.ts\` · **HEAD** \`${head}\``,
    "",
    "## 比較表",
    "",
    "| ID | OOS TR | OOS CAGR | MaxDD | 元本最深中央 | 元本10%ile | 元本最悪 | 水中日数中央 | 暦年プラス |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${pct(r.tr)} | ${pct(r.cagr)} | ${pct(r.maxDd)} | ${pct(r.principalMedian)} | ${pct(r.principalP10)} | ${pct(r.principalWorst)} | ${Number.isFinite(r.underwaterMedian) ? Math.round(r.underwaterMedian) : "—"} | ${r.posYears} |`,
    ),
    "",
    "**暦年:** 2021–2025 は暦年リターン（前年末終値→当年末／2026 は **YTD** ～2026-10-02）。",
    "",
    "**参考（OOS 月初のみ・材料割れ率）:** plain " +
      `${(rows.find((r) => r.id === "plain_15__mcap")!.materialOos * 100).toFixed(0)}%` +
      " · divGold_K1 " +
      `${(rows.find((r) => r.id === "divGold_K1_keep")!.materialOos * 100).toFixed(0)}%` +
      " · divGold_K2 " +
      `${(rows.find((r) => r.id === "divGold_K2_keep")!.materialOos * 100).toFixed(0)}%` +
      " · tbill " +
      `${(rows.find((r) => r.id === "tbill_K2_SHY20_G5")!.materialOos * 100).toFixed(0)}%` +
      "（比較の主軸は深さ・水中期間）。",
    "",
    "## Emma / yuri 向けメモ",
    "",
    "1. **Primary の「TR ≥ plain −2%pt」**は **伸び優先**の採否。全期間 divGold/tbill はここで落ちたが、**減らさない（元本の深さ・水中）優先**なら別の合格軸もあり得る（本表は OOS 窓で再掲）。",
    "2. 開始月の **材料割れ率**は案間で差が小さいことが多い → OOS 比較では **元本最深中央・10%ile・水中日数**を主に見る。",
    "",
    "**データ:** PIT + Yahoo div/ETF（`.cache`）· **main マージなし**",
  ];

  fs.writeFileSync(OUT, md.join("\n"));
  console.log("\n" + md.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
