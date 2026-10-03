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
import { etfOrders, type EtfBar, type EtfEntryName } from "../src/lib/etf-sleeve";
import { isIgnoredTicker } from "../src/lib/holdings";
import { overallVerdict } from "../src/lib/round2";
import { type Round3Universe, type Round3Window } from "../src/lib/round3";
import { admits, aboveBoxTop, ttmAt, type ConceptFacts, type TtmStatus } from "../src/lib/round4";
import { withRound7Exit } from "../src/lib/round7";
import {
  ROUND7_PREREG,
  ROUND8_AMENDMENT,
  ROUND8_AMENDMENT2,
  ROUND8_FILL,
  ROUND8_PREREG,
  SPY_BENCH,
  buyAndHold,
  scoreBook,
  type EtfExitName,
  type Round8Hold,
  type Round8Id,
  type Round8Report,
  type Round8Row,
} from "../src/lib/round8";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 8 idle-cash ETF sleeve. Rules are locked in docs/ROUND8_PREREG.md.
 * Analysis only. Does not call EDGAR. Writes data/backtest/round8.json.
 *   npx tsx scripts/round8-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round8.json");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "r8-core", label: "今の187", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "r8-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });

const C_LOCK: Array<{ universe: Round3Universe; window: Round3Window; total: number; n: number }> = [
  { universe: "core", window: "oos", total: 1801.92, n: 245 },
  { universe: "core", window: "in", total: 633.32, n: 266 },
  { universe: "pit", window: "oos", total: 335.76, n: 319 },
  { universe: "pit", window: "in", total: 302.24, n: 340 },
  { universe: "adv", window: "oos", total: 831.79, n: 236 },
  { universe: "adv", window: "in", total: 704.43, n: 262 },
];

