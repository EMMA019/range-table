/**
 * Round 18 portfolio study (research only). Writes docs/ROUND18_ja.md.
 * Bars cache: data/.cache/round18/ (gitignored). No CSV output.
 *
 *   SEC_USER_AGENT='range-table research contact@example.com' npx tsx scripts/round18-portfolio-study.ts
 */
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
  round18Configs,
  selectRound18Config,
  simulateRound18,
  tradingDaysFromBars,
  type Round18Config,
} from "../src/lib/round18-portfolio";
import type { Bar } from "../src/lib/types";

const CACHE = path.join(process.cwd(), "data", ".cache", "round18");
const DOC = path.join(process.cwd(), "docs", "ROUND18_ja.md");
const BENCH = ["SPY", "QQQ", "SOXX"] as const;
const PREREG = "b8ec490";

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
  const { bars } = await fetchDailyBars(sym, { range: "max", keep: 3200 });
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

async function main() {
  const fresh = process.argv.includes("--fresh");
  const tickers = watchlistTickers();
  const barsBy = new Map<string, Bar[]>();

  for (const b of BENCH) {
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

  const md = `# Round 18 — ロングオンリー・ポートフォリオ研究

## 事前登録

- コミット: \`${PREREG}\`（\`docs/ROUND18_PREREG_ja.md\`）
- 試行構成数: **${configs.length}**（多重検定に注意）
- サイト非掲載・研究のみ

## 事実

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
