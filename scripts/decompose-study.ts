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
  type Candidate,
  type Feat,
  type NameSeries,
} from "../src/lib/backtest-study";
import {
  DECOMPOSE_SEED,
  dedupeTrades,
  sharedLosses,
  sliceFacts,
  topLosses,
  type DecomposeReport,
  type LedgerTrade,
  type StoredSlice,
} from "../src/lib/decompose";
import { reactionDaysFrom } from "../src/lib/earnings-bridge";
import { isIgnoredTicker } from "../src/lib/holdings";
import { riskShares } from "../src/lib/round3";
import { entryBeforeEarnings } from "../src/lib/round2";
import { mulberry32 } from "../src/lib/robustness";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Descriptive trade ledger. Not a pass/fail study.
 * Writes data/backtest/decompose.json.
 *   npx tsx scripts/decompose-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "decompose.json");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "ledger-core", label: "今の187", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "ledger-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type WindowId = "oos" | "in";
type UniverseId = "core" | "pit" | "adv";
type WindowSpec = { id: WindowId; from: string; to: string; asOf: string };
type BookId = "base" | "R1";

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

function weekday(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay()] ?? "Sun";
}

function spyAbove20(spy: Feat[]): Map<string, boolean | null> {
  const out = new Map<string, boolean | null>();
  let sum = 0;
  for (let i = 0; i < spy.length; i += 1) {
    sum += spy[i]?.c ?? 0;
    if (i >= 20) sum -= spy[i - 20]?.c ?? 0;
    const ma = i >= 19 ? sum / 20 : null;
    const close = spy[i]?.c ?? 0;
    out.set(spy[i]?.date ?? "", ma == null ? null : close > ma);
  }
  return out;
}

function daysToNext(at: number, reactions: readonly number[]): number | null {
  let best: number | null = null;
  for (const event of reactions) {
    if (event < at) continue;
    const distance = event - at;
    if (best == null || distance < best) best = distance;
  }
  return best;
}

function packSlice(id: string, universe: StoredSlice["universe"], window: StoredSlice["window"], bookUsd: number, trades: LedgerTrade[], rng: () => number): { slice: StoredSlice; tests: number } {
  const facts = sliceFacts(trades, rng);
  const slice: StoredSlice = {
    id,
    universe,
    window,
    n: facts.n,
    bookUsd,
    tradePnlUsd: round(facts.tradePnlUsd) ?? 0,
    wins: facts.wins,
    losses: facts.losses,
    flats: facts.flats,
    sectors: facts.sectors.map((row) => ({
      ...row,
      winRate: round(row.winRate, 4),
      avgWinUsd: round(row.avgWinUsd),
      avgLossUsd: round(row.avgLossUsd),
      totalUsd: round(row.totalUsd) ?? 0,
      worstUsd: round(row.worstUsd),
    })),
    continuous: facts.continuous.map((row) => ({
      ...row,
      medianWin: round(row.medianWin, 4),
      medianLoss: round(row.medianLoss, 4),
      stdDiff: round(row.stdDiff, 4),
      mannWhitneyP: round(row.mannWhitneyP, 6),
      medianDiffCiLow: round(row.medianDiffCiLow, 4),
      medianDiffCiHigh: round(row.medianDiffCiHigh, 4),
    })),
    categorical: facts.categorical.map((row) => ({
      ...row,
      stdDiff: round(row.stdDiff, 4),
      mannWhitneyP: round(row.mannWhitneyP, 6),
      buckets: row.buckets.map((bucket) => ({
        ...bucket,
        winRate: round(bucket.winRate, 4),
        avgPnlUsd: round(bucket.avgPnlUsd),
      })),
    })),
    rank: facts.rank.map((row) => ({
      ...row,
      stdDiff: round(row.stdDiff, 4),
      absEffect: round(row.absEffect, 4),
    })),
  };
  return { slice, tests: facts.tests };
}

function roundTrade(trade: LedgerTrade): LedgerTrade {
  return {
    ...trade,
    pnlUsd: round(trade.pnlUsd) ?? 0,
    atrPct: round(trade.atrPct, 4),
    boxWidthPct: round(trade.boxWidthPct, 4),
    entryPosPct: round(trade.entryPosPct, 4),
    rs20: round(trade.rs20, 4),
  };
}

