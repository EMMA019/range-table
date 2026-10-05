/**
 * Live window scorecard 2026-07-30 → 2026-10-02 (detail §7 aligned).
 *   NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/round19-live-window-scorecard.ts
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  SAKA_CONFIGS,
  SAKA_END,
  SAKA_REBAL_MIN_TRADE_USD,
  SAKA_REBAL_REL_DRIFT,
  SAKA_START,
  applySemiCap,
  applySameCikHandoffTransfers,
  drawdownFromCurve,
  filterEligibleCandidates,
  isSemiSubIndustry,
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

const OUT = path.join(process.cwd(), "docs", "ROUND19_LIVE_WINDOW_2026-07-30_ja.md");
const LIVE_ENTRY = "2026-07-30";
const LIVE_END = "2026-10-02";
const LIVE_BOOT = "2026-07-01";
const LIVE_REBAL = "2026-10-01";
const JPY_START = 463_000;
const FX_ENTRY = 163.3;
const FX_END = 157.93;
const COMMISSION = 0.35;
const BASELINE = SAKA_CONFIGS.find((c) => c.id === "plain_15__mcap")!;
const MCAP_N = 11;
const DIV_N = 4;
const DIV_MIN_MCAP = 30e9;

type BookBuilder = (eligible: string[], date: string, ctx: SakaCandidateContext, semiOf: (t: string) => boolean) => Promise<Record<string, number>> | Record<string, number>;

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

function fillMcap(scored: Array<{ t: string; m: number }>, picked: string[], megaMax: number): string[] {
  const pool = [...picked];
  for (const { t } of scored) {
    if (pool.length >= MCAP_N) break;
    if (pool.includes(t)) continue;
    if (wouldExceedMega(pool, t, megaMax)) continue;
    pool.push(t);
  }
  return pool.slice(0, MCAP_N);
}

function pickMcap(eligible: string[], date: string, ctx: SakaCandidateContext, megaMax: number): string[] {
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
  return fillMcap(scored, picked, megaMax);
}

function mcapWeights(holdings: string[], date: string, ctx: SakaCandidateContext, semiOf: (t: string) => boolean): Record<string, number> {
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

async function ensureBars(barsBy: Map<string, Bar[]>, sym: string): Promise<boolean> {
  if (barsBy.get(sym)?.length) return true;
  const pit = loadPitBars(sym, PIT_CACHE);
  if (pit.length) {
    barsBy.set(sym, pit);
    return true;
  }
  try {
    const { bars } = await fetchDailyBars(sym.replace(/\./g, "-"), { range: "5y", keep: 800, totalReturn: true });
    if (bars.length) {
      barsBy.set(sym, bars);
      return true;
    }
  } catch {
    /* */
  }
  return false;
}

type DivEvent = { date: string; amount: number };
const divCache = new Map<string, DivEvent[]>();

