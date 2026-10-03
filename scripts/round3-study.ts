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
  type DayQuote,
  type Feat,
  type NameSeries,
} from "../src/lib/backtest-study";
import { entryGuides } from "../src/lib/compute";
import { reactionDaysFrom } from "../src/lib/earnings-bridge";
import { isIgnoredTicker } from "../src/lib/holdings";
import {
  ROUND3_IDS,
  ROUND3_PREREG,
  SPY_BENCH,
  activeScale,
  boxedExit,
  expectancyR,
  feeRoomOk,
  gapVoids,
  riskShares,
  round3Verdict,
  strengthOk,
  type Round3Id,
  type Round3Report,
  type Round3Row,
  type Round3Universe,
  type Round3Window,
} from "../src/lib/round3";
import { MAIN_Q, MAIN_Z, bootstrapMean, entryBeforeEarnings, overallVerdict, type Verdict } from "../src/lib/round2";
import { scaleFlatIndex } from "../src/lib/scale-exit";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 3 risk-sizing study.
 * Analysis only. Writes data/backtest/round3.json.
 *   npx tsx scripts/round3-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round3.json");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "r3-core", label: "今の187", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "r3-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });

type WindowSpec = { id: Round3Window; from: string; to: string; asOf: string };

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

function meanOf(values: number[]): number | null {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function withTimeStop(cand: Candidate, bars: Feat[]): Candidate {
  const plan = boxedExit(bars, cand.entryIndex, cand.entry + cand.atr, cand.stop ?? null, 20, true);
  if (!plan) return { ...cand };
  return {
    ...cand,
    exitIndex: plan.exitIndex,
    exitDate: bars[plan.exitIndex].date,
    exit: plan.exit,
    reason: plan.reason,
    exitTiming: plan.timing,
    voided: gapVoids(
      bars.map((bar) => bar.c),
      cand.entryIndex,
      plan.exitIndex,
    ),
  };
}

function withScale(cand: Candidate, bars: Feat[], timeStop: boolean): Candidate {
  const sig = bars[cand.signalIndex];
  const prices = activeScale(cand.entry, sig?.mid ?? null, sig?.high20 ?? null);
  const stop = cand.stop ?? null;
  const timeStopIndex = timeStop ? cand.entryIndex + 5 : null;
  const liveTime = timeStopIndex != null && timeStopIndex < bars.length ? timeStopIndex : null;
  const flat = scaleFlatIndex(bars, cand.entryIndex, {
    entry: cand.entry,
    mid: prices.mid,
    top: prices.top,
    stop,
    timeStopIndex: liveTime,
    maxHold: 20,
  });
  const holdIndex = Math.min(bars.length - 1, cand.entryIndex + 20);
  return {
    ...cand,
    voided: gapVoids(
      bars.map((bar) => bar.c),
      cand.entryIndex,
      flat,
    ),
    exitIndex: flat,
    exitDate: bars[flat].date,
    exit: bars[flat].c,
    reason: "timeout",
    exitTiming: "close",
    scale: {
      mid: prices.mid,
      top: prices.top,
      stop,
      timeStopDate: liveTime == null ? null : bars[liveTime].date,
      maxHoldDate: bars[holdIndex].date,
    },
  };
}

function isStrong(cand: Candidate, bars: Feat[] | undefined): boolean {
  const feat = bars?.[cand.signalIndex];
  if (!feat) return false;
  return strengthOk(cand.rs20 ?? null, feat.c, feat.ma50);
}

function atLine25(cand: Candidate, bars: Feat[] | undefined): boolean {
  const feat = bars?.[cand.signalIndex];
  if (!feat || feat.low20 == null || feat.high20 == null) return false;
  return feat.c >= entryGuides(feat.low20, feat.high20).line25;
}

function prepare(id: Round3Id, list: Candidate[], feats: Map<string, Feat[]>): Candidate[] {
  if (id === "R4") return list.filter((cand) => isStrong(cand, feats.get(cand.ticker)));
  if (id === "R6") return list.filter((cand) => atLine25(cand, feats.get(cand.ticker)));
  if (id === "R2") return list.map((cand) => withScale(cand, feats.get(cand.ticker) ?? [], false));
  if (id === "R3") return list.map((cand) => withTimeStop(cand, feats.get(cand.ticker) ?? []));
  if (id === "R7") return list.filter((cand) => isStrong(cand, feats.get(cand.ticker))).map((cand) => withScale(cand, feats.get(cand.ticker) ?? [], true));
  return list;
}

function score(book: Book, id: Round3Id, universe: Round3Universe, window: Round3Window): Round3Row {
  const fills = book.fills ?? [];
  const wins = fills.filter((fill) => fill.pnlUsd > 0).map((fill) => fill.pnlUsd);
  const losses = fills.filter((fill) => fill.pnlUsd < 0).map((fill) => fill.pnlUsd);
  const boot = bootstrapMean(
    fills.map((fill) => fill.pnlUsd),
    MAIN_Q,
    MAIN_Z,
  );
  const ratio = book.maxDrawdownUsd > 0 ? round(book.totalUsd / book.maxDrawdownUsd) : null;
  const spy = SPY_BENCH[window];
  const judged = id !== "base" && universe !== "core";
  const invested = book.exposure?.investedFraction ?? null;
  const expectancy = expectancyR(
    fills.map((fill) => fill.pnlUsd),
    fills.map((fill) => fill.riskUsd ?? null),
  );
  return {
    id,
    universe,
    window,
    totalUsd: book.totalUsd,
    n: book.n,
    winRate: book.winRate,
    avgWinUsd: meanOf(wins),
    avgLossUsd: meanOf(losses),
    worstUsd: fills.length ? round(Math.min(...fills.map((fill) => fill.pnlUsd))) : null,
    mtmDdUsd: book.maxDrawdownUsd,
    daysMtm10Share: book.sessions > 0 ? round(book.daysMtm10 / book.sessions, 4) : null,
    profitFactor: book.profitFactor,
    expectancyR: expectancy == null ? null : round(expectancy, 4),
    investedFraction: invested,
    daysOpenShare: book.exposure?.daysOpenShare ?? null,
    scaledSpyUsd: invested == null ? null : round(spy.totalUsd * invested),
    ratio,
    ciLow: boot.lower == null ? null : round(boot.lower, 4),
    nRequired: boot.nRequired == null ? null : round(boot.nRequired),
    verdict: round3Verdict({
      judged,
      totalUsd: book.totalUsd,
      n: book.n,
      ratio,
      spyRatio: spy.ratio,
      lower: boot.lower,
      nRequired: boot.nRequired,
    }),
  };
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

  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const reactions = new Map<string, string[]>();
  let undated = 0;
  const names: NameSeries[] = [];
  for (const [ticker, series] of feats) {
    if (ticker === "SPY" || BENCH.has(ticker) || JAB.has(ticker)) continue;
    const key = ticker.toUpperCase();
    const cik = cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, "."));
    if (!cik) reactions.set(ticker, []);
    else {
      const parsed = reactionDaysFrom(loadBlocks(cik), calendar);
      undated += parsed.undated;
      reactions.set(ticker, parsed.days);
    }
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
  const quotes = new Map<string, Map<string, DayQuote>>();
  for (const name of names) {
    advSeries.set(name.ticker, trailingAvgDollar(name.feats, ADV_WINDOW));
    const days = new Map<string, number>();
    const bars = new Map<string, DayQuote>();
    for (const bar of name.feats) {
      days.set(bar.date, bar.c);
      bars.set(bar.date, { o: bar.o, h: bar.h, c: bar.c });
    }
    closes.set(name.ticker, days);
    quotes.set(name.ticker, bars);
  }
  console.log(`names ${names.length} last ${lastBar} undated ${undated}`);

  const rows: Round3Row[] = [];
  for (const window of windows) {
    const bounds = { from: window.from, to: window.to };
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
    const pitSet = new Set(
      [...membershipAsOf(sp500.map((row) => row.ticker), changes500.changes, window.asOf), ...membershipAsOf(sp400.map((row) => row.ticker), changes400.changes, window.asOf)].filter((ticker) => feats.has(ticker)),
    );
    const leaders = advLeaders(advSeries, windowSessions, ADV_TOP_N);
    const dropPre = (list: Candidate[]) => list.filter((cand) => !entryBeforeEarnings(cand.entryDate, reactions.get(cand.ticker) ?? [], calendar));
    const baseCore: Candidate[] = [];
    const baseWide: Candidate[] = [];
    const riskCore: Candidate[] = [];
    const riskWide: Candidate[] = [];
    for (const name of names) {
      if (name.core) {
        baseCore.push(...rangeCandidates(name, CORE_RULES, market, calendar, bounds));
        riskCore.push(...rangeCandidates(name, CORE_RULES, market, calendar, bounds, undefined, r1Stop));
      }
      const wide = { ...name, semi: gicsSemi(name.ticker) };
      baseWide.push(...rangeCandidates(wide, WIDE_RULES, market, calendar, bounds));
      riskWide.push(...rangeCandidates(wide, WIDE_RULES, market, calendar, bounds, undefined, r1Stop));
    }
    const kept = {
      baseCore: dropPre(baseCore),
      baseWide: dropPre(baseWide),
      riskCore: dropPre(riskCore),
      riskWide: dropPre(riskWide),
    };
    console.log(`${window.id} pit ${pitSet.size} base ${kept.baseCore.length} risk ${kept.riskCore.length}`);

    for (const id of ROUND3_IDS) {
      const sourceCore = id === "base" ? kept.baseCore : kept.riskCore;
      const sourceWide = id === "base" ? kept.baseWide : kept.riskWide;
      const coreList = prepare(id, sourceCore, feats);
      const wideList = prepare(id, sourceWide, feats);
      const books: Array<{ universe: Round3Universe; cands: Candidate[] }> = [
        { universe: "core", cands: coreList },
        { universe: "pit", cands: wideList.filter((cand) => pitSet.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) })) },
        { universe: "adv", cands: wideList.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) })) },
      ];
      const size =
        id === "base"
          ? undefined
          : (cand: Candidate) => {
              const qty = riskShares(cand.entry, cand.stop ?? Number.NaN);
              if (qty == null) return null;
              if (id !== "R5" && id !== "R7") return qty;
              const mid = feats.get(cand.ticker)?.[cand.signalIndex]?.mid ?? null;
              return feeRoomOk(mid, cand.entry, qty) ? qty : null;
            };
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
            quotes,
            maxSemi: 2,
            size,
            keepFills: true,
            keepRisk: true,
            keepExposure: true,
          },
          spec.cands,
        );
        const row = score(book, id, spec.universe, window.id);
        rows.push(row);
        console.log(`${window.id} ${spec.universe} ${id} n ${row.n} pnl ${row.totalUsd} ${row.verdict} exp ${row.expectancyR} spy ${row.scaledSpyUsd}`);
      }
    }
  }

  const baseline = rows.find((row) => row.id === "base" && row.universe === "core" && row.window === "in");
  if (baseline?.totalUsd !== 1307.46 || baseline.n !== 363) {
    throw new Error(`基準の今の187が +1307.46 / 363 ではない: ${baseline?.totalUsd} / ${baseline?.n}`);
  }
  const summary = ROUND3_IDS.map((id) => {
    const of = (universe: Round3Universe): Verdict => overallVerdict(rows.filter((row) => row.id === id && row.universe === universe).map((row) => row.verdict));
    const pit = of("pit");
    const adv = of("adv");
    return { id, pit, adv, verdict: overallVerdict([pit, adv]) };
  });
  const report: Round3Report = {
    v: 1,
    prereg: "docs/ROUND3_PREREG.md",
    rulesCommit: ROUND3_PREREG,
    generatedAt: new Date().toISOString(),
    undated,
    spy: SPY_BENCH,
    rows,
    summary,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote ${OUT}`);
  for (const row of summary) console.log(`summary ${row.id} pit ${row.pit} adv ${row.adv} ${row.verdict}`);
}

main();
