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
import { PUBLISHED_BASELINE } from "../src/lib/round10";
import { totalNet190 } from "../src/lib/round8";
import { etfExitPrice } from "../src/lib/round11";
import {
  ROUND12B_PREREG,
  bucketOf,
  bucketTable,
  flowOf,
  sectorOf,
  sectorTable,
  type Round12bCell,
  type Round12bReport,
  type SectorSource,
  type StockTrade,
} from "../src/lib/round12b";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 12b unlimited budget. Rules are locked in docs/ROUND12B_PREREG.md.
 * Analysis only. Does not call EDGAR. Writes data/backtest/round12b.json.
 * Trade rows go to /opt/cursor/artifacts/round_unlimited_trades/ and are not committed.
 *   npx tsx scripts/round12b-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round12b.json");
const ART = "/opt/cursor/artifacts/round_unlimited_trades";
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "r12b-core", label: "今の187", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "r12b-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });
const WINDOW_LABEL: Record<Round3Window, string> = { oos: "2022-24", in: "2024-26" };
const CSV_HEAD = "config,universe,window,sleeve,ticker,signal_date,entry_date,entry_price,shares,cost_usd,stop,target,exit_date,exit_price,exit_reason,pnl_usd,pnl_net190_usd,hold_days,sector,atr_pct";

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
  const diff = Math.abs(stock + etf - book.totalUsd);
  const room = 1 + 0.01 * ((book.fills?.length ?? 0) + (book.etfFills?.length ?? 0));
  if (diff > room) throw new Error(`現金と約定が合わない ${id} ${book.totalUsd} ${stock} ${etf}`);
}

function entryInWindow(cand: Candidate, first: string, last: string): boolean {
  return cand.entryDate >= first && cand.entryDate <= last;
}

type TradeRow = {
  config: string;
  universe: Round3Universe | "sleeve";
  window: string;
  sleeve: "stock" | "etf";
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
  sector: string;
  atrPct: string;
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
    row.sector,
    row.atrPct,
  ].join(",");
}

function atrPctOf(cand: Ready): number {
  const bar = cand.series[cand.signalIndex];
  if (!bar || bar.date !== cand.signalDate || !(bar.c > 0) || !Number.isFinite(cand.atr) || cand.atr < 0) {
    throw new Error(`ATR%がない ${cand.ticker} ${cand.signalDate}`);
  }
  return (cand.atr / bar.c) * 100;
}

function stockTrades(
  book: Book,
  taken: readonly Ready[],
  config: string,
  universe: Round3Universe | "sleeve",
  window: string,
  sectorBy: ReadonlyMap<string, string | null>,
  watchGroup: ReadonlyMap<string, string>,
): TradeRow[] {
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
    const labeled = sectorOf(sectorBy.get(fill.ticker) ?? null, watchGroup.get(fill.ticker) ?? null);
    const atrPct = atrPctOf(cand);
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
      sector: labeled.sector,
      atrPct: atrPct.toFixed(8),
    });
  }
  return out;
}

function etfTrades(
  book: Book,
  orders: Map<string, EtfOrder>,
  bars: Map<string, EtfBar>,
  config: string,
  universe: Round3Universe | "sleeve",
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
      sector: "",
      atrPct: "",
    });
  }
  return out;
}

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

function r6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function keyOf(row: { ticker: string; entryDate: string }): string {
  return `${row.ticker}|${row.entryDate}`;
}

