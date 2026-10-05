/**
 * Snapshot divGold K1/K2 thin books on one rebalance date.
 *   NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/round19-v1-div-gold-holdings-snapshot.ts
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  SAKA_CONFIGS,
  SAKA_CORR_LOOKBACK,
  SAKA_CORR_MIN_OBS,
  SAKA_END,
  SAKA_START,
  applySemiCap,
  filterEligibleCandidates,
  isSemiSubIndustry,
  profitabilityStatus,
  rebalanceDates,
  tradingDaysFromBars,
  trailingLogReturnSeries,
  type ProfitabilityStatus,
  type SakaCandidateContext,
} from "../src/lib/round19-saka";
import { pearson } from "../src/lib/corr";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { buildPitFactsIndex, loadMergedPitFacts } from "../src/lib/pit-facts-index";
import { pitMarketCapAtDate } from "../src/lib/pit-mcap";
import { mcapCloseOnOrBefore } from "../src/lib/pit-mcap-price";
import { loadPitSplits, type PitSplit } from "../src/lib/pit-splits";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "../src/lib/pit-dataset";
import { loadSp500PitFiles, membersOnDate, uniqueTickersInRange } from "../src/lib/sp500-pit";
import { fetchDailyBars } from "../src/lib/yahoo";
import type { Bar } from "../src/lib/types";

const DATE = "2026-10-01";
const OUT = path.join(process.cwd(), "docs", "ROUND19_V1_DIV_GOLD_HOLDINGS_2026-10-01_ja.md");
const MCAP_N = 11;
const DIV_N = 4;
const W_MCAP = 0.75;
const W_DIV = 0.2;
const W_GOLD = 0.05;
const DIV_MIN_MCAP = 30e9;
const SEMI_QUAD = ["NVDA", "AVGO", "AMD", "MU"] as const;
const MEGA_TRIPLE = ["GOOGL", "MSFT", "META"] as const;

type DivEvent = { date: string; amount: number };

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

function quadCorrHigh(
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  date: string,
  present: string[],
): boolean {
  const series = new Map<string, ReturnType<typeof trailingLogReturnSeries>>();
  for (const t of SEMI_QUAD) {
    const hist = closeHistory.get(t);
    if (!hist || !present.includes(t)) continue;
    series.set(t, trailingLogReturnSeries(calendar, hist, date, SAKA_CORR_LOOKBACK));
  }
  const rhos: number[] = [];
  let highPairs = 0;
  for (let i = 0; i < SEMI_QUAD.length; i += 1) {
    for (let j = i + 1; j < SEMI_QUAD.length; j += 1) {
      const a = SEMI_QUAD[i]!;
      const b = SEMI_QUAD[j]!;
      const sa = series.get(a);
      const sb = series.get(b);
      if (!sa || !sb) continue;
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
      if (rho != null && present.includes(a) && present.includes(b)) {
        rhos.push(rho);
        if (rho >= 0.65) highPairs += 1;
      }
    }
  }
  const avg = rhos.length ? rhos.reduce((s, x) => s + x, 0) / rhos.length : 0;
  return highPairs >= 3 || avg >= 0.7;
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
    if (!quadCorrHigh(calendar, closeHistory, date, present)) break;
    const weakest = [...present].sort((a, b) => ctx.mcap(a, date) - ctx.mcap(b, date))[0];
    if (!weakest) break;
    pool = pool.filter((t) => t !== weakest);
    pool = fillMcapFromScored(scored, pool, megaMax);
  }
  return pool;
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
    /* fall through */
  }
  cache.set(ticker, []);
  return [];
}

