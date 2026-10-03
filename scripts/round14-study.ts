import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  ADV_TOP_N,
  ADV_WINDOW,
  BENCHMARKS,
  IN_FROM,
  IN_TO,
  JAB_ETFS,
  OOS_FROM,
  OOS_TO,
  SECTOR_HOLDING_ETFS,
  advLeaders,
  changesFrom,
  cleanTicker,
  expandRowspan,
  isSemiSubIndustry,
  listedFrom,
  membershipAsOf,
  trailingAvgDollar,
  wikiTables,
} from "../src/lib/bias";
import {
  YEAR2_FROM,
  buildFeatures,
  marketByDate,
  rangeCandidates,
  runPortfolio,
  withRules,
  type Book,
  type Candidate,
  type Feat,
  type NameSeries,
} from "../src/lib/backtest-study";
import { etfOrders, type EtfBar, type EtfOrder } from "../src/lib/etf-sleeve";
import { isIgnoredTicker } from "../src/lib/holdings";
import { type Round3Universe, type Round3Window } from "../src/lib/round3";
import { admits, aboveBoxTop, ttmAt, type ConceptFacts, type TtmStatus } from "../src/lib/round4";
import { withRound7Exit } from "../src/lib/round7";
import { PUBLISHED_BASELINE, type PublishedCell } from "../src/lib/round10";
import { totalNet190 } from "../src/lib/round8";
import { etfExitPrice } from "../src/lib/round11";
import { sessionDate } from "../src/lib/calendar";
import { parseChart } from "../src/lib/yahoo";
import {
  ROUND14_PREREG,
  START,
  equityChange,
  lowestEquity,
  netWithDividends,
  yearSlices,
  type Round14Cell,
  type Round14Report,
  type Round14Side,
} from "../src/lib/round14";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";
import type { ParkBar, ParkOpts, ParkSell } from "../src/lib/backtest-study";

