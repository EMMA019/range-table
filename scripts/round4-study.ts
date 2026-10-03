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
  type FilingBlock,
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
import { reactionDaysFrom } from "../src/lib/earnings-bridge";
import { EdgarHttpError, edgarJson, secUserAgent } from "../src/lib/edgar-client";
import { isIgnoredTicker } from "../src/lib/holdings";
import { expectancyR, riskShares } from "../src/lib/round3";
import { MAIN_Q, MAIN_Z, bootstrapMean, entryBeforeEarnings, overallVerdict } from "../src/lib/round2";
import {
  FACTS_MAX_BYTES,
  ROUND4_PREREG,
  SPY_BENCH,
  aboveBoxTop,
  admits,
  emptyFlow,
  filterFlow,
  readConceptFacts,
  round4Verdict,
  sumFlow,
  ttmAt,
  type ConceptFacts,
  type Round4Book,
  type Round4Filter,
  type Round4Report,
  type Round4Row,
  type TtmStatus,
} from "../src/lib/round4";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 4 filter study. Rules are locked in docs/ROUND4_PREREG.md.
 * Analysis only. Writes data/backtest/round4.json.
 *   SEC_USER_AGENT="range-table you@example.com" npx tsx scripts/round4-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round4.json");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "r4-core", label: "今の187", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "r4-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });
const FILTERS: Round4Filter[] = ["none", "F1x", "F1i", "F2", "F1xF2", "F1iF2"];
const BOOKS: Round4Book[] = ["base", "R1"];

type WindowId = "oos" | "in";
type UniverseId = "core" | "pit" | "adv";
type WindowSpec = { id: WindowId; from: string; to: string; asOf: string };
type Marked = Candidate & { f1: TtmStatus; above: boolean };
type SlimFile = { missing: true } | { missing: false; concepts: ConceptFacts };

const EXPECTED: Array<{ book: Round4Book; universe: UniverseId; window: WindowId; total: number; n: number }> = [
  { book: "base", universe: "core", window: "oos", total: 1172.36, n: 378 },
  { book: "base", universe: "core", window: "in", total: 1304.86, n: 382 },
  { book: "base", universe: "pit", window: "oos", total: -401.68, n: 348 },
  { book: "base", universe: "pit", window: "in", total: 451.15, n: 345 },
  { book: "base", universe: "adv", window: "oos", total: 1475.92, n: 376 },
  { book: "base", universe: "adv", window: "in", total: 120.83, n: 367 },
  { book: "R1", universe: "core", window: "oos", total: 174.44, n: 276 },
  { book: "R1", universe: "core", window: "in", total: 599.94, n: 293 },
  { book: "R1", universe: "pit", window: "oos", total: -127.88, n: 267 },
  { book: "R1", universe: "pit", window: "in", total: 62.67, n: 305 },
  { book: "R1", universe: "adv", window: "oos", total: 518.88, n: 281 },
  { book: "R1", universe: "adv", window: "in", total: 227.61, n: 281 },
];

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function flowCents(flow: { n: number; pnlUsd: number }) {
  return { n: flow.n, pnlUsd: round(flow.pnlUsd) ?? 0 };
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

function loadBlocks(cik: string): FilingBlock[] {
  const file = path.join(EDGAR, `${cik}.json`);
  if (!fs.existsSync(file)) return [];
  const json = JSON.parse(fs.readFileSync(file, "utf8")) as { filings?: { recent?: FilingBlock; files?: Array<{ name: string }> } };
  const blocks: FilingBlock[] = [];
  if (json.filings?.recent) blocks.push(json.filings.recent);
  for (const extra of json.filings?.files ?? []) {
    const extraFile = path.join(EDGAR, extra.name);
    if (fs.existsSync(extraFile)) blocks.push(JSON.parse(fs.readFileSync(extraFile, "utf8")) as FilingBlock);
  }
  return blocks;
}

function r1Stop(feat: Feat): number | null {
  if (feat.low20 == null || feat.atr == null) return null;
  return feat.low20 - 1.5 * feat.atr;
}

function cikFor(cikOf: Map<string, string>, ticker: string): string | null {
  const key = ticker.toUpperCase();
  return cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, ".")) ?? null;
}