function trailingDivYield(events: DivEvent[], date: string, px: number): number {
  if (!(px > 0)) return 0;
  const end = Date.parse(`${date}T12:00:00Z`);
  const start = end - 365 * 86_400_000;
  let sum = 0;
  for (const e of events) {
    const t = Date.parse(`${e.date}T12:00:00Z`);
    if (t > start && t <= end) sum += e.amount;
  }
  return sum / px;
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

function combineBook(
  mcapHoldings: string[],
  divHoldings: string[],
  goldTicker: string | null,
  date: string,
  ctx: SakaCandidateContext,
  semiOf: (t: string) => boolean,
): Record<string, number> {
  const raw: Record<string, number> = {};
  let sum = 0;
  for (const t of mcapHoldings) {
    const m = ctx.mcap(t, date);
    if (m > 0) {
      raw[t] = m;
      sum += m;
    }
  }
  if (sum > 0) for (const t of Object.keys(raw)) raw[t] /= sum;
  const mw = applySemiCap(raw, semiOf);
  const out: Record<string, number> = {};
  for (const [t, w] of Object.entries(mw)) out[t] = w * W_MCAP;
  if (divHoldings.length) {
    const each = W_DIV / divHoldings.length;
    for (const t of divHoldings) out[t] = (out[t] ?? 0) + each;
  }
  if (goldTicker) out[goldTicker] = (out[goldTicker] ?? 0) + W_GOLD;
  return out;
}

async function ensureGold(barsBy: Map<string, Bar[]>): Promise<string | null> {
  for (const sym of ["GLD", "IAU"]) {
    const c = loadPitBars(sym, PIT_CACHE);
    if (c.length) {
      barsBy.set(sym, c);
      return sym;
    }
    try {
      const { bars } = await fetchDailyBars(sym, { range: "20y", keep: 3200, totalReturn: true });
      if (bars.length) {
        barsBy.set(sym, bars);
        return sym;
      }
    } catch {
      /* next */
    }
  }
  return null;
}

type Row = { t: string; sleeve: string; pct: number };

function buildRows(
  weights: Record<string, number>,
  mcapSet: Set<string>,
  divSet: Set<string>,
  gold: string | null,
): Row[] {
  return Object.entries(weights)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, w]) => {
      let sleeve = "時価総額枠";
      if (gold && t === gold) sleeve = "金";
      else if (divSet.has(t)) sleeve = "高配当";
      else if (mcapSet.has(t)) sleeve = "時価総額枠";
      return { t, sleeve, pct: w * 100 };
    });
}

function megaInMcap(mcap: string[]): string {
  const s = new Set(mcap.map(normalizeMega));
  const hit = MEGA_TRIPLE.filter((m) => s.has(m));
  return hit.length ? hit.join(", ") : "なし";
}

async function main() {
  const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
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
  if (!rebals.includes(DATE)) throw new Error(`date ${DATE} not a rebalance`);
  const gold = await ensureGold(barsBy);
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
      if (hit) return hit === "profitable";
      const st = profitabilityStatus(factFor(t), d);
      profitCache.set(k, st);
      return st === "profitable";
    },
    hasPrice: (t, d) => mcapCloseOnOrBefore(barsBy.get(t) ?? [], d) != null,
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

  const eligible = filterEligibleCandidates(membersOnDate(intervals, DATE), DATE, ctx);
  const divCache = new Map<string, DivEvent[]>();

  const variants = [
    { id: "divGold_K1_thin", megaMax: 1, semiThin: true },
    { id: "divGold_K1_keep", megaMax: 1, semiThin: false },
    { id: "divGold_K2_thin", megaMax: 2, semiThin: true },
    { id: "divGold_K2_keep", megaMax: 2, semiThin: false },
  ] as const;

  const sections: string[] = [
    "# divGold 保有スナップショット（2026-10-01）",
    "",
    "**リバランス日:** 2026-10-01 · **ブック:** 75% 時価総額枠（11）+ 20% 高配当（4）+ 5% 金（GLD）",
    "**ウェイト:** `combineBook` 後（mcap スリーブ内 `applySemiCap` 30% 込み）",
    `**生成:** \`scripts/round19-v1-div-gold-holdings-snapshot.ts\` · **HEAD** \`${head.slice(0, 7)}\``,
    "**参照 prereg:** `docs/ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md`",
    "",
  ];

  for (const v of variants) {
    const mcapH = pickMcapSleeve(eligible, DATE, ctx, v.megaMax, v.semiThin, calendar, ctx.closeHistory);
    const divH = await pickDivSleeve(eligible, DATE, ctx, new Set(mcapH), divCache, barsBy);
    const weights = combineBook(mcapH, divH, gold, DATE, ctx, semiOf);
    const rows = buildRows(weights, new Set(mcapH), new Set(divH), gold);
    const sum = rows.reduce((s, r) => s + r.pct, 0);
    sections.push(`## ${v.id}`, "");
    sections.push(`**時価総額枠の GOOGL / MSFT / META:** ${megaInMcap(mcapH)}`);
    sections.push(`**mcap 11:** ${mcapH.join(", ")}`);
    sections.push(`**高配当 4:** ${divH.join(", ")} · **金:** ${gold ?? "—"}`);
    sections.push("");
    sections.push("| Ticker | スリーブ | ブック % |");
    sections.push("|---|---|---:|");
    for (const r of rows) sections.push(`| ${r.t} | ${r.sleeve} | ${r.pct.toFixed(2)} |`);
    sections.push("");
    sections.push(`表示合計: **${sum.toFixed(2)}%**`, "");
    console.log(`\n=== ${v.id} === mega: ${megaInMcap(mcapH)}`);
    for (const r of rows) console.log(`${r.t}\t${r.sleeve}\t${r.pct.toFixed(2)}%`);
  }

  fs.writeFileSync(OUT, sections.join("\n"));
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
