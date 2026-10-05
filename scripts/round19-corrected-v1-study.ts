/**
 * Bug-fix rerun of Round 19 v1 (same 30 configs + IS adoption rule).
 * Full CIK map, facts unknown≠loss, date-aligned corr, delta rebalance.
 *
 *   SEC_USER_AGENT='...' npx tsx scripts/round19-corrected-v1-study.ts
 */
import fs from "node:fs";
import path from "node:path";
import { loadWatchlist } from "../src/lib/watchlist";
import {
  SAKA_CONFIGS,
  SAKA_END,
  SAKA_INITIAL_CASH,
  SAKA_IS_END,
  SAKA_OOS_START,
  SAKA_REBAL_MIN_TRADE_USD,
  SAKA_REBAL_REL_DRIFT,
  SAKA_START,
  SAKA_CAL_YEARS,
  avgCorr,
  buildCorrInputs,
  calendarYearReturn,
  correlationMatrix,
  correlationMatrixByIndex,
  eligibilityFunnelCounts,
  feeDragSummary,
  filterEligibleCandidates,
  isSemiSubIndustry,
  maxPairwiseCorr,
  medianPairwiseCorr,
  metricsFromCurve,
  pairCorrelation,
  pickHoldings,
  profitabilityStatus,
  rebalanceDates,
  selectSakaConfig,
  simulateSaka,
  type SakaSimOptions,
  targetWeights,
  tradingDaysFromBars,
  ttmNetIncomePitAudit,
  type ProfitabilityStatus,
  type SakaCandidateContext,
  type SakaConfig,
} from "../src/lib/round19-saka";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE, pitPaths } from "../src/lib/pit-dataset";
import { buildPitFactsIndex, loadMergedPitFacts, pitFactsPathForTicker } from "../src/lib/pit-facts-index";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { loadSp500PitFiles, membersOnDate, uniqueTickersInRange, buildSameCikHandoffResolver } from "../src/lib/sp500-pit";
import { pitMarketCapForTicker } from "../src/lib/pit-mcap";
import { mcapCloseOnOrBefore } from "../src/lib/pit-mcap-price";
import { loadPitSplits } from "../src/lib/pit-splits";
import type { Bar } from "../src/lib/types";

const CACHE_V1 = path.join(process.cwd(), "data", ".cache", "round19");
const CACHE = path.join(process.cwd(), "data", ".cache", "round19v2");
const AUDIT = path.join(process.cwd(), "docs", "ROUND19_AUDIT_ja.md");
const PREREG = "6e3ad93";
const BENCH = ["SPY", "QQQ"] as const;

