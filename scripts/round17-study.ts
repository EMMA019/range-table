import fs from "node:fs";
import path from "node:path";
import { earningsDatesFrom, type FilingBlock } from "../src/lib/bias";
import { buildFeatures, marketByDate, runPortfolio, type Book, type Candidate, type Feat, type NameSeries } from "../src/lib/backtest-study";
import { isIgnoredTicker } from "../src/lib/holdings";
import { ttmAt, type ConceptFacts } from "../src/lib/round4";
import { buildSpyMa20, paperShares } from "../src/lib/round16";
import {
  AI_DC_GROUP_IDS,
  ROUND17_PREREG,
  WINDOW_BOUNDS,
  countSemiTouches,
  generateLiveBandSignals,
  passVerdict,
  pickCrashK,
  scoreRound17Book,
  summarizeJa,
  type Round17Report,
  type Round17Row,
  type Round17VariantId,
  type Round17Window,
  type SignalFilters,
} from "../src/lib/round17";
import { sortedExclusionLists, themeExclusionSet } from "../src/lib/study-theme-lists";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 17: live morning band baseline + filters. Rules in docs/ROUND17_PREREG.md.
 *   npx tsx scripts/round17-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round17.json");
const ART = "/opt/cursor/artifacts/round17_trades";
const REPORT = "/opt/cursor/artifacts/round17_report/round17_ja.md";
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const F1_AS_OF = "2024-10-03";
const CRASH_GRID = [2.5, 3, 3.5] as const;

type SlimFile = { missing: true } | { missing: false; concepts: ConceptFacts };
type PoolRow = { ticker: string; sector: string; semi: boolean; aiDc: boolean };
type NameExt = NameSeries & { aiDc: boolean };

function cikFor(cikOf: Map<string, string>, ticker: string): string | null {
  const key = ticker.toUpperCase();
  return cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, ".")) ?? null;
}

function loadSlim(cik: string): ConceptFacts | null {
  const file = path.join(FACTS, `${cik}.json`);
  if (!fs.existsSync(file)) return null;
  const cached = JSON.parse(fs.readFileSync(file, "utf8")) as SlimFile;
  return cached.missing ? null : cached.concepts;
}

function loadItem202(tickers: string[]): Map<string, string[]> {
  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const dates = new Map<string, string[]>();
  for (const ticker of tickers) {
    const key = ticker.toUpperCase();
    const cik = cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, "."));
    const file = cik ? path.join(EDGAR, `${cik}.json`) : "";
    if (!cik || !fs.existsSync(file)) continue;
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { filings?: { recent?: FilingBlock; files?: Array<{ name: string }> } };
    const blocks: FilingBlock[] = [];
    if (json.filings?.recent) blocks.push(json.filings.recent);
    for (const extra of json.filings?.files ?? []) {
      const extraFile = path.join(EDGAR, extra.name);
      if (fs.existsSync(extraFile)) blocks.push(JSON.parse(fs.readFileSync(extraFile, "utf8")) as FilingBlock);
    }
    dates.set(ticker, earningsDatesFrom(blocks).item202);
  }
  return dates;
}

function orderByRs20(list: Candidate[]) {
  list.sort((a, b) => {
    if (a.rs20 == null && b.rs20 != null) return 1;
    if (a.rs20 != null && b.rs20 == null) return -1;
    if (a.rs20 != null && b.rs20 != null && a.rs20 !== b.rs20) return b.rs20 - a.rs20;
    return a.ticker.localeCompare(b.ticker);
  });
}

function runVariant(
  id: Round17VariantId,
  names: NameExt[],
  calendar: string[],
  window: { id: Round17Window; from: string; to: string },
  spyByDate: ReturnType<typeof buildSpyMa20>,
  market: ReturnType<typeof marketByDate>,
  conceptsOf: Map<string, ConceptFacts | null>,
  filters: SignalFilters,
  portfolio: { maxSemi?: number; maxBucket?: number; allBucketHeavy?: boolean },
): { book: Book; cands: Candidate[] } {
  const sessions = calendar.filter((date) => date >= window.from && date <= window.to);
  const cands: Candidate[] = [];
  for (const name of names) {
    cands.push(
      ...generateLiveBandSignals({
        name,
        from: window.from,
        to: window.to,
        sessions: calendar,
        spyByDate,
        market,
        earningsBlock: true,
        concepts: conceptsOf.get(name.ticker) ?? null,
        filters,
        allBucketHeavy: portfolio.allBucketHeavy,
      }),
    );
  }
  const closes = new Map<string, Map<string, number>>();
  for (const name of names) {
    const days = new Map<string, number>();
    for (const bar of name.feats) days.set(bar.date, bar.c);
    closes.set(name.ticker, days);
  }
  const book = runPortfolio(
    {
      id,
      label: id,
      universe: "round17",
      rank: "rs",
      sessions,
      flatten: true,
      withRestart: false,
      keepDaily: true,
      keepFills: true,
      closes,
      order: orderByRs20,
      maxSemi: portfolio.maxSemi,
      maxBucket: portfolio.maxBucket,
      size: (cand) => paperShares(cand.entry, cand.stop ?? Number.NaN),
    },
    cands,
  );
  return { book, cands };
}

