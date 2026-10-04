/**
 * Round 18 portfolio study (research only). Writes docs/ROUND18_ja.md.
 * Bars cache: data/.cache/round18/ (gitignored). No CSV output.
 *
 *   SEC_USER_AGENT='range-table research contact@example.com' npx tsx scripts/round18-portfolio-study.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadWatchlist } from "../src/lib/watchlist";
import { fetchEpsBatch } from "../src/lib/eps";
import { resolveProfitability } from "../src/lib/loss-filter";
import { cachedTtmIncome, fetchTtmIncomeForTicker } from "../src/lib/edgar-companyfacts";
import { fetchDailyBars } from "../src/lib/yahoo";
import { edgarGet, EdgarDisabledError } from "../src/lib/edgar-client";
import { cikForTicker } from "../src/lib/edgar-companyfacts";
import { companyFactsUrl } from "../src/lib/edgar-companyfacts";
import { isIgnoredTicker } from "../src/lib/holdings";
import { themeOf } from "../src/lib/themes";
import {
  ROUND18_END,
  ROUND18_IS_END,
  ROUND18_OOS_START,
  ROUND18_START,
  ROUND18_CAL_YEAR_END,
  ROUND18_CAL_YEAR_START,
  ROUND18_INITIAL_CASH,
  buildRound18Universe,
  firstBarDate,
  metricsFromCurve,
  rebalanceDates,
  round18Configs,
  selectRound18Config,
  simulateRound18,
  targetWeights,
  tradingDaysFromBars,
  type Round18Config,
  type Round18Rebal,
} from "../src/lib/round18-portfolio";
import {
  buildCorrInputs,
  correlationMatrix,
  hierarchicalClusterOrder,
  listHighCorrPairs,
} from "../src/lib/round18-corr";
import {
  buildSdiMeta,
  SDI_SPLIT_5050,
  SDI_SPLIT_6535,
  simulateSdi,
  type SdiDailyState,
  type SdiSplit,
  type SdiStockSelection,
} from "../src/lib/round18-sdi";
import type { Bar } from "../src/lib/types";

const CACHE = path.join(process.cwd(), "data", ".cache", "round18");
const DOC = path.join(process.cwd(), "docs", "ROUND18_ja.md");
const BENCH = ["SPY", "QQQ", "SOXX"] as const;
const PREREG = "b8ec490";
const PREREG_SDI = "bdc45c9";
const PREREG_CORR = "9605999";
const HEATMAP_JSON = path.join(CACHE, "corr-heatmap.json");
const HEATMAP_PNG = path.join(process.cwd(), "docs", "round18_corr_heatmap.png");

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
  // Yahoo `range=max` returns ~400 monthly points (not daily); 20y + keep 3200 → daily from ~2014.
  const { bars } = await fetchDailyBars(sym, { range: "20y", keep: 3200 });
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(bars));
  return bars;
}

function parseSharesOutstanding(json: unknown): number | null {
  if (!json || typeof json !== "object" || !("facts" in json)) return null;
  const facts = (json as { facts: Record<string, Record<string, { units?: Record<string, Array<{ val?: number; end?: string }>> }>> }).facts;
  const tags = ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"];
  for (const tag of tags) {
    const block = facts["us-gaap"]?.[tag]?.units?.shares ?? facts["dei"]?.[tag]?.units?.shares;
    if (!block?.length) continue;
    const sorted = [...block].filter((p) => typeof p.val === "number").sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""));
    const val = sorted[0]?.val;
    if (val != null && val > 0) return val;
  }
  return null;
}

async function sharesForTicker(ticker: string): Promise<number> {
  const file = path.join(CACHE, `shares-${ticker}.json`);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8")) as { shares: number };
    return cached.shares;
  }
  const cik = cikForTicker(ticker);
  let shares = 1;
  if (cik) {
    try {
      const text = await edgarGet(companyFactsUrl(cik));
      const parsed = parseSharesOutstanding(JSON.parse(text));
      if (parsed) shares = parsed;
    } catch (error) {
      if (!(error instanceof EdgarDisabledError)) {
        /* keep default */
      }
    }
  }
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ shares }));
  return shares;
}

function watchlistTickers(): string[] {
  const watch = loadWatchlist();
  const out: string[] = [];
  for (const g of watch.groups) {
    for (const t of g.tickers) {
      const ticker = t.ticker;
      if (isIgnoredTicker(ticker)) continue;
      if (g.id === "financials") continue;
      if (themeOf(ticker)) continue;
      out.push(ticker);
    }
  }
  return [...new Set(out)];
}

