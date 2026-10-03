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
import {
  ROUND9_BASES,
  ROUND9_FILTERS,
  ROUND9_PREREG,
  SPY_BENCH,
  belowByDate,
  belowShare,
  keepEtfOrder,
  keepStock,
  scoreRow,
  selectBest,
  summarize,
  type RegimeFilter,
  type Round9Base,
  type Round9Report,
  type Round9Row,
} from "../src/lib/round9";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 9 SPY regime filter. Rules are locked in docs/ROUND9_PREREG.md.
 * Analysis only. Does not call EDGAR. Writes data/backtest/round9.json.
 *   npx tsx scripts/round9-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round9.json");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "r9-core", label: "今の187", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "r9-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });

type Lock = {
  base: Round9Base;
  universe: Round3Universe;
  window: Round3Window;
  totalUsd: number;
  mtmDdUsd: number;
  etfPnlUsd: number;
  etfN: number;
  stockN: number;
  jointLossDays: number;
  totalNet190Usd: number;
};

const LOCK: Lock[] = [
  { base: "C", universe: "core", window: "oos", totalUsd: 1801.92, mtmDdUsd: 459.51, etfPnlUsd: 0, etfN: 0, stockN: 245, jointLossDays: 0, totalNet190Usd: 1507.95 },
  { base: "C", universe: "core", window: "in", totalUsd: 633.32, mtmDdUsd: 823.76, etfPnlUsd: 0, etfN: 0, stockN: 266, jointLossDays: 0, totalNet190Usd: 314.14 },
  { base: "C", universe: "pit", window: "oos", totalUsd: 335.76, mtmDdUsd: 670.94, etfPnlUsd: 0, etfN: 0, stockN: 319, jointLossDays: 0, totalNet190Usd: -47.05 },
  { base: "C", universe: "pit", window: "in", totalUsd: 302.24, mtmDdUsd: 782.86, etfPnlUsd: 0, etfN: 0, stockN: 340, jointLossDays: 0, totalNet190Usd: -105.77 },
  { base: "C", universe: "adv", window: "oos", totalUsd: 831.79, mtmDdUsd: 447.8, etfPnlUsd: 0, etfN: 0, stockN: 236, jointLossDays: 0, totalNet190Usd: 548.59 },
  { base: "C", universe: "adv", window: "in", totalUsd: 704.43, mtmDdUsd: 684.07, etfPnlUsd: 0, etfN: 0, stockN: 262, jointLossDays: 0, totalNet190Usd: 390.02 },
  { base: "SOXX", universe: "core", window: "oos", totalUsd: 2174.12, mtmDdUsd: 639.82, etfPnlUsd: 371.05, etfN: 29, stockN: 245, jointLossDays: 79, totalNet190Usd: 1855.86 },
  { base: "SOXX", universe: "core", window: "in", totalUsd: 949.29, mtmDdUsd: 918.14, etfPnlUsd: 293.12, etfN: 23, stockN: 265, jointLossDays: 66, totalNet190Usd: 617.01 },
  { base: "SOXX", universe: "pit", window: "oos", totalUsd: 670.37, mtmDdUsd: 646.89, etfPnlUsd: 334.61, etfN: 30, stockN: 319, jointLossDays: 82, totalNet190Usd: 261.36 },
  { base: "SOXX", universe: "pit", window: "in", totalUsd: 560.29, mtmDdUsd: 954.41, etfPnlUsd: 258.05, etfN: 23, stockN: 340, jointLossDays: 63, totalNet190Usd: 129.58 },
  { base: "SOXX", universe: "adv", window: "oos", totalUsd: 1105.85, mtmDdUsd: 621.54, etfPnlUsd: 351.2, etfN: 29, stockN: 236, jointLossDays: 78, totalNet190Usd: 799.74 },
  { base: "SOXX", universe: "adv", window: "in", totalUsd: 1069.65, mtmDdUsd: 804.17, etfPnlUsd: 364.6, etfN: 23, stockN: 261, jointLossDays: 60, totalNet190Usd: 735.84 },
];

type WindowSpec = { id: Round3Window; from: string; to: string; asOf: string };
type Marked = Candidate & { f1: TtmStatus; above: boolean };
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

function sameBook(a: Round9Row, b: Round9Row): boolean {
  return a.totalUsd === b.totalUsd && a.totalNet190Usd === b.totalNet190Usd && a.stockN === b.stockN && a.etfN === b.etfN && a.mtmDdUsd === b.mtmDdUsd && a.jointLossDays === b.jointLossDays && a.etfPnlUsd === b.etfPnlUsd;
}