function main() {
  console.log(`prereg ${ROUND17_PREREG}`);
  const spyBars = readCachedBars("SPY");
  if (!spyBars?.length) throw new Error("SPYの日足がない");
  const spy = buildFeatures(spyBars);
  const calendar = spy.map((bar) => bar.date);
  const lastBar = calendar[calendar.length - 1] ?? "";
  const windows = (["oos", "in"] as Round17Window[]).map((id) => {
    const bounds = WINDOW_BOUNDS[id];
    const to = id === "in" && lastBar < bounds.to ? lastBar : bounds.to;
    return { id, from: bounds.from, to };
  });
  const spyByDate = buildSpyMa20(spy);
  const market = marketByDate(spy, []);

  const watch = loadWatchlist();
  const themeSet = themeExclusionSet(watch).set;
  const excluded = sortedExclusionLists(watch);
  const union = [...themeSet].sort();

  let watchlist = 0;
  let financialsDropped = 0;
  let themeDropped = 0;
  const pool: PoolRow[] = [];
  for (const group of watch.groups) {
    const semi = group.id === "semi" || group.id === "equipment";
    const aiDc = AI_DC_GROUP_IDS.has(group.id);
    for (const row of group.tickers) {
      if (isIgnoredTicker(row.ticker)) continue;
      watchlist += 1;
      if (group.id === "financials") {
        financialsDropped += 1;
        continue;
      }
      if (themeSet.has(row.ticker)) {
        themeDropped += 1;
        continue;
      }
      pool.push({ ticker: row.ticker, sector: group.name, semi, aiDc });
    }
  }

  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const conceptsOf = new Map<string, ConceptFacts | null>();
  for (const row of pool) {
    const cik = cikFor(cikOf, row.ticker);
    conceptsOf.set(row.ticker, cik ? loadSlim(cik) : null);
  }
  const f1Unknown: string[] = [];
  for (const row of pool) {
    const status = ttmAt(conceptsOf.get(row.ticker) ?? null, F1_AS_OF).status;
    if (status === "unknown") f1Unknown.push(row.ticker);
  }
  f1Unknown.sort();

  const earnings = loadItem202(pool.map((row) => row.ticker));
  const names: NameExt[] = [];
  for (const row of pool) {
    const bars = readCachedBars(row.ticker);
    if (!bars?.length) continue;
    names.push({
      ticker: row.ticker,
      sector: row.sector,
      semi: row.semi,
      aiDc: row.aiDc,
      core: true,
      broad: false,
      feats: buildFeatures(bars),
      earnings: earnings.get(row.ticker) ?? [],
    });
  }

  fs.mkdirSync(ART, { recursive: true });
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });

  const rows: Round17Row[] = [];
  const baselinePortfolio = { maxSemi: 2 as number | undefined };

  for (const window of windows) {
    const { book } = runVariant("baseline", names, calendar, window, spyByDate, market, conceptsOf, {}, baselinePortfolio);
    rows.push(scoreRound17Book(book, "baseline", window.id));
  }

  for (const k of CRASH_GRID) {
    for (const window of windows) {
      const id = `crash-${k}` as Round17VariantId;
      const { book } = runVariant(id, names, calendar, window, spyByDate, market, conceptsOf, { crashK: k }, baselinePortfolio);
      rows.push(scoreRound17Book(book, id, window.id));
    }
  }

  const crashKPick = pickCrashK(rows);

  for (const n of [2, 3] as const) {
    for (const window of windows) {
      const id = `stab-${n}` as Round17VariantId;
      const { book } = runVariant(id, names, calendar, window, spyByDate, market, conceptsOf, { stabN: n }, baselinePortfolio);
      rows.push(scoreRound17Book(book, id, window.id));
    }
  }

  const aiCap = { maxBucket: 2 };
  for (const window of windows) {
    const { book } = runVariant("ai-dc-cap", names, calendar, window, spyByDate, market, conceptsOf, {}, { ...aiCap, allBucketHeavy: false });
    rows.push(scoreRound17Book(book, "ai-dc-cap", window.id));
  }

  for (const box of [5, 10, 20] as const) {
    const touches = countSemiTouches(names, box, windows[1].from, windows[1].to, calendar, spyByDate, market, conceptsOf, true);
    rows.push({
      id: `semi-box-${box}`,
      window: "in",
      trades: touches,
      winRate: null,
      totalNet190Usd: 0,
      avgNet190Usd: null,
      mtmDdUsd: 0,
      maxConsecLosses: 0,
      stopOutRate: null,
      lowDate: "",
      lowUsd: 0,
      engineTotalUsd: 0,
    });
  }

  const baseIn = rows.find((row) => row.id === "baseline" && row.window === "in");
  if (!baseIn) throw new Error("baseline in-sample missing");

  const verdicts: Round17Report["verdicts"] = [];
  for (const row of rows) {
    if (row.window !== "in" || row.id === "baseline") continue;
    if (String(row.id).startsWith("crash-")) {
      const k = Number(String(row.id).replace("crash-", ""));
      if (crashKPick != null && k !== crashKPick) continue;
    }
    const verdict = passVerdict(baseIn, row);
    verdicts.push({ id: row.id, window: row.window, verdict });
  }

  const report: Round17Report = {
    v: 1,
    prereg: ROUND17_PREREG,
    generatedAt: new Date().toISOString(),
    excluded: { ...excluded, union },
    universe: {
      watchlist,
      afterFilters: pool.length,
      f1Unknown,
      themeDropped,
      financialsDropped,
    },
    rows,
    crashKPick,
    verdicts,
    summaryJa: summarizeJa(rows, crashKPick, union),
  };

  fs.writeFileSync(OUT, `${JSON.stringify(report)}\n`);
  writeReportJa(report);
  console.log(JSON.stringify({ rows: rows.length, crashKPick, verdicts, summaryJa: report.summaryJa }, null, 2));
}

