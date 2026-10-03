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
import { MAIN_Q, MAIN_Z, bootstrapMean, overallVerdict } from "../src/lib/round2";
import { SPY_BENCH, riskShares, type Round3Universe, type Round3Window } from "../src/lib/round3";
import { admits, aboveBoxTop, ttmAt, type ConceptFacts, type TtmStatus } from "../src/lib/round4";
import {
  ROUND5_PREREG,
  inRound5Class,
  round5Verdict,
  tickerExtremes,
  uncappedRiskShares,
  type Round5Cap,
  type Round5Report,
  type Round5Row,
  type Round5Stop,
} from "../src/lib/round5";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 5 semiconductor book. Rules are locked in docs/ROUND5_PREREG.md.
 * Analysis only. Does not call EDGAR. Writes data/backtest/round5.json.
 *   npx tsx scripts/round5-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round5.json");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "r5-base-core", label: "基準の今の187", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "r5-base-wide", label: "基準の上限なし", atrMin: 3, gapThroughStop: true });
const CLASS_RULES = withRules({ id: "r5-class", label: "半導体とその隣", atrMin: 3, gapThroughStop: true });

const CLASS_LISTS = {
  core: "AAOI, ADI, AEHR, ALAB, AMD, AMKR, ANET, APH, ARM, ASML, ASX, AVGO, CAMT, CIEN, CLS, COHR, CRDO, CSCO, DELL, EME, ENTG, ETN, FN, FORM, GEV, GFS, GLW, HPE, HUBB, INTC, JBL, KLAC, LITE, LRCX, LSCC, MCHP, MOD, MPWR, MRVL, MTSI, MU, NOK, NTAP, NVDA, NVMI, NVTS, NXPI, ON, ONTO, POET, POWI, POWL, PWR, QCOM, RMBS, SITM, SMCI, SNDK, STM, STX, SWKS, TEL, TER, TSM, TT, TXN, VIAV, VRT, WDC",
  pitOos: "ADI, AMAT, AMD, AMKR, ANET, APH, AVGO, CIEN, COHR, CRUS, CSCO, EME, ETN, FSLR, GLW, HPE, HUBB, INTC, JBL, KLAC, LITE, LRCX, LSCC, MCHP, MKSI, MPWR, MTSI, MU, NTAP, NVDA, NXPI, OLED, ON, POWI, PWR, QCOM, SITM, SLAB, SMTC, STX, SWKS, SYNA, TEL, TER, TT, TXN, WDC",
  pitIn: "ADI, ALGM, AMAT, AMD, AMKR, ANET, APH, AVGO, CIEN, COHR, CRUS, CSCO, DELL, EME, ETN, FN, FSLR, GEV, GLW, HPE, HUBB, INTC, JBL, KLAC, LITE, LRCX, LSCC, MCHP, MKSI, MPWR, MTSI, MU, NTAP, NVDA, NXPI, OLED, ON, ONTO, POWI, PWR, QCOM, RMBS, SLAB, SMCI, STX, SWKS, SYNA, TEL, TER, TT, TXN, WDC",
  advOos: "ADI, AMAT, AMD, ANET, APH, ARM, ASML, AVGO, CSCO, DELL, ETN, FSLR, GEV, INTC, KLAC, LRCX, MCHP, MPWR, MRVL, MU, NVDA, NXPI, ON, QCOM, SMCI, TSM, TT, TXN, VRT, WDC",
  advIn: "AAOI, ADI, ALAB, AMAT, AMD, ANET, APH, ARM, ASML, AVGO, CIEN, CLS, COHR, CRDO, CSCO, DELL, ETN, FN, FSLR, GEV, GLW, HPE, INTC, KLAC, LITE, LRCX, MCHP, MPWR, MRVL, MU, NOK, NVDA, NVTS, NXPI, ON, PWR, QCOM, SMCI, SNDK, STM, STX, TEL, TER, TSM, TT, TXN, VRT, WDC",
};