function writeSlim(file: string, body: SlimFile) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body));
  fs.renameSync(tmp, file);
}

async function loadFacts(cik: string): Promise<ConceptFacts | null> {
  const file = path.join(FACTS, `${cik}.json`);
  if (fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, "utf8")) as SlimFile;
      return cached.missing ? null : cached.concepts;
    } catch {
      fs.unlinkSync(file);
    }
  }
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  let last = "unknown";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const json = await edgarJson<unknown>(url, FACTS_MAX_BYTES);
      const concepts = readConceptFacts(json);
      writeSlim(file, { missing: false, concepts });
      return concepts;
    } catch (error) {
      last = error instanceof Error ? error.message : "unknown";
      if (error instanceof EdgarHttpError && error.status === 404) break;
    }
  }
  console.error(`facts ${cik} unknown (${last})`);
  writeSlim(file, { missing: true });
  return null;
}

function score(
  book: Book,
  idBook: Round4Book,
  filter: Round4Filter,
  universe: UniverseId,
  window: WindowId,
  baseline: Book,
  meta: Map<string, { f1: TtmStatus; above: boolean }>,
): Round4Row {
  const fills = book.fills ?? [];
  const baseFills = baseline.fills ?? [];
  const wins = fills.filter((fill) => fill.pnlUsd > 0).map((fill) => fill.pnlUsd);
  const losses = fills.filter((fill) => fill.pnlUsd < 0).map((fill) => fill.pnlUsd);
  const boot = bootstrapMean(fills.map((fill) => fill.pnlUsd), MAIN_Q, MAIN_Z);
  const ratio = book.maxDrawdownUsd > 0 ? round(book.totalUsd / book.maxDrawdownUsd) : null;
  const spy = SPY_BENCH[window];
  const judged = filter !== "none" && universe !== "core";
  const invested = book.exposure?.investedFraction ?? null;
  const expectancy = expectancyR(fills.map((fill) => fill.pnlUsd), fills.map((fill) => fill.riskUsd ?? null));
  const passes = (trade: { ticker: string; entryDate: string }) => {
    const row = meta.get(`${trade.ticker}|${trade.entryDate}`);
    if (!row) throw new Error(`状態がない ${trade.ticker} ${trade.entryDate}`);
    return admits(filter, row.f1, row.above);
  };
  const flow = filter === "none" ? { excludedOriginal: emptyFlow(), newlyAdmitted: emptyFlow(), crowdedOut: emptyFlow() } : filterFlow(baseFills, fills, passes);
  const unknownPnls = baseFills.flatMap((fill) => (meta.get(`${fill.ticker}|${fill.entryDate}`)?.f1 === "unknown" ? [fill.pnlUsd] : []));
  const dropsUnknown = filter === "F1x" || filter === "F1xF2";
  if (dropsUnknown && unknownPnls.length > flow.excludedOriginal.n) throw new Error("未知の除外が合わない");
  return {
    book: idBook,
    filter,
    universe,
    window,
    totalUsd: book.totalUsd,
    n: book.n,
    winRate: book.winRate,
    avgWinUsd: wins.length ? round(wins.reduce((sum, value) => sum + value, 0) / wins.length) : null,
    avgLossUsd: losses.length ? round(losses.reduce((sum, value) => sum + value, 0) / losses.length) : null,
    worstUsd: fills.length ? round(Math.min(...fills.map((fill) => fill.pnlUsd))) : null,
    mtmDdUsd: book.maxDrawdownUsd,
    daysMtm10Share: book.sessions > 0 ? round(book.daysMtm10 / book.sessions, 4) : null,
    profitFactor: book.profitFactor,
    expectancyR: expectancy == null ? null : round(expectancy, 4),
    investedFraction: invested,
    scaledSpyUsd: invested == null ? null : round(spy.totalUsd * invested),
    ratio,
    ciLow: boot.lower == null ? null : round(boot.lower, 4),
    nRequired: boot.nRequired == null ? null : round(boot.nRequired),
    verdict: round4Verdict({ judged, totalUsd: book.totalUsd, n: book.n, ratio, spyRatio: spy.ratio, lower: boot.lower, nRequired: boot.nRequired }),
    excludedOriginal: flowCents(flow.excludedOriginal),
    newlyAdmitted: flowCents(flow.newlyAdmitted),
    crowdedOut: flowCents(flow.crowdedOut),
    unknownBaseline: flowCents(sumFlow(unknownPnls)),
    unknownExcluded: dropsUnknown ? flowCents(sumFlow(unknownPnls)) : null,
  };
}

