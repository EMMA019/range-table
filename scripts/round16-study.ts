import fs from "node:fs";
import path from "node:path";
import { earningsDatesFrom, type FilingBlock } from "../src/lib/bias";
import { buildFeatures, marketByDate, runPortfolio, type Book, type Candidate, type NameSeries } from "../src/lib/backtest-study";
import { isIgnoredTicker } from "../src/lib/holdings";
import { ttmAt, type ConceptFacts } from "../src/lib/round4";
import { CRYPTO, NUCLEAR_LIST, QUANTUM, SOLAR } from "../src/lib/round12";
import {
  FLAVORS,
  LINE_PCTS,
  ROUND16_PREREG,
  WINDOW_BOUNDS,
  buildSpyMa20,
  generateSignals,
  paperShares,
  scoreBook,
  summarizeJa,
  variantId,
  verdictForFlavor,
  type LineFlavor,
  type LinePct,
  type Round16Report,
  type Round16Window,
} from "../src/lib/round16";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 16: 20-day box entry line (15/25/30/35%). Rules in docs/ROUND16_PREREG.md.
 * Analysis only. Writes data/backtest/round16.json. Trade CSVs under
 * /opt/cursor/artifacts/round16_trades/ (not committed).
 *   npx tsx scripts/round16-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round16.json");
const ART = "/opt/cursor/artifacts/round16_trades";
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const F1_AS_OF = "2024-10-03";
const THEME_SET = new Set<string>([...SOLAR, ...CRYPTO, ...NUCLEAR_LIST, ...QUANTUM]);
const CSV_HEAD =
  "variant,window,ticker,signal_date,entry_date,entry_price,shares,cost_usd,stop,target,exit_date,exit_price,exit_reason,pnl_usd,pnl_net190_usd,hold_days";

type SlimFile = { missing: true } | { missing: false; concepts: ConceptFacts };
type WindowSpec = { id: Round16Window; from: string; to: string };

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

function net190(pnl: number, sells: number): number {
  return (Math.round(pnl * 100) + 70 * sells - 190) / 100;
}

function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function price(value: number): string {
  return value.toFixed(4);
}

function exportTrades(
  book: Book,
  cands: readonly Candidate[],
  high20Of: Map<string, number | null>,
  variant: string,
  window: string,
): string[] {
  const byEntry = new Map<string, Candidate>();
  for (const cand of cands) {
    const key = `${cand.ticker}|${cand.entryDate}`;
    if (byEntry.has(key)) throw new Error(`候補が重複 ${key}`);
    byEntry.set(key, cand);
  }
  const lines: string[] = [];
  for (const fill of book.fills ?? []) {
    const cand = byEntry.get(`${fill.ticker}|${fill.entryDate}`);
    if (!cand) throw new Error(`約定の候補がない ${fill.ticker} ${fill.entryDate}`);
    const legs = fill.legs ?? [];
    const last = legs[legs.length - 1];
    if (!last) throw new Error(`約定の足がない ${fill.ticker}`);
    const plannedLegs = cand.round7Legs ?? [];
    const shares = plannedLegs.reduce((sum, leg) => sum + leg.qty, 0);
    const stop = cand.stop ?? 0;
    const planned = [...plannedLegs].reverse().find((leg) => leg.date === fill.exitDate && leg.reason === last.reason);
    const exitPrice = planned?.price ?? last.price;
    if (exitPrice == null) throw new Error(`出口価格がない ${fill.ticker}`);
    const targetLeg = plannedLegs.find((leg) => leg.reason === "target");
    const targetLevel = targetLeg?.price ?? high20Of.get(`${fill.ticker}|${fill.entryDate}`) ?? stop;
    lines.push(
      [
        variant,
        window,
        fill.ticker,
        cand.signalDate,
        fill.entryDate,
        price(cand.entry),
        String(shares),
        money(shares * cand.entry),
        price(stop),
        price(targetLevel),
        fill.exitDate,
        price(exitPrice),
        last.reason,
        money(fill.pnlUsd),
        money(net190(fill.pnlUsd, legs.length)),
        String(fill.hold ?? ""),
      ].join(","),
    );
  }
  return lines;
}

