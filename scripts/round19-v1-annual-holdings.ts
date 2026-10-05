/**
 * Year-end (last quarterly rebalance) holdings for plain_15__mcap post-fix book.
 * Writes docs/ROUND19_V1_ANNUAL_HOLDINGS_ja.md
 *
 *   NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/tsx scripts/round19-v1-annual-holdings.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  SAKA_CAL_YEARS,
  SAKA_CONFIGS,
  SAKA_END,
  SAKA_SEMI_CAP,
  SAKA_START,
  filterEligibleCandidates,
  isSemiSubIndustry,
  pickHoldings,
  profitabilityStatus,
  rebalanceDates,
  targetWeights,
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

const OUT_MD = path.join(process.cwd(), "docs", "ROUND19_V1_ANNUAL_HOLDINGS_ja.md");
const CONFIG = SAKA_CONFIGS.find((c) => c.id === "plain_15__mcap");
if (!CONFIG) throw new Error("plain_15__mcap missing");

/** AI-tilt: GICS semi sub-industry OR explicit hyperscaler / AI software / AI infra (union, no double-count in sum). */
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

function isAiTiltTicker(t: string, semiOf: (t: string) => boolean): boolean {
  return semiOf(t) || AI_PLATFORM_INFRA.has(t);
}

function annualRebalanceDates(rebals: string[]): Map<number, string> {
  const byYear = new Map<number, string>();
  for (const d of rebals) {
    const y = Number(d.slice(0, 4));
    const prev = byYear.get(y);
    if (!prev || d > prev) byYear.set(y, d);
  }
  return byYear;
}

type Snapshot = {
  year: number;
  date: string;
  weights: Record<string, number>;
  tickers: string[];
  semiPct: number;
  aiPct: number;
  sectors: Record<string, number>;
  aiTickers: string[];
};