async function main() {
  if (!secUserAgent()) throw new Error("SEC_USER_AGENT が未設定");
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
  const sessionAt = new Map(calendar.map((date, index) => [date, index]));
  const lastBar = calendar[calendar.length - 1] ?? "";
  const windows: WindowSpec[] = [
    { id: "oos", from: OOS_FROM, to: OOS_TO, asOf: OOS_FROM },
    { id: "in", from: IN_FROM, to: lastBar < IN_TO ? lastBar : IN_TO, asOf: IN_FROM },
  ];
  const market = marketByDate(spy, []);

  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const reactionDays = new Map<string, string[]>();
  const facts = new Map<string, ConceptFacts | null>();
  const ciks = new Set<string>();
  for (const ticker of feats.keys()) {
    if (ticker === "SPY" || BENCH.has(ticker) || JAB.has(ticker)) continue;
    const cik = cikFor(cikOf, ticker);
    if (cik) ciks.add(cik);
    const days = cik ? reactionDaysFrom(loadBlocks(cik), calendar).days : [];
    reactionDays.set(ticker, days.filter((date) => sessionAt.has(date)));
  }
  fs.mkdirSync(FACTS, { recursive: true });
  console.log(`facts ${ciks.size}`);
  let done = 0;
  for (const cik of ciks) {
    const concepts = await loadFacts(cik);
    for (const [ticker] of feats) {
      if (cikFor(cikOf, ticker) === cik) facts.set(ticker, concepts);
    }
    done += 1;
    if (done % 50 === 0 || done === ciks.size) console.log(`facts ${done}/${ciks.size}`);
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

  const rows: Round4Row[] = [];
  for (const window of windows) {
    const bounds = { from: window.from, to: window.to };
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
    const pitSet = new Set(
      [...membershipAsOf(sp500.map((row) => row.ticker), changes500.changes, window.asOf), ...membershipAsOf(sp400.map((row) => row.ticker), changes400.changes, window.asOf)].filter((ticker) => feats.has(ticker)),
    );
    const leaders = advLeaders(advSeries, windowSessions, ADV_TOP_N);
    const baseCore: Candidate[] = [];
    const baseWide: Candidate[] = [];
    const riskCore: Candidate[] = [];
    const riskWide: Candidate[] = [];
    for (const name of names) {
      const wide = { ...name, semi: gicsSemi(name.ticker) };
      if (name.core) {
        baseCore.push(...rangeCandidates(name, CORE_RULES, market, calendar, bounds));
        riskCore.push(...rangeCandidates(name, CORE_RULES, market, calendar, bounds, undefined, r1Stop));
      }
      baseWide.push(...rangeCandidates(wide, WIDE_RULES, market, calendar, bounds));
      riskWide.push(...rangeCandidates(wide, WIDE_RULES, market, calendar, bounds, undefined, r1Stop));
    }
    const dropPre = (list: Candidate[]) => list.filter((cand) => !entryBeforeEarnings(cand.entryDate, reactionDays.get(cand.ticker) ?? [], calendar));
    const lists: Record<Round4Book, { core: Marked[]; wide: Marked[] }> = {
      base: { core: baseCore.map(mark), wide: baseWide.map(mark) },
      R1: { core: dropPre(riskCore).map(mark), wide: dropPre(riskWide).map(mark) },
    };
    console.log(`${window.id} pit ${pitSet.size}`);

    for (const bookId of BOOKS) {
      const size = bookId === "base" ? undefined : (cand: Candidate) => riskShares(cand.entry, cand.stop ?? Number.NaN);
      const sources: Array<{ universe: UniverseId; cands: Marked[] }> = [
        { universe: "core", cands: lists[bookId].core },
        { universe: "pit", cands: lists[bookId].wide.filter((cand) => pitSet.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) })) },
        { universe: "adv", cands: lists[bookId].wide.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) })) },
      ];
      for (const spec of sources) {
        const meta = new Map<string, { f1: TtmStatus; above: boolean }>();
        for (const cand of spec.cands) {
          const key = `${cand.ticker}|${cand.entryDate}`;
          const prev = meta.get(key);
          if (prev && (prev.f1 !== cand.f1 || prev.above !== cand.above)) throw new Error(`状態が割れた ${key}`);
          meta.set(key, { f1: cand.f1, above: cand.above });
        }
        const ran = new Map<Round4Filter, Book>();
        for (const filter of FILTERS) {
          const portfolio = runPortfolio(
            {
              id: `${bookId}-${filter}`,
              label: filter,
              universe: spec.universe,
              rank: "rs",
              sessions: windowSessions,
              flatten: true,
              withRestart: false,
              yearSplit: YEAR2_FROM,
              closes,
              maxSemi: 2,
              size,
              keepFills: true,
              keepRisk: true,
              keepExposure: true,
            },
            spec.cands.filter((cand) => admits(filter, cand.f1, cand.above)),
          );
          ran.set(filter, portfolio);
          console.log(`${window.id} ${spec.universe} ${bookId} ${filter} n ${portfolio.n} pnl ${portfolio.totalUsd}`);
        }
        const baseline = ran.get("none");
        if (!baseline) throw new Error("基準がない");
        for (const filter of FILTERS) {
          const portfolio = ran.get(filter);
          if (!portfolio) throw new Error("行がない");
          rows.push(score(portfolio, bookId, filter, spec.universe, window.id, baseline, meta));
        }
      }
    }
  }

  for (const cell of EXPECTED) {
    const row = rows.find((item) => item.book === cell.book && item.filter === "none" && item.universe === cell.universe && item.window === cell.window);
    if (row?.totalUsd !== cell.total || row.n !== cell.n) {
      throw new Error(`${cell.book} ${cell.universe} ${cell.window} が ${cell.total} / ${cell.n} ではない: ${row?.totalUsd} / ${row?.n}`);
    }
  }

  const summary: Round4Report["summary"] = [];
  for (const book of BOOKS) {
    for (const filter of FILTERS) {
      const of = (universe: UniverseId) => rows.filter((row) => row.book === book && row.filter === filter && row.universe === universe).map((row) => row.verdict);
      const pit = overallVerdict(of("pit"));
      const adv = overallVerdict(of("adv"));
      summary.push({ book, filter, pit, adv, verdict: overallVerdict([...of("pit"), ...of("adv")]) });
    }
  }
  const report: Round4Report = {
    v: 1,
    prereg: ROUND4_PREREG,
    rulesCommit: ROUND4_PREREG,
    generatedAt: new Date().toISOString(),
    spy: SPY_BENCH,
    rows,
    summary,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote ${OUT}`);
  for (const row of summary) console.log(`${row.book} ${row.filter} pit ${row.pit} adv ${row.adv} overall ${row.verdict}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