const SLEEVES: Array<{ id: Round8Id; symbol: "SOXX" | "QQQ" | null; box: number }> = [
  { id: "C", symbol: null, box: 0 },
  { id: "SOXX20", symbol: "SOXX", box: 20 },
  { id: "SOXX40", symbol: "SOXX", box: 40 },
  { id: "SOXX60", symbol: "SOXX", box: 60 },
  { id: "QQQ20", symbol: "QQQ", box: 20 },
  { id: "QQQ40", symbol: "QQQ", box: 40 },
  { id: "QQQ60", symbol: "QQQ", box: 60 },
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

type PublishedRow = {
  id: Round8Id;
  universe: Round3Universe;
  window: Round3Window;
  totalUsd: number;
  mtmDdUsd: number;
  etfPnlUsd: number;
  etfN: number;
  stockN: number;
  n: number;
  bothNegativeDays: number;
  sameDayStops: number;
  totalNet190Usd: number;
  verdict: string;
  exit?: "box" | "atr" | null;
  entry?: "E15" | "E25" | "E30" | null;
};

function loadPublished(): PublishedRow[] {
  const raw = JSON.parse(fs.readFileSync(OUT, "utf8")) as { rows: PublishedRow[] };
  const rows = (raw.rows ?? []).filter((row) => (row.exit == null || row.exit === "box") && (row.entry == null || row.entry === "E15"));
  if (!rows.length) throw new Error("公開済みの箱出口がない");
  return rows;
}

function cashAgrees(book: Book, id: string): void {
  const stock = (book.fills ?? []).reduce((sum, fill) => sum + fill.pnlUsd, 0);
  const etf = (book.etfFills ?? []).reduce((sum, fill) => sum + fill.pnlUsd, 0);
  const diff = Math.abs(stock + etf - book.totalUsd);
  const room = 1 + 0.01 * ((book.fills?.length ?? 0) + (book.etfFills?.length ?? 0));
  if (diff > room) throw new Error(`現金と約定が合わない ${id} ${book.totalUsd} ${stock} ${etf}`);
}

function main() {
  console.log(`prereg ${ROUND8_PREREG} amendment ${ROUND8_AMENDMENT} entry ${ROUND8_AMENDMENT2}`);
  const published = loadPublished();
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
  const packs = { SOXX: loadEtf("SOXX"), QQQ: loadEtf("QQQ"), SPY: loadEtf("SPY") };

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

  const rows: Round8Row[] = [];
  const hold: Round8Hold[] = [];
  for (const window of windows) {
    const bounds = { from: window.from, to: window.to };
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
    for (const symbol of ["SPY", "QQQ", "SOXX"] as const) {
      const pathHold = buyAndHold(windowSessions, packs[symbol].byDate);
      hold.push({ symbol, window: window.id, units: pathHold.shares, pnlUsd: pathHold.pnlUsd, mtmDdUsd: pathHold.mtmDdUsd, pnlNet190Usd: pathHold.pnlNet190Usd });
      console.log(`hold ${symbol} ${window.id} pnl ${pathHold.pnlUsd} dd ${pathHold.mtmDdUsd} sh ${pathHold.shares}`);
    }
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
          return { ...withRound7Exit(cand, series, "C"), f1: cand.f1, above: cand.above };
        });
      for (const sleeve of SLEEVES) {
        const pack = sleeve.symbol ? packs[sleeve.symbol] : null;
        const entries: Array<EtfEntryName | null> = sleeve.symbol ? ["E15", "E25", "E30"] : [null];
        const modes: Array<EtfExitName | null> = sleeve.symbol ? ["box", "atr"] : [null];
        for (const entryName of entries) {
          const orders = pack && entryName ? etfOrders(pack.bars, sleeve.box, windowSessions, entryName) : null;
          for (const mode of modes) {
            const portfolio = runPortfolio(
              {
                id: `${sleeve.id}-${entryName ?? "stock"}-${mode ?? "stock"}-${source.universe}-${window.id}`,
                label: sleeve.id,
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
                ...(pack && orders && mode
                  ? { etfSleeve: { symbol: sleeve.symbol ?? "", orders, bars: pack.byDate, sessions: windowSessions, exit: mode } }
                  : {}),
              },
              admitted,
            );
            cashAgrees(portfolio, `${sleeve.id} ${entryName ?? "C"} ${mode ?? "C"} ${source.universe} ${window.id}`);
            const judged = mode === "box" && entryName === "E15" && (sleeve.id === "SOXX20" || sleeve.id === "QQQ20") && source.universe !== "core";
            const row = scoreBook(portfolio, sleeve.id, source.universe, window.id, mode, entryName, judged);
            console.log(
              `${window.id} ${sleeve.id} ${entryName ?? "C"} ${mode ?? "C"} ${source.universe} ${row.verdict} pnl ${row.totalUsd} etf ${row.etfPnlUsd} n ${row.etfN} win ${row.etfWinRate} dd ${row.mtmDdUsd} joint ${row.jointLossDays} net ${row.totalNet190Usd}`,
            );
            rows.push(row);
          }
        }
      }
    }
  }

  for (const cell of C_LOCK) {
    const row = rows.find((item) => item.id === "C" && item.universe === cell.universe && item.window === cell.window);
    if (row?.totalUsd !== cell.total || row.stockN !== cell.n) {
      throw new Error(`C ${cell.universe} ${cell.window} が ${cell.total} / ${cell.n} ではない: ${row?.totalUsd} / ${row?.stockN}`);
    }
  }
  for (const prior of published) {
    const match = rows.find((item) => item.id === prior.id && item.universe === prior.universe && item.window === prior.window && (prior.id === "C" ? item.exit == null : item.exit === "box" && item.entry === "E15"));
    if (!match || match.totalUsd !== prior.totalUsd || match.mtmDdUsd !== prior.mtmDdUsd || match.etfPnlUsd !== prior.etfPnlUsd || match.etfN !== prior.etfN || match.stockN !== prior.stockN || match.n !== prior.n || match.bothNegativeDays !== prior.bothNegativeDays || match.sameDayStops !== prior.sameDayStops || match.totalNet190Usd !== prior.totalNet190Usd || match.verdict !== prior.verdict) {
      throw new Error(`箱出口が公開値と違う ${prior.id} ${prior.universe} ${prior.window}: ${match?.totalUsd} / ${match?.etfN}`);
    }
  }

  const summary: Round8Report["summary"] = [];
  for (const id of ["SOXX20", "QQQ20"] as const) {
    const of = (universe: Round3Universe) => rows.filter((row) => row.id === id && row.universe === universe && row.exit === "box" && row.entry === "E15").map((row) => row.verdict);
    const pit = overallVerdict(of("pit"));
    const adv = overallVerdict(of("adv"));
    summary.push({ id, pit, adv, verdict: overallVerdict([...of("pit"), ...of("adv")]) });
  }
  const report: Round8Report = {
    v: 3,
    prereg: ROUND8_PREREG,
    rulesCommit: ROUND8_PREREG,
    amendment: ROUND8_AMENDMENT,
    amendment2: ROUND8_AMENDMENT2,
    round7Commit: ROUND7_PREREG,
    generatedAt: new Date().toISOString(),
    fill: ROUND8_FILL,
    spy: SPY_BENCH,
    hold,
    rows,
    summary,
  };
  const sleeveRows = 6 * 3 * 2 * 3 * windows.length;
  if (rows.length !== 3 * windows.length + sleeveRows) throw new Error(`行数が違う ${rows.length}`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote ${OUT}`);
  for (const row of summary) console.log(`${row.id} pit ${row.pit} adv ${row.adv} overall ${row.verdict}`);
}

main();
