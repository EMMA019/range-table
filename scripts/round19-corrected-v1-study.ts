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
  buildCorrInputs,
  calendarYearReturn,
  correlationMatrix,
  eligibilityFunnelCounts,
  feeDragSummary,
  filterEligibleCandidates,
  isSemiSubIndustry,
  medianPairwiseCorr,
  metricsFromCurve,
  pairCorrelation,
  pickHoldings,
  profitabilityStatus,
  rebalanceDates,
  selectSakaConfig,
  simulateSaka,
  targetWeights,
  tradingDaysFromBars,
  type ProfitabilityStatus,
  type SakaCandidateContext,
  type SakaConfig,
} from "../src/lib/round19-saka";
import { buildFullTickerCikMap, loadSecTickerCikMap, resolveCik } from "../src/lib/sec-ticker-cik";
import { loadSp500PitFiles, membersOnDate, uniqueTickersInRange } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const CACHE_V1 = path.join(process.cwd(), "data", ".cache", "round19");
const CACHE = path.join(process.cwd(), "data", ".cache", "round19v2");
const AUDIT = path.join(process.cwd(), "docs", "ROUND19_AUDIT_ja.md");
const PREREG = "6e3ad93";
const BENCH = ["SPY", "QQQ"] as const;

function loadBars(ticker: string): Bar[] {
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
  const { intervals, gics } = await loadSp500PitFiles(CACHE);
  const secMap = await loadSecTickerCikMap(CACHE);
  const cikMap = buildFullTickerCikMap(gics, secMap);
  const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const factsDir = path.join(CACHE, "facts");
  const hasFactsFile = (t: string) =>
    fs.existsSync(path.join(factsDir, `${t}.json`)) || fs.existsSync(path.join(CACHE_V1, "facts", `${t}.json`));
  const factByTicker = new Map<string, unknown | undefined>();
  const factForTicker = (t: string): unknown | undefined => {
    if (factByTicker.has(t)) return factByTicker.get(t);
    let json: unknown | undefined;
    for (const dir of [factsDir, path.join(CACHE_V1, "facts")]) {
      const f = path.join(dir, `${t}.json`);
      if (!fs.existsSync(f)) continue;
      json = JSON.parse(fs.readFileSync(f, "utf8"));
      break;
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
    mcap: (t, date) => {
      const p = price(t, date);
      const f = factForTicker(t);
      let sh: number | null = f ? sharesOutstandingAsOf(f, date) : null;
      if (sh != null && sh > 0) lastKnownShares.set(t, sh);
      else sh = lastKnownShares.get(t) ?? null;
      if (p == null || !sh || sh <= 0) return 0;
      return p * sh;
    },
    sharesLookup: (t, date) => {
      const f = factForTicker(t);
      let sh: number | null = f ? sharesOutstandingAsOf(f, date) : null;
      if (sh != null && sh > 0) return { shares: sh, stale: false };
      const prev = lastKnownShares.get(t);
      if (prev != null) return { shares: prev, stale: true };
      return { shares: 0, stale: true };
    },
    profitable: (t, date) => profitOf(t, date) === "profitable",
    hasPrice: (t, date) => price(t, date) != null,
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
      `| ${d} | ${fc.pit} | ${fc.afterFinancial} | ${fc.profitable} | ${fc.loss} | ${fc.unknownProfit} | ${fc.eligible} | ${(cov * 100).toFixed(1)}% | ${el.length ? ((100 * inWl) / el.length).toFixed(1) : "—"}% |`,
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

  const semiOf = (t: string) => ctx.gicsOf(t)?.semiBucket ?? false;
  const simOpts = { rebalance: "delta" as const, minTradeUsd: SAKA_REBAL_MIN_TRADE_USD, relDrift: SAKA_REBAL_REL_DRIFT };

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
  const holdingsMd = holdings
    .map((t) => `| ${t} | ${ctx.gicsOf(t)?.sector ?? "—"} | ${pct(weights[t] ?? 0)} |`)
    .join("\n");

  const oosTable = oosSorted
    .map((r, i) => {
      const hl = r.config.id === adopted.id ? "**" : "";
      return `| ${i + 1} | ${hl}${r.config.id}${hl} | ${pct(r.oos.cagr)} | ${pct(r.oos.maxDrawdown)} | $${r.oosFeeUsd.toFixed(0)} (${r.oosOrders} ord) |`;
    })
    .join("\n");

  const noCik = tickers.filter((t) => !resolveCik(t, gics.get(t)?.cik, cikMap)).length;

  const section = `

## Corrected v1（バグ修正再実行・**新デザインではない**）

事前登録 \`${PREREG}\` の **30 構成・IS 採用規則は同一**。変更点のみ:

| 修正 | 内容 |
|---|---|
| CIK | SEC \`company_tickers.json\` + GICS CSV CIK（\`resolveCik\`）。watchlist 限定 \`sec_cik.json\` は使わない |
| EDGAR | facts 欠損は **unknown**（赤字扱いしない）。eligible は **profitable のみ** |
| 相関 | 日付キーでリターンを揃えてから Pearson（\`pearsonOnAlignedSeries\`） |
| 約定 | **差分リバランス**（除名は全売り、新規は買い、継続は \|Δ\|≥$${SAKA_REBAL_MIN_TRADE_USD} **または** 相対ドリフト≥${(SAKA_REBAL_REL_DRIFT * 100).toFixed(0)}% のときのみ） |

### データカバレッジ

- PIT ユニーク銘柄: **${tickers.length}**
- facts ファイル: **${factsFileCount}**（${((100 * factsFileCount) / tickers.length).toFixed(1)}%）
- CIK 未解決: **${noCik}**
- 目標 facts≥95%/リバランス → 下表「facts %」列

### 四半期 eligible（修正後）

| 日付 | PIT | 金融・テーマ後 | 黒字 | 赤字 | unknown | eligible | facts/PIT | ∩watchlist |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${funnelRows.join("\n")}

### 相関サニティ（${corrDate}・eligible プール）

| ペア | ρ（252d log、日付揃え） |
|---|---:|
${pairLines.join("\n")}
| **プール中央値**（ペアワイズ） | ${med != null ? med.toFixed(3) : "—"} |

### IS 採用構成

- **${adopted.id}**（IS CAGR ${pct(adoptedRun.is.cagr)}、DD ${pct(adoptedRun.is.maxDrawdown)}）

### OOS 全構成（$0.35・差分リバランス）

| 順位 | 構成 | OOS 年率 | OOS DD | OOS 手数料 |
|---:|---|---:|---:|---|
${oosTable}
| — | SPY | ${pct(spyOos.cagr)} | ${pct(spyOos.maxDrawdown)} | — |

**OOS 順位:** ${adoptedRank} / ${oosSorted.length}

### 最終ホールディング（${lastRebal}）

| ティッカー | セクター | ウェイト |
|---|---|---:|
${holdingsMd}

### 半導体（2023–2024 四半期）

- 採用構成 **${adopted.id}**: **${semiHeld(adopted, "2023-01-01", "2024-12-31") ? "あり" : "なし"}**
- 参考 plain_20__mcap: **${semiHeld(SAKA_CONFIGS.find((c) => c.id === "plain_20__mcap")!, "2023-01-01", "2024-12-31") ? "あり" : "なし"}**

### OOS 手数料（採用・$0.35）

- 合計 **$${adoptedRun.oosFeeUsd.toFixed(0)}**（**${adoptedRun.oosOrders}** 注文）

*生成: \`npx tsx scripts/round19-corrected-v1-study.ts\`（キャッシュはコミットしない）*
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