function loadBars(ticker: string): Bar[] {
  const pit = loadPitBars(ticker, PIT_CACHE);
  if (pit.length) return pit;
  const sym = ticker.replace(/\./g, "-");
  for (const dir of [CACHE, CACHE_V1]) {
    const f = path.join(dir, `${sym}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")) as Bar[];
  }
  return [];
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

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function factsCoverageOnDate(members: string[], date: string, hasFacts: (t: string) => boolean): number {
  if (!members.length) return 0;
  let n = 0;
  for (const t of members) if (hasFacts(t)) n += 1;
  return n / members.length;
}

async function main() {
  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const overrides = loadPitCikOverrides().cik;
  const cikResolved = await buildPitCikMapForTickers(PIT_CACHE, gics, tickers, overrides);
  const cikMapBuilt = new Map([...cikResolved.entries()].map(([t, r]) => [t, r.cik]));
  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const hasFactsFile = (t: string) =>
    pitFactsPathForTicker(t, cikMapBuilt.get(t), factsIndex, PIT_CACHE) != null ||
    fs.existsSync(path.join(CACHE, "facts", `${t}.json`)) ||
    fs.existsSync(path.join(CACHE_V1, "facts", `${t}.json`));
  const factByTicker = new Map<string, unknown | undefined>();
  const factForTicker = (t: string): unknown | undefined => {
    if (factByTicker.has(t)) return factByTicker.get(t);
    let json: unknown | undefined = loadMergedPitFacts(t, cikMapBuilt.get(t), factsIndex, PIT_CACHE);
    if (!json) {
      for (const dir of [path.join(CACHE, "facts"), path.join(CACHE_V1, "facts")]) {
        const f = path.join(dir, `${t}.json`);
        if (!fs.existsSync(f)) continue;
        json = JSON.parse(fs.readFileSync(f, "utf8"));
        break;
      }
    }
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
  let factsFileCount = 0;
  for (const t of tickers) if (hasFactsFile(t)) factsFileCount += 1;

  const barsBy = new Map<string, Bar[]>();
  for (const b of BENCH) barsBy.set(b, loadBars(b));
  for (const t of tickers) {
    const bars = loadBars(t);
    if (bars.length) barsBy.set(t, bars);
  }

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

  const wl = new Set<string>();
  for (const g of loadWatchlist().groups) for (const x of g.tickers) wl.add(x.ticker);

  const lastKnownShares = new Map<string, number>();
  const { sharesOutstandingAsOf } = await import("../src/lib/round19-saka");

  const ctx: SakaCandidateContext = {
    calendar,
    closeHistory,
    gicsOf: (t) => {
      const g = gics.get(t);
      if (!g) return null;
      return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
    },
    mcap: (t, date) =>
      pitMarketCapForTicker(t, barsBy.get(t) ?? [], factForTicker(t), date, PIT_CACHE),
    sharesLookup: (t, date) => {
      const f = factForTicker(t);
      const sh: number | null = f ? sharesOutstandingAsOf(f, date) : null;
      if (sh != null && sh > 0) return { shares: sh, stale: false };
      const prev = lastKnownShares.get(t);
      if (prev != null) return { shares: prev, stale: true };
      return { shares: 0, stale: true };
    },
    profitable: (t, date) => profitOf(t, date) === "profitable",
    hasPrice: (t, date) => mcapCloseOnOrBefore(barsBy.get(t) ?? [], date) != null,
    cikOf: (t) => cikMapBuilt.get(t) ?? null,
  };

  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);
  const funnelRows: string[] = [];
  for (const d of rebals) {
    const members = membersOn(d);
    const fc = eligibilityFunnelCounts(members, d, ctx, profitOf);
    const cov = factsCoverageOnDate(members, d, (t) => hasFactsFile(t));
    const el = filterEligibleCandidates(members, d, ctx);
    const inWl = el.filter((t) => wl.has(t)).length;
    funnelRows.push(
      `| ${d} | ${fc.pit} | ${fc.afterFinancial} | ${fc.noPrice} | ${fc.profitable} | ${fc.loss} | ${fc.unknownProfit} | ${fc.shareClassDeduped} | ${fc.eligible} | ${(cov * 100).toFixed(1)}% | ${el.length ? ((100 * inWl) / el.length).toFixed(1) : "—"}% |`,
    );
  }

  const lastRebal = rebals[rebals.length - 1]!;
  const corrDate = lastRebal;
  const pairs = [
    ["KLAC", "LRCX"],
    ["CVX", "XOM"],
    ["MO", "PM"],
    ["AMD", "NVDA"],
  ] as const;
  const pairLines = pairs.map(([a, b]) => {
    const r = pairCorrelation(a, b, calendar, closeHistory, corrDate);
    return `| ${a}–${b} | ${r != null ? r.toFixed(3) : "—"} |`;
  });
  const eligibleLast = filterEligibleCandidates(membersOn(corrDate), corrDate, ctx);
  const poolInputs = buildCorrInputs(eligibleLast, calendar, closeHistory, corrDate);
  const med = poolInputs ? medianPairwiseCorr(poolInputs.tickers, correlationMatrix(poolInputs)) : null;

  const rankCorrTop15 = (matrixFn: typeof correlationMatrix) => {
    if (!poolInputs) return [] as string[];
    const corr = matrixFn(poolInputs);
    const u = poolInputs.tickers;
    return [...u]
      .sort((a, b) => avgCorr(a, u, corr) - avgCorr(b, u, corr) || a.localeCompare(b))
      .slice(0, 15);
  };
  const top15Aligned = rankCorrTop15(correlationMatrix);
  const top15Index = rankCorrTop15(correlationMatrixByIndex);

  const pitExampleTicker = "AAPL";
  const pitExampleDate = "2020-01-02";
  const pitEx = ttmNetIncomePitAudit(factForTicker(pitExampleTicker), pitExampleDate);
  const pitExampleMd = pitEx.quarters.length
    ? pitEx.quarters
        .map((q) => `| ${q.end} | ${q.filed ?? "—"} | ${q.fp ?? "—"} | ${q.form ?? "—"} | ${(q.val / 1e9).toFixed(2)}B |`)
        .join("\n")
    : "| — | — | — | — | — |";

  const semiOf = (t: string) => ctx.gicsOf(t)?.semiBucket ?? false;
  const handoffSuccessor = buildSameCikHandoffResolver(intervals, (t) => cikMapBuilt.get(t) ?? null);
  const simOptsDelta = {
    rebalance: "delta" as const,
    minTradeUsd: SAKA_REBAL_MIN_TRADE_USD,
    relDrift: SAKA_REBAL_REL_DRIFT,
    handoffSuccessor,
  };
  const simOptsFull = { rebalance: "legacy_full_liquidate" as const };

  const runConfig = (config: SakaConfig, commission: number, simOpts: SakaSimOptions = simOptsDelta) => {
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
      simOpts,
    );
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
      oosFeeUsd: oosFees.totalFees,
      oosOrders: Object.values(
        Object.fromEntries(Object.entries(ordersPerYear).filter(([y]) => Number(y) >= 2021)),
      ).reduce((a, b) => a + b, 0),
    };
  };

  const spyBench = (() => {
    const anchor = spyBars.findIndex((b) => b.date >= SAKA_START);
    const p0 = spyBars[anchor].c;
    return spyBars
      .filter((b) => b.date >= SAKA_START && b.date <= SAKA_END)
      .map((b) => ({ date: b.date, equity: SAKA_INITIAL_CASH * (b.c / p0) }));
  })();
  const spyIs = metricsFromCurve(spyBench, calendar, SAKA_START, SAKA_IS_END);
  const spyOos = metricsFromCurve(spyBench.filter((p) => p.date >= SAKA_OOS_START), calendar, SAKA_OOS_START, SAKA_END);

  const results35: Array<ReturnType<typeof runConfig> & { config: SakaConfig }> = [];
  for (let i = 0; i < SAKA_CONFIGS.length; i += 1) {
    const config = SAKA_CONFIGS[i];
    console.error(`[corrected-v1] sim ${i + 1}/${SAKA_CONFIGS.length} ${config.id}`);
    results35.push({ config, ...runConfig(config, 0.35) });
  }
  const chosen = selectSakaConfig(
    results35.map((r) => ({ config: r.config, is: r.is, turnover: r.turnoverPerRebal })),
    spyIs.maxDrawdown,
  );
  const adopted = chosen ?? results35[0].config;
  const adoptedRun = results35.find((r) => r.config.id === adopted.id)!;
  const adoptedFull = runConfig(adopted, 0.35, simOptsFull);
  const corrEq = SAKA_CONFIGS.find((c) => c.id === "corrdiverse_15__equal")!;
  const corrEqDelta = runConfig(corrEq, 0.35, simOptsDelta);
  const corrEqFull = runConfig(corrEq, 0.35, simOptsFull);
  const oosSorted = [...results35].sort((a, b) => b.oos.cagr - a.oos.cagr);
  const adoptedRank = oosSorted.findIndex((r) => r.config.id === adopted.id) + 1;
  const semiHeld = (config: SakaConfig, from: string, to: string) => {
    const dates = rebalanceDates(calendar, from, to);
    for (const d of dates) {
      const y = Number(d.slice(0, 4));
      if (y < 2023 || y > 2024) continue;
      const h = pickHoldings(config, filterEligibleCandidates(membersOn(d), d, ctx), d, ctx);
      if (h.some((t) => semiOf(t))) return true;
    }
    return false;
  };

  const holdings = pickHoldings(adopted, filterEligibleCandidates(membersOn(lastRebal), lastRebal, ctx), lastRebal, ctx);
  const weights = targetWeights(adopted, holdings, lastRebal, ctx, semiOf);
  const hInputs = buildCorrInputs(holdings, calendar, closeHistory, lastRebal);
  const hCorr = hInputs ? correlationMatrix(hInputs) : new Map();
  const maxRho = maxPairwiseCorr(holdings, hCorr);
  const pairsHigh: string[] = [];
  for (let i = 0; i < holdings.length; i += 1) {
    for (let j = i + 1; j < holdings.length; j += 1) {
      const r = hCorr.get(holdings[i])?.get(holdings[j]) ?? 0;
      if (r > 0.6) pairsHigh.push(`${holdings[i]}–${holdings[j]} (${r.toFixed(2)})`);
    }
  }
  const holdingsMd = holdings
    .map((t) => `| ${t} | ${ctx.gicsOf(t)?.sector ?? "—"} | ${pct(weights[t] ?? 0)} |`)
    .join("\n");

  const yearRows = SAKA_CAL_YEARS.map((y) => {
    const ys = String(y);
    const p = adoptedRun.full.calendarYears[ys];
    const spyY = calendarYearReturn(spyBench, calendar, y, SAKA_END);
    return `| ${ys}${y === 2026 ? " YTD" : ""} | ${p != null ? pct(p) : "—"} | ${spyY != null ? pct(spyY) : "—"} |`;
  });
  const adoptedFullMetrics = adoptedRun.full;
  const passCagr = adoptedRun.oos.cagr >= 0.1;
  const passDd = adoptedRun.oos.maxDrawdown > spyOos.maxDrawdown;
  const passYears = adoptedFullMetrics.positiveYearShare >= 0.7;
  const beatsSpyCagr = adoptedRun.oos.cagr > spyOos.cagr;

  const oosTable = oosSorted
    .map((r, i) => {
      const hl = r.config.id === adopted.id ? "**" : "";
      return `| ${i + 1} | ${hl}${r.config.id}${hl} | ${pct(r.oos.cagr)} | ${pct(r.oos.maxDrawdown)} | $${r.oosFeeUsd.toFixed(0)} (${r.oosOrders} ord) |`;
    })
    .join("\n");

  const noCik = tickers.filter((t) => !cikMapBuilt.get(t)).length;
  const corrRankSame = top15Aligned.join(",") === top15Index.join(",");
  const minFactsRebal = Math.min(
    ...rebals.map((d) => {
      const m = membersOn(d);
      let n = 0;
      for (const t of m) if (hasFactsFile(t)) n += 1;
      return m.length ? n / m.length : 0;
    }),
  );
  const minPriceRebal = Math.min(
    ...rebals.map((d) => {
      const m = membersOn(d);
      let n = 0;
      for (const t of m) if (loadBars(t).length > 0) n += 1;
      return m.length ? n / m.length : 0;
    }),
  );
  const baselineE2380 = {
    adopted: "plain_15__equal",
    oosCagr: 0.154,
    oosDd: -0.203,
    rank: 5,
    nConfigs: 30,
  };

  const section = `

## Corrected v1（バグ修正再実行・**新デザインではない**）

事前登録 \`${PREREG}\` の **30 構成・IS 採用規則は同一**。データは \`data/.cache/pit/\`（\`docs/DATA_PIT_ja.md\`）。

### 事実 — 修正内容

| 修正 | 内容 |
|---|---|
| CIK | SEC マップ + \`PIT_TICKER_ALIASES\` + \`data/pit_cik_overrides.json\`（版管理） |
| 価格 | Yahoo（\`pit_price_ticker_aliases.json\` で現行ティッカー）→ Stooq → pickdani GitHub CSV；\`price_meta.json\` に source |
| EDGAR | facts 欠損は **unknown**；黒字は **filed ≤ リバランス日** の四半期のみ TTM（\`ttmNetIncomePitAudit\`） |
| 相関 | 日付キーでリターンを揃えて Pearson |
| 株クラス | 同一 CIK は 1 銘柄（GOOG/GOOGL 等） |
| 約定 | 主表は **差分リバランス**（\$${SAKA_REBAL_MIN_TRADE_USD} / ${(SAKA_REBAL_REL_DRIFT * 100).toFixed(0)}% ドリフト） |

### 事実 — データカバレッジ

- PIT ユニーク: **${tickers.length}**／facts ファイル **${factsFileCount}**（${((100 * factsFileCount) / tickers.length).toFixed(1)}%）
- CIK 未解決: **${noCik}**
- リバランス日 PIT 構成に対する **facts** 最悪値: **${(minFactsRebal * 100).toFixed(1)}%**（目標 ≥95%）
- リバランス日 PIT 構成に対する **価格** 最悪値: **${(minPriceRebal * 100).toFixed(1)}%**（目標 ≥95%）

**Before/after（\`e2380b8\` → 本実行）:** 採用 **${baselineE2380.adopted}** → **${adopted.id}**；OOS CAGR **${(baselineE2380.oosCagr * 100).toFixed(1)}%** → **${pct(adoptedRun.oos.cagr)}**；OOS DD **${(baselineE2380.oosDd * 100).toFixed(1)}%** → **${pct(adoptedRun.oos.maxDrawdown)}**；OOS 順位 **${baselineE2380.rank}/${baselineE2380.nConfigs}** → **${adoptedRank}/${oosSorted.length}**

### 事実 — PIT 黒字（コード根拠）

\`round19-saka.ts\` の \`factFiledOnOrBefore\` が各 \`NetIncomeLoss\` 四半期の **\`filed\`** をリバランス日以下でフィルタ。例 **${pitExampleTicker}** @ **${pitExampleDate}**（TTM **${pitEx.ttmNetIncome != null ? (pitEx.ttmNetIncome / 1e9).toFixed(2) + "B" : "—"}**）:

| 四半期終了 | filed | fp | form | 値 |
|---|---|---|---|---:|
${pitExampleMd}

### 事実 — 四半期漏斗（修正後）

「−価格なし」= 金融・テーマ後でも当日株価が無い銘柄（旧表の 297+18+13≠454 の差 **126** はここ）。「−株クラス」= 黒字後の重複 CIK 除外数。

| 日付 | PIT | 金融・テーマ後 | −価格なし | 黒字 | 赤字 | unknown | −株クラス | eligible | facts/PIT | ∩watchlist |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${funnelRows.join("\n")}

### 事実 — 相関（${corrDate}）

| ペア | ρ（日付揃え） |
|---|---:|
${pairLines.join("\n")}
| プール中央値 | ${med != null ? med.toFixed(3) : "—"} |

**corrdiverse 用「平均ρ 低い順」上位 15（日付揃え）:** ${top15Aligned.join(", ")}

**旧方式（インデックス揃え・監査比較）:** ${top15Index.join(", ")} — リスト一致: **${corrRankSame ? "はい" : "いいえ"}**

### 事実 — IS 採用

- **${adopted.id}**（IS CAGR ${pct(adoptedRun.is.cagr)}、DD ${pct(adoptedRun.is.maxDrawdown)}）

### 事実 — OOS（$0.35・差分リバランス）

| 順位 | 構成 | OOS 年率 | OOS DD | OOS 手数料 |
|---:|---|---:|---:|---|
${oosTable}
| — | SPY | ${pct(spyOos.cagr)} | ${pct(spyOos.maxDrawdown)} | — |

**OOS 順位:** ${adoptedRank} / ${oosSorted.length}

### 事実 — 暦年リターン（採用 vs SPY・前年最終営業日）

| 年 | ${adopted.id} | SPY |
|---|---:|---:|
${yearRows.join("\n")}

**プラス年比率（2016–2026）:** ${(adoptedFullMetrics.positiveYearShare * 100).toFixed(0)}%

### 事実 — 事前登録合格基準（OOS・$0.35）

| 基準 | 採用構成 | 判定 |
|---|---|---|
| OOS CAGR ≥ 10% | ${pct(adoptedRun.oos.cagr)} | ${passCagr ? "合格" : "不合格"} |
| OOS MaxDD < SPY（${pct(spyOos.maxDrawdown)}） | ${pct(adoptedRun.oos.maxDrawdown)} | ${passDd ? "合格" : "不合格"} |
| 暦年プラス ≥ 70% | ${(adoptedFullMetrics.positiveYearShare * 100).toFixed(0)}% | ${passYears ? "合格" : "不合格"} |
| （参考）OOS CAGR > SPY | ${pct(adoptedRun.oos.cagr)} vs ${pct(spyOos.cagr)} | ${beatsSpyCagr ? "はい" : "いいえ"} |

### 事実 — 手数料の同条件比較（OOS・$0.35）

| 構成 | 差分リバランス | 全売却→再購入 |
|---|---|---|
| corrdiverse_15__equal | \$${corrEqDelta.oosFeeUsd.toFixed(0)} / ${corrEqDelta.oosOrders} 注文 | \$${corrEqFull.oosFeeUsd.toFixed(0)} / ${corrEqFull.oosOrders} 注文 |
| **${adopted.id}** | \$${adoptedRun.oosFeeUsd.toFixed(0)} / ${adoptedRun.oosOrders} 注文 | \$${adoptedFull.oosFeeUsd.toFixed(0)} / ${adoptedFull.oosOrders} 注文 |

### 事実 — 最終ホールディング（${lastRebal}）

最大ペア ρ: **${maxRho.toFixed(2)}**。ρ>0.6: ${pairsHigh.length ? pairsHigh.join("; ") : "なし"}

| ティッカー | セクター | ウェイト |
|---|---|---:|
${holdingsMd}

### 事実 — 半導体（2023–2024）

- 採用 **${adopted.id}**: **${semiHeld(adopted, "2023-01-01", "2024-12-31") ? "あり" : "なし"}**
- plain_20__mcap: **${semiHeld(SAKA_CONFIGS.find((c) => c.id === "plain_20__mcap")!, "2023-01-01", "2024-12-31") ? "あり" : "なし"}**

### 解釈

- watchlist 100% 張り付きは解消（∩watchlist はおおむね 25–28%）。eligible 拡大により IS 採用が **mcap 上位 plain** に移った可能性がある（過適合リスクは v1 事前登録どおり残る）。
- facts カバレッジが 2016 台で 77–88% の四半期は、PIT 構成員の EDGAR 未取得が残っている（\`rebuild-pit-dataset.ts --fetch-facts\` で改善）。

*生成: \`npx tsx scripts/round19-corrected-v1-study.ts\`*
`;

  let audit = fs.readFileSync(AUDIT, "utf8");
  if (!audit.includes("## Corrected v1")) audit = audit.trimEnd() + section;
  else audit = audit.replace(/\n## Corrected v1[\s\S]*$/, section);

  const s5Path = path.join(process.cwd(), "docs", "ROUND19_AUDIT_section5.md");
  if (fs.existsSync(s5Path) && !audit.includes("## (5)")) {
    const s5 = fs.readFileSync(s5Path, "utf8");
    const insertAt = audit.indexOf("\n## (7)");
    if (insertAt > 0) audit = audit.slice(0, insertAt) + "\n" + s5.trim() + "\n" + audit.slice(insertAt);
  }
  fs.writeFileSync(AUDIT, audit);

  console.log(
    JSON.stringify(
      {
        adopted: adopted.id,
        rank: adoptedRank,
        factsPct: factsFileCount / tickers.length,
        lastEligible: funnelRows[funnelRows.length - 1],
        oosFee: adoptedRun.oosFeeUsd,
        oosOrders: adoptedRun.oosOrders,
        medianCorr: med,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
