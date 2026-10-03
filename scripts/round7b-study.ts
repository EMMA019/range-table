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
import { MAIN_Q, MAIN_Z, bootstrapMean } from "../src/lib/round2";
import { SPY_BENCH, type Round3Universe, type Round3Window } from "../src/lib/round3";
import { admits, aboveBoxTop, ttmAt, type ConceptFacts, type TtmStatus } from "../src/lib/round4";
import { emptyExits, meanNet190, withRound7Exit, EXIT_REASONS, type Round7Variant } from "../src/lib/round7";
import {
  EXCEPTION_KEEP,
  KEEP,
  LOSS_MAKING,
  NUCLEAR,
  OTHER_REMOVE,
  REMOVE,
  ROUND4_PREREG,
  ROUND7B_PREREG,
  ROUND7_EXIT_COMMIT,
  TRANSITION,
  cellOf,
  rowMembers,
  themeOf,
  themeTotals,
  type Round7bExit,
  type Round7bFill,
  type Round7bName,
  type Round7bReport,
  type Round7bRow,
  type Round7bRowId,
} from "../src/lib/round7b";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 7b hindsight reference. Rules are locked in docs/ROUND7B_PREREG.md.
 * Analysis only. Does not call EDGAR. Does not edit the watchlist.
 *   npx tsx scripts/round7b-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round7b_reference.json");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "r7b-core", label: "今のリスト", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "r7b-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });

const CURRENT_A: Array<{ window: Round3Window; total: number; n: number }> = [
  { window: "oos", total: 1581.13, n: 350 },
  { window: "in", total: 1105.45, n: 375 },
];
const CURRENT_C: Array<{ window: Round3Window; total: number; n: number }> = [
  { window: "oos", total: 1801.92, n: 245 },
  { window: "in", total: 633.32, n: 266 },
];

type WindowSpec = { id: Round3Window; from: string; to: string; asOf: string };
type Marked = Candidate & { f1: TtmStatus; above: boolean };
type SlimFile = { missing: true } | { missing: false; concepts: ConceptFacts };

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
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

function score(book: Book, id: Round7bRowId, window: Round3Window): Round7bRow {
  const fills = book.fills ?? [];
  const wins = fills.filter((fill) => fill.pnlUsd > 0).map((fill) => fill.pnlUsd);
  const losses = fills.filter((fill) => fill.pnlUsd < 0).map((fill) => fill.pnlUsd);
  const boot = bootstrapMean(fills.map((fill) => fill.pnlUsd), MAIN_Q, MAIN_Z);
  const ratio = book.maxDrawdownUsd > 0 ? round(book.totalUsd / book.maxDrawdownUsd) : null;
  const spy = SPY_BENCH[window];
  const invested = book.exposure?.investedFraction ?? null;
  const exits = emptyExits();
  const netTrades: Array<{ pnlUsd: number; sells: number }> = [];
  let holdSum = 0;
  for (const fill of fills) {
    const legs = fill.legs ?? [];
    if (!legs.length || fill.hold == null) throw new Error(`内訳がない ${id} ${fill.ticker} ${fill.entryDate}`);
    holdSum += fill.hold;
    netTrades.push({ pnlUsd: fill.pnlUsd, sells: legs.length });
    for (const leg of legs) {
      const reason = EXIT_REASONS.find((item) => item === leg.reason);
      if (!reason) throw new Error(`出口の理由が違う ${leg.reason}`);
      const bucket = exits[reason];
      bucket.n += 1;
      bucket.pnlUsd += leg.pnlUsd;
    }
  }
  for (const reason of EXIT_REASONS) exits[reason].pnlUsd = round(exits[reason].pnlUsd) ?? 0;
  const mean = fills.length ? round(fills.reduce((sum, fill) => sum + fill.pnlUsd, 0) / fills.length) : null;
  return {
    id,
    window,
    members: rowMembers(id).length,
    totalUsd: book.totalUsd,
    n: book.n,
    winRate: book.winRate,
    avgWinUsd: wins.length ? round(wins.reduce((sum, value) => sum + value, 0) / wins.length) : null,
    avgLossUsd: losses.length ? round(losses.reduce((sum, value) => sum + value, 0) / losses.length) : null,
    mtmDdUsd: book.maxDrawdownUsd,
    meanUsd: mean,
    meanNet190Usd: round(meanNet190(netTrades)),
    avgHold: fills.length ? round(holdSum / fills.length, 2) : null,
    exits,
    investedFraction: invested,
    scaledSpyUsd: invested == null ? null : round(spy.totalUsd * invested),
    spyTotalUsd: spy.totalUsd,
    spyMtmDdUsd: spy.mtmDdUsd,
    spyRatio: spy.ratio,
    ratio,
    nRequired: boot.nRequired == null ? null : round(boot.nRequired),
  };
}

