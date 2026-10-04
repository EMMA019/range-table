/**
 * Step 0 coverage gate — before/after CIK fix; optional facts fetch.
 *   SEC_USER_AGENT='...' npx tsx scripts/round19v2-step0-coverage.ts [--fetch-facts]
 */
import fs from "node:fs";
import path from "node:path";
import { edgarJson, EdgarDisabledError } from "../src/lib/edgar-client";
import {
  SAKA_END,
  SAKA_START,
  filterEligibleCandidates,
  isExcludedTheme,
  isFinancialSector,
  rebalanceDates,
  sharesOutstandingAsOf,
  tradingDaysFromBars,
  ttmNetIncomeAsOf,
  type SakaCandidateContext,
} from "../src/lib/round19-saka";
import { loadWatchlist } from "../src/lib/watchlist";
import { loadSp500PitFiles, membersOnDate, parseSp500GicsCsv, uniqueTickersInRange } from "../src/lib/sp500-pit";
import { loadSecTickerCikMap, resolveCik } from "../src/lib/sec-ticker-cik";
import type { Bar } from "../src/lib/types";

const CACHE_V1 = path.join(process.cwd(), "data", ".cache", "round19");
const CACHE = path.join(process.cwd(), "data", ".cache", "round19v2");
const DOC = path.join(process.cwd(), "docs", "ROUND19V2_STEP0_ja.md");
const MIN_ELIGIBLE_SHARE = 0.45;

function companyFactsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
}

