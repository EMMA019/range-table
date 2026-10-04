/**
 * Round 19 — Saka Index study. Writes docs/ROUND19_ja.md + docs/round19_equity.png.
 *
 *   SEC_USER_AGENT='...' npx tsx scripts/round19-saka-study.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { edgarJson, EdgarDisabledError } from "../src/lib/edgar-client";
import { cikForTicker } from "../src/lib/edgar-companyfacts";

function companyFactsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
}
import { fetchDailyBars } from "../src/lib/yahoo";
import {
  SAKA_CONFIGS,
  SAKA_END,
  SAKA_INITIAL_CASH,
  SAKA_IS_END,
  SAKA_OOS_START,
  SAKA_START,
  buildCorrInputs,
  calendarYearReturn,
  correlationMatrix,
  feeDragSummary,
  filterEligibleCandidates,
  isSemiSubIndustry,
  maxPairwiseCorr,
  metricsFromCurve,
  pickHoldings,
  rebalanceDates,
  selectSakaConfig,
  sharesOutstandingAsOf,
  simulateSaka,
  targetWeights,
  tradingDaysFromBars,
  ttmNetIncomeAsOf,
  type SakaCandidateContext,
  type SakaConfig,
} from "../src/lib/round19-saka";
import { loadSp500PitFiles, membersOnDate, uniqueTickersInRange } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const CACHE = path.join(process.cwd(), "data", ".cache", "round19");
const DOC = path.join(process.cwd(), "docs", "ROUND19_ja.md");
const PREREG = "6e3ad93";
const BENCH = ["SPY", "QQQ", "SOXX"] as const;

function yahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, "-");
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
    const { bars } = await fetchDailyBars(sym, { range: "20y", keep: 3200, totalReturn: true });
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(bars));
    return bars;
  } catch {
    return [];
  }
}

async function loadFacts(ticker: string, cik: number | null): Promise<unknown | null> {
  const file = path.join(CACHE, "facts", `${ticker}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const resolvedCik = cik ?? cikForTicker(ticker);
  if (!resolvedCik) return null;
  try {
    const json = await edgarJson(companyFactsUrl(resolvedCik));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json));
    return json;
  } catch (error) {
    if (error instanceof EdgarDisabledError) return null;
    return null;
  }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
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

/** Benchmark curve from full bar history (include dates before `from` for calendar-year anchors). */
function benchCurve(bars: Bar[], from: string, to: string): { date: string; equity: number }[] {
  const anchorIdx = bars.findIndex((b) => b.date >= from);
  if (anchorIdx < 0) return [];
  const anchorPrice = bars[anchorIdx].c;
  const out: { date: string; equity: number }[] = [];
  for (const b of bars) {
    if (b.date > to) break;
    if (b.date < bars[0].date) continue;
    out.push({ date: b.date, equity: SAKA_INITIAL_CASH * (b.c / anchorPrice) });
  }
  return out;
}