function snaps(book: Book, wanted: Set<string>): Round7bFill[] {
  return (book.fills ?? [])
    .filter((fill) => wanted.has(fill.ticker))
    .map((fill) => ({ ticker: fill.ticker, entryDate: fill.entryDate, exitDate: fill.exitDate, pnlUsd: fill.pnlUsd }));
}

function withExit(cands: Marked[], exit: Round7Variant, feats: Map<string, Feat[]>): Marked[] {
  return cands.map((cand) => {
    const series = feats.get(cand.ticker);
    if (!series) throw new Error(`日足がない ${cand.ticker}`);
    return { ...withRound7Exit(cand, series, exit), f1: cand.f1, above: cand.above };
  });
}

function portfolio(id: string, universe: Round3Universe, sessions: string[], closes: Map<string, Map<string, number>>, cands: Marked[]): Book {
  return runPortfolio(
    {
      id,
      label: id,
      universe,
      rank: "rs",
      sessions,
      flatten: true,
      withRestart: false,
      yearSplit: YEAR2_FROM,
      closes,
      maxSemi: 2,
      keepFills: true,
      keepExposure: true,
      keepRound7: true,
    },
    cands,
  );
}

function main() {
  console.log(`prereg ${ROUND7B_PREREG}`);
  const watch = loadWatchlist();
  const traded = watch.groups.flatMap((group) => group.tickers.map((row) => row.ticker)).filter((ticker) => !isIgnoredTicker(ticker));
  const proposed = new Set(rowMembers("currentA"));
  if (proposed.size !== traded.length || traded.some((ticker) => !proposed.has(ticker))) {
    throw new Error("リストが今の取引対象と一致しない");
  }

  const sp500 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp500.html"), "utf8"), "Symbol"));
  const sp400 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp400.html"), "utf8"), "Symbol"));
  const changes500 = changes("sp500-hist.html");
  const changes400 = changes("sp400.html");
  if (!changes500.changes.length || !changes400.changes.length) throw new Error("変更表が読めない");
  const gics = new Map<string, string | null>();
  for (const row of sp400) if (!gics.has(row.ticker)) gics.set(row.ticker, row.sub);
  for (const row of sp500) gics.set(row.ticker, row.sub);
  const gicsSemi = (ticker: string) => isSemiSubIndustry(gics.get(ticker));

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
  for (const ticker of proposed) {
    const series = feats.get(ticker);
    if (!series || series.length < 30) throw new Error(`日足が足りない ${ticker}`);
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

  const focus = new Set<string>([...REMOVE, ...TRANSITION]);
  const bags = new Map<string, Round7bFill[]>();
  const bagKey = (exit: Round7bExit, universe: Round3Universe, window: Round3Window, ticker: string) => `${exit}|${universe}|${window}|${ticker}`;
  const rows: Round7bRow[] = [];

  for (const window of windows) {
    const bounds = { from: window.from, to: window.to };
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
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
    const admitted = (cands: Marked[]) => cands.filter((cand) => admits("F1iF2", cand.f1, cand.above));
    const sources: Array<{ universe: Round3Universe; cands: Marked[] }> = [
      { universe: "core", cands: admitted(baseCore) },
      { universe: "pit", cands: admitted(baseWide.filter((cand) => pitSet.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) }))) },
      { universe: "adv", cands: admitted(baseWide.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) }))) },
    ];

    const keep = new Set(rowMembers("keepC"));
    const keepTransition = new Set(rowMembers("keepTransitionC"));
    const core = sources.find((source) => source.universe === "core");
    if (!core) throw new Error("今のリストがない");
    const reference: Array<{ id: Round7bRowId; exit: Round7Variant; cands: Marked[] }> = [
      { id: "keepC", exit: "C", cands: core.cands.filter((cand) => keep.has(cand.ticker)) },
      { id: "keepTransitionC", exit: "C", cands: core.cands.filter((cand) => keepTransition.has(cand.ticker)) },
      { id: "currentC", exit: "C", cands: core.cands },
      { id: "currentA", exit: "A", cands: core.cands },
    ];
    const coreBooks = new Map<Round7bExit, Book>();
    for (const item of reference) {
      const book = portfolio(item.id, "core", windowSessions, closes, withExit(item.cands, item.exit, feats));
      const row = score(book, item.id, window.id);
      console.log(`${window.id} ${item.id} n ${row.n} pnl ${row.totalUsd} dd ${row.mtmDdUsd} N ${row.nRequired}`);
      rows.push(row);
      if (item.id === "currentA" || item.id === "currentC") coreBooks.set(item.exit, book);
    }

    for (const source of sources) {
      for (const exit of ["A", "C"] as const) {
        const book = source.universe === "core" ? coreBooks.get(exit) : portfolio(`${exit}-${source.universe}`, source.universe, windowSessions, closes, withExit(source.cands, exit, feats));
        if (!book) throw new Error(`本がない ${exit} ${source.universe}`);
        for (const fill of snaps(book, focus)) {
          const key = bagKey(exit, source.universe, window.id, fill.ticker);
          const list = bags.get(key) ?? [];
          list.push(fill);
          bags.set(key, list);
        }
        if (source.universe !== "core") console.log(`${window.id} ${exit} ${source.universe} n ${book.n} pnl ${book.totalUsd}`);
      }
    }
  }

  for (const cell of CURRENT_A) {
    const row = rows.find((item) => item.id === "currentA" && item.window === cell.window);
    if (row?.totalUsd !== cell.total || row.n !== cell.n) throw new Error(`出口A ${cell.window} が ${cell.total} / ${cell.n} ではない: ${row?.totalUsd} / ${row?.n}`);
  }
  for (const cell of CURRENT_C) {
    const row = rows.find((item) => item.id === "currentC" && item.window === cell.window);
    if (row?.totalUsd !== cell.total || row.n !== cell.n) throw new Error(`出口C ${cell.window} が ${cell.total} / ${cell.n} ではない: ${row?.totalUsd} / ${row?.n}`);
  }

  const ordered = [...REMOVE, ...TRANSITION];
  const namesOut: Round7bName[] = ordered.map((ticker) => {
    const theme = themeOf(ticker);
    if (!theme) throw new Error(`テーマがない ${ticker}`);
    const cells = (["A", "C"] as const).flatMap((exit) =>
      (["core", "pit", "adv"] as const).flatMap((universe) =>
        (["oos", "in"] as const).map((window) => cellOf(bags.get(bagKey(exit, universe, window, ticker)) ?? [], exit, universe, window)),
      ),
    );
    return { ticker, list: (TRANSITION as readonly string[]).includes(ticker) ? "transition" : "remove", theme, cells };
  });

  const report: Round7bReport = {
    v: 1,
    kind: "reference",
    hindsight: true,
    prereg: ROUND7B_PREREG,
    rulesCommit: ROUND7B_PREREG,
    round4Commit: ROUND4_PREREG,
    round7Commit: ROUND7_EXIT_COMMIT,
    generatedAt: new Date().toISOString(),
    lists: { keep: KEEP, exceptionKeep: EXCEPTION_KEEP, transition: TRANSITION, remove: REMOVE },
    themes: { nuclear: NUCLEAR, lossMaking: LOSS_MAKING, transition: TRANSITION, other: OTHER_REMOVE },
    spy: SPY_BENCH,
    rows,
    names: namesOut,
    themeTotals: themeTotals(namesOut),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote ${OUT}`);
}

main();