function yearReturnPct(bars: Bar[], year: number): number | null {
  const from = `${year}-01-01`;
  const to = year === ROUND18_CAL_YEAR_END ? ROUND18_END : `${year}-12-31`;
  const curve = benchCurve(bars, from, to, 1);
  if (curve.length < 2) return null;
  return curve[curve.length - 1].equity / curve[0].equity - 1;
}

function benchCurve(bars: Bar[], from: string, to: string, initial: number): { date: string; equity: number }[] {
  const startIdx = bars.findIndex((b) => b.date >= from);
  if (startIdx < 0) return [];
  const startPrice = bars[startIdx].c;
  const out: { date: string; equity: number }[] = [];
  for (const b of bars) {
    if (b.date < from || b.date > to) continue;
    out.push({ date: b.date, equity: initial * (b.c / startPrice) });
  }
  return out;
}

function countPositiveYears(cal: Record<string, number>): number {
  let n = 0;
  for (let y = ROUND18_CAL_YEAR_START; y <= ROUND18_CAL_YEAR_END; y += 1) {
    const r = cal[String(y)];
    if (r != null && r > 0) n += 1;
  }
  return n;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function stateOnOrBefore(daily: SdiDailyState[], date: string): SdiDailyState | null {
  let best: SdiDailyState | null = null;
  for (const row of daily) {
    if (row.date <= date) best = row;
    else break;
  }
  return best;
}

function fmtUsd(x: number): string {
  return `$${x.toFixed(0)}`;
}

function yearParts(
  daily: SdiDailyState[],
  year: number,
): { base0: number; sleeve0: number; base1: number; sleeve1: number; cashPct: number } | null {
  const yEnd = year === ROUND18_CAL_YEAR_END ? ROUND18_END : `${year}-12-31`;
  const s0 = stateOnOrBefore(daily, `${year}-01-04`);
  const s1 = stateOnOrBefore(daily, yEnd);
  if (!s0 || !s1 || s0.equity <= 0) return null;
  const cashPct = daily.filter((d) => d.date.startsWith(String(year))).reduce((a, r) => a + r.cash / r.equity, 0) /
    Math.max(1, daily.filter((d) => d.date.startsWith(String(year))).length);
  return { base0: s0.baseValue, sleeve0: s0.sleeveValue, base1: s1.baseValue, sleeve1: s1.sleeveValue, cashPct };
}

async function main() {
  const fresh = process.argv.includes("--fresh");
  const tickers = watchlistTickers();
  const barsBy = new Map<string, Bar[]>();

  for (const b of [...BENCH, "SPTM"]) {
    barsBy.set(b, await loadBars(b, fresh));
  }

  await pool(tickers, 4, async (ticker) => {
    try {
      barsBy.set(ticker, await loadBars(ticker, fresh));
    } catch (error) {
      console.error(`[round18] skip ${ticker}`, error);
    }
  });

  const spyBars = barsBy.get("SPY")!;
  const calendar = tradingDaysFromBars(spyBars);
  const firstDates = new Map<string, string>();
  for (const [t, bars] of barsBy) {
    const fd = firstBarDate(bars);
    if (fd) firstDates.set(t, fd);
  }

  const shareMap = new Map<string, number>();
  await pool(tickers, 3, async (ticker) => {
    shareMap.set(ticker, await sharesForTicker(ticker));
  });

  const eps = await fetchEpsBatch(tickers.map(yahooSymbol));
  await pool(tickers, 2, async (ticker) => {
    if (cachedTtmIncome(ticker)) return;
    try {
      await fetchTtmIncomeForTicker(ticker);
    } catch {
      /* optional */
    }
  });

  const isProfitable = (ticker: string) =>
    resolveProfitability(ticker, eps[yahooSymbol(ticker)] ?? eps[ticker] ?? null, cachedTtmIncome(ticker)).status ===
    "profit";

  let universe = buildRound18Universe(loadWatchlist(), firstDates, isProfitable);
  universe = universe.map((m) => ({ ...m, shares: shareMap.get(m.ticker) ?? 1 }));

  const configs = round18Configs();
  const commissionSelect = 0.35;
  const inSampleRows: Array<{ config: Round18Config; cagr: number; maxDrawdown: number }> = [];

  for (const config of configs) {
    const curve = simulateRound18(config, calendar, universe, barsBy, commissionSelect, ROUND18_START, ROUND18_END);
    const m = metricsFromCurve(curve, ROUND18_START, ROUND18_IS_END);
    inSampleRows.push({ config, cagr: m.cagr, maxDrawdown: m.maxDrawdown });
  }

  const chosen = selectRound18Config(inSampleRows);
  const chosenLabel = `${chosen.method}/N=${chosen.n}/${chosen.rebal}`;

  const runChosen = (commission: number) => {
    const curve = simulateRound18(chosen, calendar, universe, barsBy, commission, ROUND18_START, ROUND18_END);
    return {
      full: metricsFromCurve(curve, ROUND18_START, ROUND18_END),
      oos: metricsFromCurve(curve, ROUND18_OOS_START, ROUND18_END),
      is: metricsFromCurve(curve, ROUND18_START, ROUND18_IS_END),
      curve,
    };
  };

  const at35 = runChosen(0.35);
  const at1 = runChosen(1);

  const benchMetrics: Record<string, { oos: ReturnType<typeof metricsFromCurve> }> = {};
  for (const b of BENCH) {
    const curve = benchCurve(barsBy.get(b)!, ROUND18_OOS_START, ROUND18_END, ROUND18_INITIAL_CASH);
    benchMetrics[b] = { oos: metricsFromCurve(curve, ROUND18_OOS_START, ROUND18_END) };
  }

  const spyOos = benchMetrics.SPY.oos;
  const passCagr = at35.oos.cagr >= 0.1;
  const passDd = at35.oos.maxDrawdown > spyOos.maxDrawdown;
  const posYears = countPositiveYears(at35.full.calendarYears);
  const passYears = posYears >= 7;

  const topIs = [...inSampleRows].sort((a, b) => b.cagr - a.cagr).slice(0, 5);

  const sdiMeta = buildSdiMeta(loadWatchlist(), firstDates);
  const sptmFirst = firstBarDate(barsBy.get("SPTM") ?? []) ?? null;
  const runSdi = (commission: number, split: SdiSplit, stockSelection: SdiStockSelection = "momentum") => {
    const { curve, broadProxyDays, broadSptmDays } = simulateSdi(
      calendar,
      sdiMeta,
      barsBy,
      isProfitable,
      commission,
      sptmFirst,
      split,
      ROUND18_START,
      ROUND18_END,
      { stockSelection },
    );
    return {
      curve,
      broadProxyDays,
      broadSptmDays,
      full: metricsFromCurve(curve, ROUND18_START, ROUND18_END),
      is: metricsFromCurve(curve, ROUND18_START, ROUND18_IS_END),
      oos: metricsFromCurve(curve, ROUND18_OOS_START, ROUND18_END),
    };
  };
  const sdi6535_35 = runSdi(0.35, SDI_SPLIT_6535);
  const sdi6535_1 = runSdi(1, SDI_SPLIT_6535);
  const sdi5050_35 = runSdi(0.35, SDI_SPLIT_5050);
  const sdi5050_1 = runSdi(1, SDI_SPLIT_5050);
  const sdi6535_corr_35 = runSdi(0.35, SDI_SPLIT_6535, "corrdiverse");
  const sdi5050_corr_35 = runSdi(0.35, SDI_SPLIT_5050, "corrdiverse");
  const qqqOos = benchMetrics.QQQ.oos;

  type CorrCompareMethod = "equal" | "invvol" | "corrdiverse" | "corrdiverse_volprune";
  const corrMethods: CorrCompareMethod[] = ["equal", "invvol", "corrdiverse", "corrdiverse_volprune"];
  const corrNs = [10, 20, 30] as const;
  const corrRebals: Round18Rebal[] = ["monthly", "quarterly", "annual"];
  const corrCell = new Map<string, { is: ReturnType<typeof metricsFromCurve>; oos: ReturnType<typeof metricsFromCurve> }>();
  for (const n of corrNs) {
    for (const rebal of corrRebals) {
      for (const method of corrMethods) {
        const cfg: Round18Config = { method, n, rebal };
        const curve = simulateRound18(cfg, calendar, universe, barsBy, 0.35, ROUND18_START, ROUND18_END);
        corrCell.set(`${method}/${n}/${rebal}`, {
          is: metricsFromCurve(curve, ROUND18_START, ROUND18_IS_END),
          oos: metricsFromCurve(curve, ROUND18_OOS_START, ROUND18_END),
        });
      }
    }
  }
  const priceAt = (ticker: string, date: string) => {
    const bars = barsBy.get(ticker);
    if (!bars) return null;
    let best: number | null = null;
    for (const b of bars) {
      if (b.date <= date) best = b.c;
      else break;
    }
    return best;
  };

  const mcapAt = (ticker: string, date: string) => {
    const m = universe.find((u) => u.ticker === ticker);
    const p = priceAt(ticker, date);
    if (!m || p == null) return 0;
    return p * (m.shares > 0 ? m.shares : 1);
  };
  const heatmapEligible = universe.filter((m) => m.firstDate <= ROUND18_END);
  const heatmapTickers = [...heatmapEligible]
    .sort((a, b) => mcapAt(b.ticker, ROUND18_END) - mcapAt(a.ticker, ROUND18_END))
    .slice(0, 40)
    .map((m) => m.ticker);
  const stockClosesHm = new Map<string, Map<string, number>>();
  for (const [ticker, bars] of barsBy) {
    const m = new Map<string, number>();
    for (const b of bars) m.set(b.date, b.c);
    stockClosesHm.set(ticker, m);
  }
  const hmInputs = buildCorrInputs(heatmapTickers, calendar, stockClosesHm, ROUND18_END);
  let heatmapPairsBlock = "（相関窓が不足）";
  if (hmInputs) {
    const hmCorr = correlationMatrix(hmInputs);
    const order = hierarchicalClusterOrder(hmCorr, hmInputs.tickers);
    const matrix = order.map((a) => order.map((b) => hmCorr.get(a)?.get(b) ?? 0));
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(
      HEATMAP_JSON,
      JSON.stringify({
        title: `Round 18 eligible top-40 mcap · 1y to ${ROUND18_END}`,
        labels: order,
        matrix,
      }),
    );
    const py = spawnSync("python3", ["scripts/round18-corr-heatmap.py", HEATMAP_JSON, HEATMAP_PNG], {
      encoding: "utf8",
    });
    if (py.status !== 0) console.error("[round18] heatmap", py.stderr || py.stdout);
    const pairs = listHighCorrPairs(hmInputs.tickers, hmCorr);
    heatmapPairsBlock = pairs.length
      ? pairs
          .slice(0, 25)
          .map((p) => `- ${p.a}–${p.b}: ρ=${p.rho.toFixed(2)}`)
          .join("\n")
      : "（|ρ|>0.7 のペアなし・上位40内）";
  }

  const sdiPassMark = (r: ReturnType<typeof runSdi>) => {
    const pos = countPositiveYears(r.full.calendarYears);
    const passCagr = r.oos.cagr >= 0.1;
    const passDd = r.oos.maxDrawdown > spyOos.maxDrawdown;
    const passYears = pos >= 7;
    const passAll = passCagr && passDd && passYears;
    return { pos, passCagr, passDd, passYears, passAll };
  };
  const p6535 = sdiPassMark(sdi6535_35);
  const p5050 = sdiPassMark(sdi5050_35);
  const p6535Corr = sdiPassMark(sdi6535_corr_35);
  const p5050Corr = sdiPassMark(sdi5050_corr_35);

  const sdiAuditSim = simulateSdi(
    calendar,
    sdiMeta,
    barsBy,
    isProfitable,
    0.35,
    sptmFirst,
    SDI_SPLIT_6535,
    ROUND18_START,
    ROUND18_END,
    { captureDaily: true },
  );
  const daily = sdiAuditSim.daily ?? [];
  const sanityDates = [
    "2020-02-19",
    "2020-02-27",
    "2020-03-16",
    "2020-03-23",
    "2022-01-03",
    "2022-06-16",
    "2022-10-12",
  ];
  const sanityRows = sanityDates.map((d) => {
    const s = stateOnOrBefore(daily, d);
    if (!s) return `| ${d} | — | — | — | — | — |`;
    return `| ${d} | ${fmtUsd(s.equity)} | ${fmtUsd(s.baseValue)} | ${fmtUsd(s.sleeveValue)} | ${fmtUsd(s.cash)} | ${s.nHoldings} | ${pct(s.investedPct)} |`;
  });

  const reconYears = [2017, 2019, 2020, 2021, 2022];
  const reconRows = reconYears.map((y) => {
    const parts = yearParts(daily, y);
    const spyY = yearReturnPct(barsBy.get("SPY")!, y);
    const pfY = sdi6535_35.full.calendarYears[String(y)];
    if (!parts || spyY == null || pfY == null) return `| ${y} | — |`;
    const baseR = parts.base0 > 0 ? parts.base1 / parts.base0 - 1 : 0;
    const sleeveR = parts.sleeve0 > 0 ? parts.sleeve1 / parts.sleeve0 - 1 : 0;
    const blend = SDI_SPLIT_6535.base * baseR + SDI_SPLIT_6535.stock * sleeveR;
    return `| ${y} | ${pct(spyY)} | ${pct(baseR)} | ${pct(sleeveR)} | ${pct(blend)} | ${pct(pfY)} | ${pct(parts.cashPct)} 現金比 |`;
  });

  const stockClosesAudit = new Map<string, Map<string, number>>();
  for (const [ticker, bars] of barsBy) {
    const m = new Map<string, number>();
    for (const b of bars) m.set(b.date, b.c);
    stockClosesAudit.set(ticker, m);
  }
  const gridRebals = rebalanceDates(calendar, "quarterly", "2019-01-01", "2022-12-31");
  const gridHoldingsLines: string[] = [];
  for (const d of gridRebals) {
    const eligible = universe.filter((m) => m.firstDate <= d);
    const w = targetWeights(
      chosen,
      d,
      eligible,
      calendar,
      (t) => priceAt(t, d),
      stockClosesAudit,
    );
    const top = Object.entries(w)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t, wt]) => `${t} ${(wt * 100).toFixed(1)}%`)
      .join(", ");
    gridHoldingsLines.push(`- **${d}:** ${top}`);
  }

  const invvolCfg = configs.find((c) => c.method === "invvol" && c.n === 10 && c.rebal === "quarterly");
  let invvolDriverBlock = "";
  if (invvolCfg) {
    const invCal = metricsFromCurve(
      simulateRound18(invvolCfg, calendar, universe, barsBy, 0.35, ROUND18_START, ROUND18_END),
      ROUND18_START,
      ROUND18_END,
    ).calendarYears;
    const topTickerLines: string[] = [];
    for (const year of [2020, 2022]) {
      const rd =
        rebalanceDates(calendar, "quarterly", `${year}-01-01`, `${year}-12-31`)[0] ?? `${year}-01-02`;
      const eligible = universe.filter((m) => m.firstDate <= rd);
      const w = targetWeights(
        invvolCfg,
        rd,
        eligible,
        calendar,
        (t) => priceAt(t, rd),
        stockClosesAudit,
      );
      const rows = Object.entries(w)
        .map(([t]) => {
          const bars = barsBy.get(t);
          const ret = bars ? yearReturnPct(bars, year) : null;
          return { t, ret: ret ?? 0 };
        })
        .sort((a, b) => b.ret - a.ret)
        .slice(0, 6)
        .map((r) => `${r.t} ${pct(r.ret)}`)
        .join(", ");
      topTickerLines.push(
        `- **${year}** PF ${pct(invCal[String(year)] ?? 0)}（構成銘柄の暦年リターン上位）: ${rows}`,
      );
    }
    invvolDriverBlock = `### invvol N=10 quarterly（監査用・in-sample 2 位ではない）

旧レポートの **+114% / −38.5%** は **月次相当の誤データ**に起因。日足修正後の暦年:

${topTickerLines.join("\n")}

`;
  }

  const auditSection = `## 監査・修正（2026-10-04）

**不具合（修正済）**

1. **SDI リバランス:** 旧コードは「増し玉のみ」で配分が崩れていた。四半期ごとに **全売却→目標配分で再購入**に変更。
2. **SDI 手数料と配分:** 広い ETF を先に満額購入したあと、個別 15 本それぞれに **$0.35 を上乗せ**していたため、**個別スリーブが 1 株も買えず約 35% が常時現金**（ベースのみ投資→ DD が浅く見える）。**購入本数分の手数料を先に控除**してから 65/35（または 50/50）で配分するよう修正。
3. **DD 回復日数:** 旧コードは回復目標に「全期間の最高 NAV」を使い、深い DD の回復が **過小（例: −47% で 27 日）** と表示されていた。**その DD の直前ピーク**へ戻る営業日数に修正（グリッド・SDI 共通の \`metricsFromCurve\`）。
4. **価格データ:** \`fetchDailyBars(..., range: "max")\` が **日足ではなく約 400 本の月次相当**しか返さず、12–1 か月モメンタムがほぼ常に null → **個別スリーブが 2016–2024 ほぼ未投資**。Round 18 キャッシュは \`range: "20y", keep: 3200\` で再取得（\`--fresh\`）。

**50/50 最大DD −19.4% / ドキュメント −12.9% について:** いずれも **未投資スリーブ＋月次データ**の誤シミュレーション。修正後 OOS 50/50 最大DD は **下表（例: 約 −31%）**、in-sample 約 **−37%**（SPY クラッシュと同オーダー）。

### SDI 65/35 — NAV 分解（修正後・$0.35）

| 日付 | NAV | ベース(SPTM) | スリーブ | 現金 | 銘柄数 | 投資比率 |
|---|---:|---:|---:|---:|---:|---:|
${sanityRows.join("\n")}

### 暦年リコンシル（65/35・ベース/スリーブの年初→年末）

| 年 | SPY | ベースR | スリーブR | 0.65×base+0.35×sleeve | 実際PF | 平均現金比 |
|---|---:|---:|---:|---:|---:|---|
${reconRows.join("\n")}

### 選択構成 ${chosenLabel} — 四半期リバランス時の上位ウェイト（2019–2022）

${gridHoldingsLines.join("\n")}

${invvolDriverBlock}

---

`;

  const sdiSection = `## Small Direct Index（SPTM/SPY + 15 銘柄）

事前登録追補: \`${PREREG_SDI}\`（\`docs/ROUND18_PREREG_SDI_ja.md\`）— **本レポート最初の比較**

| 共通 | |
|---|---|
| 広いスリーブ | **SPTM**（開始 ${sptmFirst ?? "—"}）。未上場日は **SPY 代理**（各バリアント四半期 ${sdi6535_35.broadProxyDays} / ${sdi6535_35.broadSptmDays} 回＝65/35 基準） |
| 個別 | **15** 銘柄・等ウェイト・**小数株**・四半期**サバイバー入替**→比率へ再平衡 |
| 条件 | 黒字（LH）・ATR14≥3%・Round 18 除外・半導体+設備 **≤4/15** |
| >15 候補 | **12–1 か月 SPY 超過**降順、同点はティッカー昇順 |

### 65/35 vs 50/50 — OOS（2021–2026-10-02・$0.35）

| | **65/35** モメンタム | **65/35** 相関分散 | **50/50** モメンタム | **50/50** 相関分散 | SPY | QQQ |
|---|---:|---:|---:|---:|---:|---:|
| CAGR | ${pct(sdi6535_35.oos.cagr)} | ${pct(sdi6535_corr_35.oos.cagr)} | **${pct(sdi5050_35.oos.cagr)}** | ${pct(sdi5050_corr_35.oos.cagr)} | ${pct(spyOos.cagr)} | ${pct(qqqOos.cagr)} |
| 最大DD | ${pct(sdi6535_35.oos.maxDrawdown)} | ${pct(sdi6535_corr_35.oos.maxDrawdown)} | ${pct(sdi5050_35.oos.maxDrawdown)} | ${pct(sdi5050_corr_35.oos.maxDrawdown)} | ${pct(spyOos.maxDrawdown)} | ${pct(qqqOos.maxDrawdown)} |
| DD回復(営業日) | ${sdi6535_35.oos.recoveryDays ?? "—"} | ${sdi6535_corr_35.oos.recoveryDays ?? "—"} | ${sdi5050_35.oos.recoveryDays ?? "—"} | ${sdi5050_corr_35.oos.recoveryDays ?? "—"} | — | — |
| 暦年プラス | ${p6535.pos}/10 | ${p6535Corr.pos}/10 | ${p5050.pos}/10 | ${p5050Corr.pos}/10 | — | — |
| 3条件合格 | ${p6535.passAll ? "✓" : "✗"} | ${p6535Corr.passAll ? "✓" : "✗"} | ${p5050.passAll ? "✓" : "✗"} | ${p5050Corr.passAll ? "✓" : "✗"} | — | — |

（SDI 相関分散 = 個別15枠を \`corrdiverse\` 一次ルールで選び、広いスリーブは同一。）

### 65/35 vs 50/50 — In-sample（2016–2020・$0.35）

| | 65/35 | 50/50 |
|---|---:|---:|
| CAGR | ${pct(sdi6535_35.is.cagr)} | ${pct(sdi5050_35.is.cagr)} |
| 最大DD | ${pct(sdi6535_35.is.maxDrawdown)} | ${pct(sdi5050_35.is.maxDrawdown)} |

### 手数料（OOS CAGR / 最大DD）

| 手数料 | 65/35 | 50/50 |
|---|---|---|
| $0.35 | ${pct(sdi6535_35.oos.cagr)} / ${pct(sdi6535_35.oos.maxDrawdown)} | ${pct(sdi5050_35.oos.cagr)} / ${pct(sdi5050_35.oos.maxDrawdown)} |
| $1.00 | ${pct(sdi6535_1.oos.cagr)} / ${pct(sdi6535_1.oos.maxDrawdown)} | ${pct(sdi5050_1.oos.cagr)} / ${pct(sdi5050_1.oos.maxDrawdown)} |

### 暦年リターン（$0.35）

| 年 | 65/35 | 50/50 | SPY | QQQ |
|---|---:|---:|---:|---:|
${Array.from({ length: ROUND18_CAL_YEAR_END - ROUND18_CAL_YEAR_START + 1 }, (_, i) => {
  const y = ROUND18_CAL_YEAR_START + i;
  const ys = String(y);
  const a = sdi6535_35.full.calendarYears[ys];
  const b = sdi5050_35.full.calendarYears[ys];
  const spyY = yearReturnPct(barsBy.get("SPY")!, y);
  const qqqY = yearReturnPct(barsBy.get("QQQ")!, y);
  return `| ${ys}${y === ROUND18_CAL_YEAR_END ? " YTD" : ""} | ${a != null ? pct(a) : "—"} | ${b != null ? pct(b) : "—"} | ${spyY != null ? pct(spyY) : "—"} | ${qqqY != null ? pct(qqqY) : "—"} |`;
}).join("\n")}

### 合格判定（OOS $0.35・Round 18 同一基準）

| 条件 | 65/35 | 50/50 |
|---|---|---|
| CAGR ≥ 10% | ${p6535.passCagr ? "✓" : "✗"} (${pct(sdi6535_35.oos.cagr)}) | ${p5050.passCagr ? "✓" : "✗"} (${pct(sdi5050_35.oos.cagr)}) |
| 最大DD < SPY | ${p6535.passDd ? "✓" : "✗"} | ${p5050.passDd ? "✓" : "✗"} |
| 7/10 年プラス | ${p6535.passYears ? "✓" : "✗"} | ${p5050.passYears ? "✓" : "✗"} |
| 参考 ≥12% / ≥13% | ${sdi6535_35.oos.cagr >= 0.12 ? "✓" : "✗"}/${sdi6535_35.oos.cagr >= 0.13 ? "✓" : "✗"} | ${sdi5050_35.oos.cagr >= 0.12 ? "✓" : "✗"}/${sdi5050_35.oos.cagr >= 0.13 ? "✓" : "✗"} |
| **3条件すべて** | ${p6535.passAll ? "✓" : "✗"} | ${p5050.passAll ? "✓" : "✗"} |

---

`;

  const corrQuarterRows = corrNs
    .map((n) => {
      const cells = corrMethods.map((m) => {
        const c = corrCell.get(`${m}/${n}/quarterly`)!;
        return `${pct(c.oos.cagr)} / ${pct(c.oos.maxDrawdown)}`;
      });
      return `| ${n} | ${cells.join(" | ")} |`;
    })
    .join("\n");
  const corrBestOos = [...corrCell.entries()]
    .map(([k, v]) => ({ k, cagr: v.oos.cagr, dd: v.oos.maxDrawdown }))
    .sort((a, b) => b.cagr - a.cagr)[0];
  const corrSection = `## 相関分散（correlation-diversified）

事前登録追補: \`${PREREG_CORR}\`（\`docs/ROUND18_PREREG_CORR_ja.md\`）

### 事実

- **一次:** 直近252営業日の日次リターン相関 → 平均相関が低い順に greedy 追加、既選銘柄と **ρ>0.7** ならスキップ。ウェイトは等ウェイト＋Round 18 セクター上限。
- **二次（volprune）:** ρ>0.7 ペアでボラ高い方を先に除外してから一次。
- 本編36構成の勝者選択は**変更なし**（相関は追試 36 セル）。

#### OOS CAGR / 最大DD（$0.35・**quarterly**）

| N | equal | invvol | corrdiverse | volprune |
|---:|---:|---:|---:|---:|
${corrQuarterRows}

（各セル: **CAGR / 最大DD**）

OOS CAGR 最大（全36セル）: \`${corrBestOos?.k ?? "—"}\`（CAGR ${corrBestOos ? pct(corrBestOos.cagr) : "—"}、DD ${corrBestOos ? pct(corrBestOos.dd) : "—"}）。

#### 相関ヒートマップ（${ROUND18_END} 時点・時価総額上位40・直近1年）

![相関ヒートマップ](round18_corr_heatmap.png)

**ρ > 0.7 のペア（上位40内・最大25件）**

${heatmapPairsBlock}

### 解釈

- equal / invvol は **時価総額上位 N** から選ぶが、corrdiverse は **全候補**から相関だけで選ぶため、セクター集中の出方が異なる。
- 二次 volprune は高相関ペアを削るが、OOS で常に優れるとは限らない（結果は上表）。
- 相関も **当日までの窓のみ**だが、銘柄集合・黒字は Round 18 同様のサバイバーシップ／ルックアヘッドあり。

---

`;

  const md = `# Round 18 — ロングオンリー・ポートフォリオ研究

${auditSection}
${sdiSection}
${corrSection}
## グリッド構成（36通り）— 事前登録

- コミット: \`${PREREG}\`（\`docs/ROUND18_PREREG_ja.md\`）
- 試行構成数: **${configs.length}**（多重検定に注意）
- サイト非掲載・研究のみ

## 事実（グリッド）

### ユニバース（実行時点）

- ウォッチリストから ONDS・金融・除外テーマ（SPCX 以外 space / quantum / crypto・CORZ / solar / nuclear）を除く
- **黒字:** 実行時点の Yahoo trailing EPS / TTM 純利益 → なければ EDGAR TTM（**全期間に適用＝ルックアヘッド**）
- **サバイバーシップ:** 今日のウォッチリストのみ
- 価格取得後の銘柄数: **${universe.length}**

### In-sample 選択（2016–2020・手数料 $0.35）

| 順位 | 構成 | CAGR | 最大DD |
|---:|---|---:|---:|
${topIs.map((r, i) => `| ${i + 1} | ${r.config.method} N=${r.config.n} ${r.config.rebal} | ${pct(r.cagr)} | ${pct(r.maxDrawdown)} |`).join("\n")}

**選択:** **${chosenLabel}**（事前登録のタイブレーク規則）

|  | In-sample | Out-of-sample (2021–2026-10-02) |
|---|---:|---:|
| CAGR | ${pct(at35.is.cagr)} | **${pct(at35.oos.cagr)}** |
| 最大DD | ${pct(at35.is.maxDrawdown)} | **${pct(at35.oos.maxDrawdown)}** |

### 選択構成 — 手数料別（OOS）

| 手数料/約定 | CAGR | 最大DD | DD回復(営業日) |
|---|---:|---:|---:|
| $0.35 | ${pct(at35.oos.cagr)} | ${pct(at35.oos.maxDrawdown)} | ${at35.oos.recoveryDays ?? "—"} |
| $1.00 | ${pct(at1.oos.cagr)} | ${pct(at1.oos.maxDrawdown)} | ${at1.oos.recoveryDays ?? "—"} |

### ベンチマーク（OOS・配当再投資相当の調整後終値）

| | CAGR | 最大DD |
|---|---:|---:|
| SPY | ${pct(spyOos.cagr)} | ${pct(spyOos.maxDrawdown)} |
| QQQ | ${pct(benchMetrics.QQQ.oos.cagr)} | ${pct(benchMetrics.QQQ.oos.maxDrawdown)} |
| SOXX | ${pct(benchMetrics.SOXX.oos.cagr)} | ${pct(benchMetrics.SOXX.oos.maxDrawdown)} |

### 暦年リターン（選択構成・$0.35）

| 年 | ポートフォリオ | SPY |
|---|---:|---:|
${Array.from({ length: ROUND18_CAL_YEAR_END - ROUND18_CAL_YEAR_START + 1 }, (_, i) => {
  const y = ROUND18_CAL_YEAR_START + i;
  const ys = String(y);
  const p = at35.full.calendarYears[ys];
  const spyY = yearReturnPct(barsBy.get("SPY")!, y);
  return `| ${ys}${y === ROUND18_CAL_YEAR_END ? " YTD" : ""} | ${p != null ? pct(p) : "—"} | ${spyY != null ? pct(spyY) : "—"} |`;
}).join("\n")}

プラス年数（2017–2026）: **${posYears} / 10**

### 事前登録合格判定（OOS・$0.35）

| 条件 | 結果 |
|---|---|
| CAGR ≥ 10% | ${passCagr ? "✓" : "✗"} (${pct(at35.oos.cagr)}) |
| 最大DDが SPY より浅い | ${passDd ? "✓" : "✗"} (PF ${pct(at35.oos.maxDrawdown)} vs SPY ${pct(spyOos.maxDrawdown)}) |
| 2017–2026 のうち7年以上プラス | ${passYears ? "✓" : "✗"} (${posYears}/10) |

参考: OOS CAGR ≥ 12% → ${at35.oos.cagr >= 0.12 ? "✓" : "✗"}；≥ 13% → ${at35.oos.cagr >= 0.13 ? "✓" : "✗"}

## 解釈

- **In-sample vs OOS:** CAGR ${pct(at35.is.cagr)} → ${pct(at35.oos.cagr)}。${Math.abs(at35.is.cagr - at35.oos.cagr) > 0.05 ? "ギャップが大きく、2016–20 で選んだ構成の過適合を疑う。" : "ギャップは中程度以下。"}
- **多重検定:** ${configs.length} 通りから in-sample 最大 CAGR を選んでいるため、OOS の有意性は過大評価されうる。
- **バイアス:** 今日のリスト・今日の黒字判定・固定株式数×価格の時価総額はいずれも過去に対するルックアヘッド／サバイバーシップ。
- **10% 目標:** 合格基準は OOS で ${passCagr && passDd && passYears ? "すべて満たした" : "満たしていない"}。現実的な運用では 12–13% ライン（参考）も併記した。

---

*生成: \`npx tsx scripts/round18-portfolio-study.ts\`*
`;

  fs.writeFileSync(DOC, md);
  console.log(
    JSON.stringify(
      {
        prereg: PREREG,
        universe: universe.length,
        chosen,
        pass: { passCagr, passDd, passYears, posYears },
        oosCagr35: at35.oos.cagr,
        configsTried: configs.length,
        sdi: {
          s6535: { oosCagr35: sdi6535_35.oos.cagr, pass: p6535 },
          s5050: { oosCagr35: sdi5050_35.oos.cagr, pass: p5050 },
          sptmFirst,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