function writeReportJa(report: Round17Report) {
  const lines: string[] = [
    "# Round 17 結果（日本語）",
    "",
    `事前登録: \`${report.prereg}\``,
    `生成: ${report.generatedAt}`,
    "",
    "## テーマ除外銘柄",
    "",
    `- ソーラー (${report.excluded.solar.length}): ${report.excluded.solar.join(", ")}`,
    `- 暗号・マイニング・ホスティング (${report.excluded.crypto.length}): ${report.excluded.crypto.join(", ")}`,
    `- 原子力 (${report.excluded.nuclear.length}): ${report.excluded.nuclear.join(", ")}`,
    `- 量子 (${report.excluded.quantum.length}): ${report.excluded.quantum.join(", ")}`,
    `- 宇宙（SPCX 以外, ${report.excluded.space.length}): ${report.excluded.space.join(", ")}`,
    `  - ウォッチリスト宇宙グループ: ${report.excluded.spaceWatchlist.join(", ")}`,
    "",
    "## 合否（2024-26、基準比）",
    "",
    "|  variant | trades | $1.90 net | DD | 連敗 | 判定 |",
    "|---|---:|---:|---:|---:|---|",
  ];
  const base = report.rows.find((row) => row.id === "baseline" && row.window === "in");
  for (const row of report.rows.filter((r) => r.window === "in")) {
    if (String(row.id).startsWith("crash-")) {
      const k = Number(String(row.id).replace("crash-", ""));
      if (report.crashKPick != null && k !== report.crashKPick) continue;
    }
    let verdict = row.id === "baseline" ? "基準" : "—";
    if (row.id !== "baseline") {
      const v = report.verdicts.find((item) => item.id === row.id);
      verdict = v ? JSON.stringify(v.verdict) : "—";
    }
    lines.push(
      `| ${row.id} | ${row.trades} | ${row.totalNet190Usd.toFixed(2)} | ${row.mtmDdUsd.toFixed(2)} | ${row.maxConsecLosses} | ${verdict} |`,
    );
  }
  lines.push("", "## 要約", "", report.summaryJa, "");
  if (base) {
    lines.push(
      "",
      `基準トレード数 ${base.trades}。70% 下限 ${Math.floor(base.trades * 0.7)}。`,
      `急落フィルタ採用 k=${report.crashKPick ?? "—"}（2022-24 チューニング）。`,
    );
  }
  fs.writeFileSync(REPORT, `${lines.join("\n")}\n`);
}

main();
