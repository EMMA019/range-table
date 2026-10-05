/**
 * Impact of post-fix 35 leak rows on annual holdings table.
 * Writes docs/ROUND19_REMAINING_LEAKS_IMPACT_ja.md
 *
 *   NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/tsx scripts/round19-remaining-leaks-impact.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  SAKA_CAL_YEARS,
  SAKA_CONFIGS,
  SAKA_END,
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

const OUT_MD = path.join(process.cwd(), "docs", "ROUND19_REMAINING_LEAKS_IMPACT_ja.md");
const AUDIT_MD = path.join(process.cwd(), "docs", "ROUND19_MCAP_LEAK_AUDIT_ja.md");
const CONFIG = SAKA_CONFIGS.find((c) => c.id === "plain_15__mcap");
if (!CONFIG) throw new Error("plain_15__mcap missing");

type LeakRow = { date: string; ticker: string; kind: string };

function parseAuditInventory(md: string): LeakRow[] {
  const rows: LeakRow[] = [];
  const inTable = md.split("## 在庫")[1]?.split("## ")[0] ?? "";
  for (const line of inTable.split("\n")) {
    if (!line.startsWith("| 20")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 5) continue;
    const date = cells[1];
    const ticker = cells[2];
    const kind = cells[3];
    if (date && ticker && kind) rows.push({ date, ticker, kind });
  }
  return rows;
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

async function loadCtx() {
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
  const holdingsAt = (date: string): string[] => {
    const members = membersOnDate(intervals, date);
    const eligible = filterEligibleCandidates(members, date, ctx);
    const holdings = pickHoldings(CONFIG, eligible, date, ctx);
    const weights = targetWeights(CONFIG, holdings, date, ctx, semiOf);
    return Object.entries(weights)
      .filter(([, w]) => w > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
  };
  const annualHoldings = new Map<number, string[]>();
  for (const y of SAKA_CAL_YEARS) {
    const d = annualMap.get(y);
    if (d) annualHoldings.set(y, holdingsAt(d));
  }
  return { annualMap, annualHoldings, holdingsAt };
}

type Impact = "yes" | "no" | "maybe";
type Judgment = { impact: Impact; why: string; action: "保留" | "修正済" };

function judge(row: LeakRow, annualMap: Map<number, string>, annualHoldings: Map<number, string[]>, holdingsAt: (d: string) => string[]): Judgment {
  const y = Number(row.date.slice(0, 4));
  const annualDate = annualMap.get(y);
  const annual = new Set(annualHoldings.get(y) ?? []);
  const atLeak = new Set(holdingsAt(row.date));

  if (row.kind === "算出不可" && (row.ticker === "PARA" || row.ticker === "VIAC")) {
    const hole = [...atLeak].filter((t) => t !== row.ticker);
    const inAnnual = hole.some((t) => annual.has(t) && !["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "FB"].includes(t));
    if (inAnnual || (annualDate === row.date && atLeak.has(row.ticker) === false)) {
      return {
        impact: "maybe",
        why: "PIT=0 のため PARA/VIAC は未採用。穴埋め（ABBV/NFLX/ADBE 等）が年次 15 に残る可能性。PIT 修正で PARA 系が入替わる余地。",
        action: "保留",
      };
    }
    return { impact: "no", why: "算出不可のため当該ティッカーは pick されず、年次 15 は他 mega-cap で埋まる。現行年次表はその前提。", action: "保留" };
  }

  if (row.kind === "算出不可" && row.ticker === "AMT") {
    return { impact: "no", why: "参照順位 ~36–40 位。PIT 上位 15 に入っていない。", action: "保留" };
  }

  if (row.kind === "参照上位なのにPIT下位" && row.ticker === "PCG") {
    if (annualDate === row.date) {
      return {
        impact: "maybe",
        why: "年次スナップショット日と一致。PCG は PIT 下位のまま、穴埋め銘柄が年次 15 に載っている可能性。",
        action: "保留",
      };
    }
    return {
      impact: "no",
      why: "中間四半期の PCG ずれ。当該年の最終四半期 15 には PCG は通常入らず、年次表のメンバーは別日付で確定。",
      action: "保留",
    };
  }

  if (row.kind === "穴埋め") {
    if (annual.has(row.ticker) && annualDate && row.date <= annualDate) {
      return {
        impact: "maybe",
        why: `${row.ticker} が年次 15 に含まれる。PCG/PARA 等の PIT 修正で参照上位が入ればウェイト・メンバーが変わり得る。`,
        action: "保留",
      };
    }
    return {
      impact: "no",
      why: "穴埋めは当該四半期のみ。年次スナップショット（年内最終四半期）の 15 には載っていない、または mega-cap 15 と一致。",
      action: "保留",
    };
  }

  if (row.kind === "偽急落") {
    const rankBad = !atLeak.has(row.ticker);
    if (rankBad && !annual.has(row.ticker)) {
      return { impact: "no", why: "PIT 順位が上位 15 外（ISRG/LRCX/BKNG）。年次 15 メンバー・ウェイトに未反映。", action: "保留" };
    }
    return { impact: "maybe", why: "偽急落で順位が揺れているが年次 15 への影響は限定的。", action: "保留" };
  }

  return { impact: "no", why: "年次 15 のメンバー・ウェイトに実質影響なし。", action: "保留" };
}

async function main() {
  const audit = fs.readFileSync(AUDIT_MD, "utf8");
  const leaks = parseAuditInventory(audit);
  if (leaks.length !== 35) console.warn(`expected 35 leak rows, got ${leaks.length}`);

  const { annualMap, annualHoldings, holdingsAt } = await loadCtx();
  const judged = leaks.map((r) => ({ ...r, ...judge(r, annualMap, annualHoldings, holdingsAt) }));

  const fixed = judged.filter((j) => j.action === "修正済");
  const deferred = judged.filter((j) => j.action === "保留");
  const byImpact = {
    yes: judged.filter((j) => j.impact === "yes").length,
    no: judged.filter((j) => j.impact === "no").length,
    maybe: judged.filter((j) => j.impact === "maybe").length,
  };

  const groupSummary = new Map<string, { n: number; maybe: number; no: number }>();
  for (const j of judged) {
    const g = j.kind;
    const cur = groupSummary.get(g) ?? { n: 0, maybe: 0, no: 0 };
    cur.n += 1;
    if (j.impact === "maybe") cur.maybe += 1;
    if (j.impact === "no") cur.no += 1;
    groupSummary.set(g, cur);
  }

  const lines = [
    "# Round 19 残存 35 件リーク → 年次保有表への影響",
    "",
    "**参照在庫:** [`ROUND19_MCAP_LEAK_AUDIT_ja.md`](ROUND19_MCAP_LEAK_AUDIT_ja.md)（修正後 35 件）",
    "**年次表:** [`ROUND19_V1_ANNUAL_HOLDINGS_ja.md`](ROUND19_V1_ANNUAL_HOLDINGS_ja.md)（年内最終四半期リバランスの 15 銘柄）",
    "**生成:** `scripts/round19-remaining-leaks-impact.ts`",
    "",
    "## 判定基準",
    "",
    "- **yes:** PIT 修正が入ると、その年の **年次 15 のティッカー集合またはウェイト**が変わる見込みが高い。",
    "- **maybe:** 中間四半期または穴埋め経由で、年次 15 が変わる **可能性**あり（PCG/PARA 系・年次表に残る穴埋め銘柄）。",
    "- **no:** 当該ティッカーは年次 15 に入っておらず、順位も 15 外。**年次推移表は修正しなくてよい** → **保留（defer）**。",
    "",
    "本ブランチでは **コード修正は追加していない**（高インパクト単独ケースなし）。",
    "",
    "## サマリー",
    "",
    "| 項目 | 件数 |",
    "|---|---:|",
    `| 在庫行 | ${leaks.length} |`,
    `| 影響 yes | ${byImpact.yes} |`,
    `| 影響 maybe | ${byImpact.maybe} |`,
    `| 影響 no | ${byImpact.no} |`,
    `| **保留（defer）** | **${deferred.length}** |`,
    `| **本ターンで修正** | **${fixed.length}** |`,
    "",
    "### 現象別",
    "",
    "| 現象 | 件数 | no | maybe |",
    "|---|---:|---:|---:|",
    ...[...groupSummary.entries()].map(([k, v]) => `| ${k} | ${v.n} | ${v.no} | ${v.maybe} |`),
    "",
    "## 行別",
    "",
    "| 日付 | Ticker | 現象 | 年次表への影響 | 対応 | 理由（1行） |",
    "|---|---|---|---|---|---|",
    ...judged.map(
      (j) =>
        `| ${j.date} | ${j.ticker} | ${j.kind} | **${j.impact}** | ${j.action} | ${j.why.replace(/\|/g, "／")} |`,
    ),
    "",
    "## 保留一覧（修正しない）",
    "",
    ...deferred.map((j) => `- ${j.date} ${j.ticker}（${j.kind}）— ${j.impact}: ${j.why}`),
    "",
  ];

  if (fixed.length) {
    lines.push("## 本ブランチで修正したもの", "", ...fixed.map((j) => `- ${j.date} ${j.ticker}`), "");
  }

  fs.writeFileSync(OUT_MD, lines.join("\n"));
  console.log(`wrote ${OUT_MD} rows=${leaks.length} defer=${deferred.length} fixed=${fixed.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