/**
 * Round 14 idle cash in SGOV. Rules are locked in docs/ROUND14_PREREG.md.
 * Analysis only. Does not call EDGAR. Writes data/backtest/round14.json.
 * Trade rows go to /opt/cursor/artifacts/round14_trades/ and are not committed.
 *   npx tsx scripts/round14-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round14.json");
const ART = "/opt/cursor/artifacts/round14_trades";
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "r14-core", label: "今の187", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "r14-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });
const WINDOW_LABEL: Record<Round3Window, string> = { oos: "2022-24", in: "2024-26" };
const CSV_HEAD = "config,universe,window,sleeve,ticker,signal_date,entry_date,entry_price,shares,cost_usd,stop,target,exit_date,exit_price,exit_reason,pnl_usd,pnl_net190_usd,hold_days";

type WindowSpec = { id: Round3Window; from: string; to: string; asOf: string };
type Marked = Candidate & { f1: TtmStatus; above: boolean };
type Ready = Marked & { series: Feat[] };
type SlimFile = { missing: true } | { missing: false; concepts: ConceptFacts };

function table(html: string, header: string): string[][] {
  for (const item of wikiTables(html)) {
    const expanded = expandRowspan(item.rows);
    if (expanded.some((row) => row.includes(header))) return expanded;
  }
  throw new Error(`表がない: ${header}`);
}

function holdingTickers(etf: string): string[] {
  const file = path.join(HOLD, `${etf}.xlsx`);
  if (!fs.existsSync(file)) return [];
  const json = execFileSync(
    "python3",
    [
      "-c",
      `import json,sys,zipfile,re
from xml.etree import ElementTree as ET
NS="{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
z=zipfile.ZipFile(sys.argv[1])
strings=[]
root=ET.fromstring(z.read("xl/sharedStrings.xml"))
for si in root.findall(NS+"si"):
    strings.append("".join((t.text or "") for t in si.iter(NS+"t")))
sheet=ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
tickers=[]
for c in sheet.iter(NS+"c"):
    ref=c.attrib.get("r","")
    m=re.match(r"([A-Z]+)(\\d+)", ref)
    if not m: continue
    if m.group(1)!="B" or int(m.group(2))<6: continue
    v=c.find(NS+"v")
    if v is None or v.text is None: continue
    val=strings[int(v.text)] if c.attrib.get("t")=="s" else v.text
    tickers.append(val.strip())
print(json.dumps(tickers))`,
      file,
    ],
    { encoding: "utf8" },
  );
  const out: string[] = [];
  for (const raw of JSON.parse(json) as string[]) {
    const ticker = cleanTicker(raw.replace(/\//g, "."));
    if (ticker && ticker !== etf) out.push(ticker);
  }
  return out;
}

function changes(file: string): ReturnType<typeof changesFrom> {
  const html = fs.readFileSync(path.join(WIKI, file), "utf8");
  const found = wikiTables(html).find((item) => expandRowspan(item.rows).some((row) => row.includes("Effective Date") || (row.includes("Date") && row.includes("Added"))));
  return changesFrom(expandRowspan(found?.rows ?? []));
}

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

function loadEtf(symbol: string): { bars: EtfBar[]; byDate: Map<string, EtfBar> } {
  const raw = readCachedBars(symbol);
  if (!raw?.length) throw new Error(`${symbol} の日足がない`);
  const bars = raw.map((bar) => ({ date: bar.date, o: bar.o, h: bar.h, l: bar.l, c: bar.c }));
  return { bars, byDate: new Map(bars.map((bar) => [bar.date, bar])) };
}

function cashAgrees(book: Book, id: string): void {
  const stock = (book.fills ?? []).reduce((sum, fill) => sum + fill.pnlUsd, 0);
  const etf = (book.etfFills ?? []).reduce((sum, fill) => sum + fill.pnlUsd, 0);
  const park = (book.park?.priceUsd ?? 0) + (book.park?.dividendsUsd ?? 0);
  const diff = Math.abs(stock + etf + park - book.totalUsd);
  const room = 1 + 0.01 * ((book.fills?.length ?? 0) + (book.etfFills?.length ?? 0) + (book.park?.sellN ?? 0));
  if (diff > room) throw new Error(`現金と約定が合わない ${id} ${book.totalUsd} ${stock} ${etf} ${park}`);
}

function entryInWindow(cand: Candidate, first: string, last: string): boolean {
  return cand.entryDate >= first && cand.entryDate <= last;
}

type TradeRow = {
  config: string;
  universe: Round3Universe;
  window: string;
  sleeve: "stock" | "etf" | "tbill";
  ticker: string;
  signalDate: string;
  entryDate: string;
  entry: number;
  shares: number;
  cost: number;
  stop: number;
  target: number;
  exitDate: string;
  exitPrice: number;
  reason: string;
  pnl: number;
  net: number;
  hold: number;
};

function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function price(value: number): string {
  return value.toFixed(4);
}

function net190(pnl: number, sells: number): number {
  return (Math.round(pnl * 100) + 70 * sells - 190) / 100;
}

function csvLine(row: TradeRow): string {
  return [
    row.config,
    row.universe,
    row.window,
    row.sleeve,
    row.ticker,
    row.signalDate,
    row.entryDate,
    price(row.entry),
    String(row.shares),
    money(row.cost),
    price(row.stop),
    price(row.target),
    row.exitDate,
    price(row.exitPrice),
    row.reason,
    money(row.pnl),
    money(row.net),
    String(row.hold),
  ].join(",");
}

function stockTrades(book: Book, taken: readonly Ready[], config: string, universe: Round3Universe, window: string): TradeRow[] {
  const byEntry = new Map<string, Ready>();
  for (const cand of taken) {
    const key = `${cand.ticker}|${cand.entryDate}`;
    if (byEntry.has(key)) throw new Error(`候補が重複 ${key}`);
    byEntry.set(key, cand);
  }
  const out: TradeRow[] = [];
  for (const fill of book.fills ?? []) {
    const cand = byEntry.get(`${fill.ticker}|${fill.entryDate}`);
    if (!cand) throw new Error(`約定の候補がない ${fill.ticker} ${fill.entryDate}`);
    const legs = fill.legs ?? [];
    const last = legs[legs.length - 1];
    if (!last) throw new Error(`約定の足がない ${fill.ticker} ${fill.exitDate}`);
    const plannedLegs = cand.round7Legs ?? [];
    const shares = plannedLegs.reduce((sum, leg) => sum + leg.qty, 0);
    if (!(shares >= 1)) throw new Error(`株数がない ${fill.ticker} ${fill.entryDate}`);
    const planned = [...plannedLegs].reverse().find((leg) => leg.date === fill.exitDate && leg.reason === last.reason);
    const flat = last.reason === "window" ? cand.series.find((item) => item.date === fill.exitDate) : undefined;
    const exitPrice = planned?.price ?? (last.reason === "window" ? flat?.c : undefined);
    if (exitPrice == null) throw new Error(`計画した出口がない ${fill.ticker} ${fill.exitDate} ${last.reason}`);
    const rebuilt = (legs.length === 1 ? shares : last.qty) * (exitPrice - cand.entry) - 0.7;
    const expected = legs.length === 1 ? fill.pnlUsd : last.pnlUsd;
    if (Math.abs(rebuilt - expected) > 0.02) throw new Error(`再建が合わない ${fill.ticker} ${fill.entryDate} ${rebuilt} ${expected}`);
    const target = cand.series[cand.signalIndex]?.high20;
    if (cand.stop == null || target == null || fill.hold == null) throw new Error(`出口の値がない ${fill.ticker} ${fill.entryDate}`);
    out.push({
      config,
      universe,
      window,
      sleeve: "stock",
      ticker: fill.ticker,
      signalDate: cand.signalDate,
      entryDate: fill.entryDate,
      entry: cand.entry,
      shares,
      cost: Math.round(shares * cand.entry * 100) / 100,
      stop: cand.stop,
      target,
      exitDate: fill.exitDate,
      exitPrice,
      reason: last.reason,
      pnl: fill.pnlUsd,
      net: net190(fill.pnlUsd, legs.length),
      hold: fill.hold,
    });
  }
  return out;
}

function etfTrades(
  book: Book,
  orders: Map<string, EtfOrder>,
  bars: Map<string, EtfBar>,
  config: string,
  universe: Round3Universe,
  window: string,
): TradeRow[] {
  const out: TradeRow[] = [];
  for (const fill of book.etfFills ?? []) {
    const order = orders.get(fill.entryDate);
    const entryBar = bars.get(fill.entryDate);
    const exitBar = bars.get(fill.exitDate);
    const last = fill.legs[fill.legs.length - 1];
    if (!order?.signalDate || !entryBar || !exitBar || !last) throw new Error(`ETFの値がない ${fill.entryDate}`);
    const exitPrice = etfExitPrice({
      reason: last.reason,
      entryDate: fill.entryDate,
      exitDate: fill.exitDate,
      open: exitBar.o,
      close: exitBar.c,
      stop: order.stop,
      target: order.target,
    });
    const rebuilt = last.qty * (exitPrice - entryBar.o) - 0.7;
    if (Math.abs(rebuilt - last.pnlUsd) > 0.02) throw new Error(`ETFの再建が合わない ${fill.entryDate} ${rebuilt} ${last.pnlUsd}`);
    out.push({
      config,
      universe,
      window,
      sleeve: "etf",
      ticker: fill.ticker,
      signalDate: order.signalDate,
      entryDate: fill.entryDate,
      entry: entryBar.o,
      shares: fill.qty,
      cost: Math.round(fill.qty * entryBar.o * 100) / 100,
      stop: order.stop,
      target: order.target,
      exitDate: fill.exitDate,
      exitPrice,
      reason: last.reason,
      pnl: fill.pnlUsd,
      net: net190(fill.pnlUsd, fill.legs.length),
      hold: fill.hold,
    });
  }
  return out;
}

type ChartFile = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
      events?: { dividends?: Record<string, { date?: number; amount?: number }> };
    }>;
  };
};

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

function shareOfStart(value: number): number {
  return Math.round((value / START) * 1e6) / 1e6;
}

function readChart(symbol: string): { byDate: Map<string, { o: number; h: number; l: number; c: number }>; divs: Map<string, number> } {
  const file = path.join(process.cwd(), "data", ".cache", "bt5", `${symbol}.chart.json`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as ChartFile;
  const result = raw.chart?.result?.[0];
  if (!result?.timestamp?.length) throw new Error(`${symbol} のチャートがない`);
  const parsed = parseChart({ timestamp: result.timestamp, indicators: result.indicators }, Date.now() / 1000, 8000);
  const byDate = new Map(parsed.bars.map((bar) => [bar.date, { o: bar.o, h: bar.h, l: bar.l, c: bar.c }]));
  const divs = new Map<string, number>();
  for (const item of Object.values(result.events?.dividends ?? {})) {
    if (item.date == null || !(item.amount && item.amount > 0)) continue;
    const date = sessionDate(item.date);
    divs.set(date, (divs.get(date) ?? 0) + item.amount);
  }
  return { byDate, divs };
}

/** SGOV on every session that has a bar. BIL only when that session has no SGOV bar. */
function loadPark(sessions: readonly string[]): { park: ParkOpts; bilSessions: number } {
  const sgov = readChart("SGOV");
  const bil = readChart("BIL");
  const bars = new Map<string, ParkBar>();
  const dividends = new Map<string, number>();
  let bilSessions = 0;
  for (const date of sessions) {
    const primary = sgov.byDate.get(date);
    const fallback = bil.byDate.get(date);
    if (primary) {
      bars.set(date, { ...primary, symbol: "SGOV" });
      const div = sgov.divs.get(date);
      if (div) dividends.set(date, div);
    } else if (fallback) {
      bilSessions += 1;
      bars.set(date, { ...fallback, symbol: "BIL" });
      const div = bil.divs.get(date);
      if (div) dividends.set(date, div);
    } else {
      throw new Error(`T-billの日足がない ${date}`);
    }
  }
  return { park: { bars, dividends }, bilSessions };
}

