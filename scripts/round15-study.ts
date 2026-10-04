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
import { fetchEpsBatch } from "../src/lib/eps";
import { isIgnoredTicker } from "../src/lib/holdings";
import { type Round3Universe, type Round3Window } from "../src/lib/round3";
import { admits, aboveBoxTop, ttmAt, type ConceptFacts, type TtmStatus } from "../src/lib/round4";
import { withRound7Exit } from "../src/lib/round7";
import { etfExitPrice, QUANTUM } from "../src/lib/round12";
import {
  PUBLISHED_PIT_ADV,
  ROUND15_IDS,
  ROUND15_PREREG,
  baselineMatches,
  dropFinancials,
  isGicsFinancials,
  removedFinancials,
  scoreRow,
  watchlistNotGics,
  type QuantumMembership,
  type Round15Cell,
  type Round15Id,
  type Round15Report,
  type Round15Row,
  type StockPnl,
  type YahooEps,
} from "../src/lib/round15";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 15: drop current GICS Financials versus the published baseline.
 * Rules are locked in docs/ROUND15_PREREG.md. Analysis only.
 * Writes data/backtest/round15.json. Trade rows go to
 * /opt/cursor/artifacts/round15_trades/ and are not committed.
 *   npx tsx scripts/round15-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round15.json");