function main() {
  console.log(`prereg ${ROUND9_PREREG}`);
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
  const below = belowByDate(spy);
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

  const rows: Round9Row[] = [];
  for (const window of windows) {
    const bounds = { from: window.from, to: window.to };
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
    const share = belowShare(windowSessions, below);
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

    for (const source of sources) {
      const admitted = source.cands
        .filter((cand) => admits("F1iF2", cand.f1, cand.above))
        .map((cand) => {
          const series = feats.get(cand.ticker);
          if (!series) throw new Error(`日足がない ${cand.ticker}`);
          return { ...withRound7Exit(cand, series, "C"), f1: cand.f1, above: cand.above, series };
        });
      for (const base of ROUND9_BASES) {
        for (const filter of ROUND9_FILTERS) {
          const taken = admitted.filter((cand) => keepStock(filter, cand.signalDate, below, cand.series[cand.signalIndex].c, cand.series[cand.signalIndex].low20, cand.series[cand.signalIndex].high20));
          const used = new Map<string, EtfOrder>();
          if (base === "SOXX") {
            for (const [date, order] of orders) {
              if (keepEtfOrder(filter, order.signalDate, below)) used.set(date, order);
            }
          }
          const portfolio = runPortfolio(
            {
              id: `${base}-${filter}-${source.universe}-${window.id}`,
              label: `${base} ${filter}`,
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
              ...(base === "SOXX"
                ? { etfSleeve: { symbol: "SOXX", orders: used, bars: soxx.byDate, sessions: windowSessions, exit: "box" as const } }
                : {}),
            },
            taken,
          );
          cashAgrees(portfolio, `${base} ${filter} ${source.universe} ${window.id}`);
          const judged = source.universe !== "core";
          const scored = scoreRow(portfolio, base, filter, source.universe, window.id, share, judged);
          console.log(
            `${window.id} ${base} ${filter} ${source.universe} ${scored.verdict} pnl ${scored.totalUsd} net ${scored.totalNet190Usd} stock ${scored.stockN} etf ${scored.etfN} win ${scored.winRate} dd ${scored.mtmDdUsd} joint ${scored.jointLossDays} below ${scored.belowShare}`,
          );
          rows.push(scored);
        }
      }
    }
  }

  for (const cell of LOCK) {
    const row = rows.find((item) => item.base === cell.base && item.filter === "off" && item.universe === cell.universe && item.window === cell.window);
    if (!row || row.totalUsd !== cell.totalUsd || row.mtmDdUsd !== cell.mtmDdUsd || row.etfPnlUsd !== cell.etfPnlUsd || row.etfN !== cell.etfN || row.stockN !== cell.stockN || row.jointLossDays !== cell.jointLossDays || row.totalNet190Usd !== cell.totalNet190Usd) {
      throw new Error(`F-off ${cell.base} ${cell.universe} ${cell.window} が公開値と違う: ${row?.totalUsd} / ${row?.stockN} / ${row?.etfN}`);
    }
  }
  for (const universe of ["core", "pit", "adv"] as const) {
    for (const window of ["oos", "in"] as const) {
      const stop = rows.find((item) => item.base === "C" && item.filter === "stop" && item.universe === universe && item.window === window);
      const all = rows.find((item) => item.base === "C" && item.filter === "stop-all" && item.universe === universe && item.window === window);
      if (!stop || !all || !sameBook(stop, all)) throw new Error(`CのF-stopとF-stop-allが違う ${universe} ${window}`);
    }
  }
  if (rows.length !== ROUND9_BASES.length * ROUND9_FILTERS.length * 3 * windows.length) throw new Error(`行数が違う ${rows.length}`);

  const selection = selectBest(rows);
  const report: Round9Report = {
    v: 1,
    prereg: ROUND9_PREREG,
    rulesCommit: ROUND9_PREREG,
    generatedAt: new Date().toISOString(),
    sma: 20,
    spy: SPY_BENCH,
    rows,
    summary: summarize(rows),
    selection,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote ${OUT}`);
  console.log(`best ${selection.bestBase} ${selection.bestFilter} sum ${selection.sumDeltaUsd} consistent ${selection.consistent}`);
  for (const row of report.summary) console.log(`${row.base} ${row.filter} pit ${row.pit} adv ${row.adv} overall ${row.verdict}`);
}

main();