async function divEvents(ticker: string): Promise<DivEvent[]> {
  if (divCache.has(ticker)) return divCache.get(ticker)!;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.replace(/\./g, "-"))}?range=10y&interval=1d&events=div`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const json = (await res.json()) as {
      chart?: { result?: Array<{ events?: { dividends?: Record<string, { amount?: number }> } }> };
    };
    const divs = json.chart?.result?.[0]?.events?.dividends ?? {};
    const events: DivEvent[] = [];
    for (const [ts, row] of Object.entries(divs)) {
      if (row.amount == null) continue;
      events.push({ date: new Date(Number(ts) * 1000).toISOString().slice(0, 10), amount: row.amount });
    }
    divCache.set(ticker, events);
    return events;
  } catch {
    divCache.set(ticker, []);
    return [];
  }
}

async function pickDiv(
  eligible: string[],
  date: string,
  ctx: SakaCandidateContext,
  exclude: Set<string>,
  barsBy: Map<string, Bar[]>,
): Promise<string[]> {
  const cands = eligible
    .filter((t) => !exclude.has(t))
    .map((t) => ({ t, m: ctx.mcap(t, date) }))
    .filter((r) => r.m >= DIV_MIN_MCAP)
    .sort((a, b) => b.m - a.m)
    .slice(0, 25);
  const ranked: Array<{ t: string; y: number }> = [];
  for (const { t } of cands) {
    const bars = barsBy.get(t) ?? [];
    const px = mcapCloseOnOrBefore(bars, date) ?? closeOnOrBefore(bars, date) ?? 0;
    const ev = await divEvents(t);
    let sum = 0;
    const end = Date.parse(`${date}T12:00:00Z`);
    const start = end - 365 * 86_400_000;
    for (const e of ev) {
      const tt = Date.parse(`${e.date}T12:00:00Z`);
      if (tt > start && tt <= end) sum += e.amount;
    }
    ranked.push({ t, y: px > 0 ? sum / px : 0 });
  }
  ranked.sort((a, b) => b.y - a.y || a.t.localeCompare(b.t));
  return ranked.slice(0, DIV_N).map((r) => r.t);
}

function combineDivGold(
  mcapH: string[],
  divH: string[],
  gold: string | null,
  date: string,
  ctx: SakaCandidateContext,
  semiOf: (t: string) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  const mw = mcapWeights(mcapH, date, ctx, semiOf);
  for (const [t, w] of Object.entries(mw)) out[t] = w * 0.75;
  const each = 0.2 / divH.length;
  for (const t of divH) out[t] = (out[t] ?? 0) + each;
  if (gold) out[gold] = (out[gold] ?? 0) + 0.05;
  return out;
}

function combineTbill(
  mcapH: string[],
  tbill: string,
  gold: string | null,
  mcapPct: number,
  tbillPct: number,
  goldPct: number,
  date: string,
  ctx: SakaCandidateContext,
  semiOf: (t: string) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  const mw = mcapWeights(mcapH, date, ctx, semiOf);
  for (const [t, w] of Object.entries(mw)) out[t] = w * mcapPct;
  out[tbill] = tbillPct;
  if (gold && goldPct > 0) out[gold] = goldPct;
  return out;
}

function simulateDelta(
  calendar: string[],
  from: string,
  to: string,
  rebalSet: Set<string>,
  bootstrapPit: string,
  bookOf: (d: string) => Record<string, number>,
  price: (t: string, d: string) => number | null,
  initialUsd: number,
  handoffSuccessor?: (fromTicker: string, pitDate: string) => string | null,
): SakaEquityPoint[] {
  let cash = initialUsd;
  let bootstrapped = false;
  const shares: Record<string, number> = {};
  const lastPrice: Record<string, number> = {};
  const curve: SakaEquityPoint[] = [];
  const equityOn = (date: string) => {
    let eq = cash;
    for (const [t, sh] of Object.entries(shares)) {
      eq += sh * (price(t, date) ?? lastPrice[t] ?? 0);
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
    const bootstrapToday = !bootstrapped;
    if (scheduled || bootstrapToday) {
      const pitDate = scheduled ? date : bootstrapPit;
      if (bootstrapToday) bootstrapped = true;
      const weights = bookOf(pitDate);
      if (handoffSuccessor) applySameCikHandoffTransfers(shares, weights, pitDate, price, lastPrice, handoffSuccessor);
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
          if (Math.abs(delta) < SAKA_REBAL_MIN_TRADE_USD && rel < SAKA_REBAL_REL_DRIFT) continue;
        }
        if (delta < -SAKA_REBAL_MIN_TRADE_USD / 2) {
          const sellUsd = Math.min(-delta, curUsd);
          const sellSh = sellUsd / p;
          if (sellSh > 0 && sellSh <= shares[t]) {
            shares[t] -= sellSh;
            cash += sellUsd - COMMISSION;
            if (shares[t] <= 1e-9) delete shares[t];
          }
        } else if (delta > SAKA_REBAL_MIN_TRADE_USD / 2) {
          const cost = delta + COMMISSION;
          if (cost <= cash) {
            cash -= cost;
            shares[t] = (shares[t] ?? 0) + delta / p;
            lastPrice[t] = p;
          }
        } else if (!had && targetUsd >= SAKA_REBAL_MIN_TRADE_USD / 2) {
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

async function loadFxBars(): Promise<Bar[]> {
  const cache = path.join(PIT_CACHE, "prices", "JPY-X.json");
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8")) as Bar[];
  const { bars } = await fetchDailyBars("JPY=X", { range: "5y", keep: 1500, totalReturn: false, applySplitAdjustment: false });
  if (bars.length) {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(bars));
  }
  return bars;
}

const FX_OVERRIDES_PATH = path.join(process.cwd(), "data", "pit_fx_overrides.json");

function loadFxOverrides(): Record<string, number> {
  if (!fs.existsSync(FX_OVERRIDES_PATH)) return {};
  const raw = JSON.parse(fs.readFileSync(FX_OVERRIDES_PATH, "utf8")) as { USDJPY?: Record<string, number> };
  return raw.USDJPY ?? {};
}

function fxOn(fxBars: Bar[], date: string): number | null {
  const overrides = loadFxOverrides();
  const o = overrides[date];
  if (o != null && o > 0) return o;
  const exact = fxBars.find((b) => b.date === date);
  if (exact) {
    const px = exact.mcapC ?? exact.c;
    return px > 0 ? px : null;
  }
  return closeOnOrBefore(fxBars, date);
}

function jpyCurve(usd: SakaEquityPoint[], fxBars: Bar[]): SakaEquityPoint[] {
  return usd.map((p) => {
    const fx = fxOn(fxBars, p.date);
    return { date: p.date, equity: fx != null ? p.equity * fx : p.equity };
  });
}

function loadBenchBars(sym: string): Bar[] {
  const pit = loadPitBars(sym, PIT_CACHE);
  if (pit.length) return pit;
  for (const dir of ["round19", "round19v2"].map((d) => path.join(process.cwd(), "data", ".cache", d))) {
    const f = path.join(dir, `${sym.replace(/\./g, "-")}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")) as Bar[];
  }
  return [];
}