function main() {
  console.log(`prereg ${ROUND16_PREREG}`);
  const spyBars = readCachedBars("SPY");
  if (!spyBars?.length) throw new Error("SPYの日足がない");
  const spy = buildFeatures(spyBars);
  const calendar = spy.map((bar) => bar.date);
  const lastBar = calendar[calendar.length - 1] ?? "";
  const windows: WindowSpec[] = (["oos", "in"] as Round16Window[]).map((id) => {
    const bounds = WINDOW_BOUNDS[id];
    const to = id === "in" && lastBar < bounds.to ? lastBar : bounds.to;
    return { id, from: bounds.from, to };
  });
  const spyByDate = buildSpyMa20(spy);
  const market = marketByDate(spy, []);

  const watch = loadWatchlist();
  let watchlist = 0;
  let financialsDropped = 0;
  let themeDropped = 0;
  const pool: Array<{ ticker: string; sector: string; semi: boolean }> = [];
  for (const group of watch.groups) {
    const semi = group.id === "semi" || group.id === "equipment";
    for (const row of group.tickers) {
      if (isIgnoredTicker(row.ticker)) continue;
      watchlist += 1;
      if (group.id === "financials") {
        financialsDropped += 1;
        continue;
      }
      if (THEME_SET.has(row.ticker)) {
        themeDropped += 1;
        continue;
      }
      pool.push({ ticker: row.ticker, sector: group.name, semi });
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
  let f1NegativeAtAsOf = 0;
  for (const row of pool) {
    const status = ttmAt(conceptsOf.get(row.ticker) ?? null, F1_AS_OF).status;
    if (status === "unknown") f1Unknown.push(row.ticker);
    else if (status === "negative" && row.ticker !== "SPCX") f1NegativeAtAsOf += 1;
  }
  f1Unknown.sort();

  const earnings = loadItem202(pool.map((row) => row.ticker));
  const names: NameSeries[] = [];
  for (const row of pool) {
    const bars = readCachedBars(row.ticker);
    if (!bars?.length) continue;
    names.push({
      ticker: row.ticker,
      sector: row.sector,
      semi: row.semi,
      core: true,
      broad: false,
      feats: buildFeatures(bars),
      earnings: earnings.get(row.ticker) ?? [],
    });
  }
  const closes = new Map<string, Map<string, number>>();
  for (const name of names) {
    const days = new Map<string, number>();
    for (const bar of name.feats) days.set(bar.date, bar.c);
    closes.set(name.ticker, days);
  }

  fs.mkdirSync(ART, { recursive: true });
  const rows: ReturnType<typeof scoreBook>[] = [];
  const allCsv: string[] = [CSV_HEAD];

  for (const pct of LINE_PCTS) {
    for (const flavor of FLAVORS) {
      for (const window of windows) {
        const sessions = calendar.filter((date) => date >= window.from && date <= window.to);
        const cands: Candidate[] = [];
        for (const name of names) {
          cands.push(
            ...generateSignals({
              name,
              pct,
              flavor,
              from: window.from,
              to: window.to,
              sessions: calendar,
              spyByDate,
              market,
              earningsBlock: true,
              concepts: conceptsOf.get(name.ticker) ?? null,
            }),
          );
        }
        const book = runPortfolio(
          {
            id: variantId(pct, flavor),
            label: variantId(pct, flavor),
            universe: "round16",
            rank: "rs",
            sessions,
            flatten: true,
            withRestart: false,
            closes,
            order: orderByRs20,
            maxSemi: 2,
            size: (cand) => paperShares(cand.entry, cand.stop ?? Number.NaN),
          },
          cands,
        );
        rows.push(scoreBook(book, pct, flavor, window.id));
        const label = window.id === "in" ? "2024-26" : "2022-24";
        const taken = cands.filter((c) => !c.voided && c.entryDate >= sessions[0]! && c.entryDate <= sessions[sessions.length - 1]!);
        const high20Of = new Map<string, number | null>();
        for (const cand of taken) {
          const name = names.find((item) => item.ticker === cand.ticker);
          const high = name?.feats[cand.signalIndex]?.high20 ?? null;
          high20Of.set(`${cand.ticker}|${cand.entryDate}`, high);
        }
        const tradeLines = exportTrades(book, taken, high20Of, variantId(pct, flavor), label);
        allCsv.push(...tradeLines);
        fs.writeFileSync(path.join(ART, `${variantId(pct, flavor)}_${window.id}.csv`), `${CSV_HEAD}\n${tradeLines.join("\n")}\n`);
      }
    }
  }

  const verdicts = FLAVORS.map((flavor) => verdictForFlavor(rows, flavor));
  const report: Round16Report = {
    v: 1,
    prereg: ROUND16_PREREG,
    generatedAt: new Date().toISOString(),
    universe: {
      watchlist,
      afterFilters: pool.length,
      f1Unknown,
      f1NegativeDropped: f1NegativeAtAsOf,
      themeDropped,
      financialsDropped,
    },
    rows,
    verdicts,
    summaryJa: summarizeJa(rows, verdicts),
  };
  fs.writeFileSync(OUT, `${JSON.stringify(report)}\n`);
  fs.writeFileSync(path.join(ART, "all_trades.csv"), `${allCsv.join("\n")}\n`);
  fs.writeFileSync(
    path.join(ART, "verify.md"),
    [
      `# Round 16 artifacts`,
      ``,
      `prereg: ${ROUND16_PREREG}`,
      `generated: ${report.generatedAt}`,
      `universe: watchlist ${watchlist}, pool ${pool.length}, financials dropped ${financialsDropped}, theme dropped ${themeDropped}`,
      `f1 unknown (${f1Unknown.length}): ${f1Unknown.join(", ") || "—"}`,
      `f1 negative at ${F1_AS_OF} (not SPCX): ${f1NegativeAtAsOf} names`,
      ``,
      `## Verdicts`,
      ...verdicts.map((v) => `- ${JSON.stringify(v)}`),
      ``,
      `## Summary (JA)`,
      report.summaryJa,
    ].join("\n"),
  );
  console.log(JSON.stringify({ rows: rows.length, verdicts, summaryJa: report.summaryJa }, null, 2));
}

main();