function legCount(book: Book): { pnlUsd: number; sells: number }[] {
  const out: { pnlUsd: number; sells: number }[] = [];
  for (const fill of book.fills ?? []) {
    const sells = fill.legs?.length ?? 0;
    if (sells < 1) throw new Error(`約定の足がない ${fill.ticker} ${fill.entryDate}`);
    out.push({ pnlUsd: fill.pnlUsd, sells });
  }
  for (const fill of book.etfFills ?? []) {
    if (fill.legs.length < 1) throw new Error(`ETFの足がない ${fill.entryDate}`);
    out.push({ pnlUsd: fill.pnlUsd, sells: fill.legs.length });
  }
  return out;
}

function parkPositions(sells: readonly ParkSell[]): { pnlUsd: number; sells: number }[] {
  const byCycle = new Map<number, { pnlUsd: number; sells: number }>();
  for (const sell of sells) {
    if (!(sell.cycle >= 1) || !sell.entryDate) throw new Error(`パークのサイクルがない ${sell.date}`);
    const row = byCycle.get(sell.cycle) ?? { pnlUsd: 0, sells: 0 };
    row.pnlUsd += sell.pnlUsd;
    row.sells += 1;
    byCycle.set(sell.cycle, row);
  }
  return [...byCycle.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
}

function sideOf(book: Book, net: number): Round14Side {
  const daily = book.daily;
  if (!daily?.length) throw new Error("日次がない");
  const low = lowestEquity(daily);
  return {
    totalUsd: book.totalUsd,
    totalNetUsd: net,
    stockUsd: cents((book.fills ?? []).reduce((sum, fill) => sum + fill.pnlUsd, 0)),
    soxxUsd: cents((book.etfFills ?? []).reduce((sum, fill) => sum + fill.pnlUsd, 0)),
    stockN: book.fills?.length ?? 0,
    soxxN: book.etfFills?.length ?? 0,
    mtmDdUsd: book.maxDrawdownUsd,
    lowUsd: low.usd,
    lowDate: low.date,
  };
}

function assertPublished(book: Book, cell: PublishedCell): void {
  const stockN = book.fills?.length ?? 0;
  const etfN = book.etfFills?.length ?? 0;
  const etfPnl = cents((book.etfFills ?? []).reduce((sum, fill) => sum + fill.pnlUsd, 0));
  const net = totalNet190(legCount(book));
  const joint = book.sleeve?.bothNegativeDays;
  const problems: string[] = [];
  if (book.totalUsd !== cell.totalUsd) problems.push(`損益 ${book.totalUsd}/${cell.totalUsd}`);
  if (book.maxDrawdownUsd !== cell.mtmDdUsd) problems.push(`DD ${book.maxDrawdownUsd}/${cell.mtmDdUsd}`);
  if (etfPnl !== cell.etfPnlUsd) problems.push(`ETF ${etfPnl}/${cell.etfPnlUsd}`);
  if (etfN !== cell.etfN) problems.push(`ETF回数 ${etfN}/${cell.etfN}`);
  if (stockN !== cell.stockN) problems.push(`株回数 ${stockN}/${cell.stockN}`);
  if (joint !== cell.jointLossDays) problems.push(`同日 ${joint}/${cell.jointLossDays}`);
  if (net !== cell.totalNet190Usd) problems.push(`手数料 ${net}/${cell.totalNet190Usd}`);
  if (book.park) problems.push("パークが付いている");
  if (problems.length) throw new Error(`基準 ${cell.universe} ${cell.window} が公開値と違う: ${problems.join(", ")}`);
}

function holdDays(sessions: readonly string[], from: string, to: string): number {
  const start = sessions.indexOf(from);
  const end = sessions.indexOf(to);
  if (start < 0 || end < start) return 0;
  return end - start;
}

function parkTrades(sells: readonly ParkSell[], sessions: readonly string[], config: string, universe: Round3Universe, window: string): TradeRow[] {
  const lastOf = new Map<number, number>();
  sells.forEach((sell, index) => lastOf.set(sell.cycle, index));
  return sells.map((sell, index) => {
    if (!(sell.qty >= 1)) throw new Error(`パークの株数がない ${sell.date}`);
    const closing = lastOf.get(sell.cycle) === index;
    const entry = sell.price - (sell.pnlUsd + 0.7) / sell.qty;
    return {
      config,
      universe,
      window,
      sleeve: "tbill" as const,
      ticker: sell.symbol,
      signalDate: "",
      entryDate: sell.entryDate,
      entry,
      shares: sell.qty,
      cost: cents(sell.qty * entry),
      stop: 0,
      target: 0,
      exitDate: sell.date,
      exitPrice: sell.price,
      reason: sell.reason,
      pnl: sell.pnlUsd,
      net: (Math.round(sell.pnlUsd * 100) + 70 - (closing ? 190 : 0)) / 100,
      hold: holdDays(sessions, sell.entryDate, sell.date),
    };
  });
}

type ExportCheck = {
  config: string;
  universe: Round3Universe;
  window: string;
  engineN: number;
  enginePnl: number;
  engineNet: number;
  dividends: number;
  parkPrice: number;
};

function main() {
  console.log(`prereg ${ROUND14_PREREG}`);
  const sp500 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp500.html"), "utf8"), "Symbol"));
  const sp400 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp400.html"), "utf8"), "Symbol"));
  const changes500 = changes("sp500-hist.html");
  const changes400 = changes("sp400.html");
  if (!changes500.changes.length || !changes400.changes.length) throw new Error("変更表が読めない");
  const gics = new Map<string, string | null>();
  for (const row of sp400) if (!gics.has(row.ticker)) gics.set(row.ticker, row.sub);
  for (const row of sp500) gics.set(row.ticker, row.sub);
  const gicsSemi = (ticker: string) => isSemiSubIndustry(gics.get(ticker));

  const watch = loadWatchlist();
  const coreSemi = new Map<string, boolean>();
  for (const group of watch.groups) {
    const inOldSemi = group.id === "semi" || group.id === "equipment";
    for (const ticker of group.tickers) {
      if (isIgnoredTicker(ticker.ticker)) continue;
      coreSemi.set(ticker.ticker, inOldSemi);
    }
  }

  const wanted = new Set<string>([...coreSemi.keys(), "SPY"]);
  for (const row of [...sp500, ...sp400]) wanted.add(row.ticker);
  for (const change of [...changes500.changes, ...changes400.changes]) {
    if (change.added) wanted.add(change.added);
    if (change.removed) wanted.add(change.removed);
  }
  for (const etf of SECTOR_HOLDING_ETFS) for (const ticker of holdingTickers(etf)) wanted.add(ticker);

  const feats = new Map<string, Feat[]>();
  for (const ticker of wanted) {
    const bars = readCachedBars(ticker);
    if (bars && bars.length >= 30) feats.set(ticker, buildFeatures(bars));
  }
  const spy = feats.get("SPY");
  if (!spy?.length) throw new Error("SPYの日足がない");
  const calendar = spy.map((bar) => bar.date);
  const lastBar = calendar[calendar.length - 1] ?? "";
  const windows: WindowSpec[] = [
    { id: "oos", from: OOS_FROM, to: OOS_TO, asOf: OOS_FROM },
    { id: "in", from: IN_FROM, to: lastBar < IN_TO ? lastBar : IN_TO, asOf: IN_FROM },
  ];
  const market = marketByDate(spy, []);
  const soxx = loadEtf("SOXX");

  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const facts = new Map<string, ConceptFacts | null>();
  for (const ticker of feats.keys()) {
    if (ticker === "SPY" || BENCH.has(ticker) || JAB.has(ticker)) continue;
    const cik = cikFor(cikOf, ticker);
    facts.set(ticker, cik ? loadSlim(cik) : null);
  }

  const names: NameSeries[] = [];
  for (const [ticker, series] of feats) {
    if (ticker === "SPY" || BENCH.has(ticker) || JAB.has(ticker)) continue;
    names.push({ ticker, sector: "", semi: coreSemi.get(ticker) === true, core: coreSemi.has(ticker), broad: true, feats: series, earnings: [] });
  }
  const advSeries = new Map<string, Map<string, number>>();
  const closes = new Map<string, Map<string, number>>();
  for (const name of names) {
    advSeries.set(name.ticker, trailingAvgDollar(name.feats, ADV_WINDOW));
    const days = new Map<string, number>();
    for (const bar of name.feats) days.set(bar.date, bar.c);
    closes.set(name.ticker, days);
  }
  const statusCache = new Map<string, TtmStatus>();
  const mark = (cand: Candidate): Marked => {
    const key = `${cand.ticker}|${cand.signalDate}`;
    let status = statusCache.get(key);
    if (!status) {
      status = ttmAt(facts.get(cand.ticker) ?? null, cand.signalDate).status;
      statusCache.set(key, status);
    }
    const high = feats.get(cand.ticker)?.[cand.signalIndex]?.high20 ?? null;
    return { ...cand, f1: status, above: aboveBoxTop(cand.entry, high) };
  };
  console.log(`names ${names.length} last ${lastBar}`);

  const cells: Round14Cell[] = [];
  const trades: TradeRow[] = [];
  const checks: ExportCheck[] = [];
  for (const window of windows) {
    const bounds = { from: window.from, to: window.to };
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
    const first = windowSessions[0] ?? "";
    const last = windowSessions[windowSessions.length - 1] ?? "";
    const orders = etfOrders(soxx.bars, 20, windowSessions, "E30");
    const loaded = loadPark(windowSessions);
    console.log(`${window.id} sessions ${windowSessions.length} ${first}..${last} bil ${loaded.bilSessions}`);
    const pitSet = new Set(
      [...membershipAsOf(sp500.map((row) => row.ticker), changes500.changes, window.asOf), ...membershipAsOf(sp400.map((row) => row.ticker), changes400.changes, window.asOf)].filter((ticker) => feats.has(ticker)),
    );
    const leaders = advLeaders(advSeries, windowSessions, ADV_TOP_N);
    const baseCore: Marked[] = [];
    const baseWide: Marked[] = [];
    for (const name of names) {
      if (name.core) baseCore.push(...rangeCandidates(name, CORE_RULES, market, calendar, bounds).map(mark));
      baseWide.push(...rangeCandidates({ ...name, semi: gicsSemi(name.ticker) }, WIDE_RULES, market, calendar, bounds).map(mark));
    }
    const sources: Array<{ universe: Round3Universe; cands: Marked[] }> = [
      { universe: "core", cands: baseCore },
      { universe: "pit", cands: baseWide.filter((cand) => pitSet.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) })) },
      { universe: "adv", cands: baseWide.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) })) },
    ];

    for (const source of sources) {
      const admitted: Ready[] = source.cands
        .filter((cand) => admits("F1iF2", cand.f1, cand.above))
        .map((cand) => {
          const series = feats.get(cand.ticker);
          if (!series) throw new Error(`日足がない ${cand.ticker}`);
          return { ...withRound7Exit(cand, series, "C"), f1: cand.f1, above: cand.above, series };
        });
      const leaked = admitted.filter((cand) => !cand.voided && entryInWindow(cand, first, last) && cand.f1 === "negative").length;
      if (leaked !== 0) throw new Error(`F1を通過した赤字がある ${source.universe} ${window.id} ${leaked}`);
      const sleeve = { symbol: "SOXX", orders, bars: soxx.byDate, sessions: windowSessions, exit: "box" as const };
      const shared = {
        label: "r14",
        universe: source.universe,
        rank: "rs" as const,
        sessions: windowSessions,
        flatten: true,
        withRestart: false,
        yearSplit: YEAR2_FROM,
        closes,
        maxSemi: 2,
        keepFills: true,
        keepRound7: true,
        keepSleeveStats: true,
        keepDaily: true,
        etfSleeve: sleeve,
      };
      const baselineBook = runPortfolio({ ...shared, id: `base-${source.universe}-${window.id}` }, admitted);
      cashAgrees(baselineBook, `基準 ${source.universe} ${window.id}`);
      const published = PUBLISHED_BASELINE.find((cell) => cell.universe === source.universe && cell.window === window.id);
      if (!published) throw new Error(`公開の基準がない ${source.universe} ${window.id}`);
      assertPublished(baselineBook, published);
      const parkedBook = runPortfolio({ ...shared, id: `park-${source.universe}-${window.id}`, park: loaded.park }, admitted);
      cashAgrees(parkedBook, `パーク ${source.universe} ${window.id}`);
      const park = parkedBook.park;
      if (!park) throw new Error(`パークの集計がない ${source.universe} ${window.id}`);
      const grouped = parkPositions(park.sells);
      if (grouped.length !== park.cycles || park.sells.length !== park.sellN) {
        throw new Error(`パークの回数が違う ${source.universe} ${window.id} ${grouped.length} ${park.cycles} ${park.sells.length}`);
      }
      if (Math.abs(park.feesUsd - cents(park.sellN * 0.7)) > 0.02) {
        throw new Error(`パークの手数料が違う ${source.universe} ${window.id} ${park.feesUsd} ${park.sellN}`);
      }
      const baselineNet = totalNet190(legCount(baselineBook));
      const parkedNet = netWithDividends([...legCount(parkedBook), ...grouped], park.dividendsUsd);
      const baseline = sideOf(baselineBook, baselineNet);
      const parkedSide = sideOf(parkedBook, parkedNet);
      const daily = parkedBook.daily;
      const baseDaily = baselineBook.daily;
      if (!daily || !baseDaily) throw new Error("日次がない");
      const years = yearSlices(windowSessions).map((slice) => {
        const upliftUsd = cents(equityChange(daily, slice.from, slice.to, START) - equityChange(baseDaily, slice.from, slice.to, START));
        return { year: slice.year, from: slice.from, to: slice.to, upliftUsd, upliftFrac: shareOfStart(upliftUsd) };
      });
      const upliftUsd = cents(parkedBook.totalUsd - baselineBook.totalUsd);
      const upliftNetUsd = cents(parkedNet - baselineNet);
      const cell: Round14Cell = {
        universe: source.universe,
        window: window.id,
        baseline,
        parked: {
          ...parkedSide,
          parkPriceUsd: park.priceUsd,
          parkDivUsd: park.dividendsUsd,
          parkUsd: cents(park.priceUsd + park.dividendsUsd),
          sellN: park.sellN,
          cycles: park.cycles,
          feesUsd: park.feesUsd,
          bilSessions: loaded.bilSessions,
        },
        upliftUsd,
        upliftNetUsd,
        upliftFrac: shareOfStart(upliftUsd),
        upliftNetFrac: shareOfStart(upliftNetUsd),
        years,
      };
      cells.push(cell);
      const label = WINDOW_LABEL[window.id];
      trades.push(
        ...stockTrades(baselineBook, admitted, "baseline", source.universe, label),
        ...etfTrades(baselineBook, orders, soxx.byDate, "baseline", source.universe, label),
        ...stockTrades(parkedBook, admitted, "park", source.universe, label),
        ...etfTrades(parkedBook, orders, soxx.byDate, "park", source.universe, label),
        ...parkTrades(park.sells, windowSessions, "park", source.universe, label),
      );
      checks.push(
        { config: "baseline", universe: source.universe, window: label, engineN: baseline.stockN + baseline.soxxN, enginePnl: baseline.totalUsd, engineNet: baseline.totalNetUsd, dividends: 0, parkPrice: 0 },
        {
          config: "park",
          universe: source.universe,
          window: label,
          engineN: parkedSide.stockN + parkedSide.soxxN + park.sellN,
          enginePnl: parkedSide.totalUsd,
          engineNet: parkedSide.totalNetUsd,
          dividends: park.dividendsUsd,
          parkPrice: park.priceUsd,
        },
      );
      console.log(
        `${window.id} ${source.universe} base ${baseline.totalUsd}/${baseline.totalNetUsd} park ${parkedSide.totalUsd}/${parkedSide.totalNetUsd} uplift ${upliftUsd}/${upliftNetUsd} div ${park.dividendsUsd} price ${park.priceUsd} sells ${park.sellN} cycles ${park.cycles} fees ${park.feesUsd} dd ${parkedSide.mtmDdUsd} low ${parkedSide.lowDate} ${parkedSide.lowUsd} bil ${loaded.bilSessions}`,
      );
    }
  }

  if (cells.length !== 6) throw new Error(`セル数が違う ${cells.length}`);

  const report: Round14Report = {
    v: 1,
    prereg: ROUND14_PREREG,
    rulesCommit: ROUND14_PREREG,
    generatedAt: new Date().toISOString(),
    cells,
  };
  const packed = JSON.stringify(report);
  if (/"shares"|"avgCost"|"avg_cost"|"reviewLine"|\bU\d{7,8}\b/.test(packed)) throw new Error("出力に残してはいけない項目がある");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, packed);
  writeTrades(trades, checks);
  console.log(`wrote ${OUT}`);
}

