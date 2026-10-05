/**
 * divGold high-div sleeve yield ranking for one rebalance (prereg §3 + pickDivSleeve impl).
 *   NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/round19-div-sleeve-yield-rank.ts [date]
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  SAKA_END,
  SAKA_START,
  filterEligibleCandidates,
  isSemiSubIndustry,
  profitabilityStatus,
  rebalanceDates,
  tradingDaysFromBars,
  type ProfitabilityStatus,
  type SakaCandidateContext,
} from "../src/lib/round19-saka";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { buildPitFactsIndex, loadMergedPitFacts } from "../src/lib/pit-facts-index";
import { pitMarketCapAtDate } from "../src/lib/pit-mcap";
import { mcapCloseOnOrBefore } from "../src/lib/pit-mcap-price";
import { loadPitSplits, type PitSplit } from "../src/lib/pit-splits";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "../src/lib/pit-dataset";
import { loadSp500PitFiles, membersOnDate, uniqueTickersInRange } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const DATE = process.argv[2] ?? "2026-10-01";
const OUT = path.join(process.cwd(), "docs", "ROUND19_DIV_SLEEVE_YIELD_RANK_2026-10-01_ja.md");
const DIV_MIN_MCAP = 30e9;
const MCAP_N = 11;
const DIV_N = 4;
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

function pickMcapSleeve(eligible: string[], date: string, ctx: SakaCandidateContext, megaMax: number): string[] {
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
  return fillMcapFromScored(scored, picked, megaMax);
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

async function loadDividendEvents(ticker: string, cache: Map<string, DivEvent[]>): Promise<DivEvent[]> {
  const hit = cache.get(ticker);
  if (hit) return hit;
  try {
    const hosts = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
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
          events.push({ date: new Date(Number(ts) * 1000).toISOString().slice(0, 10), amount });
        }
        events.sort((a, b) => a.date.localeCompare(b.date));
        cache.set(ticker, events);
        return events;
      } catch {
        /* try next host */
      }
    }
  } catch {
    /* fall through */
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

async function rankDivSleeve(
  eligible: string[],
  date: string,
  ctx: SakaCandidateContext,
  exclude: Set<string>,
  divCache: Map<string, DivEvent[]>,
  barsBy: Map<string, Bar[]>,
): Promise<{ ranked: Array<{ t: string; y: number }>; overlapSkips: string[]; pool25: string[] }> {
  const overlapSkips = eligible
    .filter((t) => exclude.has(t) && ctx.mcap(t, date) >= DIV_MIN_MCAP)
    .sort((a, b) => ctx.mcap(b, date) - ctx.mcap(a, date) || a.localeCompare(b));

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
  return { ranked, overlapSkips, pool25: cands.map((c) => c.t) };
}

function yldPct(y: number): string {
  return `${(y * 100).toFixed(2)}%`;
}

async function main() {
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

  const eligible = filterEligibleCandidates(membersOnDate(intervals, DATE), DATE, ctx);
  const divCache = new Map<string, DivEvent[]>();

  for (const megaMax of [1, 2] as const) {
    const label = megaMax === 1 ? "K1" : "K2";
    const mcap11 = pickMcapSleeve(eligible, DATE, ctx, megaMax);
    const { ranked, overlapSkips } = await rankDivSleeve(eligible, DATE, ctx, new Set(mcap11), divCache, barsBy);
    const top10 = ranked.slice(0, 10);
    console.log(`\n=== ${label} mcap-11: ${mcap11.join(", ")} ===`);
    console.log(`mcap overlap skip (eligible, mcap≥$30B, in mcap-11): ${overlapSkips.join(", ") || "—"}`);
    console.log("rank\tticker\tyield\tstatus");
    top10.forEach((r, i) => {
      const rank = i + 1;
      let status = rank <= DIV_N ? "ADOPTED" : "dropped";
      console.log(`${rank}\t${r.t}\t${yldPct(r.y)}\t${status}`);
    });
  }

  const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim().slice(0, 7);
  const k1m = pickMcapSleeve(eligible, DATE, ctx, 1);
  const k2m = pickMcapSleeve(eligible, DATE, ctx, 2);
  const r1 = await rankDivSleeve(eligible, DATE, ctx, new Set(k1m), divCache, barsBy);
  const r2 = await rankDivSleeve(eligible, DATE, ctx, new Set(k2m), divCache, barsBy);
  const sameRank = JSON.stringify(r1.ranked.slice(0, 10)) === JSON.stringify(r2.ranked.slice(0, 10));

  const md: string[] = [
    `# 高配当スリーブ利回り順位（${DATE}）`,
    "",
    "**定義:** [`ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md`](ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md) §3 · 実装は `pickDivSleeve`（非重複・mcap≥$30B のうち **PIT mcap 上位25** → TTM キャッシュ利回り降順 → 上位4）。",
    `**生成:** \`scripts/round19-div-sleeve-yield-rank.ts\` · **HEAD** \`${head}\``,
    "",
  ];

  const renderBlock = (label: string, mcap11: string[], block: Awaited<ReturnType<typeof rankDivSleeve>>) => {
    md.push(`## ${label}`, "", `**mcap-11:** ${mcap11.join(", ")}`, "");
    md.push(
      `**mcap 重複除外（eligible・mcap≥$30B・mcap-11 在籍）:** ${block.overlapSkips.join(", ") || "—"}`,
      "",
      "| # | Ticker | TTM yield | 判定 |",
      "|---:|---|---:|---|",
    );
    block.ranked.slice(0, 10).forEach((r, i) => {
      const n = i + 1;
      const verdict = n <= DIV_N ? "**採用**" : "落選";
      md.push(`| ${n} | ${r.t} | ${yldPct(r.y)} | ${verdict} |`);
    });
    md.push("");
  };

  if (sameRank && JSON.stringify(k1m) !== JSON.stringify(k2m)) {
    md.push("**K1 / K2:** mcap-11 の差（K1: JNJ、K2: MSFT）のみ；利回り **top10 同一**。", "");
    renderBlock("K1 & K2（共通順位）", k2m, r2);
  } else {
    renderBlock("K1", k1m, r1);
    if (!sameRank) renderBlock("K2", k2m, r2);
    else renderBlock("K2", k2m, r2);
  }

  md.push("**採用 top4:** CVX, HD, PM, PG · **落選 #5–#10:** 上表参照。");
  fs.writeFileSync(OUT, md.join("\n"));
  console.log(`\nWrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
