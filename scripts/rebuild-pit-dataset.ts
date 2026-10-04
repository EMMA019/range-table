/**
 * Rebuild PIT fundamentals + price dataset (cache: data/.cache/pit/, not committed).
 *
 *   SEC_USER_AGENT='range-table you@example.com' npx tsx scripts/rebuild-pit-dataset.ts
 *   npx tsx scripts/rebuild-pit-dataset.ts --resolve-only
 *   npx tsx scripts/rebuild-pit-dataset.ts --fetch-facts --fetch-prices
 */
import fs from "node:fs";
import path from "node:path";
import { edgarJson, EdgarDisabledError } from "../src/lib/edgar-client";
import { fetchDailyBars } from "../src/lib/yahoo";
import {
  PIT_CACHE,
  pitPaths,
  type PitManifest,
} from "../src/lib/pit-dataset";
import { buildPitFactsIndex, pitFactsPathForTicker } from "../src/lib/pit-facts-index";
import { buildPitCikMapForTickers, searchCikEfts, type CikResolution } from "../src/lib/pit-cik";
import { fetchStooqDailyBars, mergePriceBars } from "../src/lib/pit-prices";
import { SAKA_END, SAKA_START, rebalanceDates, tradingDaysFromBars } from "../src/lib/round19-saka";
import { loadSp500PitFiles, membersOnDate, uniqueTickersInRange } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const LEGACY = [path.join(process.cwd(), "data", ".cache", "round19v2"), path.join(process.cwd(), "data", ".cache", "round19")];
const DOC = path.join(process.cwd(), "docs", "DATA_PIT_ja.md");

function companyFactsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadLegacyBars(ticker: string): Bar[] {
  const sym = ticker.replace(/\./g, "-");
  for (const dir of LEGACY) {
    const f = path.join(dir, `${sym}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")) as Bar[];
  }
  return [];
}

function loadLegacyFacts(ticker: string): unknown | null {
  for (const dir of LEGACY) {
    const f = path.join(dir, "facts", `${ticker}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  }
  return null;
}

async function main() {
  const resolveOnly = process.argv.includes("--resolve-only");
  const fetchFacts = process.argv.includes("--fetch-facts");
  const fetchPrices = process.argv.includes("--fetch-prices");
  const eftsSearch = process.argv.includes("--efts-search");

  const paths = pitPaths(PIT_CACHE);
  fs.mkdirSync(paths.facts, { recursive: true });
  fs.mkdirSync(paths.prices, { recursive: true });

  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const pitTickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);

  let overrides: Record<string, number> = {};
  if (fs.existsSync(paths.overrides)) overrides = JSON.parse(fs.readFileSync(paths.overrides, "utf8")) as Record<string, number>;

  const cikRes = await buildPitCikMapForTickers(PIT_CACHE, gics, pitTickers, overrides);
  const missing = pitTickers.filter((t) => !cikRes.has(t));

  if (eftsSearch && process.env.SEC_USER_AGENT?.trim()) {
    for (const t of missing) {
      const g = gics.get(t);
      const name = g ? (g as { ticker: string }).ticker : t;
      const secName = [...gics.values()].find((x) => x.ticker === t);
      const cik = await searchCikEfts(t, secName?.subIndustry ? `${t} ${secName.sector}` : t);
      if (cik) {
        overrides[t] = cik;
        cikRes.set(t, { cik, source: "efts" });
      }
      await sleep(250);
    }
    fs.writeFileSync(paths.overrides, JSON.stringify(overrides, null, 2));
  }

  const cikOut: Record<string, CikResolution> = {};
  for (const t of pitTickers) {
    const r = cikRes.get(t);
    if (r) cikOut[t] = r;
  }
  fs.writeFileSync(paths.cikMap, JSON.stringify(cikOut, null, 2));

  if (!resolveOnly) {
    for (const t of pitTickers) {
      const dest = path.join(paths.facts, `${t}.json`);
      if (!fs.existsSync(dest)) {
        const leg = loadLegacyFacts(t);
        if (leg) fs.writeFileSync(dest, JSON.stringify(leg));
      }
    }
    const factsByCik = new Map<number, string>();
    for (const f of fs.readdirSync(paths.facts)) {
      if (!f.endsWith(".json")) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(paths.facts, f), "utf8")) as { cik?: number };
        const cik = typeof j.cik === "number" ? j.cik : Number(String(j.cik).replace(/\D/g, ""));
        if (cik > 0 && !factsByCik.has(cik)) factsByCik.set(cik, f);
      } catch {
        /* skip */
      }
    }
    for (const t of pitTickers) {
      const dest = path.join(paths.facts, `${t}.json`);
      if (fs.existsSync(dest)) continue;
      const r = cikRes.get(t);
      if (!r) continue;
      const donor = factsByCik.get(r.cik);
      if (!donor) continue;
      fs.copyFileSync(path.join(paths.facts, donor), dest);
    }
  }

  if (fetchFacts && process.env.SEC_USER_AGENT?.trim()) {
    let n = 0;
    for (const t of pitTickers) {
      const dest = path.join(paths.facts, `${t}.json`);
      if (fs.existsSync(dest)) continue;
      const r = cikRes.get(t);
      if (!r) continue;
      try {
        const json = await edgarJson(companyFactsUrl(r.cik));
        fs.writeFileSync(dest, JSON.stringify(json));
        n += 1;
        if (n % 20 === 0) console.error(`[pit] facts ${n}`);
      } catch (e) {
        if (e instanceof EdgarDisabledError) break;
      }
    }
  }

  if (fetchPrices) {
    for (let i = 0; i < pitTickers.length; i += 1) {
      const t = pitTickers[i];
      const dest = path.join(paths.prices, `${t.replace(/\./g, "-")}.json`);
      if (fs.existsSync(dest)) continue;
      let bars = loadLegacyBars(t);
      if (!bars.length) {
        try {
          const { bars: y } = await fetchDailyBars(t.replace(/\./g, "-"), { range: "20y", keep: 3200, totalReturn: true });
          bars = y;
        } catch {
          bars = [];
        }
      }
      const stooq = await fetchStooqDailyBars(t);
      bars = mergePriceBars(bars, stooq);
      if (bars.length) fs.writeFileSync(dest, JSON.stringify(bars));
      if (i % 50 === 0) console.error(`[pit] prices ${i}/${pitTickers.length}`);
      await sleep(80);
    }
  } else if (!resolveOnly) {
    for (const t of pitTickers) {
      const dest = path.join(paths.prices, `${t.replace(/\./g, "-")}.json`);
      if (fs.existsSync(dest)) continue;
      const leg = loadLegacyBars(t);
      if (leg.length) fs.writeFileSync(dest, JSON.stringify(leg));
    }
  }

  const spy = loadLegacyBars("SPY");
  const calendar = tradingDaysFromBars(spy);
  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);
  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const rebalanceCoverage = rebals.map((date) => {
    const members = membersOnDate(intervals, date);
    let withFacts = 0;
    let withPrice = 0;
    for (const t of members) {
      const cik = cikRes.get(t)?.cik;
      if (pitFactsPathForTicker(t, cik, factsIndex, PIT_CACHE)) withFacts += 1;
      const pb = path.join(paths.prices, `${t.replace(/\./g, "-")}.json`);
      if (fs.existsSync(pb)) withPrice += 1;
    }
    const n = members.length || 1;
    return {
      date,
      pitMembers: members.length,
      withFacts,
      factsPct: withFacts / n,
      withPrice,
      pricePct: withPrice / n,
    };
  });

  const factsFiles = fs.readdirSync(paths.facts).filter((f) => f.endsWith(".json")).length;
  const priceFiles = fs.readdirSync(paths.prices).filter((f) => f.endsWith(".json")).length;
  const manifest: PitManifest = {
    version: 1,
    builtAt: new Date().toISOString(),
    pitTickers: pitTickers.length,
    cikResolved: Object.keys(cikOut).length,
    factsFiles,
    priceFiles,
    rebalanceCoverage,
  };
  fs.writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2));

  const miss = pitTickers.filter((t) => !cikOut[t]);
  const minFactsPct = Math.min(...rebalanceCoverage.map((r) => r.factsPct));

  const md = `# PIT データセット（S&P 500・2016–2026）

**キャッシュ:** \`data/.cache/pit/\`（git 非コミット）  
**再生成:** \`SEC_USER_AGENT='…' npx tsx scripts/rebuild-pit-dataset.ts --fetch-facts --fetch-prices\`

## 概要

| 項目 | 値 |
|---|---:|
| PIT ユニーク銘柄 | ${pitTickers.length} |
| CIK 解決 | ${Object.keys(cikOut).length}（未解決 **${miss.length}**） |
| companyfacts ファイル | ${factsFiles} |
| 価格ファイル | ${priceFiles} |
| 最悪リバランス facts/PIT 構成 | **${(minFactsPct * 100).toFixed(1)}%**（目標 ≥95%） |

## CIK 解決順

1. GICS \`sp500.csv\` の CIK 列（クォート付き CSV パース）
2. SEC \`company_tickers.json\` + \`company_tickers_exchange.json\`
3. \`src/lib/pit-cik.ts\` の \`PIT_TICKER_ALIASES\`（旧ティッカー→現行）
4. \`data/.cache/pit/cik_overrides.json\`（手動 / \`--efts-search\`）

## 価格

- 優先: 既存 Yahoo adjclose（\`round19\` / \`round19v2\` キャッシュ）
- 欠損: Stooq 日足（\`pit-prices.ts\`）
- それでも無い銘柄は manifest の price% に反映（スタディ側で除外または最終価格固定）

## 黒字（PIT）

\`ttmNetIncomeAsOf\` は各四半期ファクトの **\`filed\` 日 ≤ リバランス日** のみ使用（\`round19-saka.ts\` \`factFiledOnOrBefore\`）。欠損 facts は **unknown**（赤字扱いしない）。

## リバランスごとのカバレッジ

| 日付 | PIT 構成 | facts | facts% | 価格 | 価格% |
|---|---:|---:|---:|---:|---:|
${rebalanceCoverage.map((r) => `| ${r.date} | ${r.pitMembers} | ${r.withFacts} | ${(r.factsPct * 100).toFixed(1)}% | ${r.withPrice} | ${(r.pricePct * 100).toFixed(1)}% |`).join("\n")}

## 未解決 CIK（先頭 30）

${miss.length ? miss.slice(0, 30).join(", ") : "（なし）"}

---

*自動生成: \`scripts/rebuild-pit-dataset.ts\`*
`;
  fs.writeFileSync(DOC, md);

  console.log(
    JSON.stringify(
      { pitTickers: pitTickers.length, cikResolved: Object.keys(cikOut).length, missing: miss.length, minFactsPct, factsFiles, priceFiles },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