async function loadBenchBarsAsync(sym: string): Promise<Bar[]> {
  const hit = loadBenchBars(sym);
  if (hit.length) return hit;
  try {
    const { bars } = await fetchDailyBars(sym, { range: "2y", keep: 600, totalReturn: true });
    return bars;
  } catch {
    return [];
  }
}

function periodRet(curve: SakaEquityPoint[], from: string, to: string): number | null {
  const s = curve.filter((p) => p.date >= from && p.date <= to);
  if (s.length < 2) return null;
  const a = s[0]!.equity;
  const b = s[s.length - 1]!.equity;
  return a > 0 ? b / a - 1 : null;
}

function benchCurve(bars: Bar[], from: string, to: string, initialUsd: number): SakaEquityPoint[] {
  const slice = bars.filter((b) => b.date >= from && b.date <= to);
  if (slice.length < 2) return [];
  const p0 = slice[0]!.c;
  return slice.map((b) => ({ date: b.date, equity: initialUsd * (b.c / p0) }));
}

function pct(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(2)}%`;
}

async function main() {
  const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const initialUsd = JPY_START / FX_ENTRY;
  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const overrides = loadPitCikOverrides().cik;
  const cikResolved = await buildPitCikMapForTickers(PIT_CACHE, gics, tickers, overrides);
  const cikMap = new Map([...cikResolved.entries()].map(([t, r]) => [t, r.cik]));
  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const factBy = new Map<string, unknown | undefined>();
  const factFor = (t: string) => {
    if (factBy.has(t)) return factBy.get(t);
    const j = loadMergedPitFacts(t, cikMap.get(t) ?? null, factsIndex, PIT_CACHE);
    factBy.set(t, j);
    return j;
  };
  const profitCache = new Map<string, ProfitabilityStatus>();
  const barsBy = new Map<string, Bar[]>();
  const splitsBy = new Map<string, PitSplit[]>();
  for (const t of tickers) {
    const b = loadPitBars(t, PIT_CACHE);
    if (b.length) barsBy.set(t, b);
    splitsBy.set(t, loadPitSplits(t, PIT_CACHE));
  }
  const spyBars = loadPitBars("SPY", PIT_CACHE);
  const calendar = tradingDaysFromBars(spyBars);
  await ensureBars(barsBy, "GLD");
  await ensureBars(barsBy, "SHY");
  const gold = barsBy.has("GLD") ? "GLD" : null;
  const shyOk = await ensureBars(barsBy, "SHY");
  const price = (t: string, d: string) => closeOnOrBefore(barsBy.get(t) ?? (t === "SPY" ? spyBars : []), d);
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
      if (mcapCache.has(k)) return mcapCache.get(k)!;
      const v = pitMarketCapAtDate(barsBy.get(t) ?? [], factFor(t), d, splitsBy.get(t) ?? []);
      mcapCache.set(k, v);
      return v;
    },
    sharesLookup: () => ({ shares: 0, stale: true }),
    profitable: (t, d) => {
      const k = `${t}|${d}`;
      if (profitCache.has(k)) return profitCache.get(k)!;
      const st = profitabilityStatus(factFor(t), d);
      profitCache.set(k, st);
      return st === "profitable";
    },
    hasPrice: (t, d) => mcapCloseOnOrBefore(barsBy.get(t) ?? [], d) != null,
    cikOf: (t) => cikMap.get(t) ?? null,
  };
  const semiOf = (t: string) => ctx.gicsOf(t)?.semiBucket ?? false;
  const handoff = buildSameCikHandoffResolver(intervals, (t) => cikMap.get(t) ?? null);
  const membersOn = (d: string) => membersOnDate(intervals, d);
  const rebalSet = new Set(rebalanceDates(calendar, SAKA_START, SAKA_END));

  async function bookAt(id: string, date: string): Promise<Record<string, number>> {
    const eligible = filterEligibleCandidates(membersOn(date), date, ctx);
    if (id === "plain_15__mcap") {
      const h = pickHoldings(BASELINE, eligible, date, ctx);
      return targetWeights(BASELINE, h, date, ctx, semiOf);
    }
    if (id.startsWith("divGold_K1")) {
      const m = pickMcap(eligible, date, ctx, 1);
      const d = await pickDiv(eligible, date, ctx, new Set(m), barsBy);
      return combineDivGold(m, d, gold, date, ctx, semiOf);
    }
    if (id.startsWith("divGold_K2")) {
      const m = pickMcap(eligible, date, ctx, 2);
      const d = await pickDiv(eligible, date, ctx, new Set(m), barsBy);
      return combineDivGold(m, d, gold, date, ctx, semiOf);
    }
    if (id === "tbill_K2_SHY20_G5") {
      if (!shyOk) return {};
      const m = pickMcap(eligible, date, ctx, 2);
      return combineTbill(m, "SHY", gold, 0.75, 0.2, 0.05, date, ctx, semiOf);
    }
    return {};
  }

  const bookCache = new Map<string, Record<string, number>>();
  const bookOf = (d: string) => bookCache.get(d) ?? {};

  const configs = ["plain_15__mcap", "divGold_K1_keep", "divGold_K2_keep", "tbill_K2_SHY20_G5"] as const;
  for (const id of configs) {
    for (const d of [LIVE_BOOT, LIVE_REBAL]) {
      bookCache.set(`${id}|${d}`, await bookAt(id, d));
    }
  }

  const bookOfFor = (id: string) => (d: string) => bookCache.get(`${id}|${d}`) ?? {};

  const fxBars = await loadFxBars();
  const fxEntryActual = fxOn(fxBars, LIVE_ENTRY);
  const fxEndActual = fxOn(fxBars, LIVE_END);

  type Row = { id: string; usdRet: number | null; jpyRet: number | null; usdDd: number; jpyDd: number };
  const rows: Row[] = [];

  for (const id of configs) {
    const wBoot = bookCache.get(`${id}|${LIVE_BOOT}`);
    if (!wBoot || !Object.keys(wBoot).length) {
      rows.push({ id, usdRet: null, jpyRet: null, usdDd: 0, jpyDd: 0 });
      continue;
    }
    const curve = simulateDelta(
      calendar,
      LIVE_ENTRY,
      LIVE_END,
      rebalSet,
      LIVE_BOOT,
      bookOfFor(id),
      price,
      initialUsd,
      handoff,
    );
    const jpy = jpyCurve(curve, fxBars);
    rows.push({
      id,
      usdRet: periodRet(curve, LIVE_ENTRY, LIVE_END),
      jpyRet: periodRet(jpy, LIVE_ENTRY, LIVE_END),
      usdDd: drawdownFromCurve(curve, LIVE_ENTRY, LIVE_END).maxDd,
      jpyDd: drawdownFromCurve(jpy, LIVE_ENTRY, LIVE_END).maxDd,
    });
  }

  for (const sym of ["SPY", "QQQ"] as const) {
    const bars = sym === "QQQ" ? await loadBenchBarsAsync(sym) : loadBenchBars(sym);
    if (!bars.length) {
      rows.push({ id: sym, usdRet: null, jpyRet: null, usdDd: 0, jpyDd: 0 });
      continue;
    }
    const c = benchCurve(bars, LIVE_ENTRY, LIVE_END, initialUsd);
    const j = jpyCurve(c, fxBars);
    rows.push({
      id: sym,
      usdRet: periodRet(c, LIVE_ENTRY, LIVE_END),
      jpyRet: periodRet(j, LIVE_ENTRY, LIVE_END),
      usdDd: drawdownFromCurve(c, LIVE_ENTRY, LIVE_END).maxDd,
      jpyDd: drawdownFromCurve(j, LIVE_ENTRY, LIVE_END).maxDd,
    });
  }

  const md = [
    "# ライブ窓スコアカード（2026-07-30 ～ 2026-10-02）",
    "",
    "**窓:** 終値ベース（[`ROUND19_V1_DETAIL_ja.md`](ROUND19_V1_DETAIL_ja.md) §7 同型）。",
    `**開始:** ¥${JPY_START.toLocaleString("ja-JP")} → USD **$${initialUsd.toFixed(2)}**（USD/JPY **${FX_ENTRY}**；実データ ${LIVE_ENTRY} 終値 **${fxEntryActual?.toFixed(2) ?? "—"}**）。`,
    `**終端:** ${LIVE_END}（USD/JPY 参照 **${FX_END}**；実データ **${fxEndActual?.toFixed(2) ?? "—"}**）。`,
    `**保有起点:** ${LIVE_BOOT} リバランスブック → ${LIVE_ENTRY} 投入 → **${LIVE_REBAL}** リバランス → ${LIVE_END}。`,
    "**取引:** 差分リバランス $0.35/注文（SPY/QQQ は手数料なし buy&hold）。",
    `**生成:** \`scripts/round19-live-window-scorecard.ts\` · **HEAD** \`${head.slice(0, 7)}\``,
    "",
    "| ID | USD ret | JPY ret | USD MaxDD | JPY MaxDD |",
    "|---|---:|---:|---:|---:|",
    ...rows.map((r) => `| ${r.id} | ${pct(r.usdRet)} | ${pct(r.jpyRet)} | ${pct(r.usdDd)} | ${pct(r.jpyDd)} |`),
    "",
    "**sanity（plain_15__mcap）:** detail §7 目安 USD **+9.45%** / JPY **+5.84%** / MaxDD **−3.13%** / **−4.39%**（post-fix データで多少ずれ得る）。",
    "",
  ].join("\n");

  fs.writeFileSync(OUT, md);
  console.log(md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
