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
  sharesForBudget,
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
  PUBLISHED_BASELINE,
  RISK_OF,
  ROUND10_IDS,
  ROUND10_PREREG,
  SPY_BENCH,
  baselineMatches,
  emptySkips,
  lossPastRisk,
  scoreRow,
  stopDistanceShares,
  summarize,
  withCQty,
  type Round10Id,
  type Round10Report,
  type Round10Row,
  type SkipCounts,
} from "../src/lib/round10";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 10 stop-distance stock sizing. Rules are locked in docs/ROUND10_PREREG.md.
 * Analysis only. Does not call EDGAR. Writes data/backtest/round10.json.
 *   npx tsx scripts/round10-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round10.json");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "r10-core", label: "今の187", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "r10-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });

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

function budgetSkips(cands: readonly Ready[], first: string, last: string): number {
  let n = 0;
  for (const cand of cands) {
    if (cand.voided || !entryInWindow(cand, first, last)) continue;
    if (sharesForBudget(cand.entry) == null) n += 1;
  }
  return n;
}

function riskBook(cands: readonly Ready[], risk: number, first: string, last: string): { taken: Ready[]; skipped: SkipCounts } {
  const skipped = emptySkips();
  const taken: Ready[] = [];
  for (const cand of cands) {
    if (!entryInWindow(cand, first, last)) continue;
    if (cand.round7Legs && cand.voided) continue;
    if (cand.stop == null || !Number.isFinite(cand.stop)) throw new Error(`損切りがない ${cand.ticker} ${cand.entryDate}`);
    const decision = stopDistanceShares(cand.entry, cand.stop, risk);
    if ("skip" in decision) {
      skipped[decision.skip] += 1;
      continue;
    }
    const planned = withCQty(cand, cand.series, decision.units);
    if (planned.voided) continue;
    taken.push({ ...planned, f1: cand.f1, above: cand.above, series: cand.series });
  }
  return { taken, skipped };
}

function exceedOf(book: Book, taken: readonly Ready[], risk: number): { gapUsd: number[]; otherUsd: number[] } {
  const byEntry = new Map(taken.map((cand) => [`${cand.ticker}|${cand.entryDate}`, cand]));
  const gapUsd: number[] = [];
  const otherUsd: number[] = [];
  for (const fill of book.fills ?? []) {
    const cand = byEntry.get(`${fill.ticker}|${fill.entryDate}`);
    if (!cand || cand.stop == null) throw new Error(`約定の候補がない ${fill.ticker} ${fill.entryDate}`);
    const bar = cand.series.find((item) => item.date === fill.exitDate);
    if (!bar) throw new Error(`出口の足がない ${fill.ticker} ${fill.exitDate}`);
    const leg = fill.legs?.[fill.legs.length - 1];
    if (!leg) throw new Error(`約定の足がない ${fill.ticker} ${fill.exitDate}`);
    const kind = lossPastRisk({ pnlUsd: fill.pnlUsd, risk, reason: leg.reason, exitOpen: bar.o, low: cand.stop });
    if (kind === "gap") gapUsd.push(fill.pnlUsd);
    else if (kind === "other") otherUsd.push(fill.pnlUsd);
  }
  return { gapUsd, otherUsd };
}

function walkSkips(book: Book, skipped: SkipCounts): SkipCounts {
  return { ...skipped, slot: book.skippedSlot, cash: book.skippedCash, semi: book.skippedSemi ?? 0 };
}

function main() {
  console.log(`prereg ${ROUND10_PREREG}`);
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

  const rows: Round10Row[] = [];
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

    for (const source of sources) {
      const admitted: Ready[] = source.cands
        .filter((cand) => admits("F1iF2", cand.f1, cand.above))
        .map((cand) => {
          const series = feats.get(cand.ticker);
          if (!series) throw new Error(`日足がない ${cand.ticker}`);
          return { ...withRound7Exit(cand, series, "C"), f1: cand.f1, above: cand.above, series };
        });
      const sleeve = { symbol: "SOXX", orders, bars: soxx.byDate, sessions: windowSessions, exit: "box" as const };
      for (const id of ROUND10_IDS) {
        const risk = id === "B" ? null : RISK_OF[id];
        const prepared = risk == null ? null : riskBook(admitted, risk, first, last);
        const taken = prepared ? prepared.taken : admitted;
        const skipped = prepared ? prepared.skipped : { ...emptySkips(), budget: budgetSkips(admitted, first, last) };
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
            ...(risk == null
              ? {}
              : {
                  size: (cand: Candidate) => {
                    const units = cand.round7Legs?.reduce((sum, leg) => sum + leg.qty, 0) ?? null;
                    if (units == null || units < 1) throw new Error(`株数がない ${cand.ticker} ${cand.entryDate}`);
                    return units;
                  },
                }),
            etfSleeve: sleeve,
          },
          taken,
        );
        cashAgrees(portfolio, `${id} ${source.universe} ${window.id}`);
        if (risk != null && portfolio.skippedPrice !== 0) throw new Error(`リスク行で価格見送りがある ${id} ${source.universe} ${window.id}`);
        const judged = id !== "B" && source.universe !== "core";
        const scored = scoreRow(portfolio, id, source.universe, window.id, walkSkips(portfolio, skipped), judged, risk == null ? null : exceedOf(portfolio, taken, risk));
        console.log(
          `${window.id} ${id} ${source.universe} ${scored.verdict} pnl ${scored.totalUsd} net ${scored.totalNet190Usd} n ${scored.n} win ${scored.winRate} worst ${scored.worstUsd} gap ${scored.gapN} dd ${scored.mtmDdUsd} low ${scored.lowUsd} use ${scored.deployed}`,
        );
        rows.push(scored);
      }
    }
  }

  for (const cell of PUBLISHED_BASELINE) {
    const row = rows.find((item) => item.id === "B" && item.universe === cell.universe && item.window === cell.window);
    if (!row || !baselineMatches(row, cell)) {
      throw new Error(`基準 ${cell.universe} ${cell.window} が公開値と違う: ${row?.totalUsd} / ${row?.stockN} / ${row?.etfN} / ${row?.totalNet190Usd}`);
    }
  }
  if (rows.length !== ROUND10_IDS.length * 3 * windows.length) throw new Error(`行数が違う ${rows.length}`);

  const report: Round10Report = {
    v: 1,
    prereg: ROUND10_PREREG,
    rulesCommit: ROUND10_PREREG,
    generatedAt: new Date().toISOString(),
    spy: SPY_BENCH,
    rows,
    summary: summarize(rows),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote ${OUT}`);
  for (const row of report.summary) console.log(`${row.id} pit ${row.pit} adv ${row.adv} overall ${row.verdict}`);
}

main();