const ART = "/opt/cursor/artifacts/round15_trades";
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const WIDE_RULES = withRules({ id: "r15-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });
const WINDOW_LABEL: Record<Round3Window, string> = { oos: "2022-24", in: "2024-26" };
const CSV_HEAD =
  "config,universe,window,sleeve,ticker,gics_sector,signal_date,entry_date,entry_price,shares,cost_usd,stop,target,exit_date,exit_price,exit_reason,pnl_usd,pnl_net190_usd,hold_days";

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

function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function price(value: number): string {
  return value.toFixed(4);
}

function net190(pnl: number, sells: number): number {
  return (Math.round(pnl * 100) + 70 * sells - 190) / 100;
}

type TradeRow = {
  config: Round15Id;
  universe: Round3Universe;
  window: string;
  sleeve: "stock" | "etf";
  ticker: string;
  gics: string;
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

function csvLine(row: TradeRow): string {
  return [
    row.config,
    row.universe,
    row.window,
    row.sleeve,
    row.ticker,
    row.gics,
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

function stockTrades(book: Book, taken: readonly Ready[], config: Round15Id, universe: Round3Universe, window: string, gicsOf: (ticker: string) => string): TradeRow[] {
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
      gics: gicsOf(fill.ticker),
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
  config: Round15Id,
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
      gics: "",
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

function stockPnls(book: Book): StockPnl[] {
  return (book.fills ?? []).map((fill) => ({
    ticker: fill.ticker,
    entryDate: fill.entryDate,
    pnlUsd: fill.pnlUsd,
    sells: fill.legs?.length || 1,
  }));
}

function ttmOn(concepts: ConceptFacts | null, signal: string): QuantumMembership["ttm"]["oos"] {
  const found = ttmAt(concepts, signal);
  return { status: found.status, ttm: found.ttm };
}

async function main() {
  console.log(`prereg ${ROUND15_PREREG}`);
  const sp500 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp500.html"), "utf8"), "Symbol"));
  const sp400 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp400.html"), "utf8"), "Symbol"));
  const changes500 = changes("sp500-hist.html");
  const changes400 = changes("sp400.html");
  if (!changes500.changes.length || !changes400.changes.length) throw new Error("変更表が読めない");
  const gicsSub = new Map<string, string | null>();
  const gicsSector = new Map<string, string>();
  for (const row of sp400) {
    if (!gicsSub.has(row.ticker)) gicsSub.set(row.ticker, row.sub);
    if (row.sector) gicsSector.set(row.ticker, row.sector);
  }
  for (const row of sp500) {
    gicsSub.set(row.ticker, row.sub);
    if (row.sector) gicsSector.set(row.ticker, row.sector);
  }
  const sectorOf = (ticker: string) => gicsSector.get(ticker) ?? null;
  const gicsOf = (ticker: string) => gicsSector.get(ticker) ?? "";
  const gicsSemi = (ticker: string) => isSemiSubIndustry(gicsSub.get(ticker));
  const sp500Set = new Set(sp500.map((row) => row.ticker));
  const sp400Set = new Set(sp400.map((row) => row.ticker));

  const watch = loadWatchlist();
  const coreSemi = new Map<string, boolean>();
  const watchFinancials = new Set<string>();
  for (const group of watch.groups) {
    const inOldSemi = group.id === "semi" || group.id === "equipment";
    for (const ticker of group.tickers) {
      if (isIgnoredTicker(ticker.ticker)) continue;
      coreSemi.set(ticker.ticker, inOldSemi);
      if (group.id === "financials") watchFinancials.add(ticker.ticker);
    }
  }

  const wanted = new Set<string>([...coreSemi.keys(), "SPY", ...QUANTUM]);
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
    names.push({ ticker, sector: gicsOf(ticker), semi: false, core: coreSemi.has(ticker), broad: true, feats: series, earnings: [] });
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

  const advHits: Record<(typeof QUANTUM)[number], { oos: number; in: number }> = {
    IONQ: { oos: 0, in: 0 },
    RGTI: { oos: 0, in: 0 },
    QBTS: { oos: 0, in: 0 },
    QUBT: { oos: 0, in: 0 },
    ARQQ: { oos: 0, in: 0 },
  };
  const pitMember: Record<Round3Window, Set<string>> = { oos: new Set(), in: new Set() };
  const pitEligible: Record<Round3Window, Set<string>> = { oos: new Set(), in: new Set() };

  const cells: Round15Cell[] = [];
  const rows: Round15Row[] = [];
  const trades: TradeRow[] = [];

  for (const window of windows) {
    const bounds = { from: window.from, to: window.to };
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
    const first = windowSessions[0] ?? "";
    const last = windowSessions[windowSessions.length - 1] ?? "";
    const orders = etfOrders(soxx.bars, 20, windowSessions, "E30");
    const members = new Set(
      [...membershipAsOf(sp500.map((row) => row.ticker), changes500.changes, window.asOf), ...membershipAsOf(sp400.map((row) => row.ticker), changes400.changes, window.asOf)],
    );
    pitMember[window.id] = members;
    const pitSet = new Set([...members].filter((ticker) => feats.has(ticker)));
    pitEligible[window.id] = pitSet;
    const leaders = advLeaders(advSeries, windowSessions, ADV_TOP_N);
    for (const set of leaders.values()) {
      for (const ticker of QUANTUM) if (set.has(ticker)) advHits[ticker][window.id] += 1;
    }
    const baseWide: Marked[] = [];
    for (const name of names) {
      baseWide.push(...rangeCandidates({ ...name, semi: gicsSemi(name.ticker) }, WIDE_RULES, market, calendar, bounds).map(mark));
    }
    const sources: Array<{ universe: Exclude<Round3Universe, "core">; cands: Marked[] }> = [
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
      const walked = new Map<Round15Id, Book>();
      for (const id of ROUND15_IDS) {
        const prepared = dropFinancials(admitted, (cand) => entryInWindow(cand, first, last), sectorOf, id === "ex-financials");
        const portfolio = runPortfolio(
          {
            id: `${id}-${source.universe}-${window.id}`,
            label: id,
            universe: source.universe,
            rank: "rs",
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
          },
          prepared.taken,
        );
        cashAgrees(portfolio, `${id} ${source.universe} ${window.id}`);
        const scored = scoreRow(portfolio, id, source.universe, window.id, prepared.dropped);
        walked.set(id, portfolio);
        rows.push(scored);
        const label = WINDOW_LABEL[window.id];
        trades.push(
          ...stockTrades(portfolio, prepared.taken, id, source.universe, label, gicsOf),
          ...etfTrades(portfolio, orders, soxx.byDate, id, source.universe, label),
        );
        console.log(
          `${window.id} ${id} ${source.universe} pnl ${scored.totalUsd} net ${scored.totalNet190Usd} n ${scored.n} win ${scored.winRate} dd ${scored.mtmDdUsd} low ${scored.lowUsd} ${scored.lowDate} dropped ${scored.dropped}`,
        );
      }
      const baseline = walked.get("baseline");
      const variant = walked.get("ex-financials");
      const baseRow = rows.find((row) => row.id === "baseline" && row.universe === source.universe && row.window === window.id);
      const exRow = rows.find((row) => row.id === "ex-financials" && row.universe === source.universe && row.window === window.id);
      if (!baseline || !variant || !baseRow || !exRow) throw new Error(`行がない ${source.universe} ${window.id}`);
      const removed = removedFinancials(stockPnls(baseline), sectorOf);
      const variantFin = stockPnls(variant).filter((fill) => isGicsFinancials(sectorOf(fill.ticker)));
      if (variantFin.length !== 0) throw new Error(`金融が残った ${source.universe} ${window.id} ${variantFin.length}`);
      const baseKeys = new Set(removedFinancials(stockPnls(baseline), sectorOf).tickers);
      for (const fill of stockPnls(baseline)) {
        if (!isGicsFinancials(sectorOf(fill.ticker))) continue;
        if (stockPnls(variant).some((other) => other.ticker === fill.ticker && other.entryDate === fill.entryDate)) {
          throw new Error(`外した約定が残った ${fill.ticker} ${fill.entryDate}`);
        }
      }
      if (baseKeys.size !== removed.tickers.length) throw new Error("金融の銘柄数が合わない");
      cells.push({
        universe: source.universe,
        window: window.id,
        baseline: baseRow,
        exFinancials: exRow,
        removed,
        watchlistNotGics: watchlistNotGics(stockPnls(baseline), sectorOf, watchFinancials),
      });
    }
  }

  if (PUBLISHED_PIT_ADV.length !== 4) throw new Error(`公開セルが4つではない ${PUBLISHED_PIT_ADV.length}`);
  for (const cell of PUBLISHED_PIT_ADV) {
    const row = rows.find((item) => item.id === "baseline" && item.universe === cell.universe && item.window === cell.window);
    if (!row || !baselineMatches(row, cell)) {
      throw new Error(`基準 ${cell.universe} ${cell.window} が公開値と違う: ${row?.totalUsd} / ${row?.stockN} / ${row?.etfN} / ${row?.totalNet190Usd} / ${row?.mtmDdUsd}`);
    }
  }
  if (cells.length !== 4) throw new Error(`セル数が違う ${cells.length}`);

  const quantum: QuantumMembership[] = QUANTUM.map((ticker) => {
    const cik = cikFor(cikOf, ticker);
    const concepts = cik ? loadSlim(cik) : null;
    return {
      ticker,
      inWatchlist: coreSemi.has(ticker),
      inSp500: sp500Set.has(ticker),
      inSp400: sp400Set.has(ticker),
      hasBars: feats.has(ticker),
      pitMember: { oos: pitMember.oos.has(ticker), in: pitMember.in.has(ticker) },
      pitEligible: { oos: pitEligible.oos.has(ticker), in: pitEligible.in.has(ticker) },
      advSessions: advHits[ticker],
      edgarCik: cik,
      slimFacts: concepts != null,
      ttm: { oos: ttmOn(concepts, OOS_FROM), in: ttmOn(concepts, IN_FROM), lastBar: ttmOn(concepts, lastBar) },
    };
  });

  const report: Round15Report = {
    v: 1,
    prereg: ROUND15_PREREG,
    generatedAt: new Date().toISOString(),
    gicsSource:
      "Cached Wikipedia S&P 500 and S&P 400 constituent tables, column GICS Sector, via listedFrom. Current constituents, not the sector on the signal date. The S&P 500 label wins when a ticker is on both lists. A ticker on neither list is not Financials and stays eligible. This is not the watchlist group financials.",
    selection:
      "Financials was chosen after the 2024-10 through 2026-10 results were already known. Those cells are in-sample. Only 2022-10 through 2024-10 is an out-of-sample check. There is no pass or fail.",
    quantumNote:
      "Emma asked on 2026-10-04 to record IONQ, RGTI, QBTS, QUBT, and ARQQ beside solar, crypto, and nuclear. QMCO is not included. Round 12 listExcluded does not read this list. This study does not drop these symbols.",
    quantum,
    yahoo: { error: "not fetched" },
    cells,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  writeTrades(trades, rows, cells);
  console.log(`wrote ${OUT}`);

  try {
    const snaps = await fetchEpsBatch([...QUANTUM]);
    const byTicker: Record<string, YahooEps> = {};
    for (const ticker of QUANTUM) {
      const snap = snaps[ticker];
      byTicker[ticker] = snap
        ? { trailingEps: snap.trailingEps, forwardEps: snap.forwardEps, error: snap.error }
        : { trailingEps: null, forwardEps: null, error: "no snapshot" };
    }
    report.yahoo = {
      retrievedOn: new Date().toISOString().slice(0, 10),
      source: "Yahoo quoteSummary trailingEps and forwardEps via fetchEpsBatch. The response has no fiscal period end. The field is trailing twelve months. The site greys a name when trailing EPS is strictly below zero, except SPCX. None of these five is SPCX.",
      byTicker,
    };
    fs.writeFileSync(OUT, JSON.stringify(report));
    console.log(`yahoo ${JSON.stringify(byTicker)}`);
  } catch (error) {
    report.yahoo = { error: error instanceof Error ? error.message : String(error) };
    fs.writeFileSync(OUT, JSON.stringify(report));
    console.error(`yahoo failed ${report.yahoo.error}`);
  }
}

function writeTrades(trades: readonly TradeRow[], rows: readonly Round15Row[], cells: readonly Round15Cell[]): void {
  fs.mkdirSync(ART, { recursive: true });
  const lines = [CSV_HEAD, ...trades.map(csvLine)];
  fs.writeFileSync(path.join(ART, "all_trades.csv"), `${lines.join("\n")}\n`);
  for (const config of ROUND15_IDS) {
    const subset = trades.filter((row) => row.config === config);
    fs.writeFileSync(path.join(ART, `${config}.csv`), `${[CSV_HEAD, ...subset.map(csvLine)].join("\n")}\n`);
  }
  const financials = trades.filter((row) => row.config === "baseline" && row.sleeve === "stock" && row.gics === "Financials");
  fs.writeFileSync(path.join(ART, "baseline_financials.csv"), `${[CSV_HEAD, ...financials.map(csvLine)].join("\n")}\n`);
  const checks: string[] = [];
  for (const row of rows) {
    const label = WINDOW_LABEL[row.window];
    const mine = trades.filter((trade) => trade.config === row.id && trade.universe === row.universe && trade.window === label);
    const pnl = Math.round(mine.reduce((sum, trade) => sum + Math.round(trade.pnl * 100), 0)) / 100;
    const net = Math.round(mine.reduce((sum, trade) => sum + Math.round(trade.net * 100), 0)) / 100;
    const stockN = mine.filter((trade) => trade.sleeve === "stock").length;
    const etfN = mine.filter((trade) => trade.sleeve === "etf").length;
    if (mine.length !== row.n || stockN !== row.stockN || etfN !== row.etfN) {
      throw new Error(`行数が違う ${row.id} ${row.universe} ${label} ${mine.length} ${row.n}`);
    }
    if (Math.abs(pnl - row.totalUsd) > 0.05) throw new Error(`損益が合わない ${row.id} ${row.universe} ${label} ${pnl} ${row.totalUsd}`);
    checks.push(
      `| ${row.id} | ${row.universe} | ${label} | ${mine.length} | ${row.n} | ${pnl.toFixed(2)} | ${row.totalUsd.toFixed(2)} | ${(pnl - row.totalUsd).toFixed(2)} | ${net.toFixed(2)} | ${row.totalNet190Usd.toFixed(2)} | ${(net - row.totalNet190Usd).toFixed(2)} |`,
    );
  }
  for (const cell of cells) {
    const label = WINDOW_LABEL[cell.window];
    const mine = financials.filter((trade) => trade.universe === cell.universe && trade.window === label);
    if (mine.length !== cell.removed.n) throw new Error(`金融の行数が違う ${cell.universe} ${label} ${mine.length} ${cell.removed.n}`);
  }
  const note = [
    "# Round 15 trade export verification",
    "",
    `Study pre-registration \`${ROUND15_PREREG}\`. Nothing from this export is committed.`,
    "",
    "`pnl_usd` is the engine position P&L. `pnl_net190_usd` adds $0.70 per sell and subtracts $1.90 once per position.",
    "",
    "`gics_sector` is the current Wikipedia GICS Sector. S&P 500 wins over S&P 400. Blank means the ticker is on neither table.",
    "",
    "2024-26 is in-sample. Financials was chosen after that window was already known. Only 2022-24 is an out-of-sample check.",
    "",
    "| config | universe | window | rows | engine trades | sum pnl_usd | engine total | pnl delta | sum pnl_net190_usd | engine net | net delta |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...checks,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(ART, "verify.md"), note);
  console.log(`wrote ${ART}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
