import fs from "fs";
import path from "path";
import { execFileSync } from "node:child_process";
import {
  ADV_TOP_N,
  ADV_WINDOW,
  BENCHMARKS,
  BREADTH_WINDOW,
  ETF_ATR_LOW,
  FULL_EARNINGS_COVERAGE,
  FOREIGN_EARNINGS_RE,
  IN_FROM,
  IN_TO,
  JAB_ETFS,
  OOS_FROM,
  OOS_TO,
  OOS_YEAR2,
  SECTOR_HOLDING_ETFS,
  SECTOR_TOP_N,
  aboveMovingAverage,
  advLeaders,
  biasGap,
  breadthSide,
  changesFrom,
  classifyExcess,
  classifySign,
  cleanTicker,
  dataEndedMidTrade,
  dollarAsOf,
  earningsDatesFrom,
  endEventsFrom,
  expandRowspan,
  filingEndClass,
  isSemiSubIndustry,
  listedFrom,
  lossExit,
  membershipAsOf,
  noteEndClass,
  ratioSma,
  resolveEndClass,
  sectorEtf,
  staysProfitable,
  topTickersByDollar,
  trailingAvgDollar,
  wikiTables,
  withinSessionsBefore,
  type BiasMath,
  type BiasReport,
  type EndClass,
  type EndEvent,
  type EndPenalty,
  type FilingBlock,
  type Listed,
  type SectorRow,
  type SlimBook,
} from "../src/lib/bias";
import {
  ROUND_TRIP_FEE,
  START_CAPITAL,
  YEAR2_FROM,
  buildFeatures,
  marketByDate,
  rangeCandidates,
  runBuyHold,
  runPortfolio,
  withRules,
  type Book,
  type Candidate,
  type Feat,
  type NameSeries,
} from "../src/lib/backtest-study";
import { isIgnoredTicker } from "../src/lib/holdings";
import { mulberry32, percentileBelow, shuffle, spansEarnings, splitStats } from "../src/lib/robustness";
import type { Bar } from "../src/lib/types";
import { loadWatchlist } from "../src/lib/watchlist";
import { fetchDailyBars } from "../src/lib/yahoo";
import { BAR_CACHE, readCachedBars, yahooSymbol } from "./cache-bars";

const UA = "range-table mimiko.neko.neko@gmail.com";
const OUT = path.join(process.cwd(), "data", "backtest", "bias.json");
const WIKI_CACHE = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD_CACHE = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const BOX = withRules({
  id: "bias-box",
  label: "基準・ATR3%・ギャップ抜け・届出がある決算だけ回避",
  atrMin: 3,
  gapThroughStop: true,
  earnings: true,
});
const ETF_BOX = withRules({
  id: "etf-box",
  label: "ETF・基準・ギャップ抜け・ATR3%",
  atrMin: 3,
  gapThroughStop: true,
  earnings: false,
});
const ETF_LOW = withRules({
  id: "etf-low",
  label: "ETF・基準・ギャップ抜け・ATR1%",
  atrMin: ETF_ATR_LOW,
  gapThroughStop: true,
  earnings: false,
});
const BELL = [
  { ticker: "NVDA", cik: "0001045810", foreign: false },
  { ticker: "LRCX", cik: "0000707549", foreign: false },
  { ticker: "TSM", cik: "0001046179", foreign: true },
  { ticker: "ASML", cik: "0000937966", foreign: true },
] as const;
const CASH = new Set(["USD", "CASH", "USDH", "USH"]);

type WindowId = "oos" | "in";
type WindowSpec = { id: WindowId; from: string; to: string; asOf: string; yearSplit: string };

function slim(window: WindowId, book: Book, note?: string): SlimBook {
  return {
    id: book.id,
    window,
    label: book.label,
    n: book.n,
    totalUsd: book.totalUsd,
    mtmDdUsd: book.maxDrawdownUsd,
    realizedDdUsd: book.realizedDrawdownUsd ?? null,
    profitFactor: book.profitFactor,
    headline: null,
    stress: null,
    ...(note ? { note } : {}),
  };
}

function missing(window: WindowId, id: string, label: string, note: string): SlimBook {
  return {
    id,
    window,
    label,
    n: null,
    totalUsd: null,
    mtmDdUsd: null,
    realizedDdUsd: null,
    profitFactor: null,
    headline: null,
    stress: null,
    note,
  };
}

async function readText(url: string, file: string): Promise<string> {
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const text = await response.text();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

async function loadWiki(): Promise<{ sp500: string; hist: string; sp400: string }> {
  fs.mkdirSync(WIKI_CACHE, { recursive: true });
  const seeds: Array<[string, string]> = [
    ["sp500.html", "/tmp/bias-src/sp500.html"],
    ["sp500-hist.html", "/tmp/bias-src/sp500-hist.html"],
    ["sp400.html", "/tmp/bias-src/sp400.html"],
  ];
  for (const [name, src] of seeds) {
    const dest = path.join(WIKI_CACHE, name);
    if (!fs.existsSync(dest) && fs.existsSync(src)) fs.copyFileSync(src, dest);
  }
  const [sp500, hist, sp400] = await Promise.all([
    readText("https://en.wikipedia.org/api/rest_v1/page/html/List_of_S%26P_500_companies", path.join(WIKI_CACHE, "sp500.html")),
    readText("https://en.wikipedia.org/api/rest_v1/page/html/Historical_components_of_the_S%26P_500", path.join(WIKI_CACHE, "sp500-hist.html")),
    readText("https://en.wikipedia.org/api/rest_v1/page/html/List_of_S%26P_400_companies", path.join(WIKI_CACHE, "sp400.html")),
  ]);
  return { sp500, hist, sp400 };
}

function table(html: string, header: string): string[][] {
  for (const item of wikiTables(html)) {
    const expanded = expandRowspan(item.rows);
    if (expanded.some((row) => row.includes(header))) return expanded;
  }
  throw new Error(`表がない: ${header}`);
}

function pickChanges(html: string) {
  const tables = wikiTables(html).map((item) => expandRowspan(item.rows));
  const chosen = tables.find((rows) => rows.some((row) => row.includes("Effective Date") || (row.includes("Date") && row.includes("Added"))));
  if (!chosen) throw new Error("変更表がない");
  return changesFrom(chosen);
}

async function pool<T>(items: T[], n: number, fn: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        await fn(items[index], index);
      }
    }),
  );
}