function main() {
  console.log(`prereg ${ROUND12B_PREREG}`);
  const sp500 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp500.html"), "utf8"), "Symbol"));
  const sp400 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp400.html"), "utf8"), "Symbol"));
  const changes500 = changes("sp500-hist.html");
  const changes400 = changes("sp400.html");
  if (!changes500.changes.length || !changes400.changes.length) throw new Error("変更表が読めない");
  const gics = new Map<string, string | null>();
  const sectorBy = new Map<string, string | null>();
  for (const row of sp400) {
    if (!gics.has(row.ticker)) gics.set(row.ticker, row.sub);
    if (!sectorBy.has(row.ticker)) sectorBy.set(row.ticker, row.sector);
  }
  for (const row of sp500) {
    gics.set(row.ticker, row.sub);
    sectorBy.set(row.ticker, row.sector);
  }
  const gicsSemi = (ticker: string) => isSemiSubIndustry(gics.get(ticker));

  const watch = loadWatchlist();
  const coreSemi = new Map<string, boolean>();
  const watchGroup = new Map<string, string>();
  for (const group of watch.groups) {
    const inOldSemi = group.id === "semi" || group.id === "equipment";
    for (const ticker of group.tickers) {
      if (isIgnoredTicker(ticker.ticker)) continue;
      coreSemi.set(ticker.ticker, inOldSemi);
      if (!watchGroup.has(ticker.ticker)) watchGroup.set(ticker.ticker, group.name);
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

  const cells: Round12bCell[] = [];
  const trades: TradeRow[] = [];
  for (const window of windows) {
    const bounds = { from: window.from, to: window.to };
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
    const first = windowSessions[0] ?? "";
    const last = windowSessions[windowSessions.length - 1] ?? "";
    const orders = etfOrders(soxx.bars, 20, windowSessions, "E30");
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

    const label = WINDOW_LABEL[window.id];
    const sleeve = { symbol: "SOXX", orders, bars: soxx.byDate, sessions: windowSessions, exit: "box" as const };
    const soxxBook = runPortfolio(
      {
        id: `soxx-${window.id}`,
        label: "SOXX",
        universe: "sleeve",
        rank: "none",
        sessions: windowSessions,
        flatten: true,
        withRestart: false,
        yearSplit: YEAR2_FROM,
        closes,
        keepFills: true,
        keepRound7: true,
        etfSleeve: sleeve,
      },
      [],
    );
    cashAgrees(soxxBook, `soxx ${window.id}`);
    const soxxFlow = soxxStats(soxxBook);
    trades.push(...etfTrades(soxxBook, orders, soxx.byDate, "soxx", "sleeve", label));
    console.log(`${window.id} soxx pnl ${soxxFlow.pnlUsd} net ${soxxFlow.netUsd} n ${soxxFlow.n}`);

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
      const walk = {
        universe: source.universe,
        rank: "rs" as const,
        sessions: windowSessions,
        flatten: true,
        withRestart: false,
        yearSplit: YEAR2_FROM,
        closes,
        keepFills: true,
        keepRound7: true,
      };
      const limited = runPortfolio(
        {
          ...walk,
          id: `b-${source.universe}-${window.id}`,
          label: "baseline",
          maxSemi: 2,
          keepSleeveStats: true,
          keepRefusals: true,
          etfSleeve: sleeve,
        },
        admitted,
      );
      cashAgrees(limited, `baseline ${source.universe} ${window.id}`);
      const baseline = assertBaseline(limited, source.universe, window.id);
      const open = runPortfolio(
        {
          ...walk,
          id: `u-${source.universe}-${window.id}`,
          label: "unlimited",
          unlimited: true,
          keepDeployed: true,
        },
        admitted,
      );
      cashAgrees(open, `unlimited ${source.universe} ${window.id}`);
      const stocks = stockStats(open, admitted, sectorBy, watchGroup);
      const byKey = new Map(stocks.map((trade) => [keyOf(trade), trade]));
      if (byKey.size !== stocks.length) throw new Error(`無制限の約定が重複 ${source.universe} ${window.id}`);
      const heldByBaseline = new Set((limited.fills ?? []).map(keyOf));
      const missing = [...heldByBaseline].filter((key) => !byKey.has(key));
      if (missing.length) throw new Error(`無制限に無い基準の約定 ${source.universe} ${window.id} ${missing.length} ${missing.slice(0, 8).join(" ")}`);
      const deployed = open.deployed;
      if (!deployed || !(deployed.usd > 0)) throw new Error(`必要資金が0 ${source.universe} ${window.id}`);
      const refusals = limited.refusals ?? [];
      const cashKeys = new Set(refusals.filter((row) => row.reason === "cash").map(keyOf));
      const slotKeys = new Set(refusals.filter((row) => row.reason === "slot").map(keyOf));
      const semiKeys = new Set(refusals.filter((row) => row.reason === "semi").map(keyOf));
      const cashTaken: StockTrade[] = [];
      let cashUnfilled = 0;
      for (const key of cashKeys) {
        const trade = byKey.get(key);
        if (trade) cashTaken.push(trade);
        else cashUnfilled += 1;
      }
      const path: StockTrade[] = [];
      const slot: StockTrade[] = [];
      const semi: StockTrade[] = [];
      for (const [key, trade] of byKey) {
        if (heldByBaseline.has(key) || cashKeys.has(key)) continue;
        path.push(trade);
        if (slotKeys.has(key)) slot.push(trade);
        if (semiKeys.has(key)) semi.push(trade);
      }
      const stockNet = totalNet190(stocks);
      const sectors = sectorTable(stocks);
      const sourcesN = { gics: 0, watchlist: 0, unknown: 0 };
      for (const trade of stocks) sourcesN[trade.source] += 1;
      const cell: Round12bCell = {
        universe: source.universe,
        window: window.id,
        baselineUsd: baseline.totalUsd,
        baselineNetUsd: baseline.netUsd,
        baselineStockN: baseline.stockN,
        baselineEtfN: baseline.etfN,
        stockN: stocks.length,
        stockUsd: open.totalUsd,
        stockNetUsd: stockNet,
        soxxN: soxxFlow.n,
        soxxUsd: soxxFlow.pnlUsd,
        soxxNetUsd: soxxFlow.netUsd,
        deployedUsd: deployed.usd,
        deployedDate: deployed.date,
        returnOnDeployed: r6(stockNet / deployed.usd),
        engineReturnOnDeployed: r6(open.totalUsd / deployed.usd),
        cash: flowOf(cashTaken),
        cashUnfilled,
        path: { n: path.length, pnlUsd: flowOf(path).pnlUsd },
        slot: { n: slot.length, pnlUsd: flowOf(slot).pnlUsd },
        semi: { n: semi.length, pnlUsd: flowOf(semi).pnlUsd },
        sectors,
        topSector: sectors[0]?.key ?? null,
        bottomSector: sectors[sectors.length - 1]?.key ?? null,
        buckets: bucketTable(stocks),
        sources: sourcesN,
      };
      if (cell.sources.gics + cell.sources.watchlist + cell.sources.unknown !== cell.stockN) {
        throw new Error(`セクターの出どころが合わない ${source.universe} ${window.id}`);
      }
      trades.push(...stockTrades(open, admitted, "unlimited", source.universe, label, sectorBy, watchGroup));
      console.log(
        `${window.id} ${source.universe} stock ${cell.stockUsd} net ${cell.stockNetUsd} n ${cell.stockN} deployed ${cell.deployedUsd} ${cell.deployedDate} ret ${cell.returnOnDeployed} cash ${cell.cash.n}/${cell.cash.pnlUsd} unfilled ${cell.cashUnfilled} path ${cell.path.n}/${cell.path.pnlUsd} slot ${cell.slot.n} semi ${cell.semi.n} top ${cell.topSector} bottom ${cell.bottomSector}`,
      );
      cells.push(cell);
    }
  }

  if (cells.length !== 3 * windows.length) throw new Error(`行数が違う ${cells.length}`);
  const report: Round12bReport = {
    v: 1,
    prereg: ROUND12B_PREREG,
    rulesCommit: ROUND12B_PREREG,
    generatedAt: new Date().toISOString(),
    hypothesisOnly: true,
    cells,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  writeTrades(trades, cells);
  console.log(`wrote ${OUT}`);
}

function assertBaseline(book: Book, universe: Round3Universe, window: Round3Window): { totalUsd: number; netUsd: number; stockN: number; etfN: number } {
  const cell = PUBLISHED_BASELINE.find((item) => item.universe === universe && item.window === window);
  if (!cell) throw new Error(`公開セルがない ${universe} ${window}`);
  const stock = book.fills ?? [];
  const etf = book.etfFills ?? [];
  const trades = [
    ...stock.map((fill) => ({ pnlUsd: fill.pnlUsd, sells: fill.legs?.length || 1 })),
    ...etf.map((fill) => {
      if (!fill.legs.length) throw new Error(`ETFの足がない ${fill.entryDate}`);
      return { pnlUsd: fill.pnlUsd, sells: fill.legs.length };
    }),
  ];
  const etfPnl = r2(etf.reduce((sum, fill) => sum + fill.pnlUsd, 0));
  const net = totalNet190(trades);
  const joint = book.sleeve?.bothNegativeDays;
  if (
    book.totalUsd !== cell.totalUsd ||
    book.maxDrawdownUsd !== cell.mtmDdUsd ||
    etfPnl !== cell.etfPnlUsd ||
    etf.length !== cell.etfN ||
    stock.length !== cell.stockN ||
    joint !== cell.jointLossDays ||
    net !== cell.totalNet190Usd
  ) {
    throw new Error(
      `基準 ${universe} ${window} が公開値と違う: ${book.totalUsd}/${cell.totalUsd} dd ${book.maxDrawdownUsd}/${cell.mtmDdUsd} etf ${etfPnl}/${cell.etfPnlUsd} n ${stock.length}/${cell.stockN} ${etf.length}/${cell.etfN} joint ${joint}/${cell.jointLossDays} net ${net}/${cell.totalNet190Usd}`,
    );
  }
  return { totalUsd: book.totalUsd, netUsd: net, stockN: stock.length, etfN: etf.length };
}

function soxxStats(book: Book): { n: number; pnlUsd: number; netUsd: number } {
  if ((book.fills?.length ?? 0) !== 0) throw new Error("SOXXの歩きに株がある");
  const etf = book.etfFills ?? [];
  const trades = etf.map((fill) => {
    if (!fill.legs.length) throw new Error(`ETFの足がない ${fill.entryDate}`);
    return { pnlUsd: fill.pnlUsd, sells: fill.legs.length };
  });
  return { n: etf.length, pnlUsd: book.totalUsd, netUsd: totalNet190(trades) };
}

function stockStats(
  book: Book,
  taken: readonly Ready[],
  sectorBy: ReadonlyMap<string, string | null>,
  watchGroup: ReadonlyMap<string, string>,
): StockTrade[] {
  const byEntry = new Map<string, Ready>();
  for (const cand of taken) {
    const key = keyOf(cand);
    if (byEntry.has(key)) throw new Error(`候補が重複 ${key}`);
    byEntry.set(key, cand);
  }
  const out: StockTrade[] = [];
  for (const fill of book.fills ?? []) {
    const cand = byEntry.get(keyOf(fill));
    if (!cand) throw new Error(`約定の候補がない ${fill.ticker} ${fill.entryDate}`);
    const sells = fill.legs?.length ?? 0;
    if (sells < 1) throw new Error(`約定の足がない ${fill.ticker} ${fill.entryDate}`);
    const labeled = sectorOf(sectorBy.get(fill.ticker) ?? null, watchGroup.get(fill.ticker) ?? null);
    out.push({
      ticker: fill.ticker,
      entryDate: fill.entryDate,
      pnlUsd: fill.pnlUsd,
      sells,
      sector: labeled.sector,
      source: labeled.source,
      atrPct: atrPctOf(cand),
    });
  }
  return out;
}

function cents(rows: readonly TradeRow[], field: "pnl" | "net"): number {
  return rows.reduce((sum, row) => sum + Math.round(row[field] * 100), 0) / 100;
}

function writeTrades(trades: readonly TradeRow[], cells: readonly Round12bCell[]): void {
  fs.rmSync(ART, { recursive: true, force: true });
  fs.mkdirSync(ART, { recursive: true });
  fs.writeFileSync(path.join(ART, "all_trades.csv"), `${[CSV_HEAD, ...trades.map(csvLine)].join("\n")}\n`);
  const checks: string[] = [];
  let maxPnlGap = 0;
  for (const cell of cells) {
    const label = WINDOW_LABEL[cell.window];
    const mine = trades.filter((trade) => trade.config === "unlimited" && trade.universe === cell.universe && trade.window === label && trade.sleeve === "stock");
    if (mine.length !== cell.stockN) throw new Error(`行数が違う ${cell.universe} ${label} ${mine.length} ${cell.stockN}`);
    const pnl = cents(mine, "pnl");
    const net = cents(mine, "net");
    const pnlDelta = r2(pnl - cell.stockUsd);
    const netDelta = r2(net - cell.stockNetUsd);
    if (netDelta !== 0) throw new Error(`ネットが違う ${cell.universe} ${label} ${net} ${cell.stockNetUsd}`);
    maxPnlGap = Math.max(maxPnlGap, Math.abs(pnlDelta));
    checks.push(
      `| unlimited | ${cell.universe} | ${label} | ${mine.length} | ${cell.stockN} | ${pnl.toFixed(2)} | ${cell.stockUsd.toFixed(2)} | ${pnlDelta.toFixed(2)} | ${net.toFixed(2)} | ${cell.stockNetUsd.toFixed(2)} | ${netDelta.toFixed(2)} |`,
    );
  }
  for (const window of ["oos", "in"] as const) {
    const label = WINDOW_LABEL[window];
    const mine = trades.filter((trade) => trade.config === "soxx" && trade.window === label && trade.sleeve === "etf");
    const same = cells.filter((cell) => cell.window === window);
    const cell = same[0];
    if (!cell || same.some((item) => item.soxxN !== cell.soxxN || item.soxxUsd !== cell.soxxUsd || item.soxxNetUsd !== cell.soxxNetUsd)) {
      throw new Error(`SOXXが窓の中で違う ${label}`);
    }
    if (mine.length !== cell.soxxN) throw new Error(`SOXXの行数が違う ${label} ${mine.length} ${cell.soxxN}`);
    const pnl = cents(mine, "pnl");
    const net = cents(mine, "net");
    const pnlDelta = r2(pnl - cell.soxxUsd);
    const netDelta = r2(net - cell.soxxNetUsd);
    if (netDelta !== 0) throw new Error(`SOXXのネットが違う ${label} ${net} ${cell.soxxNetUsd}`);
    maxPnlGap = Math.max(maxPnlGap, Math.abs(pnlDelta));
    checks.push(
      `| soxx | sleeve | ${label} | ${mine.length} | ${cell.soxxN} | ${pnl.toFixed(2)} | ${cell.soxxUsd.toFixed(2)} | ${pnlDelta.toFixed(2)} | ${net.toFixed(2)} | ${cell.soxxNetUsd.toFixed(2)} | ${netDelta.toFixed(2)} |`,
    );
  }
  const names = fs.readdirSync(ART).sort();
  if (names.join(",") !== "all_trades.csv") throw new Error(`書き出したファイルが違う ${names.join(",")}`);
  const note = [
    "# Round 12b unlimited-budget trade export",
    "",
    `Study pre-registration \`${ROUND12B_PREREG}\`. Hypothesis generation only. Nothing from this export is committed.`,
    "",
    "Rows are the unlimited stock book plus the separate SOXX sleeve. SOXX is written once per window. It is not mixed into a stock universe. `sector` and `atr_pct` are empty on SOXX rows.",
    "",
    "`pnl_usd` is the engine position P&L. `pnl_net190_usd` adds $0.70 per sell and subtracts $1.90 once per position.",
    "",
    "`atr_pct` is `(ATR14 / signal close) × 100` with no further rounding before the bucket. The text keeps eight decimals.",
    "",
    "`sector` is the current Wikipedia GICS sector, S&P 500 over S&P 400, else the watchlist group name, else `unknown`. It is not the sector on the signal date.",
    "",
    "| config | universe | window | rows | engine trades | sum pnl_usd | engine total | pnl delta | sum pnl_net190_usd | engine net | net delta |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...checks,
    "",
    `The largest gap between the sum of cent-rounded pnl_usd and the engine total is $${maxPnlGap.toFixed(2)}. Each pnl_net190_usd sum matches the stored net exactly.`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(ART, "verify.md"), note);
  const written = fs.readdirSync(ART).sort();
  if (written.join(",") !== "all_trades.csv,verify.md") throw new Error(`書き出したファイルが違う ${written.join(",")}`);
  console.log(`wrote ${ART}`);
}

main();
