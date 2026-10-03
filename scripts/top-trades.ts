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
import { reactionDaysFrom } from "../src/lib/earnings-bridge";
import { isIgnoredTicker } from "../src/lib/holdings";
import { ROUND4_PREREG, aboveBoxTop, admits, ttmAt, type ConceptFacts, type Round4Filter, type TtmStatus } from "../src/lib/round4";
import { counts, dedupeFills, exitLabel, median, profitLabel, topByPnl, type ExitLabel, type ProfitLabel } from "../src/lib/top-trades";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Descriptive top winners and losers for the locked round-4 base books.
 * Analysis only. Writes data/backtest/top_trades.json and top_trades.csv.
 *   npx tsx scripts/top-trades.ts
 */
const OUT_JSON = path.join(process.cwd(), "data", "backtest", "top_trades.json");
const OUT_CSV = path.join(process.cwd(), "data", "backtest", "top_trades.csv");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const WIDE_RULES = withRules({ id: "top-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });
const FILTERS = ["none", "F1iF2"] as const;
type BookId = (typeof FILTERS)[number];
type WindowId = "oos" | "in";
type UniverseId = "pit" | "adv";

const EXPECTED: Array<{ filter: BookId; universe: UniverseId; window: WindowId; total: number; n: number }> = [
  { filter: "none", universe: "pit", window: "oos", total: -401.68, n: 348 },
  { filter: "none", universe: "pit", window: "in", total: 451.15, n: 345 },
  { filter: "none", universe: "adv", window: "oos", total: 1475.92, n: 376 },
  { filter: "none", universe: "adv", window: "in", total: 120.83, n: 367 },
  { filter: "F1iF2", universe: "pit", window: "oos", total: 135.08, n: 373 },
  { filter: "F1iF2", universe: "pit", window: "in", total: 10.16, n: 381 },
  { filter: "F1iF2", universe: "adv", window: "oos", total: 879.27, n: 346 },
  { filter: "F1iF2", universe: "adv", window: "in", total: 277.96, n: 381 },
];

/** Official SEC SIC phrase to a short Japanese line. Unlisted phrases stay in English. */
const SIC_JA: Record<string, string> = {
  "Electronic Computers": "電子計算機",
  "Services-Offices & Clinics of  Doctors of  Medicine": "医業の診療所",
  "Telephone & Telegraph Apparatus": "電話・電信機器",
  "Services-Prepackaged Software": "パッケージソフト",
  "Electric Services": "電力",
  "Rubber & Plastics Footwear": "ゴム・プラスチックの靴",
  "Motor Vehicles & Passenger Car Bodies": "自動車と車体",
  "Services-Computer Processing & Data Preparation": "計算機処理とデータ準備",
  "Cogeneration Services & Small Power Producers": "コージェネレーションと小規模発電",
  "Services-Business Services, NEC": "他に分類されない事業サービス",
  "Retail-Auto Dealers & Gasoline Stations": "自動車販売と給油所",
  "Surgical & Medical Instruments & Apparatus": "外科・医療用機器",
  "Computer Communications Equipment": "コンピュータ通信機器",
  "Finance Services": "金融サービス",
  "Metal Mining": "金属鉱業",
  "Semiconductors & Related Devices": "半導体と関連装置",
  "Communications Services, NEC": "他に分類されない通信サービス",
  "Services-Computer Programming, Data Processing, Etc.": "コンピュータプログラミングとデータ処理",
  "Services-Help Supply Services": "人材派遣",
  "Men's & Boys' Furnishgs, Work Clothg, & Allied Garments": "紳士・少年向け衣料",
  "Optical Instruments & Lenses": "光学機器とレンズ",
  "Security Brokers, Dealers & Flotation Companies": "証券ブローカーとディーラー",
  "Printed Circuit Boards": "プリント基板",
  "Air Transportation, Scheduled": "定期航空輸送",
  "Special Industry Machinery, NEC": "他に分類されない特殊産業用機械",
  "Food and Kindred Products": "食品および関連製品",
  "Biological Products, (No Diagnostic Substances)": "生物学的製剤（診断用を除く）",
  "Computer Storage Devices": "コンピュータ記憶装置",
  "Canned, Frozen & Preservd Fruit, Veg & Food Specialties": "缶詰・冷凍の果実、野菜、食品",
};

/** Verified items whose date falls inside the hold. Key is ticker|entryDate|exitDate. */
const NEWS: Record<string, { text: string; url: string }> = {
  "DELL|2024-02-26|2024-03-01": {
    text: "2024-02-29の決算で、AI向けサーバの受注が前四半期比で約40%増え、受注残は29億ドルだったと説明。",
    url: "https://www.reuters.com/technology/dell-shares-soar-annual-forecast-gets-boost-ai-adoption-2024-03-01/",
  },
  "SMCI|2024-11-08|2024-11-14": {
    text: "2024-11-13に10-Qの期限延長届を提出。監査法人の辞任後、後任が未定だと記載。",
    url: "https://d18rn0p25nwr6d.cloudfront.net/CIK-0001375365/0f60054b-7835-4438-9c3e-91b27c9287e7.html",
  },
  "NVDA|2025-02-18|2025-03-04": {
    text: "2025-03-03、関税の表明を受けて同日の株価が下落したとForbesが報じた。",
    url: "https://www.forbes.com/sites/dereksaul/2025/03/03/nvidia-falls-9-as-trumps-tariffs-pledge-routs-stocks-on-monday/",
  },
};

type Snap = {
  f1: TtmStatus;
  atrPct: number | null;
  boxWidthPct: number | null;
  entryPosPct: number | null;
  rs20: number | null;
  above50: boolean | null;
  entry: number;
  exit: number;
  exitDate: string;
  reason: string;
  exitTiming: string;
};

type LedgerRow = {
  book: BookId;
  ticker: string;
  entryDate: string;
  exitDate: string;
  pnlUsd: number;
  holdSessions: number;
  entry: number;
  exit: number;
  atrPct: number | null;
  boxWidthPct: number | null;
  entryPosPct: number | null;
  rs20: number | null;
  above50: boolean | null;
  profitStatus: ProfitLabel;
  exitReason: ExitLabel;
  seenIn: string[];
};

function round(value: number | null, digits = 4): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
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

function main() {
  const sp500 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp500.html"), "utf8"), "Symbol"));
  const sp400 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp400.html"), "utf8"), "Symbol"));
  const changes500 = changes("sp500-hist.html");
  const changes400 = changes("sp400.html");
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
  const windows: Array<{ id: WindowId; from: string; to: string; asOf: string }> = [
    { id: "oos", from: OOS_FROM, to: OOS_TO, asOf: OOS_FROM },
    { id: "in", from: IN_FROM, to: lastBar < IN_TO ? lastBar : IN_TO, asOf: IN_FROM },
  ];
  const market = marketByDate(spy, []);
  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const cikOf = new Map<string, string>();
  const titleOf = new Map<string, string>();
  for (const row of Object.values(raw)) {
    const cik = String(row.cik_str).padStart(10, "0");
    cikOf.set(row.ticker.toUpperCase(), cik);
    titleOf.set(row.ticker.toUpperCase(), row.title);
  }
  const cikFor = (ticker: string) => {
    const key = ticker.toUpperCase();
    return cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, ".")) ?? null;
  };
  const factCache = new Map<string, ConceptFacts | null>();
  const conceptsFor = (ticker: string): ConceptFacts | null => {
    const cik = cikFor(ticker);
    if (!cik) return null;
    if (factCache.has(cik)) return factCache.get(cik) ?? null;
    const file = path.join(FACTS, `${cik}.json`);
    if (!fs.existsSync(file)) {
      factCache.set(cik, null);
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { missing: true } | { missing: false; concepts: ConceptFacts };
    const concepts = parsed.missing ? null : parsed.concepts;
    factCache.set(cik, concepts);
    return concepts;
  };
  const statusCache = new Map<string, TtmStatus>();
  const statusFor = (ticker: string, signal: string) => {
    const key = `${ticker}|${signal}`;
    const cached = statusCache.get(key);
    if (cached) return cached;
    const status = ttmAt(conceptsFor(ticker), signal).status;
    statusCache.set(key, status);
    return status;
  };

  const names: NameSeries[] = [];
  for (const [ticker, series] of feats) {
    if (ticker === "SPY" || BENCH.has(ticker) || JAB.has(ticker)) continue;
    names.push({ ticker, sector: sectorOf.get(ticker) ?? "", semi: gicsSemi(ticker), core: coreSemi.has(ticker), broad: true, feats: series, earnings: [] });
  }
  const advSeries = new Map<string, Map<string, number>>();
  const closes = new Map<string, Map<string, number>>();
  for (const name of names) {
    advSeries.set(name.ticker, trailingAvgDollar(name.feats, ADV_WINDOW));
    const days = new Map<string, number>();
    for (const bar of name.feats) days.set(bar.date, bar.c);
    closes.set(name.ticker, days);
  }

  const ledgers: Record<BookId, LedgerRow[]> = { none: [], F1iF2: [] };
  for (const window of windows) {
    const bounds = { from: window.from, to: window.to };
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
    const pitSet = new Set(
      [...membershipAsOf(sp500.map((row) => row.ticker), changes500.changes, window.asOf), ...membershipAsOf(sp400.map((row) => row.ticker), changes400.changes, window.asOf)].filter((ticker) => feats.has(ticker)),
    );
    const leaders = advLeaders(advSeries, windowSessions, ADV_TOP_N);
    const wide: Candidate[] = [];
    for (const name of names) wide.push(...rangeCandidates(name, WIDE_RULES, market, calendar, bounds));
    const marked = wide.map((cand) => {
      const sig = feats.get(cand.ticker)?.[cand.signalIndex];
      const low = sig?.low20 ?? null;
      const high = sig?.high20 ?? null;
      const width = low != null && high != null && low > 0 ? ((high - low) / low) * 100 : null;
      const range = low != null && high != null ? high - low : null;
      const snap: Snap = {
        f1: statusFor(cand.ticker, cand.signalDate),
        atrPct: cand.atrPct,
        boxWidthPct: width,
        entryPosPct: range != null && range > 0 ? ((cand.entry - low) / range) * 100 : null,
        rs20: cand.rs20,
        above50: sig?.ma50 == null ? null : sig.c > sig.ma50,
        entry: cand.entry,
        exit: cand.exit,
        exitDate: cand.exitDate,
        reason: cand.reason,
        exitTiming: cand.exitTiming,
      };
      return { cand, snap, above: aboveBoxTop(cand.entry, high) };
    });
    const sources: Array<{ universe: UniverseId; rows: typeof marked }> = [
      { universe: "pit", rows: marked.filter((row) => pitSet.has(row.cand.ticker)) },
      { universe: "adv", rows: marked.filter((row) => leaders.get(row.cand.signalDate)?.has(row.cand.ticker)) },
    ];
    for (const source of sources) {
      for (const filter of FILTERS) {
        const chosen = source.rows.filter((row) => admits(filter as Round4Filter, row.snap.f1, row.above));
        const byKey = new Map<string, Array<{ cand: Candidate; snap: Snap }>>();
        for (const row of chosen) {
          const key = `${row.cand.ticker}|${row.cand.entryDate}`;
          const list = byKey.get(key) ?? [];
          list.push(row);
          byKey.set(key, list);
        }
        const ran = runPortfolio(
          {
            id: `base-${filter}`,
            label: filter,
            universe: source.universe,
            rank: "rs",
            sessions: windowSessions,
            flatten: true,
            withRestart: false,
            yearSplit: YEAR2_FROM,
            closes,
            maxSemi: 2,
            keepFills: true,
          },
          chosen.map((row) => row.cand),
        );
        const expect = EXPECTED.find((cell) => cell.filter === filter && cell.universe === source.universe && cell.window === window.id);
        if (ran.totalUsd !== expect?.total || ran.n !== expect.n) {
          throw new Error(`${filter} ${source.universe} ${window.id} が ${expect?.total} / ${expect?.n} ではない: ${ran.totalUsd} / ${ran.n}`);
        }
        for (const fill of ran.fills ?? []) {
          const matches = byKey.get(`${fill.ticker}|${fill.entryDate}`) ?? [];
          const hit = matches.find((row) => row.cand.exitDate === fill.exitDate) ?? matches[0];
          if (!hit) throw new Error(`約定に候補がない ${fill.ticker} ${fill.entryDate}`);
          const planned = hit.cand.exitDate === fill.exitDate;
          const entryAt = sessionAt.get(fill.entryDate);
          const exitAt = sessionAt.get(fill.exitDate);
          const exitBar = feats.get(fill.ticker)?.find((bar) => bar.date === fill.exitDate);
          ledgers[filter].push({
            book: filter,
            ticker: fill.ticker,
            entryDate: fill.entryDate,
            exitDate: fill.exitDate,
            pnlUsd: fill.pnlUsd,
            holdSessions: entryAt != null && exitAt != null ? exitAt - entryAt : 0,
            entry: hit.snap.entry,
            exit: planned ? hit.snap.exit : (exitBar?.c ?? hit.snap.exit),
            atrPct: hit.snap.atrPct,
            boxWidthPct: hit.snap.boxWidthPct,
            entryPosPct: hit.snap.entryPosPct,
            rs20: hit.snap.rs20,
            above50: hit.snap.above50,
            profitStatus: profitLabel(hit.snap.f1),
            exitReason: exitLabel(hit.snap.reason, hit.snap.exitTiming, planned),
            seenIn: [`${source.universe}/${window.id}`],
          });
        }
        console.log(`${window.id} ${source.universe} ${filter} n ${ran.n} pnl ${ran.totalUsd}`);
      }
    }
  }

  const reactionCache = new Map<string, string[]>();
  const reactionsFor = (ticker: string) => {
    const cached = reactionCache.get(ticker);
    if (cached) return cached;
    const cik = cikFor(ticker);
    const days = cik ? reactionDaysFrom(loadBlocks(cik), calendar).days : [];
    reactionCache.set(ticker, days);
    return days;
  };
  const profileCache = new Map<string, { name: string; sic: string | null; sicDescription: string | null }>();
  const profileFor = (ticker: string) => {
    const cached = profileCache.get(ticker);
    if (cached) return cached;
    const cik = cikFor(ticker);
    const title = titleOf.get(ticker.toUpperCase()) ?? titleOf.get(ticker.toUpperCase().replace(/\./g, "-")) ?? "";
    let name = title;
    let sic: string | null = null;
    let sicDescription: string | null = null;
    if (cik && fs.existsSync(path.join(EDGAR, `${cik}.json`))) {
      const doc = JSON.parse(fs.readFileSync(path.join(EDGAR, `${cik}.json`), "utf8")) as { name?: string; sic?: string; sicDescription?: string };
      if (doc.name) name = doc.name;
      sic = doc.sic ?? null;
      sicDescription = doc.sicDescription ?? null;
    }
    const profile = { name, sic, sicDescription };
    profileCache.set(ticker, profile);
    return profile;
  };

  const books = FILTERS.map((filter) => {
    const unique = dedupeFills(ledgers[filter]);
    const winners = topByPnl(unique, 20, "winner");
    const losers = topByPnl(unique, 20, "loser");
    const present = (rows: LedgerRow[], side: "winner" | "loser") =>
      rows.map((row, index) => {
        const profile = profileFor(row.ticker);
        const phrase = profile.sicDescription ? (SIC_JA[profile.sicDescription] ?? profile.sicDescription) : "";
        const descriptionJa = phrase ? `${phrase}（${profile.name}）` : profile.name ? `${profile.name}（業種区分なし）` : "社名も業種もSECに無い";
        const descriptionSource = profile.sicDescription ? `SEC SIC ${profile.sic} ${profile.sicDescription}` : profile.name ? "SEC company name" : "none";
        const earningsDuring = reactionsFor(row.ticker).filter((date) => date >= row.entryDate && date <= row.exitDate);
        const news = NEWS[`${row.ticker}|${row.entryDate}|${row.exitDate}`] ?? null;
        return {
          rank: index + 1,
          side,
          ticker: row.ticker,
          companyName: profile.name,
          descriptionJa,
          descriptionSource,
          sector: sectorOf.get(row.ticker) ?? "unmapped",
          entryDate: row.entryDate,
          exitDate: row.exitDate,
          holdSessions: row.holdSessions,
          pnlUsd: money(row.pnlUsd),
          entry: round(row.entry, 4),
          exit: round(row.exit, 4),
          atrPct: round(row.atrPct, 4),
          boxWidthPct: round(row.boxWidthPct, 4),
          entryPosPct: round(row.entryPosPct, 4),
          rs20: round(row.rs20, 4),
          above50: row.above50,
          profitStatus: row.profitStatus,
          exitReason: row.exitReason,
          earningsDuring,
          news,
          seenIn: row.seenIn,
        };
      });
    const winnerRows = present(winners, "winner");
    const loserRows = present(losers, "loser");
    const factSide = (rows: typeof winnerRows) => ({
      n: rows.length,
      exitReasons: counts(rows.map((row) => row.exitReason)),
      profit: counts(rows.map((row) => row.profitStatus)),
      above50: rows.filter((row) => row.above50 === true).length,
      below50: rows.filter((row) => row.above50 === false).length,
      unknown50: rows.filter((row) => row.above50 == null).length,
      earningsDuring: rows.filter((row) => row.earningsDuring.length > 0).length,
      unmapped: rows.filter((row) => row.sector === "unmapped").length,
      sectors: counts(rows.map((row) => row.sector)),
      medianHold: median(rows.map((row) => row.holdSessions)),
      medianAtrPct: median(rows.flatMap((row) => (row.atrPct == null ? [] : [row.atrPct]))),
      medianBoxWidthPct: median(rows.flatMap((row) => (row.boxWidthPct == null ? [] : [row.boxWidthPct]))),
      medianEntryPosPct: median(rows.flatMap((row) => (row.entryPosPct == null ? [] : [row.entryPosPct]))),
      medianRs20: median(rows.flatMap((row) => (row.rs20 == null ? [] : [row.rs20]))),
    });
    return {
      id: filter,
      label: filter === "none" ? "基準（フィルタなし）" : "基準 + F1未知も取る + F2",
      pooled: unique.length,
      winners: winnerRows,
      losers: loserRows,
      facts: { winners: factSide(winnerRows), losers: factSide(loserRows) },
    };
  });

  const missingSic = new Set<string>();
  for (const book of books) {
    for (const row of [...book.winners, ...book.losers]) {
      if (row.descriptionSource.startsWith("SEC SIC") && !row.descriptionJa.match(/[\u3040-\u30ff\u4e00-\u9faf]/)) missingSic.add(row.descriptionSource);
    }
  }
  const report = {
    v: 1,
    rulesCommit: ROUND4_PREREG,
    generatedAt: new Date().toISOString(),
    pool: "Point-in-time S&P 500+400 and ADV top 200, both windows. One row per ticker, entry date, exit date, and P&L.",
    descriptionNote: "Japanese line is a translation of the SEC SIC description plus the SEC company name. It is not a news summary.",
    books,
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report));
  const header = ["book", "side", "rank", "ticker", "companyName", "descriptionJa", "descriptionSource", "sector", "entryDate", "exitDate", "holdSessions", "pnlUsd", "entry", "exit", "atrPct", "boxWidthPct", "entryPosPct", "rs20", "above50", "profitStatus", "exitReason", "earningsDuring", "newsText", "newsUrl", "seenIn"];
  const lines = [header.join(",")];
  const cell = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  for (const book of books) {
    for (const row of [...book.winners, ...book.losers]) {
      lines.push(
        [
          book.id,
          row.side,
          row.rank,
          row.ticker,
          row.companyName,
          row.descriptionJa,
          row.descriptionSource,
          row.sector,
          row.entryDate,
          row.exitDate,
          row.holdSessions,
          row.pnlUsd,
          row.entry,
          row.exit,
          row.atrPct,
          row.boxWidthPct,
          row.entryPosPct,
          row.rs20,
          row.above50,
          row.profitStatus,
          row.exitReason,
          row.earningsDuring.join("|"),
          row.news?.text ?? "",
          row.news?.url ?? "",
          row.seenIn.join("|"),
        ]
          .map(cell)
          .join(","),
      );
    }
  }
  fs.writeFileSync(OUT_CSV, `${lines.join("\n")}\n`);
  console.log(`wrote ${OUT_JSON}`);
  if (missingSic.size) console.log(`untranslated SIC ${[...missingSic].join(" || ")}`);
  for (const book of books) {
    console.log(book.id, "winners", book.winners.map((row) => `${row.ticker} ${row.pnlUsd}`).join(", "));
    console.log(book.id, "losers", book.losers.map((row) => `${row.ticker} ${row.pnlUsd}`).join(", "));
    console.log(book.id, "facts", JSON.stringify(book.facts));
  }
}

main();