async function ensureBars(ticker: string): Promise<Bar[] | null> {
  const cached = readCachedBars(ticker);
  if (cached && cached.length >= 30) return cached;
  try {
    const { bars } = await fetchDailyBars(yahooSymbol(ticker), { range: "5y", keep: 1600 });
    if (bars.length < 30) return null;
    fs.mkdirSync(BAR_CACHE, { recursive: true });
    fs.writeFileSync(path.join(BAR_CACHE, `${yahooSymbol(ticker)}.json`), JSON.stringify(bars));
    return bars;
  } catch (error) {
    console.error(`bar ${ticker}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

type Submission = { filings?: { recent?: FilingBlock; files?: Array<{ name: string }> } };

async function secJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function filingBlocks(cik: string): Promise<FilingBlock[]> {
  const id = cik.padStart(10, "0");
  const file = path.join(EDGAR, `${id}.json`);
  let json: Submission;
  if (fs.existsSync(file)) json = JSON.parse(fs.readFileSync(file, "utf8")) as Submission;
  else {
    json = (await secJson(`https://data.sec.gov/submissions/CIK${id}.json`)) as Submission;
    fs.writeFileSync(file, JSON.stringify(json));
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const blocks: FilingBlock[] = [];
  if (json.filings?.recent) blocks.push(json.filings.recent);
  const recentDates = json.filings?.recent?.filingDate ?? [];
  const oldest = recentDates.length ? recentDates[recentDates.length - 1] : "9999";
  if (oldest > OOS_FROM) {
    for (const extra of json.filings?.files ?? []) {
      const extraFile = path.join(EDGAR, extra.name);
      let block: FilingBlock;
      if (fs.existsSync(extraFile)) block = JSON.parse(fs.readFileSync(extraFile, "utf8")) as FilingBlock;
      else {
        block = (await secJson(`https://data.sec.gov/submissions/${extra.name}`)) as FilingBlock;
        fs.writeFileSync(extraFile, JSON.stringify(block));
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      blocks.push(block);
    }
  }
  return blocks;
}

function foreignSummary(blocks: FilingBlock[]): { forms: number; matched: number } {
  let forms = 0;
  let matched = 0;
  for (const block of blocks) {
    const n = block.form?.length ?? 0;
    for (let i = 0; i < n; i += 1) {
      const form = block.form?.[i];
      if (form !== "6-K" && form !== "6-K/A") continue;
      forms += 1;
      if (FOREIGN_EARNINGS_RE.test(block.primaryDocDescription?.[i] ?? "")) matched += 1;
    }
  }
  return { forms, matched };
}

async function loadEdgar(tickers: string[]): Promise<{ dates: Map<string, string[]>; events: Map<string, EndEvent[]>; missingCik: string[] }> {
  fs.mkdirSync(EDGAR, { recursive: true });
  const tickerFile = path.join(EDGAR, "company_tickers.json");
  if (!fs.existsSync(tickerFile)) {
    fs.writeFileSync(tickerFile, JSON.stringify(await secJson("https://www.sec.gov/files/company_tickers.json")));
  }
  const raw = JSON.parse(fs.readFileSync(tickerFile, "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const dates = new Map<string, string[]>();
  const events = new Map<string, EndEvent[]>();
  const missingCik: string[] = [];
  let done = 0;
  for (const ticker of tickers) {
    const key = ticker.toUpperCase();
    const cik = cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, "."));
    if (!cik) {
      missingCik.push(ticker);
      continue;
    }
    try {
      const blocks = await filingBlocks(cik);
      dates.set(ticker, earningsDatesFrom(blocks).item202);
      events.set(ticker, endEventsFrom(blocks));
    } catch (error) {
      console.error(`edgar ${ticker}: ${error instanceof Error ? error.message : error}`);
      missingCik.push(ticker);
    }
    done += 1;
    if (done % 50 === 0) console.log(`edgar ${done}/${tickers.length}`);
  }
  return { dates, events, missingCik };
}

async function loadBellwether(): Promise<{ dates: Record<string, string[]>; missing: string[]; note: string }> {
  const dates: Record<string, string[]> = {};
  const missing: string[] = [];
  const notes: string[] = [];
  for (const row of BELL) {
    try {
      const blocks = await filingBlocks(row.cik);
      const parsed = earningsDatesFrom(blocks);
      const list = row.foreign ? parsed.foreign6k : parsed.item202;
      dates[row.ticker] = list;
      if (!list.length) missing.push(row.ticker);
      if (row.foreign) {
        const summary = foreignSummary(blocks);
        notes.push(`${row.ticker}の6-Kは${summary.forms}件、説明文が決算と読めたのは${summary.matched}件`);
      } else notes.push(`${row.ticker}の8-K Item 2.02は${list.length}件`);
    } catch (error) {
      dates[row.ticker] = [];
      missing.push(row.ticker);
      notes.push(`${row.ticker}の届出を取得できなかった`);
      console.error(error);
    }
  }
  return { dates, missing, note: notes.join("。") + "。" };
}

function holdingFile(etf: string): { asOf: string | null; tickers: string[] } {
  const file = path.join(HOLD_CACHE, `${etf}.xlsx`);
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
asof=None
tickers=[]
for c in sheet.iter(NS+"c"):
    ref=c.attrib.get("r","")
    m=re.match(r"([A-Z]+)(\\d+)", ref)
    if not m: continue
    col,row=m.group(1),int(m.group(2))
    v=c.find(NS+"v")
    if v is None or v.text is None: continue
    val=strings[int(v.text)] if c.attrib.get("t")=="s" else v.text
    if row<=4 and "As of" in val: asof=val
    if row>=6 and col=="B": tickers.append(val.strip())
print(json.dumps({"asOf": asof, "tickers": tickers}))`,
      file,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(json) as { asOf: string | null; tickers: string[] };
}

async function loadHoldings(): Promise<{ asOf: string | null; byEtf: Map<string, string[]>; failed: string[] }> {
  fs.mkdirSync(HOLD_CACHE, { recursive: true });
  const byEtf = new Map<string, string[]>();
  const failed: string[] = [];
  let asOf: string | null = null;
  for (const etf of SECTOR_HOLDING_ETFS) {
    const file = path.join(HOLD_CACHE, `${etf}.xlsx`);
    if (!fs.existsSync(file)) {
      const url = `https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-${etf.toLowerCase()}.xlsx`;
      const response = await fetch(url, { headers: { "User-Agent": UA } });
      if (!response.ok) {
        failed.push(etf);
        continue;
      }
      fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    }
    try {
      const parsed = holdingFile(etf);
      if (parsed.asOf && !asOf) asOf = parsed.asOf;
      const tickers: string[] = [];
      for (const raw of parsed.tickers) {
        const ticker = cleanTicker(raw.replace(/\//g, "."));
        if (!ticker || CASH.has(ticker) || ticker === etf) continue;
        tickers.push(ticker);
      }
      byEtf.set(etf, [...new Set(tickers)]);
    } catch (error) {
      failed.push(etf);
      console.error(`holdings ${etf}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return { asOf, byEtf, failed };
}

function orderBy(score: Map<string, number | null>) {
  return (list: Candidate[]) => {
    list.sort((a, b) => {
      const av = score.get(`${a.ticker}|${a.signalDate}`) ?? null;
      const bv = score.get(`${b.ticker}|${b.signalDate}`) ?? null;
      if (av == null && bv != null) return 1;
      if (av != null && bv == null) return -1;
      if (av != null && bv != null && av !== bv) return bv - av;
      return a.ticker.localeCompare(b.ticker);
    });
  };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return Math.round((sorted[lo] * (hi - index) + sorted[hi] * (index - lo)) * 100) / 100;
}

function stamp(cands: Candidate[], isSemi: (ticker: string) => boolean): Candidate[] {
  return cands.map((cand) => {
    const semi = isSemi(cand.ticker);
    return cand.semi === semi ? cand : { ...cand, semi };
  });
}

async function main() {
  console.log("wiki");
  const wiki = await loadWiki();
  const sp500 = listedFrom(table(wiki.sp500, "Symbol"));
  const sp400 = listedFrom(table(wiki.sp400, "Symbol"));
  const changes500 = pickChanges(wiki.hist);
  const changes400 = pickChanges(wiki.sp400);
  console.log(`sp500 ${sp500.length} changes ${changes500.changes.length} skipped ${changes500.skippedDates.length}`);
  console.log(`sp400 ${sp400.length} changes ${changes400.changes.length} skipped ${changes400.skippedDates.length}`);
  if (sp500.length < 490 || sp400.length < 390 || changes500.changes.length < 300 || changes400.changes.length < 500) {
    throw new Error("Wikipediaの表が想定より小さい。日付の取りこぼしを疑う。");
  }
  if (process.argv.includes("--parse")) return;

  const gics = new Map<string, Listed>();
  for (const row of [...sp500, ...sp400]) if (!gics.has(row.ticker)) gics.set(row.ticker, row);
  const asOfDates = [OOS_FROM, IN_FROM];
  const members = new Map<string, { sp500: string[]; sp400: string[]; union: string[] }>();
  for (const asOf of asOfDates) {
    const large = membershipAsOf(sp500.map((row) => row.ticker), changes500.changes, asOf);
    const mid = membershipAsOf(sp400.map((row) => row.ticker), changes400.changes, asOf);
    const union = [...new Set([...large, ...mid])].sort();
    members.set(asOf, { sp500: large, sp400: mid, union });
    console.log(`as of ${asOf} large ${large.length} mid ${mid.length} union ${union.length}`);
  }

  console.log("holdings");
  const holdings = await loadHoldings();
  console.log(`holdings as of ${holdings.asOf} failed ${holdings.failed.join(",") || "none"}`);

  const watch = loadWatchlist();
  const coreSemi = new Map<string, boolean>();
  const coreSector = new Map<string, string>();
  for (const group of watch.groups) {
    const semi = group.id === "semi" || group.id === "equipment";
    for (const ticker of group.tickers) {
      if (isIgnoredTicker(ticker.ticker)) continue;
      coreSemi.set(ticker.ticker, semi);
      coreSector.set(ticker.ticker, group.name);
    }
  }

  const ever = new Set<string>([...coreSemi.keys()]);
  for (const row of [...sp500, ...sp400]) ever.add(row.ticker);
  for (const change of [...changes500.changes, ...changes400.changes]) {
    if (change.added) ever.add(change.added);
    if (change.removed) ever.add(change.removed);
  }
  for (const list of holdings.byEtf.values()) for (const ticker of list) ever.add(ticker);
  for (const etf of [...BENCHMARKS, ...JAB_ETFS, ...SECTOR_HOLDING_ETFS, "SOXX"]) ever.add(etf);

  console.log(`bars wanted ${ever.size}`);
  const bars = new Map<string, Bar[]>();
  const missed: string[] = [];
  let loaded = 0;
  await pool([...ever], 3, async (ticker) => {
    const series = await ensureBars(ticker);
    if (series) bars.set(ticker, series);
    else missed.push(ticker);
    loaded += 1;
    if (loaded % 40 === 0) console.log(`bars ${loaded}/${ever.size} miss ${missed.length}`);
  });
  console.log(`bars ready ${bars.size} miss ${missed.length}`);

  const spyBars = bars.get("SPY");
  if (!spyBars?.length) throw new Error("SPYの日足がない");
  const lastBar = spyBars[spyBars.length - 1].date;
  const inTo = lastBar < IN_TO ? lastBar : IN_TO;
  const windows: WindowSpec[] = [
    { id: "oos", from: OOS_FROM, to: OOS_TO, asOf: OOS_FROM, yearSplit: OOS_YEAR2 },
    { id: "in", from: IN_FROM, to: inTo, asOf: IN_FROM, yearSplit: YEAR2_FROM },
  ];
  const allSessions = spyBars.map((bar) => bar.date);

  const stockTickers = [...ever].filter((ticker) => bars.has(ticker) && !BENCHMARKS.includes(ticker as (typeof BENCHMARKS)[number]) && !JAB_ETFS.includes(ticker as (typeof JAB_ETFS)[number]));
  console.log(`edgar ${stockTickers.length}`);
  const edgar = await loadEdgar(stockTickers);
  console.log("bellwether");
  const bell = await loadBellwether();
  const bellDates = [...new Set(Object.values(bell.dates).flat())].sort();
  console.log(`bell dates ${bellDates.length} missing ${bell.missing.join(",") || "none"}`);

  console.log("features");
  const haveBars = new Set(bars.keys());
  const feats = new Map<string, Feat[]>();
  for (const [ticker, series] of bars) feats.set(ticker, buildFeatures(series));
  bars.clear();
  const spy = feats.get("SPY") ?? [];
  const soxx = feats.get("SOXX") ?? [];
  const market = marketByDate(spy, soxx);
  const closes = new Map<string, Map<string, number>>();
  const ret20 = new Map<string, number | null>();
  const ret60 = new Map<string, number | null>();
  const adv = new Map<string, Map<string, number>>();
  for (const [ticker, series] of feats) {
    const days = new Map<string, number>();
    for (const bar of series) {
      days.set(bar.date, bar.c);
      ret20.set(`${ticker}|${bar.date}`, bar.ret20);
      ret60.set(`${ticker}|${bar.date}`, bar.ret60);
    }
    closes.set(ticker, days);
    adv.set(ticker, trailingAvgDollar(series, ADV_WINDOW));
  }
  const ends = new Map<string, string>();
  for (const [ticker, series] of feats) {
    const last = series[series.length - 1];
    if (last) ends.set(ticker, last.date);
  }
  const notesByTicker = new Map<string, Array<{ date: string; reason: string }>>();
  for (const change of [...changes500.changes, ...changes400.changes]) {
    if (!change.removed || !change.reason) continue;
    const list = notesByTicker.get(change.removed) ?? [];
    list.push({ date: change.date, reason: change.reason });
    notesByTicker.set(change.removed, list);
  }
  const fateOf = (ticker: string): EndClass => {
    const last = ends.get(ticker);
    if (!last) return "unknown";
    return resolveEndClass(noteEndClass(notesByTicker.get(ticker) ?? [], last), filingEndClass(edgar.events.get(ticker) ?? [], last));
  };
  const rsp = feats.get("RSP") ?? [];
  const iwm = feats.get("IWM") ?? [];
  const breadth = ratioSma(spy, rsp, BREADTH_WINDOW);
  const rspDay = new Map(rsp.map((bar) => [bar.date, bar]));
  const iwmDay = new Map(iwm.map((bar) => [bar.date, bar]));

  const gicsSemi = (ticker: string) => isSemiSubIndustry(gics.get(ticker)?.sub);
  const names: NameSeries[] = [];
  for (const ticker of stockTickers) {
    const series = feats.get(ticker);
    if (!series) continue;
    names.push({
      ticker,
      sector: gics.get(ticker)?.sector ?? coreSector.get(ticker) ?? "不明",
      semi: false,
      core: coreSemi.has(ticker),
      broad: true,
      feats: series,
      earnings: edgar.dates.get(ticker) ?? [],
    });
  }

  const reportBooks: SlimBook[] = [];
  const sectorRows: SectorRow[] = [];
  const randomRows: BiasReport["random"] = [];
  const biasRows: BiasMath[] = [];
  const bellWindows: BiasReport["bellwether"]["byWindow"] = [];
  const coverage: BiasReport["coverage"] = [];
  const benchmarks: SlimBook[] = [];
  const universe: BiasReport["universe"] = [];

  const baseOpts = (window: WindowSpec, id: string, label: string, extra: Partial<Parameters<typeof runPortfolio>[0]> = {}) => ({
    id,
    label,
    universe: "bias",
    rank: "rs" as const,
    sessions: allSessions.filter((date) => date >= window.from && date <= window.to),
    flatten: true,
    withRestart: false,
    yearSplit: window.yearSplit,
    capital: START_CAPITAL,
    maxPositions: 5,
    closes,
    ...extra,
  });

  for (const window of windows) {
    const sessions = allSessions.filter((date) => date >= window.from && date <= window.to);
    console.log(`window ${window.id} ${window.from}..${window.to} sessions ${sessions.length}`);
    const generated = names.flatMap((name) => rangeCandidates(name, BOX, market, allSessions, { from: window.from, to: window.to }));
    console.log(`signals ${generated.length}`);
    const member = members.get(window.asOf)!;
    const pitSet = new Set(member.union.filter((ticker) => haveBars.has(ticker)));
    const noBars = member.union.filter((ticker) => !haveBars.has(ticker));
    const withBars = [...pitSet];
    const unknownGics = withBars.filter((ticker) => !gics.has(ticker)).length;
    const knownSemis = withBars.filter((ticker) => gicsSemi(ticker)).length;
    const overlap = member.sp500.filter((ticker) => member.sp400.includes(ticker)).length;
    universe.push({
      asOf: window.asOf,
      sp500: member.sp500.length,
      sp400: member.sp400.length,
      union: member.union.length,
      overlap,
      withBars: withBars.length,
      noBars: noBars.length,
      unknownGics,
      knownSemis,
    });

    const pit = stamp(generated.filter((cand) => pitSet.has(cand.ticker)), gicsSemi);
    const core = stamp(generated.filter((cand) => coreSemi.has(cand.ticker)), (ticker) => coreSemi.get(ticker) === true);
    const dated = new Set([...edgar.dates.entries()].filter(([, list]) => list.length > 0).map(([ticker]) => ticker));
    const pitNames = withBars;
    const withDate = pitNames.filter((ticker) => dated.has(ticker)).length;
    const filings = pitNames.reduce((sum, ticker) => sum + (edgar.dates.get(ticker)?.length ?? 0), 0);
    coverage.push({ window: window.id, names: pitNames.length, withDate, filings });

    const run = (id: string, label: string, cands: Candidate[], extra: Partial<Parameters<typeof runPortfolio>[0]> = {}) =>
      runPortfolio(baseOpts(window, id, label, extra), cands);

    type Prep = { cands: Candidate[]; repriced: Set<string>; acquisition: Set<string>; bankruptcy: Set<string>; unknown: Set<string> };
    const prepare = (cands: Candidate[], mode: "headline" | "stress"): Prep => {
      const repriced = new Set<string>();
      const acquisition = new Set<string>();
      const bankruptcy = new Set<string>();
      const unknown = new Set<string>();
      const next = cands.map((cand) => {
        const end = ends.get(cand.ticker);
        if (!dataEndedMidTrade(cand.exitDate, cand.reason, end, window.to)) return cand;
        const key = `${cand.ticker}|${cand.entryDate}`;
        const fate = fateOf(cand.ticker);
        if (fate === "acquisition") acquisition.add(key);
        else if (fate === "bankruptcy") bankruptcy.add(key);
        else unknown.add(key);
        if (mode === "headline" && fate === "acquisition") return cand;
        repriced.add(key);
        return {
          ...cand,
          exit: lossExit(cand.entry, mode === "stress" ? 1 : 0.5),
          exitDate: end ?? cand.exitDate,
          reason: "window" as const,
          exitTiming: "close" as const,
        };
      });
      return { cands: next, repriced, acquisition, bankruptcy, unknown };
    };
    const penaltyFrom = (book: Book, prep: Prep): EndPenalty => {
      const fills = book.fills ?? [];
      const hit = (keys: Set<string>) => fills.reduce((sum, fill) => sum + (keys.has(`${fill.ticker}|${fill.entryDate}`) ? 1 : 0), 0);
      return {
        penalized: hit(prep.repriced),
        acquisitions: hit(prep.acquisition),
        bankruptcies: hit(prep.bankruptcy),
        unknown: hit(prep.unknown),
        n: book.n,
        totalUsd: book.totalUsd,
        profitFactor: book.profitFactor,
        profitable: staysProfitable(book.profitFactor, book.n),
      };
    };
    const scored = (book: Book, cands: Candidate[], extra: Partial<Parameters<typeof runPortfolio>[0]> = {}, note?: string): SlimBook => {
      const headlinePrep = prepare(cands, "headline");
      const stressPrep = prepare(cands, "stress");
      const headlineBook = run(`${book.id}-head`, book.label, headlinePrep.cands, { ...extra, keepFills: true });
      const stressBook = run(`${book.id}-stress`, book.label, stressPrep.cands, { ...extra, keepFills: true });
      return {
        ...slim(window.id, book, note),
        headline: penaltyFrom(headlineBook, headlinePrep),
        stress: penaltyFrom(stressBook, stressPrep),
      };
    };

    const coreBook = run("core", "今の187銘柄・対SPY・半導体2", core, { maxSemi: 2 });
    const pitBook = run("pit", "当時の500+400・対SPY・半導体2", pit, { maxSemi: 2, keepFills: true });
    const exBook = run("exsemi", "当時のユニバースから半導体を除く", pit.filter((cand) => !cand.semi), { maxSemi: 2 });
    const freeBook = run("free", "当時のユニバース・枠5・セクター上限なし", pit);
    const jabBook = run("jab", "半導体2＋その他3", pit, { maxSemi: 2, maxNonSemi: 3 });
    const midSet = new Set(member.sp400.filter((ticker) => haveBars.has(ticker)));
    const midBook = run("mid", "S&P400（当時の中型）", stamp(generated.filter((cand) => midSet.has(cand.ticker)), gicsSemi), { maxSemi: 2 });

    const rspScore = new Map<string, number | null>();
    const sectorScore = new Map<string, number | null>();
    for (const cand of pit) {
      const stock = ret20.get(`${cand.ticker}|${cand.signalDate}`) ?? null;
      const rspRet = ret20.get(`RSP|${cand.signalDate}`) ?? null;
      rspScore.set(`${cand.ticker}|${cand.signalDate}`, stock == null || rspRet == null ? null : stock - rspRet);
      const bench = sectorEtf(gics.get(cand.ticker)?.sector, gicsSemi(cand.ticker));
      const benchRet = bench ? (ret20.get(`${bench}|${cand.signalDate}`) ?? null) : null;
      sectorScore.set(`${cand.ticker}|${cand.signalDate}`, stock == null || benchRet == null ? null : stock - benchRet);
    }
    const rspBook = run("rs-rsp", "当時・対RSP", pit, { maxSemi: 2, order: orderBy(rspScore) });
    const sectorBook = run("rs-sector", "当時・対セクターETF", pit, { maxSemi: 2, order: orderBy(sectorScore) });

    const regimeOf = (date: string) => classifyExcess(ret60.get(`SOXX|${date}`) ?? null, ret60.get(`SPY|${date}`) ?? null);
    const iwmOf = (date: string) => classifySign(ret60.get(`IWM|${date}`) ?? null);
    const breadthOf = (date: string) => {
      const row = breadth.get(date);
      return breadthSide(row?.ratio, row?.sma);
    };
    const soxxOut = run("reg-soxx-out", "SOXXがSPYを上回る60日", pit.filter((cand) => regimeOf(cand.signalDate) === "out"), { maxSemi: 2 });
    const soxxUnder = run("reg-soxx-under", "SOXXがSPYを下回る60日", pit.filter((cand) => regimeOf(cand.signalDate) === "under"), { maxSemi: 2 });
    const iwmDown = run("reg-iwm-down", "IWMの60日が下落", pit.filter((cand) => iwmOf(cand.signalDate) === "negative"), { maxSemi: 2 });
    const iwmUp = run("reg-iwm-up", "IWMの60日が上昇", pit.filter((cand) => iwmOf(cand.signalDate) === "positive"), { maxSemi: 2 });
    const breadthAbove = run("reg-breadth-above", "RSP/SPYが200日平均より上", pit.filter((cand) => breadthOf(cand.signalDate) === "above"), { maxSemi: 2 });
    const breadthBelow = run("reg-breadth-below", "RSP/SPYが200日平均より下", pit.filter((cand) => breadthOf(cand.signalDate) === "below"), { maxSemi: 2 });

    let rspMissing = 0;
    let rspFail = 0;
    let iwmMissing = 0;
    let iwmFail = 0;
    const rspPass: Candidate[] = [];
    const iwmPass: Candidate[] = [];
    for (const cand of pit) {
      const rspOk = aboveMovingAverage(rspDay.get(cand.signalDate)?.c, rspDay.get(cand.signalDate)?.ma50);
      const iwmOk = aboveMovingAverage(iwmDay.get(cand.signalDate)?.c, iwmDay.get(cand.signalDate)?.ma50);
      if (rspOk == null) rspMissing += 1;
      else if (!rspOk) rspFail += 1;
      else rspPass.push(cand);
      if (iwmOk == null) iwmMissing += 1;
      else if (!iwmOk) iwmFail += 1;
      else iwmPass.push(cand);
    }
    const filtRsp = run("filt-rsp50", "RSPが50日平均より上の日だけ", rspPass, { maxSemi: 2 });
    const filtIwm = run("filt-iwm50", "IWMが50日平均より上の日だけ", iwmPass, { maxSemi: 2 });

    const stockAdv = new Map<string, Map<string, number>>();
    for (const ticker of stockTickers) {
      const series = adv.get(ticker);
      if (series) stockAdv.set(ticker, series);
    }
    const leaders = advLeaders(stockAdv, sessions, ADV_TOP_N);
    const advCands = stamp(
      generated.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)),
      gicsSemi,
    );
    const advBook = run("adv", "63日売買代金の上位200（指数履歴の範囲）", advCands, { maxSemi: 2 });

    const chosenByEtf = new Map<string, string[]>();
    for (const etf of SECTOR_HOLDING_ETFS) {
      const held = holdings.byEtf.get(etf) ?? [];
      const ranked = topTickersByDollar(
        held.map((ticker) => ({ ticker, dollar: dollarAsOf(adv.get(ticker) ?? new Map(), window.asOf) })),
        SECTOR_TOP_N,
      );
      const withAdv = held.filter((ticker) => dollarAsOf(adv.get(ticker) ?? new Map(), window.asOf) != null).length;
      chosenByEtf.set(etf, ranked);
      const sectorCands = stamp(generated.filter((cand) => ranked.includes(cand.ticker)), gicsSemi);
      const sectorBook = ranked.length ? run(`sector-${etf}`, `${etf}の売買代金上位`, sectorCands) : null;
      const sectorRow = sectorBook ? scored(sectorBook, sectorCands) : null;
      sectorRows.push({
        window: window.id,
        etf,
        names: ranked,
        holdings: held.length,
        withAdv,
        n: sectorRow?.n ?? null,
        totalUsd: sectorRow?.totalUsd ?? null,
        mtmDdUsd: sectorRow?.mtmDdUsd ?? null,
        realizedDdUsd: sectorRow?.realizedDdUsd ?? null,
        profitFactor: sectorRow?.profitFactor ?? null,
        headline: sectorRow?.headline ?? null,
        stress: sectorRow?.stress ?? null,
      });
    }
    const balancedTickers = new Set([...chosenByEtf.values()].flat());
    const balancedCands = stamp(generated.filter((cand) => balancedTickers.has(cand.ticker)), gicsSemi);
    const balanced = balancedTickers.size ? run("sector", "セクターETF保有の上位12×11", balancedCands, { maxSemi: 2 }) : null;

    const etfNames: NameSeries[] = JAB_ETFS.flatMap((ticker) => {
      const series = feats.get(ticker);
      if (!series) return [];
      return [{ ticker, sector: "ETF", semi: false, core: false, broad: false, feats: series, earnings: [] }];
    });
    const etf3 = etfNames.flatMap((name) => rangeCandidates(name, ETF_BOX, market, allSessions, { from: window.from, to: window.to }));
    const etf1 = etfNames.flatMap((name) => rangeCandidates(name, ETF_LOW, market, allSessions, { from: window.from, to: window.to }));
    const etf3Book = etfNames.length === JAB_ETFS.length ? run("etf3", "ETFを同じ型で（ATR3%）", etf3) : null;
    const etf1Book = etfNames.length === JAB_ETFS.length ? run("etf1", "ETFを同じ型で（ATR1%）", etf1) : null;

    const coverageRatio = pitNames.length ? withDate / pitNames.length : 0;
    const fullBook =
      coverageRatio >= FULL_EARNINGS_COVERAGE
        ? run("earn-full", "決算日が無い銘柄も落とす", pit.filter((cand) => dated.has(cand.ticker)), { maxSemi: 2 })
        : null;

    for (const etf of BENCHMARKS) {
      const series = feats.get(etf);
      if (!series) {
        benchmarks.push(missing(window.id, etf, etf, "日足がない"));
        continue;
      }
      const book = runBuyHold(etf, etf, series, window.from, window.to);
      const row = slim(window.id, book);
      const last = series[series.length - 1]?.date;
      const inWindow = series.filter((bar) => bar.date >= window.from && bar.date <= window.to);
      const unchanged: EndPenalty = {
        penalized: 0,
        acquisitions: 0,
        bankruptcies: 0,
        unknown: 0,
        n: book.n,
        totalUsd: book.totalUsd,
        profitFactor: book.profitFactor,
        profitable: staysProfitable(book.profitFactor, book.n),
      };
      if (!last || !(last < window.to) || !inWindow.length || !(inWindow[0].o > 0)) {
        benchmarks.push({ ...row, headline: unchanged, stress: unchanged });
        continue;
      }
      const fate = fateOf(etf);
      const qty = Math.floor(START_CAPITAL / inWindow[0].o);
      const entry = inWindow[0].o;
      const priced = (fraction: number, apply: boolean): EndPenalty => {
        const totalUsd = apply ? Math.round((qty * (lossExit(entry, fraction) - entry) - ROUND_TRIP_FEE) * 100) / 100 : book.totalUsd;
        const profitFactor = totalUsd < 0 ? 0 : book.profitFactor;
        return {
          penalized: apply ? 1 : 0,
          acquisitions: fate === "acquisition" ? 1 : 0,
          bankruptcies: fate === "bankruptcy" ? 1 : 0,
          unknown: fate === "unknown" ? 1 : 0,
          n: book.n,
          totalUsd,
          profitFactor,
          profitable: staysProfitable(profitFactor, book.n),
        };
      };
      benchmarks.push({ ...row, headline: priced(0.5, fate !== "acquisition"), stress: priced(1, true) });
    }

    const exCands = pit.filter((cand) => !cand.semi);
    const midCands = stamp(generated.filter((cand) => midSet.has(cand.ticker)), gicsSemi);
    const fullCands = pit.filter((cand) => dated.has(cand.ticker));
    const rows: SlimBook[] = [
      scored(coreBook, core, { maxSemi: 2 }),
      scored(pitBook, pit, { maxSemi: 2 }),
      scored(exBook, exCands, { maxSemi: 2 }),
      scored(freeBook, pit),
      scored(jabBook, pit, { maxSemi: 2, maxNonSemi: 3 }),
      scored(midBook, midCands, { maxSemi: 2 }),
      scored(rspBook, pit, { maxSemi: 2, order: orderBy(rspScore) }),
      scored(sectorBook, pit, { maxSemi: 2, order: orderBy(sectorScore) }, `GICS不明でセクターRSが空の銘柄 ${unknownGics}`),
      scored(soxxOut, pit.filter((cand) => regimeOf(cand.signalDate) === "out"), { maxSemi: 2 }),
      scored(soxxUnder, pit.filter((cand) => regimeOf(cand.signalDate) === "under"), { maxSemi: 2 }),
      scored(iwmDown, pit.filter((cand) => iwmOf(cand.signalDate) === "negative"), { maxSemi: 2 }),
      scored(iwmUp, pit.filter((cand) => iwmOf(cand.signalDate) === "positive"), { maxSemi: 2 }),
      scored(breadthAbove, pit.filter((cand) => breadthOf(cand.signalDate) === "above"), { maxSemi: 2 }),
      scored(breadthBelow, pit.filter((cand) => breadthOf(cand.signalDate) === "below"), { maxSemi: 2 }),
      scored(filtRsp, rspPass, { maxSemi: 2 }, `50日平均が無く落ちたシグナル ${rspMissing}、平均以下 ${rspFail}`),
      scored(filtIwm, iwmPass, { maxSemi: 2 }, `50日平均が無く落ちたシグナル ${iwmMissing}、平均以下 ${iwmFail}`),
      scored(advBook, advCands, { maxSemi: 2 }, "S&P500とS&P400のWikipedia履歴にある銘柄だけ。米国全銘柄ではない。"),
      balanced ? scored(balanced, balancedCands, { maxSemi: 2 }, `採用 ${balancedTickers.size}銘柄`) : missing(window.id, "sector", "セクターETF保有の上位12×11", "保有一覧が取れなかった"),
      etf3Book ? scored(etf3Book, etf3, {}, `シグナル ${etf3.length}`) : missing(window.id, "etf3", "ETFを同じ型で（ATR3%）", "ETFの日足が足りない"),
      etf1Book ? scored(etf1Book, etf1, {}, `シグナル ${etf1.length}`) : missing(window.id, "etf1", "ETFを同じ型で（ATR1%）", "ETFの日足が足りない"),
      missing(window.id, "iwm-members", "ラッセル2000の当時構成", "未計算。無料の過去構成リストがない。"),
      missing(window.id, "adv-all", "米国全銘柄の売買代金上位200", "未計算。上場廃止を含む全米ユニバースの無料履歴がない。"),
      fullBook
        ? scored(fullBook, fullCands, { maxSemi: 2 }, `届出あり ${withDate}/${pitNames.length}`)
        : missing(window.id, "earn-full", "決算日が無い銘柄も落とす", `未計算。届出があるのは ${withDate}/${pitNames.length} で、${Math.round(FULL_EARNINGS_COVERAGE * 100)}%に届かない。`),
    ];
    reportBooks.push(...rows);

    const gap = biasGap(coreBook.totalUsd, pitBook.totalUsd, exBook.totalUsd);
    biasRows.push({
      window: window.id,
      coreUsd: coreBook.totalUsd,
      pitUsd: pitBook.totalUsd,
      exSemiUsd: exBook.totalUsd,
      survivorship: gap.survivorship,
      semisTailwind: gap.semisTailwind,
    });

    const takenSemis = (pitBook.fills ?? []).filter((fill) => {
      const listed = gics.get(fill.ticker);
      if (listed) return isSemiSubIndustry(listed.sub);
      return false;
    });
    const span = [];
    const clear = [];
    for (const fill of takenSemis) {
      if (bellDates.length && spansEarnings(fill.entryDate, fill.exitDate, bellDates)) span.push(fill);
      else clear.push(fill);
    }
    const avoid = bellDates.length
      ? run(
          "bell-avoid",
          "ベルウェザーの3営業日前は半導体を買わない",
          pit.filter((cand) => !(cand.semi && withinSessionsBefore(allSessions, cand.signalDate, bellDates))),
          { maxSemi: 2 },
        )
      : null;
    const spanStats = bellDates.length ? splitStats(span) : null;
    const clearStats = bellDates.length ? splitStats(clear) : null;
    bellWindows.push({
      window: window.id,
      span: spanStats ? { n: spanStats.n, totalUsd: spanStats.totalUsd, avgUsd: spanStats.avgUsd } : null,
      clear: clearStats ? { n: clearStats.n, totalUsd: clearStats.totalUsd, avgUsd: clearStats.avgUsd } : null,
      semiTrades: bellDates.length ? takenSemis.length : null,
      base: { n: pitBook.n, totalUsd: pitBook.totalUsd, mtmDdUsd: pitBook.maxDrawdownUsd },
      avoid: avoid ? { n: avoid.n, totalUsd: avoid.totalUsd, mtmDdUsd: avoid.maxDrawdownUsd } : null,
    });

    console.log(`random ${window.id}`);
    const started = Date.now();
    const probe = runPortfolio(
      baseOpts(window, "probe", "probe", {
        rank: "ticker",
        maxSemi: 2,
        order: (list) => shuffle(list, mulberry32(1)),
      }),
      pit,
    );
    const probeMs = Date.now() - started;
    console.log(`probe ${probeMs}ms pnl ${probe.totalUsd}`);
    if (probeMs > 400 && window.id === "oos") {
      randomRows.push({
        window: window.id,
        trials: null,
        mean: null,
        p50: null,
        p05: null,
        p95: null,
        ruleUsd: pitBook.totalUsd,
        percentile: null,
        note: `未計算。1試行が${probeMs}msで、1000回はここまで回していない。`,
      });
    } else {
      const totals: number[] = [];
      for (let seed = 1; seed <= 1000; seed += 1) {
        const rng = mulberry32(seed);
        const trial = runPortfolio(
          baseOpts(window, `rand-${seed}`, "random", {
            rank: "ticker",
            maxSemi: 2,
            order: (list) => shuffle(list, rng),
          }),
          pit,
        );
        totals.push(trial.totalUsd);
        if (seed % 250 === 0) console.log(`random ${window.id} ${seed}`);
      }
      totals.sort((a, b) => a - b);
      const mean = Math.round((totals.reduce((sum, value) => sum + value, 0) / totals.length) * 100) / 100;
      randomRows.push({
        window: window.id,
        trials: totals.length,
        mean,
        p50: quantile(totals, 0.5),
        p05: quantile(totals, 0.05),
        p95: quantile(totals, 0.95),
        ruleUsd: pitBook.totalUsd,
        percentile: percentileBelow(totals, pitBook.totalUsd),
      });
    }
  }

  const bestBenchmark = (["oos", "in"] as const).flatMap((window) => {
    const rows = benchmarks.filter((row) => row.window === window && row.totalUsd != null);
    if (!rows.length) return [];
    const best = rows.reduce((top, row) => ((row.totalUsd ?? -Infinity) > (top.totalUsd ?? -Infinity) ? row : top));
    return [{ window, id: best.id, totalUsd: best.totalUsd as number }];
  });

  const gaps = [
    "Wikipediaの変更履歴は公式のポイントインタイム名簿ではない。載っていない入れ替えは欠ける。",
    `検証の終わりはSPYの最終バー ${inTo}。依頼の ${IN_TO} がその日より後なら、その差は未使用。`,
    `決算回避は8-K Item 2.02がある銘柄だけ。CIKがない、または届出が無い銘柄は残した。CIKなし ${edgar.missingCik.length}銘柄。`,
    "GICSは現在の構成表だけ。両方の指数から外れて現在の表に無い銘柄はセクター不明、半導体ではないものとして数えた。",
    "ラッセル2000の当時構成は未計算。中型は当時のS&P400。",
    "売買代金の上位200は、WikipediaのS&P500とS&P400の履歴に出てYahooの日足がある銘柄の中だけ。ETFは入れていない。米国の全上場・上場廃止は未計算。Yahooがティッカーを再利用している古い会社は、今の会社の日足になっていることがある。",
    holdings.asOf
      ? `セクターETFの保有銘柄は ${holdings.asOf} の一覧で、当時の保有ではない。各期間の開始日までの63日平均売買代金で上位${SECTOR_TOP_N}を採った。`
      : "セクターETFの保有時点をファイルから読めなかった。",
    holdings.failed.length ? `保有一覧が取れなかったETF: ${holdings.failed.join(", ")}` : "セクターETF11本の保有一覧は取得した。",
    changes500.skippedDates.length || changes400.skippedDates.length
      ? `日付を解釈できず飛ばした変更: S&P500 ${changes500.skippedDates.length}、S&P400 ${changes400.skippedDates.length}。`
      : "変更表の日付はすべて解釈した。",
    `日足が無い銘柄は除外した。取得できなかったシンボルは ${missed.length}。`,
    "この比較に$550の価格上限は入れてない。紙テストの凍結ルールとは別の本。",
    bell.note,
    bell.missing.length ? `ベルウェザーの決算日が無い: ${bell.missing.join(", ")}。その銘柄は窓の判定に使っていない。` : "ベルウェザー4銘柄の決算日は取得した。",
    "日足が期間末より前に尽きた建玉だけを分けた。Wikipediaの変更理由は最終バーの前後30日、8-Kは前15日〜後30日。Item 1.03か破綻の文言は破綻、Item 2.01か買収・合併の文言は買収。指数移動やティッカー変更や「上場廃止」だけでは買収にも破綻にもしない。買収は最終値のまま（取引価格は取っていない）。破綻と不明はエントリーの-50%で決済し直した。全部を-100%にした結果はストレスで、見出しではない。枠と現金は罰則後の受取で組み直す。",
    "今回のYahoo日足は、最終バーがサンプル末日より前の銘柄が無かった。上場廃止や買収で消えたティッカーは404で、建玉になる前に落ちている。見出しの-50%もストレスの-100%も掛け直した建玉は0件で、PFは元の本と同じ。罰則に耐えたという意味ではない。",
    "マクロトレンドの決算ページは使っていない。",
  ];

  const report: BiasReport = {
    v: 1,
    generatedAt: new Date().toISOString(),
    rules:
      "基準の箱（反発1日以上、終値は15%線以上、利確1ATR、損切りはシグナル日の20日安値、保有20営業日）。ATRは3%以上。ギャップで損切りを割り込んだらその始値。同じ日は対SPYの20日超過で並べ、半導体は同時2枠。資金$3,200、最大5枠、1枠$300–$450、売却代金は翌営業日、往復$0.70。決算日がファイルにあるときだけ前後5営業日を避ける。",
    windows: {
      oos: { from: OOS_FROM, to: OOS_TO },
      in: { from: IN_FROM, to: inTo },
    },
    gaps,
    benchmarks,
    bestBenchmark,
    books: reportBooks,
    sectors: sectorRows,
    random: randomRows,
    bias: biasRows,
    bellwether: { dates: bell.dates, missing: bell.missing, note: bell.note, byWindow: bellWindows },
    coverage,
    universe,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote ${OUT}`);
  for (const row of biasRows) {
    console.log(`${row.window} core ${row.coreUsd} pit ${row.pitUsd} ex ${row.exSemiUsd} surv ${row.survivorship} tail ${row.semisTailwind}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