function main() {
  const sp500 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp500.html"), "utf8"), "Symbol"));
  const sp400 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp400.html"), "utf8"), "Symbol"));
  const changes500 = changes("sp500-hist.html");
  const changes400 = changes("sp400.html");
  if (!changes500.changes.length || !changes400.changes.length) throw new Error("変更表が読めない");
  const sectorOf = new Map<string, string>();
  const gics = new Map<string, string | null>();
  for (const row of sp400) {
    if (row.sector) sectorOf.set(row.ticker, row.sector);
    if (!gics.has(row.ticker)) gics.set(row.ticker, row.sub);
  }
  for (const row of sp500) {
    if (row.sector) sectorOf.set(row.ticker, row.sector);
    gics.set(row.ticker, row.sub);
  }
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
  const regime = spyAbove20(spy);

  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const reactionAt = new Map<string, number[]>();
  for (const [ticker, series] of feats) {
    if (ticker === "SPY" || BENCH.has(ticker) || JAB.has(ticker)) continue;
    const key = ticker.toUpperCase();
    const cik = cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, "."));
    const days = cik ? reactionDaysFrom(loadBlocks(cik), calendar).days : [];
    reactionAt.set(ticker, days.flatMap((date) => {
      const index = sessionAt.get(date);
      return index == null ? [] : [index];
    }));
    void series;
  }

  const names: NameSeries[] = [];
  for (const [ticker, series] of feats) {
    if (ticker === "SPY" || BENCH.has(ticker) || JAB.has(ticker)) continue;
    names.push({
      ticker,
      sector: sectorOf.get(ticker) ?? "",
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

  const books: Array<{ id: BookId; label: string; trades: LedgerTrade[]; checks: Array<{ universe: UniverseId; window: WindowId; totalUsd: number; n: number }> }> = [
    { id: "base", label: "基準（決算の見送りなし・20日安値）", trades: [], checks: [] },
    { id: "R1", label: "R1（決算の前5営業日を見送り・安値−1.5ATR・$32）", trades: [], checks: [] },
  ];

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
    const dropPre = (list: Candidate[]) => list.filter((cand) => !entryBeforeEarnings(cand.entryDate, reactionAt.get(cand.ticker)?.map((index) => calendar[index] ?? "") ?? [], calendar));
    const lists: Record<BookId, { core: Candidate[]; wide: Candidate[] }> = {
      base: { core: baseCore, wide: baseWide },
      R1: { core: dropPre(riskCore), wide: dropPre(riskWide) },
    };
    console.log(`${window.id} pit ${pitSet.size}`);

    for (const book of books) {
      const size = book.id === "base" ? undefined : (cand: Candidate) => riskShares(cand.entry, cand.stop ?? Number.NaN);
      const sources: Array<{ universe: UniverseId; cands: Candidate[] }> = [
        { universe: "core", cands: lists[book.id].core },
        { universe: "pit", cands: lists[book.id].wide.filter((cand) => pitSet.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) })) },
        { universe: "adv", cands: lists[book.id].wide.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)).map((cand) => ({ ...cand, semi: gicsSemi(cand.ticker) })) },
      ];
      for (const spec of sources) {
        const ran = runPortfolio(
          {
            id: book.id,
            label: book.id,
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
          },
          spec.cands,
        );
        const byKey = new Map<string, Candidate[]>();
        for (const cand of spec.cands) {
          if (cand.voided) continue;
          const key = `${cand.ticker}|${cand.entryDate}`;
          const list = byKey.get(key) ?? [];
          list.push(cand);
          byKey.set(key, list);
        }
        for (const fill of ran.fills ?? []) {
          const matches = byKey.get(`${fill.ticker}|${fill.entryDate}`) ?? [];
          const cand = matches.find((row) => row.exitDate === fill.exitDate) ?? matches[0];
          if (!cand) throw new Error(`約定に候補がない ${fill.ticker} ${fill.entryDate}`);
          const sig = feats.get(fill.ticker)?.[cand.signalIndex];
          const low = sig?.low20 ?? null;
          const high = sig?.high20 ?? null;
          const width = low != null && high != null && low > 0 ? ((high - low) / low) * 100 : null;
          const range = low != null && high != null ? high - low : null;
          const entryAt = sessionAt.get(fill.entryDate);
          const exitAt = sessionAt.get(fill.exitDate);
          const planned = cand.exitDate === fill.exitDate;
          book.trades.push({
            ticker: fill.ticker,
            entryDate: fill.entryDate,
            exitDate: fill.exitDate,
            pnlUsd: fill.pnlUsd,
            sector: sectorOf.get(fill.ticker) ?? "unmapped",
            atrPct: cand.atrPct,
            boxWidthPct: width,
            entryPosPct: range != null && range > 0 ? ((cand.entry - (low as number)) / range) * 100 : null,
            rs20: cand.rs20,
            above50: sig?.ma50 == null ? null : sig.c > sig.ma50,
            weekday: weekday(fill.entryDate),
            holdSessions: entryAt != null && exitAt != null ? exitAt - entryAt : 0,
            daysToNextReaction: entryAt == null ? null : daysToNext(entryAt, reactionAt.get(fill.ticker) ?? []),
            gapThrough: planned && cand.reason === "stop" && cand.exitTiming === "open",
            spyAbove20: regime.get(cand.signalDate) ?? null,
            exitReason: planned ? cand.reason : "window",
            slices: [`${spec.universe}/${window.id}`],
          });
        }
        book.checks.push({ universe: spec.universe, window: window.id, totalUsd: ran.totalUsd, n: ran.n });
        console.log(`${window.id} ${spec.universe} ${book.id} n ${ran.n} pnl ${ran.totalUsd}`);
      }
    }
  }

  const expect = (book: BookId, universe: UniverseId, window: WindowId, total: number, n: number) => {
    const row = books.find((item) => item.id === book)?.checks.find((item) => item.universe === universe && item.window === window);
    if (row?.totalUsd !== total || row.n !== n) throw new Error(`${book} ${universe} ${window} が ${total} / ${n} ではない: ${row?.totalUsd} / ${row?.n}`);
  };
  expect("base", "core", "in", 1304.86, 382);
  expect("base", "core", "oos", 1172.36, 378);
  expect("R1", "core", "in", 599.94, 293);
  expect("R1", "core", "oos", 174.44, 276);

  const rng = mulberry32(DECOMPOSE_SEED);
  let tests = 0;
  const reportBooks: DecomposeReport["books"] = [];
  for (const book of books) {
    const slices: StoredSlice[] = [];
    for (const universe of ["core", "pit", "adv"] as const) {
      for (const window of ["oos", "in"] as const) {
        const id = `${universe}/${window}`;
        const rows = book.trades.filter((trade) => trade.slices[0] === id);
        const check = book.checks.find((item) => item.universe === universe && item.window === window);
        const packed = packSlice(id, universe, window, check?.totalUsd ?? 0, rows, rng);
        if (Math.abs(packed.slice.tradePnlUsd - packed.slice.bookUsd) > 2) {
          throw new Error(`${book.id} ${id} の取引合計が口座と合わない ${packed.slice.tradePnlUsd} vs ${packed.slice.bookUsd}`);
        }
        slices.push(packed.slice);
        tests += packed.tests;
      }
    }
    const pooled = dedupeTrades(book.trades);
    const packedPool = packSlice("pooled", "pooled", "all", round(pooled.trades.reduce((sum, trade) => sum + trade.pnlUsd, 0)) ?? 0, pooled.trades, rng);
    slices.push(packedPool.slice);
    tests += packedPool.tests;
    const losses = topLosses(pooled.trades, 10).map(roundTrade);
    const shared = sharedLosses(losses);
    reportBooks.push({
      id: book.id,
      label: book.label,
      unmapped: [...new Set(pooled.trades.filter((trade) => trade.sector === "unmapped").map((trade) => trade.ticker))].sort(),
      conflicts: pooled.conflicts,
      slices,
      topLosses: losses,
      shared: {
        ...shared,
        medianHold: round(shared.medianHold, 1),
        medianAtrPct: round(shared.medianAtrPct, 4),
        medianBoxWidthPct: round(shared.medianBoxWidthPct, 4),
        medianEntryPosPct: round(shared.medianEntryPosPct, 4),
        medianRs20: round(shared.medianRs20, 4),
        medianDaysToEarnings: round(shared.medianDaysToEarnings, 1),
      },
    });
    console.log(`${book.id} pooled ${pooled.trades.length} conflicts ${pooled.conflicts} unmapped ${reportBooks[reportBooks.length - 1]?.unmapped.length}`);
  }

  const report: DecomposeReport = {
    v: 1,
    generatedAt: new Date().toISOString(),
    gicsSource: "Cached Wikipedia S&P 500 and S&P 400 constituent tables, column GICS Sector. Current constituents, not point-in-time. The S&P 500 label wins when a ticker is on both lists. A traded ticker on neither list is unmapped.",
    methods: [
      "Base is the stop-comparison box-low book: no earnings block, $300–$450 size, semiconductors capped at 2, $0.70 on each sell.",
      "R1 is the round-3 row locked at 65bd4a0: pre-earnings block, stop at the 20-day low minus 1.5 ATR for every name, floor($32 / risk) capped at $450.",
      "A win is trade P&L > 0. A loss is trade P&L < 0. Flat trades stay in the sector totals and out of the winner-versus-loser tests.",
      "ATR%, box width (high−low)/low, relative strength, the 50-day average, and the SPY 20-day regime use the signal session, which is known at the entry open. Box position uses the entry open against that same box.",
      "Holding days are SPY sessions from entry to exit. Gap-through means the planned exit was a stop filled at a later open. Days to the next earnings count SPY sessions to the next 8-K reaction day on or after the entry, using the full cached calendar.",
      "The standardized difference is the winner mean minus the loser mean, divided by the pooled within-group standard deviation. The Mann-Whitney p is a two-sided normal approximation. The interval is a 2,000-draw bootstrap of the median difference, seed 20261003.",
      "Weekday has no single p-value. Its effect is the largest one-versus-rest standardized difference. The pooled view keeps one copy of a fill that shares ticker, entry, exit, and P&L.",
    ],
    multipleComparisons: {
      tests,
      bonferroni: tests > 0 ? round(0.05 / tests, 6) : null,
      note: "The p-values are descriptive. They are not adjusted, and none of them is a pass or a fail. The Bonferroni figure is only a reference for how many tests were run.",
    },
    books: reportBooks,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote ${OUT} tests ${tests}`);
}

main();
