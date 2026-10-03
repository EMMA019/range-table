import fs from "fs";
import path from "path";
import { earningsDatesFrom, IN_FROM, IN_TO, type FilingBlock } from "../src/lib/bias";
import {
  clipTo,
  marketByDate,
  rangeCandidates,
  runPortfolio,
  withRules,
  YEAR2_FROM,
  type Candidate,
  type NameSeries,
  type RangeRules,
} from "../src/lib/backtest-study";
import { FROZEN_BOX, FROZEN_GAP } from "../src/lib/paper";
import { loadCore } from "./cache-bars";

/**
 * Dollar bridge from the published RS book to the bias-study core book.
 * Analysis only. Writes `bridge` onto data/backtest/bias.json.
 *   npx tsx scripts/reconcile-core.ts
 */
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const OUT = path.join(process.cwd(), "data", "backtest", "bias.json");

function orderByRs20(list: Candidate[]) {
  list.sort((a, b) => {
    if (a.rs20 == null && b.rs20 != null) return 1;
    if (a.rs20 != null && b.rs20 == null) return -1;
    if (a.rs20 != null && b.rs20 != null && a.rs20 !== b.rs20) return b.rs20 - a.rs20;
    return a.ticker.localeCompare(b.ticker);
  });
}

function loadItem202(tickers: string[]): { dates: Map<string, string[]>; missing: number } {
  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const dates = new Map<string, string[]>();
  let missing = 0;
  for (const ticker of tickers) {
    const key = ticker.toUpperCase();
    const cik = cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, "."));
    const file = cik ? path.join(EDGAR, `${cik}.json`) : "";
    if (!cik || !fs.existsSync(file)) {
      missing += 1;
      continue;
    }
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { filings?: { recent?: FilingBlock; files?: Array<{ name: string }> } };
    const blocks: FilingBlock[] = [];
    if (json.filings?.recent) blocks.push(json.filings.recent);
    for (const extra of json.filings?.files ?? []) {
      const extraFile = path.join(EDGAR, extra.name);
      if (fs.existsSync(extraFile)) blocks.push(JSON.parse(fs.readFileSync(extraFile, "utf8")) as FilingBlock);
    }
    dates.set(ticker, earningsDatesFrom(blocks).item202);
  }
  return { dates, missing };
}

function run(
  id: string,
  names: NameSeries[],
  rules: RangeRules,
  portfolioSessions: string[],
  calendar: string[],
  closes: Map<string, Map<string, number>>,
  maxSemi?: number,
) {
  const end = portfolioSessions[portfolioSessions.length - 1] ?? IN_TO;
  const cands = names.flatMap((name) => rangeCandidates(name, rules, market, calendar, { from: IN_FROM, to: end }));
  const result = runPortfolio(
    {
      id,
      label: id,
      universe: "core",
      rank: "rs",
      sessions: portfolioSessions,
      flatten: true,
      withRestart: false,
      yearSplit: YEAR2_FROM,
      closes,
      order: orderByRs20,
      maxSemi,
    },
    cands,
  );
  return { n: result.n, totalUsd: result.totalUsd, signals: cands.length };
}

let market: ReturnType<typeof marketByDate>;

function usd(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main() {
  const { names, spy } = await loadCore(false);
  const last = spy[spy.length - 1]?.date ?? "";
  const calendar = spy.map((bar) => bar.date);
  const portfolioSessions = calendar.filter((date) => date >= IN_FROM && date <= IN_TO);
  market = marketByDate(spy, []);
  const clipped = names.map((name) => ({ ...name, feats: clipTo(name.feats, IN_TO) }));
  const closes = new Map<string, Map<string, number>>();
  for (const name of clipped) {
    const days = new Map<string, number>();
    for (const bar of name.feats) days.set(bar.date, bar.c);
    closes.set(name.ticker, days);
  }
  const edgar = loadItem202(clipped.map((name) => name.ticker));
  const withDates = clipped.map((name) => ({ ...name, earnings: edgar.dates.get(name.ticker) ?? [] }));
  const withItem202 = withDates.filter((name) => name.earnings.length > 0).length;

  const earnOnCap = withRules({ ...FROZEN_GAP, id: "gap-earn", label: "gap-earn", earnings: true });
  const published = run("published", clipped, FROZEN_BOX, portfolioSessions, calendar, closes);
  const gap = run("gap", clipped, FROZEN_GAP, portfolioSessions, calendar, closes);
  const semiOnly = run("semi", clipped, FROZEN_BOX, portfolioSessions, calendar, closes, 2);
  const gapSemi = run("gap-semi", clipped, FROZEN_GAP, portfolioSessions, calendar, closes, 2);
  const stacked = run("stacked", withDates, earnOnCap, portfolioSessions, calendar, closes, 2);
  const noCap = withRules({
    id: "bias",
    label: "bias",
    atrMin: 3,
    priceMax: null,
    gapThroughStop: true,
    earnings: true,
  });
  const bias = run("bias", withDates, noCap, portfolioSessions, calendar, closes, 2);
  const capOnly = run("cap", clipped, withRules({ id: "nocap", label: "nocap", atrMin: 3, priceMax: null }), portfolioSessions, calendar, closes);

  const chain = [published, gap, gapSemi, stacked];
  const labels = [
    "公開の本。ギャップは終値で損切り、終値$550以下、決算は避けない、半導体の上限なし",
    "ギャップで損切りを割り込んだら、その始値で損切り",
    "その上で、半導体と装置は同時2枠",
    "その上で、8-K Item 2.02の前後5営業日は新しい買いを避ける",
  ];
  const steps = chain.map((row, index) => ({
    label: labels[index] ?? "",
    n: row.n,
    totalUsd: row.totalUsd,
    deltaUsd: index === 0 ? 0 : usd(row.totalUsd - chain[index - 1].totalUsd),
  }));

  const bridge = {
    fromUsd: published.totalUsd,
    toUsd: stacked.totalUsd,
    namesInFile: 187,
    namesTraded: names.length,
    ignored: "ONDS",
    lastBar: last,
    withItem202,
    withoutItem202: names.length - withItem202,
    edgarMissing: edgar.missing,
    steps,
    side: {
      label: "半導体2枠だけ。ギャップは終値のまま。足し算の途中ではない",
      n: semiOnly.n,
      totalUsd: semiOnly.totalUsd,
      deltaUsd: usd(semiOnly.totalUsd - published.totalUsd),
    },
    unchanged: {
      dropCapUsd: capOnly.totalUsd,
      dropCapOnStackedUsd: bias.totalUsd,
      sameTradesWhenCapDrops: capOnly.n === published.n && capOnly.totalUsd === published.totalUsd,
      stackedMatchesBias: bias.totalUsd === stacked.totalUsd && bias.n === stacked.n,
    },
  };
  console.log(JSON.stringify(bridge, null, 2));
  if (!fs.existsSync(OUT)) throw new Error("bias.json が無い");
  const report = JSON.parse(fs.readFileSync(OUT, "utf8")) as { bridge?: unknown };
  report.bridge = bridge;
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote bridge onto ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
