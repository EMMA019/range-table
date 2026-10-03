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
import { isIgnoredTicker } from "../src/lib/holdings";
import { STOP_IDS, classStop, type StopId, type StopReport, type StopRow, type StopUniverseId, type StopWindowId } from "../src/lib/stops";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Stop comparison for the no-earnings bridge book.
 * Analysis only. Writes data/backtest/stops.json.
 *   npx tsx scripts/stops-study.ts
 */
const RULES_COMMIT = "b8684529ce60cd5e9db1417c9f97bb575ae44084";
const OUT = path.join(process.cwd(), "data", "backtest", "stops.json");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "stop-core", label: "今の187", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "stop-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });

type WindowSpec = { id: StopWindowId; from: string; to: string; asOf: string };

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

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

function share(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return round(part / whole, 4);
}

function worstOf(values: number[]): number | null {
  if (!values.length) return null;
  return round(Math.min(...values));
}

function score(book: Book, cands: Candidate[], id: StopId, universe: StopUniverseId, window: StopWindowId): StopRow {
  const fills = book.fills ?? [];
  const semiKeys = new Set(cands.filter((cand) => cand.semi).map((cand) => `${cand.ticker}|${cand.entryDate}`));
  const semiPnls = fills.filter((fill) => semiKeys.has(`${fill.ticker}|${fill.entryDate}`)).map((fill) => fill.pnlUsd);
  const pnls = fills.map((fill) => fill.pnlUsd);
  const trades10 = pnls.reduce((sum, pnl) => sum + (pnl >= 10 ? 1 : 0), 0);
  return {
    id,
    universe,
    window,
    totalUsd: book.totalUsd,
    worstUsd: worstOf(pnls),
    n: book.n,
    winRate: book.winRate,
    trades10Share: share(trades10, book.n),
    daysMtm10Share: share(book.daysMtm10, book.sessions),
    mtmDdUsd: book.maxDrawdownUsd,
    semis: {
      n: semiPnls.length,
      totalUsd: round(semiPnls.reduce((sum, pnl) => sum + pnl, 0)),
      worstUsd: worstOf(semiPnls),
    },
  };
}

function generate(name: NameSeries, id: StopId, rules: typeof CORE_RULES, market: ReturnType<typeof marketByDate>, calendar: string[], bounds: { from: string; to: string }): Candidate[] {
  return rangeCandidates(name, rules, market, calendar, bounds, undefined, (feat) => {
    if (feat.low20 == null || feat.atr == null) return null;
    return classStop(id, name.semi, feat.low20, feat.atr);
  });
}

function main() {
  const sp500 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp500.html"), "utf8"), "Symbol"));
  const sp400 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp400.html"), "utf8"), "Symbol"));
  const changes500 = changes("sp500-hist.html");
  const changes400 = changes("sp400.html");
  if (!changes500.changes.length || !changes400.changes.length) throw new Error("変更表が読めない");
  const gics = new Map<string, string | null>();
  for (const row of [...sp500, ...sp400]) if (!gics.has(row.ticker)) gics.set(row.ticker, row.sub);
  const gicsSemi = (ticker: string) => isSemiSubIndustry(gics.get(ticker));

  const watch = loadWatchlist();
  const coreSemi = new Map<string, boolean>();
  for (const group of watch.groups) {
    const inClass = group.id === "semi" || group.id === "equipment";
    for (const ticker of group.tickers) {
      if (isIgnoredTicker(ticker.ticker)) continue;
      coreSemi.set(ticker.ticker, inClass);
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
  const names: NameSeries[] = [];
  for (const [ticker, series] of feats) {
    if (ticker === "SPY" || BENCH.has(ticker) || JAB.has(ticker)) continue;
    names.push({
      ticker,
      sector: "",
      semi: coreSemi.get(ticker) === true,
      core: coreSemi.has(ticker),
      broad: true,
      feats: series,
      earnings: [],
    });
  }
  const advSeries = new Map<string, Map<string, number>>();
  const closes = new Map<string, Map<string, number>>();
  for (const name of names) {
    advSeries.set(name.ticker, trailingAvgDollar(name.feats, ADV_WINDOW));
    const days = new Map<string, number>();
    for (const bar of name.feats) days.set(bar.date, bar.c);
    closes.set(name.ticker, days);
  }
  console.log(`names ${names.length} last ${lastBar}`);

  const rows: StopRow[] = [];
  for (const window of windows) {
    const bounds = { from: window.from, to: window.to };
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
    const pitSet = new Set(
      [...membershipAsOf(sp500.map((row) => row.ticker), changes500.changes, window.asOf), ...membershipAsOf(sp400.map((row) => row.ticker), changes400.changes, window.asOf)].filter((ticker) => feats.has(ticker)),
    );
    const leaders = advLeaders(advSeries, windowSessions, ADV_TOP_N);
    console.log(`${window.id} pit ${pitSet.size}`);
    for (const id of STOP_IDS) {
      const coreCands: Candidate[] = [];
      const wideCands: Candidate[] = [];
      for (const name of names) {
        if (name.core) coreCands.push(...generate(name, id, CORE_RULES, market, calendar, bounds));
        wideCands.push(...generate({ ...name, semi: gicsSemi(name.ticker) }, id, WIDE_RULES, market, calendar, bounds));
      }
      const books: Array<{ universe: StopUniverseId; cands: Candidate[] }> = [
        { universe: "core", cands: coreCands },
        { universe: "pit", cands: wideCands.filter((cand) => pitSet.has(cand.ticker)) },
        { universe: "adv", cands: wideCands.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)) },
      ];
      for (const spec of books) {
        const book = runPortfolio(
          {
            id,
            label: id,
            universe: spec.universe,
            rank: "rs",
            sessions: windowSessions,
            flatten: true,
            withRestart: false,
            yearSplit: YEAR2_FROM,
            closes,
            maxSemi: 2,
            keepFills: true,
          },
          spec.cands,
        );
        const row = score(book, spec.cands, id, spec.universe, window.id);
        rows.push(row);
        console.log(`${window.id} ${spec.universe} ${id} n ${row.n} pnl ${row.totalUsd} worst ${row.worstUsd} semi ${row.semis.n} ${row.semis.totalUsd}`);
      }
    }
  }

  const baseline = rows.find((row) => row.id === "low" && row.universe === "core" && row.window === "in");
  if (baseline?.totalUsd !== 1304.86) throw new Error(`基準の今の187が +1304.86 ではない: ${baseline?.totalUsd}`);
  const report: StopReport = { v: 1, rulesCommit: RULES_COMMIT, generatedAt: new Date().toISOString(), rows };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote ${OUT}`);
}

main();