const BASELINE: Array<{ universe: Round3Universe; window: Round3Window; total: number; n: number }> = [
  { universe: "core", window: "oos", total: 1581.13, n: 350 },
  { universe: "core", window: "in", total: 1105.45, n: 375 },
  { universe: "pit", window: "oos", total: 135.08, n: 373 },
  { universe: "pit", window: "in", total: 10.16, n: 381 },
  { universe: "adv", window: "oos", total: 879.27, n: 346 },
  { universe: "adv", window: "in", total: 277.96, n: 381 },
];

type WindowId = Round3Window;
type WindowSpec = { id: WindowId; from: string; to: string; asOf: string };
type Marked = Candidate & { f1: TtmStatus; above: boolean };
type SlimFile = { missing: true } | { missing: false; concepts: ConceptFacts };

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function sameList(rows: readonly string[], expected: string) {
  const got = [...rows].sort().join(", ");
  if (got !== expected) throw new Error(`銘柄リストが事前登録と違う\n${got}\n${expected}`);
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

function stopAt(stop: Round5Stop): (feat: Feat) => number | null {
  if (stop === "S0") return (feat) => feat.low20;
  return (feat) => (feat.low20 == null || feat.atr == null ? null : feat.low20 - feat.atr);
}

function assertUnique(cands: readonly Candidate[]) {
  const seen = new Set<string>();
  for (const cand of cands) {
    const key = `${cand.ticker}|${cand.entryDate}`;
    if (seen.has(key)) throw new Error(`候補が重なった ${key}`);
    seen.add(key);
  }
}

function score(
  book: Book,
  role: Round5Row["role"],
  stop: Round5Stop | null,
  cap: Round5Cap | null,
  universe: Round3Universe,
  window: WindowId,
  judged: boolean,
): Round5Row {
  const fills = book.fills ?? [];
  const wins = fills.filter((fill) => fill.pnlUsd > 0).map((fill) => fill.pnlUsd);
  const losses = fills.filter((fill) => fill.pnlUsd < 0).map((fill) => fill.pnlUsd);
  const boot = bootstrapMean(fills.map((fill) => fill.pnlUsd), MAIN_Q, MAIN_Z);
  const ratio = book.maxDrawdownUsd > 0 ? round(book.totalUsd / book.maxDrawdownUsd) : null;
  const spy = SPY_BENCH[window];
  const invested = book.exposure?.investedFraction ?? null;
  const ends = tickerExtremes(fills);
  const money = (row: { ticker: string; pnlUsd: number }) => ({ ticker: row.ticker, pnlUsd: round(row.pnlUsd) ?? 0 });
  return {
    role,
    stop,
    cap,
    universe,
    window,
    totalUsd: book.totalUsd,
    n: book.n,
    winRate: book.winRate,
    avgWinUsd: wins.length ? round(wins.reduce((sum, value) => sum + value, 0) / wins.length) : null,
    avgLossUsd: losses.length ? round(losses.reduce((sum, value) => sum + value, 0) / losses.length) : null,
    mtmDdUsd: book.maxDrawdownUsd,
    investedFraction: invested,
    scaledSpyUsd: invested == null ? null : round(spy.totalUsd * invested),
    ratio,
    ciLow: boot.lower == null ? null : round(boot.lower, 4),
    nRequired: boot.nRequired == null ? null : round(boot.nRequired),
    verdict: round5Verdict({ judged, totalUsd: book.totalUsd, n: book.n, ratio, spyRatio: spy.ratio, lower: boot.lower, nRequired: boot.nRequired }),
    topTickers: ends.top.map(money),
    bottomTickers: ends.bottom.map(money),
    unfunded: 0,
  };
}

function main() {
  console.log(`prereg ${ROUND5_PREREG}`);
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
  const groupOf = new Map<string, string>();
  const coreSemi = new Map<string, boolean>();
  for (const group of watch.groups) {
    const inOldSemi = group.id === "semi" || group.id === "equipment";
    for (const ticker of group.tickers) {
      if (isIgnoredTicker(ticker.ticker)) continue;
      groupOf.set(ticker.ticker, group.id);
      coreSemi.set(ticker.ticker, inOldSemi);
    }
  }
  const inClass = (ticker: string) => inRound5Class(ticker, groupOf.get(ticker) ?? null, gics.get(ticker) ?? null);
  sameList([...groupOf.keys()].filter(inClass), CLASS_LISTS.core);

  const wanted = new Set<string>([...groupOf.keys(), "SPY"]);
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

  const rows: Round5Row[] = [];
  const classCounts = { core: CLASS_LISTS.core.split(", ").length, pitOos: 0, pitIn: 0, advOos: 0, advIn: 0 };
  for (const window of windows) {
    const bounds = { from: window.from, to: window.to };
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
    const pitSet = new Set(
      [...membershipAsOf(sp500.map((row) => row.ticker), changes500.changes, window.asOf), ...membershipAsOf(sp400.map((row) => row.ticker), changes400.changes, window.asOf)].filter((ticker) => feats.has(ticker)),
    );
    const leaders = advLeaders(advSeries, windowSessions, ADV_TOP_N);
    const pitClass = [...pitSet].filter(inClass).sort();
    const advClass = new Set<string>();
    for (const set of leaders.values()) for (const ticker of set) if (inClass(ticker)) advClass.add(ticker);
    if (window.id === "oos") {
      classCounts.pitOos = pitClass.length;
      classCounts.advOos = advClass.size;
      sameList(pitClass, CLASS_LISTS.pitOos);
      sameList([...advClass], CLASS_LISTS.advOos);
    } else {
      classCounts.pitIn = pitClass.length;
      classCounts.advIn = advClass.size;
      sameList(pitClass, CLASS_LISTS.pitIn);
      sameList([...advClass], CLASS_LISTS.advIn);
    }

    const baseCore: Marked[] = [];
    const baseWide: Marked[] = [];
    for (const name of names) {
      if (name.core) baseCore.push(...rangeCandidates(name, CORE_RULES, market, calendar, bounds).map(mark));
      baseWide.push(...rangeCandidates({ ...name, semi: gicsSemi(name.ticker) }, WIDE_RULES, market, calendar, bounds).map(mark));
    }
    const baselineSources: Array<{ universe: Round3Universe; cands: Marked[]; semiCap: boolean }> = [
      { universe: "core", cands: baseCore, semiCap: true },
      { universe: "pit", cands: baseWide.filter((cand) => pitSet.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) })), semiCap: true },
      { universe: "adv", cands: baseWide.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) })), semiCap: true },
    ];
    for (const source of baselineSources) {
      const portfolio = runPortfolio(
        {
          id: `baseline-${source.universe}`,
          label: "基準 F1iF2",
          universe: source.universe,
          rank: "rs",
          sessions: windowSessions,
          flatten: true,
          withRestart: false,
          yearSplit: YEAR2_FROM,
          closes,
          maxSemi: 2,
          keepFills: true,
          keepExposure: true,
        },
        source.cands.filter((cand) => admits("F1iF2", cand.f1, cand.above)),
      );
      console.log(`${window.id} baseline ${source.universe} n ${portfolio.n} pnl ${portfolio.totalUsd}`);
      rows.push(score(portfolio, "baseline", null, null, source.universe, window.id, false));
    }

    const classNames = names.filter((name) => inClass(name.ticker));
    for (const stop of ["S0", "S1"] as const) {
      const made: Marked[] = [];
      for (const name of classNames) made.push(...rangeCandidates(name, CLASS_RULES, market, calendar, bounds, undefined, stopAt(stop)).map(mark));
      assertUnique(made);
      const sources: Array<{ universe: Round3Universe; cands: Marked[] }> = [
        { universe: "core", cands: made.filter((cand) => coreSemi.has(cand.ticker)) },
        { universe: "pit", cands: made.filter((cand) => pitSet.has(cand.ticker)) },
        { universe: "adv", cands: made.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)) },
      ];
      for (const source of sources) {
        for (const cap of ["cap450", "uncapped"] as const) {
          const size = (cand: Candidate) => (cap === "cap450" ? riskShares(cand.entry, cand.stop ?? Number.NaN) : uncappedRiskShares(cand.entry, cand.stop ?? Number.NaN));
          const opts = {
            id: `${stop}-${cap}-${source.universe}`,
            label: `${stop} ${cap}`,
            universe: source.universe,
            rank: "rs" as const,
            sessions: windowSessions,
            flatten: true,
            withRestart: false,
            yearSplit: YEAR2_FROM,
            closes,
            size,
            keepFills: true,
            keepExposure: true,
          };
          const first = runPortfolio(opts, source.cands);
          const kept = new Set<string>();
          for (const fill of first.fills ?? []) {
            const row = source.cands.find((cand) => cand.ticker === fill.ticker && cand.entryDate === fill.entryDate);
            if (!row) throw new Error(`約定に候補がない ${fill.ticker} ${fill.entryDate}`);
            if (admits("F1iF2", row.f1, row.above)) kept.add(`${fill.ticker}|${fill.entryDate}`);
          }
          const secondCands = source.cands.filter((cand) => kept.has(`${cand.ticker}|${cand.entryDate}`));
          if (secondCands.length !== kept.size) throw new Error(`${stop} ${cap} ${source.universe} ${window.id} の残件が ${kept.size} ではなく ${secondCands.length}`);
          const second = runPortfolio(opts, secondCands);
          const unfunded = kept.size - second.n;
          if (unfunded !== second.skippedCash || second.skippedSlot !== 0 || second.skippedPrice !== 0) {
            throw new Error(`${stop} ${cap} ${source.universe} ${window.id} の再実行が現金以外で欠ける ${unfunded} cash ${second.skippedCash} slot ${second.skippedSlot} price ${second.skippedPrice}`);
          }
          const judged = cap === "cap450" && source.universe !== "core";
          console.log(`${window.id} ${stop} ${cap} ${source.universe} n ${second.n} pnl ${second.totalUsd} dropped ${(first.fills?.length ?? 0) - kept.size} unfunded ${unfunded}`);
          const row = score(second, "book", stop, cap, source.universe, window.id, judged);
          row.unfunded = unfunded;
          rows.push(row);
        }
      }
    }
  }

  for (const cell of BASELINE) {
    const row = rows.find((item) => item.role === "baseline" && item.universe === cell.universe && item.window === cell.window);
    if (row?.totalUsd !== cell.total || row.n !== cell.n) {
      throw new Error(`基準 ${cell.universe} ${cell.window} が ${cell.total} / ${cell.n} ではない: ${row?.totalUsd} / ${row?.n}`);
    }
  }

  const summary: Round5Report["summary"] = [];
  for (const stop of ["S0", "S1"] as const) {
    const of = (universe: Round3Universe) =>
      rows.filter((row) => row.role === "book" && row.stop === stop && row.cap === "cap450" && row.universe === universe).map((row) => row.verdict);
    const pit = overallVerdict(of("pit"));
    const adv = overallVerdict(of("adv"));
    summary.push({ stop, pit, adv, verdict: overallVerdict([...of("pit"), ...of("adv")]) });
  }
  const report: Round5Report = {
    v: 1,
    prereg: ROUND5_PREREG,
    rulesCommit: ROUND5_PREREG,
    generatedAt: new Date().toISOString(),
    lowCountExpected: true,
    classCounts,
    spy: SPY_BENCH,
    rows,
    summary,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote ${OUT}`);
  for (const row of summary) console.log(`${row.stop} pit ${row.pit} adv ${row.adv} overall ${row.verdict}`);
}

main();