function writeTrades(rows: readonly TradeRow[], expected: readonly ExportCheck[]): void {
  fs.rmSync(ART, { recursive: true, force: true });
  fs.mkdirSync(ART, { recursive: true });
  fs.writeFileSync(path.join(ART, "all_trades.csv"), `${[CSV_HEAD, ...rows.map(csvLine)].join("\n")}\n`);
  const lines: string[] = [];
  let maxPnlGap = 0;
  let maxNetGap = 0;
  let maxParkGap = 0;
  for (const check of expected) {
    const mine = rows.filter((row) => row.config === check.config && row.universe === check.universe && row.window === check.window);
    if (mine.length !== check.engineN) throw new Error(`行数が違う ${check.config} ${check.universe} ${check.window} ${mine.length} ${check.engineN}`);
    const pnl = mine.reduce((sum, row) => sum + Math.round(row.pnl * 100), 0) / 100;
    const net = mine.reduce((sum, row) => sum + Math.round(row.net * 100), 0) / 100;
    const tbill = mine.filter((row) => row.sleeve === "tbill").reduce((sum, row) => sum + Math.round(row.pnl * 100), 0) / 100;
    const pnlGap = cents(pnl + check.dividends - check.enginePnl);
    const netGap = cents(net + check.dividends - check.engineNet);
    const parkGap = cents(tbill - check.parkPrice);
    maxPnlGap = Math.max(maxPnlGap, Math.abs(pnlGap));
    maxNetGap = Math.max(maxNetGap, Math.abs(netGap));
    maxParkGap = Math.max(maxParkGap, Math.abs(parkGap));
    if (Math.abs(netGap) > 0.05) throw new Error(`手数料の差が大きい ${check.config} ${check.universe} ${check.window} ${netGap}`);
    lines.push(
      `| ${check.config} | ${check.universe} | ${check.window} | ${mine.length} | ${check.engineN} | ${pnl.toFixed(2)} | ${check.enginePnl.toFixed(2)} | ${pnlGap.toFixed(2)} | ${net.toFixed(2)} | ${check.engineNet.toFixed(2)} | ${netGap.toFixed(2)} | ${tbill.toFixed(2)} | ${check.parkPrice.toFixed(2)} | ${parkGap.toFixed(2)} |`,
    );
  }
  const names = fs.readdirSync(ART).sort();
  if (names.join(",") !== "all_trades.csv") throw new Error(`成果物が多い ${names.join(",")}`);
  const note = [
    "# Round 14 trade export verification",
    "",
    `Study pre-registration \`${ROUND14_PREREG}\`. Nothing from this export is committed.`,
    "",
    "`pnl_usd` is the engine position P&L. `pnl_net190_usd` adds $0.70 per sell and subtracts $1.90 once per position. A T-bill cycle is one position: partial sales add the $0.70 back and only the sale that ends the cycle subtracts $1.90. Cash distributions are not a row; they are added in the net comparison.",
    "",
    "A T-bill `entry_price` is the average cost implied by that sale's rounded P&L. `signal_date` is empty. `hold_days` is the session count from the cycle's first buy to that sale.",
    "",
    "| config | universe | window | rows | engine rows | sum pnl_usd | engine total | pnl delta | sum net | engine net | net delta | tbill pnl | engine price | price delta |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...lines,
    "",
    `Position nets match the engine $1.90 total within $${maxNetGap.toFixed(2)} after adding distributions. Summed \`pnl_usd\` cents can differ from the engine account total by a few cents because each park sale is rounded on its own; the largest account gap in this export is $${maxPnlGap.toFixed(2)} and the largest T-bill price gap is $${maxParkGap.toFixed(2)}.`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(ART, "verify.md"), note);
  const left = fs.readdirSync(ART).sort();
  if (left.join(",") !== "all_trades.csv,verify.md") throw new Error(`成果物が違う ${left.join(",")}`);
  console.log(`wrote ${ART} pnlGap ${maxPnlGap.toFixed(2)} netGap ${maxNetGap.toFixed(2)} parkGap ${maxParkGap.toFixed(2)}`);
}

main();