function loadBars(ticker: string, dir: string): Bar[] {
  const sym = ticker.replace(/\./g, "-");
  const f = path.join(dir, `${sym}.json`);
  if (!fs.existsSync(f)) return [];
  return JSON.parse(fs.readFileSync(f, "utf8")) as Bar[];
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

async function main() {
  const fetchFacts = process.argv.includes("--fetch-facts");
  const { intervals } = await loadSp500PitFiles(CACHE);
  const gicsBroken = parseSp500GicsCsv(fs.readFileSync(path.join(CACHE, "sp500.csv"), "utf8"));
  const { parseSp500GicsCsv: parseFixed } = await import("../src/lib/sp500-pit");
  const gicsFixed = parseFixed(fs.readFileSync(path.join(CACHE, "sp500.csv"), "utf8"));
  const secMap = await loadSecTickerCikMap(CACHE);

  const withCikBroken = [...gicsBroken.values()].filter((g) => g.cik).length;
  const withCikFixed = [...gicsFixed.values()].filter((g) => g.cik).length;

  const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const barsBy = new Map<string, Bar[]>();
  for (const t of tickers) {
    const b = loadBars(t, CACHE) ?? loadBars(t, CACHE_V1);
    if (b.length) barsBy.set(t, b);
  }
  const spy = loadBars("SPY", CACHE_V1);
  const calendar = tradingDaysFromBars(spy);
  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);

  const factsDir = path.join(CACHE, "facts");
  fs.mkdirSync(factsDir, { recursive: true });

  const loadFactFile = (t: string) => {
    const f = path.join(factsDir, `${t}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
    const v1 = path.join(CACHE_V1, "facts", `${t}.json`);
    if (fs.existsSync(v1)) return JSON.parse(fs.readFileSync(v1, "utf8"));
    return null;
  };

  if (fetchFacts && process.env.SEC_USER_AGENT?.trim()) {
    let i = 0;
    for (const t of tickers) {
      if (loadFactFile(t)) continue;
      const cik = resolveCik(t, gicsFixed.get(t)?.cik, secMap);
      if (!cik) continue;
      try {
        const json = await edgarJson(companyFactsUrl(cik));
        fs.writeFileSync(path.join(factsDir, `${t}.json`), JSON.stringify(json));
      } catch (e) {
        if (e instanceof EdgarDisabledError) break;
      }
      i += 1;
      if (i % 50 === 0) console.error(`[step0] facts ${i}`);
    }
  }

  const factsBy = new Map<string, unknown>();
  for (const t of tickers) {
    const f = loadFactFile(t);
    if (f) factsBy.set(t, f);
  }

  const wl = new Set<string>();
  for (const g of loadWatchlist().groups) for (const x of g.tickers) wl.add(x.ticker);

  const makeCtx = (useWatchlistCikFallback: boolean): SakaCandidateContext => {
    const closeHistory = new Map<string, Map<string, number>>();
    for (const [t, bars] of barsBy) {
      const m = new Map<string, number>();
      for (const b of bars) m.set(b.date, b.c);
      closeHistory.set(t, m);
    }
    const lastKnownShares = new Map<string, number>();
    return {
      calendar,
      closeHistory,
      gicsOf: (t) => {
        const g = gicsFixed.get(t);
        if (!g) return null;
        return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: false };
      },
      mcap: (t, date) => {
        const p = closeOnOrBefore(barsBy.get(t) ?? [], date);
        const f = factsBy.get(t);
        let sh: number | null = null;
        if (f) sh = sharesOutstandingAsOf(f, date);
        if (sh != null && sh > 0) lastKnownShares.set(t, sh);
        else sh = lastKnownShares.get(t) ?? null;
        if (p == null || !sh || sh <= 0) return 0;
        return p * sh;
      },
      sharesLookup: (t, date) => {
        const f = factsBy.get(t);
        let sh: number | null = null;
        if (f) sh = sharesOutstandingAsOf(f, date);
        if (sh != null && sh > 0) return { shares: sh, stale: false };
        const prev = lastKnownShares.get(t);
        if (prev != null) return { shares: prev, stale: true };
        return { shares: 0, stale: true };
      },
      profitable: (t, date) => {
        const f = factsBy.get(t);
        if (!f) return false;
        const ni = ttmNetIncomeAsOf(f, date);
        return ni != null && ni > 0;
      },
      hasPrice: (t, date) => closeOnOrBefore(barsBy.get(t) ?? [], date) != null,
    };
  };

  const ctxV1proxy = makeCtx(true);
  const ctxV2 = makeCtx(false);

  const row = (date: string, label: string, ctx: SakaCandidateContext) => {
    const members = membersOnDate(intervals, date);
    const afterTheme = members.filter((t) => {
      if (isExcludedTheme(t)) return false;
      const g = ctx.gicsOf(t);
      return !(g && isFinancialSector(g.sector));
    });
    const el = filterEligibleCandidates(members, date, ctx);
    const inWl = el.filter((t) => wl.has(t)).length;
    return { date, label, pit: members.length, afterTheme: afterTheme.length, eligible: el.length, wlPct: el.length ? inWl / el.length : 0 };
  };

  const sampleDates = [rebals[0], rebals[Math.floor(rebals.length / 2)], rebals[rebals.length - 1]!];
  const rowsBefore = sampleDates.map((d) => row(d, "v1-proxy (facts cache as-is)", ctxV1proxy));
  const rowsAfter = sampleDates.map((d) => row(d, "v2 CIK fix + facts", ctxV2));

  const last = row(rebals[rebals.length - 1]!, "final", ctxV2);
  const gateOk = last.eligible >= last.afterTheme * MIN_ELIGIBLE_SHARE;

  const md = `# Round 19 v2 Step 0 — カバレッジ

- GICS CSV CIK 行（壊れ）: **${withCikBroken}** / ${gicsBroken.size}
- GICS CSV CIK 行（修正パース）: **${withCikFixed}** / ${gicsFixed.size}
- SEC \`company_tickers.json\` マップ: **${secMap.size}** ティッカー
- facts キャッシュ: **${factsBy.size}** / PIT ユニーク **${tickers.length}**
- 価格バー: **${barsBy.size}** 銘柄

## 代表リバランス eligible（修正前後）

| 日付 | ラベル | PIT | テーマ・金融後 | eligible | watchlist % |
|---|---|---:|---:|---:|---:|
${[...rowsBefore, ...rowsAfter].map((r) => `| ${r.date} | ${r.label} | ${r.pit} | ${r.afterTheme} | ${r.eligible} | ${(r.wlPct * 100).toFixed(1)}% |`).join("\n")}

## ゲート（最終リバランス ${last.date}）

- eligible **${last.eligible}** / テーマ・金融後 **${last.afterTheme}** = **${((100 * last.eligible) / last.afterTheme).toFixed(1)}%**
- 閾値 **${MIN_ELIGIBLE_SHARE * 100}%** → **${gateOk ? "PASS — v2 スタディ実行可" : "STOP — 無料データではカバレッジ不足"}**
- watchlist 交集合: **${(last.wlPct * 100).toFixed(1)}%**

${fetchFacts ? "" : "（`--fetch-facts` 未指定のため既存 facts のみ。本番前に全 PIT facts 取得推奨）"}
`;

  fs.writeFileSync(DOC, md);
  console.log(JSON.stringify({ gateOk, last, facts: factsBy.size, withCikFixed }, null, 2));
  if (!gateOk && fetchFacts) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