async function main() {
  if (!process.env.SEC_USER_AGENT?.trim()) {
    console.error("[round19] SEC_USER_AGENT required for EDGAR profitability and PIT shares");
  }
  const fresh = process.argv.includes("--fresh");
  const { intervals, gics } = await loadSp500PitFiles(CACHE);
  const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const barsBy = new Map<string, Bar[]>();

  for (const b of BENCH) barsBy.set(b, await loadBars(b, fresh));

  await pool(tickers, 6, async (ticker) => {
    const bars = await loadBars(ticker, fresh);
    if (bars.length) barsBy.set(ticker, bars);
  });

  const factsBy = new Map<string, unknown>();
  await pool(tickers, 3, async (ticker) => {
    const g = gics.get(ticker);
    const f = await loadFacts(ticker, g?.cik ?? null);
    if (f) factsBy.set(ticker, f);
  });

  const spyBars = barsBy.get("SPY")!;
  const calendar = tradingDaysFromBars(spyBars);
  const closeHistory = new Map<string, Map<string, number>>();
  for (const [t, bars] of barsBy) {
    const m = new Map<string, number>();
    for (const b of bars) m.set(b.date, b.c);
    closeHistory.set(t, m);
  }

  const price = (ticker: string, date: string) => closeOnOrBefore(barsBy.get(ticker) ?? [], date);
  const membersOn = (date: string) => membersOnDate(intervals, date);

  const lastKnownShares = new Map<string, number>();
  const sharesLookup = (ticker: string, date: string) => {
    const f = factsBy.get(ticker);
    let stale = false;
    let sh: number | null = null;
    if (f) sh = sharesOutstandingAsOf(f, date);
    if (sh != null && sh > 0) {
      lastKnownShares.set(ticker, sh);
      return { shares: sh, stale: false };
    }
    const prev = lastKnownShares.get(ticker);
    if (prev != null) return { shares: prev, stale: true };
    return { shares: 0, stale: true };
  };

  let staleNameChecks = 0;
  let staleWeightChecks = 0;
  const lastRebal = rebalanceDates(calendar, SAKA_OOS_START, SAKA_END).at(-1) ?? SAKA_END;
  for (const t of membersOn(lastRebal)) {
    const { shares, stale } = sharesLookup(t, lastRebal);
    const p = price(t, lastRebal);
    if (!p || shares <= 0) continue;
    staleNameChecks += 1;
    if (stale) staleWeightChecks += 1;
  }

  const ctx: SakaCandidateContext = {
    calendar,
    closeHistory,
    gicsOf: (t) => {
      const g = gics.get(t);
      if (!g) return null;
      return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
    },
    mcap: (t, date) => {
      const p = price(t, date);
      const { shares } = sharesLookup(t, date);
      if (p == null || shares <= 0) return 0;
      return p * shares;
    },
    sharesLookup,
    profitable: (t, date) => {
      const f = factsBy.get(t);
      if (!f) return false;
      const ni = ttmNetIncomeAsOf(f, date);
      return ni != null && ni > 0;
    },
    hasPrice: (t, date) => price(t, date) != null,
  };

  const semiOf = (t: string) => ctx.gicsOf(t)?.semiBucket ?? false;

  const runConfig = (config: SakaConfig, commission: number) => {
    const { curve, ordersPerYear, turnoverPerRebal } = simulateSaka(
      config,
      calendar,
      membersOn,
      ctx,
      semiOf,
      price,
      commission,
      SAKA_START,
      SAKA_END,
    );
    const fees = feeDragSummary(ordersPerYear, curve, commission);
    const oosFees = feeDragSummary(
      Object.fromEntries(Object.entries(ordersPerYear).filter(([y]) => Number(y) >= 2021)),
      curve.filter((p) => p.date >= SAKA_OOS_START),
      commission,
    );
    return {
      curve,
      turnoverPerRebal,
      full: metricsFromCurve(curve, calendar, SAKA_START, SAKA_END),
      is: metricsFromCurve(curve, calendar, SAKA_START, SAKA_IS_END),
      oos: metricsFromCurve(curve, calendar, SAKA_OOS_START, SAKA_END),
      fees,
      oosFeePct: oosFees.totalFees / SAKA_INITIAL_CASH,
      oosFeeUsd: oosFees.totalFees,
    };
  };

  const spyBenchFull = benchCurve(spyBars, "2014-01-01", SAKA_END).map((p) => ({ date: p.date, equity: p.equity }));
  const spyIsCurve = spyBenchFull.filter((p) => p.date >= SAKA_START && p.date <= SAKA_IS_END);
  const spyIs = metricsFromCurve(spyIsCurve, calendar, SAKA_START, SAKA_IS_END);
  const spyOos = metricsFromCurve(
    spyBenchFull.filter((p) => p.date >= SAKA_OOS_START),
    calendar,
    SAKA_OOS_START,
    SAKA_END,
  );
  const qqqBench = benchCurve(barsBy.get("QQQ")!, "2014-01-01", SAKA_END).map((p) => ({ date: p.date, equity: p.equity }));
  const qqqOos = metricsFromCurve(qqqBench.filter((p) => p.date >= SAKA_OOS_START), calendar, SAKA_OOS_START, SAKA_END);
  const soxxBench = benchCurve(barsBy.get("SOXX")!, "2014-01-01", SAKA_END).map((p) => ({ date: p.date, equity: p.equity }));
  const soxxOos = metricsFromCurve(soxxBench.filter((p) => p.date >= SAKA_OOS_START), calendar, SAKA_OOS_START, SAKA_END);

  const results35 = SAKA_CONFIGS.map((config) => ({ config, ...runConfig(config, 0.35) }));
  const results1 = new Map(SAKA_CONFIGS.map((c) => [c.id, runConfig(c, 1)]));
  const chosen = selectSakaConfig(
    results35.map((r) => ({ config: r.config, is: r.is, turnover: r.turnoverPerRebal })),
    spyIs.maxDrawdown,
  );
  const adopted = chosen ?? results35[0].config;
  const adoptedRun = results35.find((r) => r.config.id === adopted.id)!;
  const adoptedStress = results1.get(adopted.id)!;

  const oosSorted = [...results35].sort((a, b) => b.oos.cagr - a.oos.cagr);
  const adoptedRank = oosSorted.findIndex((r) => r.config.id === adopted.id) + 1;

  const oosTableRows = oosSorted
    .map((r, i) => {
      const stress = results1.get(r.config.id)!;
      const hl = r.config.id === adopted.id ? "**" : "";
      const rank = i + 1;
      return `| ${rank} | ${hl}${r.config.id}${hl} | ${pct(r.oos.cagr)} | ${pct(r.oos.maxDrawdown)} | ${(r.oos.positiveYearShare * 100).toFixed(0)}% | ${(r.turnoverPerRebal * 100).toFixed(1)}% | ${pct(r.oosFeePct)} / $${r.oosFeeUsd.toFixed(0)} | ${pct(stress.oosFeePct)} / $${stress.oosFeeUsd.toFixed(0)} |`;
    })
    .join("\n");

  const holdingsBlock = (config: SakaConfig, label: string, weightNote: string) => {
    const date = lastRebal;
    const eligible = filterEligibleCandidates(membersOn(date), date, ctx);
    const holdings = pickHoldings(config, eligible, date, ctx);
    const weights = targetWeights(config, holdings, date, ctx, semiOf);
    const inputs = buildCorrInputs(holdings, calendar, closeHistory, date);
    const corr = inputs ? correlationMatrix(inputs) : new Map();
    const maxRho = maxPairwiseCorr(holdings, corr);
    const lines = holdings
      .map((t) => {
        const g = ctx.gicsOf(t);
        return `| ${t} | ${g?.sector ?? "—"} | ${pct(weights[t] ?? 0)} |`;
      })
      .join("\n");
    return `#### ${label}（${date}・${weightNote}）

最大ペア ρ: **${maxRho.toFixed(2)}**

| ティッカー | GICS | ウェイト |
|---|---|---:|
${lines}
`;
  };

  const norm = (curve: { date: string; equity: number }[], from: string) => {
    const slice = curve.filter((p) => p.date >= from);
    const e0 = slice[0]?.equity ?? 1;
    return slice.map((p) => ({ date: p.date, v: p.equity / e0 }));
  };
  const oosPf = norm(adoptedRun.curve, SAKA_OOS_START);
  const oosSpy = norm(spyBenchFull, SAKA_OOS_START);
  const oosQqq = norm(qqqBench, SAKA_OOS_START);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(
    path.join(CACHE, "equity-chart.json"),
    JSON.stringify({
      title: `OOS adopted ${adopted.id}`,
      series: [
        { label: adopted.id, dates: oosPf.map((p) => p.date), values: oosPf.map((p) => p.v) },
        { label: "SPY", dates: oosSpy.map((p) => p.date), values: oosSpy.map((p) => p.v) },
        { label: "QQQ", dates: oosQqq.map((p) => p.date), values: oosQqq.map((p) => p.v) },
      ],
    }),
  );
  spawnSync("python3", ["scripts/round19-equity-chart.py", path.join(CACHE, "equity-chart.json"), "docs/round19_equity.png"], {
    stdio: "inherit",
  });

  const spy2017 = calendarYearReturn(spyBenchFull, calendar, 2017, SAKA_END);
  const spy2018 = calendarYearReturn(spyBenchFull, calendar, 2018, SAKA_END);

  const md = `# Round 19 — Saka Index（研究）

事前登録: \`${PREREG}\`（\`docs/ROUND19_PREREG_ja.md\`）— **ウォッチリスト未使用・PIT S&P 500 のみ**

## 事実

### データ

- 構成: [fja05680/sp500](https://github.com/fja05680/sp500) \`sp500_ticker_start_end.csv\`
- GICS: 同 \`sp500.csv\`（現行・ルックアヘッド）
- 価格: Yahoo **adjclose**（分割・配当込み調整後終値、fetchDailyBars totalReturn）
- 時価総額: EDGAR companyfacts 株式数（リバランス日以前の最新）× 当日終値
- 繰り越し株数: 最終リバランスで mcap 算出可能銘柄 **${staleNameChecks}** 件中 **${staleNameChecks ? pct(staleWeightChecks / staleNameChecks) : "—"}** が過去株数繰り越し
- SPY 暦年チェック: 2017 **${spy2017 != null ? pct(spy2017) : "—"}**, 2018 **${spy2018 != null ? pct(spy2018) : "—"}**（前年最終営業日基準）

### 試行と採用

- **30** 構成（3 選定 × 2 N × 5 ウェイト）、四半期・小数株・$3,200
- IS 採用: **${adopted.id}**（IS CAGR ${pct(adoptedRun.is.cagr)}、IS DD ${pct(adoptedRun.is.maxDrawdown)}、ターンオーバー ${(adoptedRun.turnoverPerRebal * 100).toFixed(1)}%/回）

### OOS 全構成（$0.35 約定・2021–2026-10-02）

| 順位 | 構成 | 年率 | 最大DD | プラス年% | ターンオーバー/回 | 手数料ドラッグ OOS ($0.35) | OOS ($1) |
|---:|---|---:|---:|---:|---:|---|---|
${oosTableRows}
| — | **SPY** | ${pct(spyOos.cagr)} | ${pct(spyOos.maxDrawdown)} | — | — | — | — |
| — | **QQQ** | ${pct(qqqOos.cagr)} | ${pct(qqqOos.maxDrawdown)} | — | — | — | — |
| — | SOXX（参考） | ${pct(soxxOos.cagr)} | ${pct(soxxOos.maxDrawdown)} | — | — | — | — |

**採用構成の OOS 順位:** **${adoptedRank} / ${oosSorted.length}**（年率降順）

### 採用構成サマリ（OOS）

| 指標 | $0.35 | $1.00 |
|---|---:|---:|
| CAGR | ${pct(adoptedRun.oos.cagr)} | ${pct(adoptedStress.oos.cagr)} |
| 最大DD | ${pct(adoptedRun.oos.maxDrawdown)} | ${pct(adoptedStress.oos.maxDrawdown)} |
| プラス年% | ${(adoptedRun.oos.positiveYearShare * 100).toFixed(0)}% | ${(adoptedStress.oos.positiveYearShare * 100).toFixed(0)}% |
| OOS 手数料合計 | $${adoptedRun.oosFeeUsd.toFixed(0)} (${pct(adoptedRun.oosFeePct)}) | $${adoptedStress.oosFeeUsd.toFixed(0)} (${pct(adoptedStress.oosFeePct)}) |

**IS→OOS CAGR:** ${pct(adoptedRun.is.cagr)} → ${pct(adoptedRun.oos.cagr)}

### 事前登録合格基準（OOS・$0.35）

| 基準 | 採用構成 | 判定 |
|---|---|---|
| CAGR ≥ 10% | ${pct(adoptedRun.oos.cagr)} | ${adoptedRun.oos.cagr >= 0.1 ? "合格" : "不合格"} |
| 最大DD < SPY（${pct(spyOos.maxDrawdown)}） | ${pct(adoptedRun.oos.maxDrawdown)} | ${adoptedRun.oos.maxDrawdown > spyOos.maxDrawdown ? "合格" : "不合格"} |
| 暦年プラス ≥ 70%（2016–2026） | ${(adoptedRun.full.positiveYearShare * 100).toFixed(0)}% | ${adoptedRun.full.positiveYearShare >= 0.7 ? "合格" : "不合格"} |

### 暦年（採用・前年最終営業日基準）

| 年 | Saka | SPY |
|---|---:|---:|
${[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => {
  const ys = String(y);
  const pf = adoptedRun.full.calendarYears[ys];
  const spyY = calendarYearReturn(spyBenchFull, calendar, y, SAKA_END);
  return `| ${ys}${y === 2026 ? " YTD" : ""} | ${pf != null ? pct(pf) : "—"} | ${spyY != null ? pct(spyY) : "—"} |`;
}).join("\n")}

### Saka v1 草案ホールディング

${holdingsBlock(adopted, `採用 ${adopted.id}`, adopted.weight)}
${holdingsBlock(SAKA_CONFIGS.find((c) => c.id === "corrdiverse_15__equal")!, "参考 corrdiverse_15", "equal")}
${holdingsBlock(SAKA_CONFIGS.find((c) => c.id === "corrdiverse_20__equal")!, "参考 corrdiverse_20", "equal")}

![OOS equity](round19_equity.png)

## 解釈

- PIT 構成はサバイバーシップを下げるが、GICS・EDGAR 欠損・株数繰り越しはバイアス／保守性の残り要因。
- **30 通り**から IS で 1 つ選ぶため OOS は過適合リスクあり（順位 ${adoptedRank}）。
- 上場廃止は最終価格固定（0% その後）。

---

*生成: \`npx tsx scripts/round19-saka-study.ts\`*
`;

  fs.writeFileSync(DOC, md);
  console.log(JSON.stringify({ prereg: PREREG, adopted: adopted.id, rank: adoptedRank, nConfigs: SAKA_CONFIGS.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
