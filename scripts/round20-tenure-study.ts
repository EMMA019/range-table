/**
 * Round 20 — S&P 500 index tenure effect.
 *
 *   SEC_USER_AGENT='...' npx tsx scripts/round20-tenure-study.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { edgarJson, EdgarDisabledError } from "../src/lib/edgar-client";
import { cikForTicker } from "../src/lib/edgar-companyfacts";
import { ttmNetIncomeAsOf } from "../src/lib/edgar-pit";
import {
  bootstrapMeanDiffLt1VsGte5,
  forwardMetricsFromCloses,
  groupReturnsByMonthLt1Gte5,
  isExcludedTheme,
  isFinancialSector,
  listRemovalEvents,
  membersOnDateIndexed,
  monthEndDates,
  pooledByFormationYear,
  recentAdditionDate,
  ROUND20_FORMATION_END,
  ROUND20_FORMATION_START,
  ROUND20_FORWARD_DAYS,
  summarizeByBucket,
  tenureBucket,
  tradingDayIndex,
  buildMembershipIndex,
  type RemovalObservation,
  type TenureObservation,
} from "../src/lib/round20-tenure";
import { loadSp500PitFiles, uniqueTickersInRange } from "../src/lib/sp500-pit";
import { fetchDailyBars } from "../src/lib/yahoo";
import type { Bar } from "../src/lib/types";

const CACHE = path.join(process.cwd(), "data", ".cache", "round20");
const DOC = path.join(process.cwd(), "docs", "ROUND20_ja.md");
const PREREG = "6c32511";

function yahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, "-");
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

async function pool<T>(items: T[], width: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: width }, () => worker()));
}

async function loadBars(ticker: string, fresh: boolean): Promise<Bar[]> {
  const sym = yahooSymbol(ticker);
  const file = path.join(CACHE, `${sym}.json`);
  if (!fresh && fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Bar[];
  }
  try {
    const { bars } = await fetchDailyBars(sym, { range: "20y", keep: 4000, totalReturn: true });
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(bars));
    return bars;
  } catch {
    return [];
  }
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

function buildAlignedCloses(calendar: string[], bars: Bar[]): (number | null)[] {
  const out: (number | null)[] = [];
  let bi = 0;
  let last: number | null = null;
  for (const d of calendar) {
    while (bi < bars.length && bars[bi].date <= d) {
      last = bars[bi].c;
      bi += 1;
    }
    out.push(last);
  }
  return out;
}

function metricsAtIndex(aligned: (number | null)[], startIdx: number): ReturnType<typeof forwardMetricsFromCloses> {
  const slice: number[] = [];
  for (let i = startIdx; i <= startIdx + ROUND20_FORWARD_DAYS; i += 1) {
    const p = aligned[i];
    if (p == null || !(p > 0)) return null;
    slice.push(p);
  }
  return forwardMetricsFromCloses(slice, 0, ROUND20_FORWARD_DAYS);
}

function companyFactsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
}

async function loadFacts(ticker: string, cik: number | null): Promise<unknown | null> {
  if (!cik) return null;
  const file = path.join(CACHE, "facts", `${ticker}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  try {
    const json = await edgarJson(companyFactsUrl(cik));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json));
    return json;
  } catch (e) {
    if (e instanceof EdgarDisabledError) return null;
    return null;
  }
}

async function main() {
  const fresh = process.argv.includes("--fresh");
  const { intervals, gics } = await loadSp500PitFiles(CACHE);
  const byTicker = buildMembershipIndex(intervals);

  const tickers = uniqueTickersInRange(intervals, "2008-01-01", "2027-12-31");
  const barsBy = new Map<string, Bar[]>();

  const spyFresh = fresh || !fs.existsSync(path.join(CACHE, "SPY.json"));
  barsBy.set("SPY", await loadBars("SPY", spyFresh));
  let spyBars = barsBy.get("SPY")!;
  if (spyBars[0]?.date > "2009-06-01") {
    fs.unlinkSync(path.join(CACHE, "SPY.json"));
    spyBars = await loadBars("SPY", true);
    barsBy.set("SPY", spyBars);
  }
  const calendar = spyBars.map((b) => b.date);
  const spyAligned = buildAlignedCloses(calendar, spyBars);

  await pool(tickers, 8, async (ticker) => {
    if (ticker === "SPY") return;
    const bars = await loadBars(ticker, fresh);
    if (bars.length) barsBy.set(ticker, bars);
  });

  const alignedBy = new Map<string, (number | null)[]>();
  for (const [t, bars] of barsBy) {
    alignedBy.set(t, buildAlignedCloses(calendar, bars));
  }

  const monthEndsRaw = monthEndDates(calendar, ROUND20_FORMATION_START, ROUND20_FORMATION_END);
  const monthEnds = monthEndsRaw.filter((m) => {
    const idx = tradingDayIndex(calendar, m);
    return idx >= 0 && idx + ROUND20_FORWARD_DAYS < calendar.length;
  });
  if (monthEnds.length === 0) {
    throw new Error("No formation months with full 252-day forward window on SPY calendar");
  }

  let missingForward = 0;
  let attemptedMember = 0;
  const observations: TenureObservation[] = [];

  for (const monthEnd of monthEnds) {
    const startIdx = tradingDayIndex(calendar, monthEnd);
    if (startIdx < 0 || startIdx + ROUND20_FORWARD_DAYS >= calendar.length) continue;
    const spyM = metricsAtIndex(spyAligned, startIdx);
    if (!spyM) continue;

    const members = membersOnDateIndexed(byTicker, monthEnd);
    const formationYear = Number(monthEnd.slice(0, 4));

    for (const ticker of members) {
      attemptedMember += 1;
      const intervalsT = byTicker.get(ticker)!;
      const add = recentAdditionDate(intervalsT, monthEnd);
      if (!add) continue;
      const bucket = tenureBucket(add, monthEnd);
      const aligned = alignedBy.get(ticker);
      if (!aligned) {
        missingForward += 1;
        continue;
      }
      const m = metricsAtIndex(aligned, startIdx);
      if (!m) {
        missingForward += 1;
        continue;
      }
      observations.push({
        monthEnd,
        formationYear,
        ticker,
        bucket,
        metrics: m,
        spyMetrics: spyM,
        excessReturn: m.totalReturn - spyM.totalReturn,
      });
    }
  }

  const bucketSummaries = summarizeByBucket(observations);
  const pooled = pooledByFormationYear(observations);
  const byMonthAll = groupReturnsByMonthLt1Gte5(observations);
  const bootAll = bootstrapMeanDiffLt1VsGte5(byMonthAll);

  // Saka-eligible secondary (requires EDGAR when SEC_USER_AGENT set)
  const factsBy = new Map<string, unknown>();
  const edgarOn = Boolean(process.env.SEC_USER_AGENT?.trim());
  if (edgarOn) {
    const needFacts = new Set<string>();
    for (const o of observations) {
      if (o.bucket !== "lt1" && o.bucket !== "gte5") continue;
      needFacts.add(o.ticker);
    }
    await pool([...needFacts], 3, async (ticker) => {
      const g = gics.get(ticker);
      const cik = g?.cik ?? cikForTicker(ticker);
      const f = await loadFacts(ticker, cik);
      if (f) factsBy.set(ticker, f);
    });
  }

  const sakaObs: TenureObservation[] = [];
  for (const o of observations) {
    if (o.bucket !== "lt1" && o.bucket !== "gte5") continue;
    const g = gics.get(o.ticker);
    if (!g || isFinancialSector(g.sector) || isExcludedTheme(o.ticker)) continue;
    if (!edgarOn) continue;
    const f = factsBy.get(o.ticker);
    if (!f) continue;
    const ni = ttmNetIncomeAsOf(f, o.monthEnd);
    if (ni == null || ni <= 0) continue;
    sakaObs.push(o);
  }
  const byMonthSaka = groupReturnsByMonthLt1Gte5(sakaObs);
  const bootSaka = bootstrapMeanDiffLt1VsGte5(byMonthSaka);

  // Removals 2010–2025-10
  const removals = listRemovalEvents(intervals, ROUND20_FORMATION_START, ROUND20_FORMATION_END);
  const removalRows: RemovalObservation[] = [];
  let removalMissing = 0;
  for (const { ticker, removalDate } of removals) {
    const startIdx = tradingDayIndex(calendar, removalDate);
    if (startIdx < 0) {
      removalMissing += 1;
      continue;
    }
    const spyM = metricsAtIndex(spyAligned, startIdx);
    const aligned = alignedBy.get(ticker);
    const actual = aligned ? metricsAtIndex(aligned, startIdx) : null;
    const spyTr = spyM?.totalReturn ?? 0;

    if (actual) {
      removalRows.push({
        removalDate,
        ticker,
        scenario: "actual",
        totalReturn: actual.totalReturn,
        spyTotalReturn: spyTr,
        excessReturn: actual.totalReturn - spyTr,
      });
    } else {
      removalMissing += 1;
      for (const scenario of ["stress50", "stress100"] as const) {
        const tr = scenario === "stress50" ? -0.5 : -1;
        removalRows.push({
          removalDate,
          ticker,
          scenario,
          totalReturn: tr,
          spyTotalReturn: spyTr,
          excessReturn: tr - spyTr,
        });
      }
    }
  }

  const removalActual = removalRows.filter((r) => r.scenario === "actual");
  const removal50 = [
    ...removalActual,
    ...removalRows.filter((r) => r.scenario === "stress50"),
  ];
  const removal100 = [
    ...removalActual,
    ...removalRows.filter((r) => r.scenario === "stress100"),
  ];
  const meanRem = (rows: RemovalObservation[]) =>
    rows.length ? rows.reduce((a, r) => a + r.totalReturn, 0) / rows.length : 0;
  const meanRemEx = (rows: RemovalObservation[]) =>
    rows.length ? rows.reduce((a, r) => a + r.excessReturn, 0) / rows.length : 0;

  // Chart: annual mean excess by bucket (lt1, 1to5, gte5)
  const chartYears: number[] = [];
  const chartLt1: number[] = [];
  const chartGte5: number[] = [];
  for (let y = 2010; y <= 2025; y += 1) {
    const ym = pooled.get(y);
    if (!ym) continue;
    const lt1 = ym.get("lt1") ?? [];
    const gte5 = ym.get("gte5") ?? [];
    if (lt1.length === 0 && gte5.length === 0) continue;
    chartYears.push(y);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const spyYear = observations.filter((o) => o.formationYear === y);
    const spyExByBucket = (b: "lt1" | "gte5") => {
      const slice = spyYear.filter((o) => o.bucket === b);
      return slice.length ? slice.reduce((a, o) => a + o.excessReturn, 0) / slice.length : 0;
    };
    chartLt1.push(spyExByBucket("lt1"));
    chartGte5.push(spyExByBucket("gte5"));
  }

  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(
    path.join(CACHE, "tenure-chart.json"),
    JSON.stringify({ years: chartYears, lt1Excess: chartLt1, gte5Excess: chartGte5 }),
  );
  spawnSync("python3", ["scripts/round20-tenure-chart.py", path.join(CACHE, "tenure-chart.json"), "docs/round20_tenure.png"], {
    stdio: "inherit",
  });

  const bucketTable = bucketSummaries
    .map(
      (b) =>
        `| ${b.bucket} | ${b.n} | ${pct(b.meanTr)} | ${pct(b.medianTr)} | ${(b.pctPositive * 100).toFixed(1)}% | ${pct(b.meanExcess)} | ${pct(b.meanVol)} | ${pct(b.meanMaxDd)} |`,
    )
    .join("\n");

  const yearRows: string[] = [];
  for (let y = 2010; y <= 2025; y += 1) {
    const ym = pooled.get(y);
    if (!ym) continue;
    const fmt = (b: "lt1" | "1to5" | "gte5") => {
      const xs = ym.get(b) ?? [];
      if (!xs.length) return "—";
      const m = xs.reduce((a, v) => a + v, 0) / xs.length;
      return `${pct(m)} (n=${xs.length})`;
    };
    yearRows.push(`| ${y} | ${fmt("lt1")} | ${fmt("1to5")} | ${fmt("gte5")} |`);
  }

  const md = `# Round 20 — S&P 500 インデックス在籍年数（テニュア）効果

事前登録: \`${PREREG}\`（\`docs/ROUND20_PREREG_ja.md\`）

## 事実

### データ・カバレッジ

- S&P 500 PIT: [fja05680/sp500](https://github.com/fja05680/sp500) \`sp500_ticker_start_end.csv\`（Round 19 同等）
- **Dow 30 PIT:** 無料で信頼できる機械可読な在籍履歴が無いため **未実施**（Wikipedia 手動履歴は本ラウンド対象外）
- 価格: Yahoo **adjclose**（\`totalReturn: true\`）、フォワード **252 営業日**（約 12 か月）
- SPY カレンダー: **${calendar[0]}** ～ **${calendar[calendar.length - 1]}**（フォワード 252 日が取れる月末のみ形成、${monthEnds.length} か月）
- 形成意図: **${ROUND20_FORMATION_START.slice(0, 4)}–${ROUND20_FORMATION_END.slice(0, 7)}**
- メンバー×月の試行: **${attemptedMember}**、フォワード価格欠損で除外: **${missingForward}**（${attemptedMember ? pct(missingForward / attemptedMember) : "—"}）
- 除名イベント（期間内）: **${removals.length}**、実価格フォワード不可: **${removalMissing}**（ストレス −50% / −100% を併記）

**生存者・データ上の注意:** 合併・ティッカー変更・上場廃止は Yahoo 終値で近似；欠損は観測除外または除名ストレス。GICS は Saka 二次表のみ現行（ルックアヘッド）。

### 在籍銘柄 — バケット別（全観測プール）

| バケット | n | 平均 TR | 中央 TR | %プラス | 平均超過 vs SPY | 平均年率ボラ | 平均最大DD |
|---|---:|---:|---:|---:|---:|---:|---:|
${bucketTable}

### 年プール（形成年ごとの平均 12M TR）

| 年 | &lt;1y | 1–5y | ≥5y |
|---|---|---|---|
${yearRows.join("\n")}

### 統計: &lt;1y vs ≥5y（12M TR 平均差）

| ユニバース | 差 (lt1−gte5) | ブートストラップ 95% CI | 月数 |
|---|---:|---|---:|
| 全 S&P | ${pct(bootAll.diff)} | [${pct(bootAll.ciLow)}, ${pct(bootAll.ciHigh)}] | ${bootAll.months} |
| Saka 適格${edgarOn ? "" : "（EDGAR 未設定のため空）"} | ${edgarOn ? pct(bootSaka.diff) : "—"} | ${edgarOn ? `[${pct(bootSaka.ciLow)}, ${pct(bootSaka.ciHigh)}]` : "—"} | ${edgarOn ? bootSaka.months : 0} |

Saka 二次: 金融・テーマ（SPCX 除く space 含む）・ONDS 除外、**TTM 黒字**（EDGAR PIT）。観測数 lt1 **${sakaObs.filter((o) => o.bucket === "lt1").length}** / gte5 **${sakaObs.filter((o) => o.bucket === "gte5").length}**。

### 除名後 12 か月（${removalActual.length} 件は実価格、欠損はストレス補完）

| シナリオ | n | 平均 TR | 平均超過 vs SPY |
|---|---:|---:|---:|
| 実価格のみ | ${removalActual.length} | ${pct(meanRem(removalActual))} | ${pct(meanRemEx(removalActual))} |
| 実価格 + 欠損 −50% | ${removal50.length} | ${pct(meanRem(removal50))} | ${pct(meanRemEx(removal50))} |
| 実価格 + 欠損 −100% | ${removal100.length} | ${pct(meanRem(removal100))} | ${pct(meanRemEx(removal100))} |

![年次平均超過リターン lt1 vs gte5](round20_tenure.png)

## 解釈

- テニュア・バケット間の差は **相関**であり、因果や Saka 採用の根拠にはならない。月次形成の **重なり**はブートストラップで月単位リサンプルした。
- 新規採用（&lt;1y）と長在籍（≥5y）の差の符号・有意性は上表の CI で読む。除名後はサンプルが小さくストレス仮定に依存。
- **Saka 選定への示唆（1 行）:** テニュアで例えば「採用後 1 年未満を除外」するルールは、本表だけでは採用できない。採用するなら **別ラウンドで OOS**（Round 19 型の事前登録＋単一採用）が必要。

---

*生成: \`npx tsx scripts/round20-tenure-study.ts\`*
`;

  fs.writeFileSync(DOC, md);
  console.log(
    JSON.stringify(
      {
        prereg: PREREG,
        observations: observations.length,
        bootAll,
        bootSaka: edgarOn ? bootSaka : null,
        missingForward,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