async function main() {
  const gitHead = process.env.GIT_HEAD ?? "";
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
  if (!spyBars.length) throw new Error("SPY bars missing");
  const calendar = tradingDaysFromBars(spyBars);
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
  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);
  const annualMap = annualRebalanceDates(rebals);

  const snapshots: Snapshot[] = [];
  for (const y of SAKA_CAL_YEARS) {
    const date = annualMap.get(y);
    if (!date) continue;
    const members = membersOnDate(intervals, date);
    const eligible = filterEligibleCandidates(members, date, ctx);
    const holdings = pickHoldings(CONFIG, eligible, date, ctx);
    const weights = targetWeights(CONFIG, holdings, date, ctx, semiOf);
    const tickersSorted = Object.entries(weights)
      .filter(([, w]) => w > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
    let semiPct = 0;
    let aiPct = 0;
    const sectors: Record<string, number> = {};
    const aiTickers: string[] = [];
    for (const t of tickersSorted) {
      const w = weights[t] ?? 0;
      if (semiOf(t)) semiPct += w;
      if (isAiTiltTicker(t, semiOf)) {
        aiPct += w;
        aiTickers.push(t);
      }
      const sec = ctx.gicsOf(t)?.sector ?? "Unknown";
      sectors[sec] = (sectors[sec] ?? 0) + w;
    }
    snapshots.push({
      year: y,
      date,
      weights,
      tickers: tickersSorted,
      semiPct,
      aiPct,
      sectors,
      aiTickers,
    });
  }

  const aiList = [...AI_PLATFORM_INFRA].sort().join(", ");
  const lines: string[] = [
    "# Round 19 v1 年次保有推移（plain_15__mcap・修正後）",
    "",
    "**状態:** 採用設定 `plain_15__mcap` の **年次スナップショット**（各暦年の **最後の四半期リバランス日** = `rebalanceDates` 上、その年の最終セッション）。ウェイトは `targetWeights` 適用後（半導体 30% キャップ込み）。",
    "**生成:** `scripts/round19-v1-annual-holdings.ts`",
    gitHead ? `**ブランチ HEAD:** \`${gitHead.slice(0, 7)}\`` : "",
    "**サイト非掲載。** v2 探索なし。",
    "",
    "**関連:** 残存 35 リークの年次表への影響 → [`ROUND19_REMAINING_LEAKS_IMPACT_ja.md`](ROUND19_REMAINING_LEAKS_IMPACT_ja.md)",
    "",
    "## スナップショットの取り方",
    "",
    `- 対象期間 ${SAKA_START} ～ ${SAKA_END}。各年 **Y** について、四半期初 SPY セッションのうち **Y 年内で最も遅い日**を採用（2026 年は **2026-10-01**）。`,
    "- シミュレーションの差分リバランスと同じ PIT 時価・eligible・`pickHoldings` 順位。",
    "",
    "## AI ティルト率の定義",
    "",
    "| 指標 | 定義 |",
    "|---|---|",
    `| **半導体 %** | GICS Sub-Industry に \`semiconductor\` を含む銘柄（\`isSemiSubIndustry\`）のウェイト合計。30% 超過時は \`applySemiCap\` で半導体を縮小し非半導体へ按分。 |`,
    `| **AI ティルト %** | 上記 **半導体** ∪ **AI プラットフォーム／インフラ** ティッカーのウェイト合計（重複は一度だけ）。AI 明示リスト: ${aiList}。 |`,
    "",
    "Emma 観点: 半導体キャップ 30% でも、ハイパースケーラ＋半導体の合算でポートが AI 集中に見えるかを **AI ティルト %** で量化する。",
    "",
    "## 年次サマリー",
    "",
    "| 年 | リバランス日 | 半導体 % | AI ティルト % | 入替 | 退出 |",
    "|---|---|---:|---:|---|---|",
  ];

  let prevSet = new Set<string>();
  for (const s of snapshots) {
    const curSet = new Set(s.tickers);
    const entered = s.tickers.filter((t) => !prevSet.has(t));
    const exited = [...prevSet].filter((t) => !curSet.has(t));
    const enterTxt = entered.length ? entered.join(", ") : "—";
    const exitTxt = exited.length ? exited.join(", ") : "—";
    lines.push(
      `| ${s.year} | ${s.date} | ${(s.semiPct * 100).toFixed(1)}% | ${(s.aiPct * 100).toFixed(1)}% | ${enterTxt} | ${exitTxt} |`,
    );
    prevSet = curSet;
  }

  lines.push("", "## 年別詳細", "");

  prevSet = new Set();
  for (const s of snapshots) {
    const curSet = new Set(s.tickers);
    const entered = s.tickers.filter((t) => !prevSet.has(t));
    const exited = [...prevSet].filter((t) => !curSet.has(t));
    const semiBind = s.semiPct >= SAKA_SEMI_CAP - 1e-6;
    lines.push(`### ${s.year}（${s.date}）`, "");
    lines.push(
      `半導体 **${(s.semiPct * 100).toFixed(2)}%**（30% キャップ ${semiBind ? "**効いてる**" : "未達"}）· AI ティルト **${(s.aiPct * 100).toFixed(2)}%**`,
    );
    lines.push("");
    lines.push(`**新規:** ${entered.length ? entered.join(", ") : "なし"} · **退出:** ${exited.length ? exited.join(", ") : "なし"}`);
    lines.push("");
    lines.push("| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |");
    lines.push("|---:|---|---:|---|---|---|");
    s.tickers.forEach((t, i) => {
      const g = gics.get(t);
      const w = (s.weights[t] ?? 0) * 100;
      const aiTag = isAiTiltTicker(t, semiOf) ? semiOf(t) ? "半導体+AI" : "AI" : "—";
      lines.push(
        `| ${i + 1} | ${t} | ${w.toFixed(2)} | ${g?.sector ?? "—"} | ${g?.subIndustry ?? "—"} | ${aiTag} |`,
      );
    });
    const secRows = Object.entries(s.sectors)
      .sort((a, b) => b[1] - a[1])
      .map(([sec, w]) => `| ${sec} | ${(w * 100).toFixed(1)}% |`);
    lines.push("", "**GICS Sector 内訳**", "", "| Sector | Wt % |", "|---|---:|", ...secRows);
    lines.push("", `**AI ティルト内訳（${s.aiTickers.length} 銘柄）:** ${s.aiTickers.join(", ")}`, "");
    if (s.year === 2026) {
      lines.push(
        "> **2026-10-01:** 半導体サブ業種が **30% キャップに張り付き**。NVDA / AAPL / GOOGL / MSFT / AMZN / META がウェイト上位を占有（詳細 [`ROUND19_V1_WEIGHTS_2026-10-01.md`](ROUND19_V1_WEIGHTS_2026-10-01.md)）。",
        "",
      );
    }
    prevSet = curSet;
  }

  fs.writeFileSync(OUT_MD, lines.join("\n") + "\n");
  console.log(`wrote ${OUT_MD}`);
  for (const s of snapshots) {
    console.log(`${s.year}\t${s.date}\tsemi=${(s.semiPct * 100).toFixed(1)}%\tai=${(s.aiPct * 100).toFixed(1)}%\t${s.tickers.join(",")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
