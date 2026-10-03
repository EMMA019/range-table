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
  earningsDatesFrom,
  expandRowspan,
  isSemiSubIndustry,
  listedFrom,
  membershipAsOf,
  trailingAvgDollar,
  wikiTables,
  type EarningsBridge,
  type EarningsBridgeRow,
  type EarningsRowId,
  type EarningsUniverseId,
  type EarningsWindowId,
  type FilingBlock,
} from "../src/lib/bias";
import {
  YEAR2_FROM,
  buildFeatures,
  marketByDate,
  nearEarnings,
  rangeCandidates,
  runBuyHold,
  runPortfolio,
  withRules,
  type Book,
  type Candidate,
  type Feat,
  type NameSeries,
} from "../src/lib/backtest-study";
import { entryAfterEarnings, exitBarBeforeReaction, reactionDaysFrom } from "../src/lib/earnings-bridge";
import { isIgnoredTicker } from "../src/lib/holdings";
import { entryBeforeEarnings, MAIN_Q, MAIN_Z, bootstrapMean, overallVerdict, windowVerdict, type Verdict } from "../src/lib/round2";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Split the earnings block on the reaction day.
 * Analysis only. Writes `earningsBridge` onto data/backtest/bias.json.
 *   npx tsx scripts/earnings-bridge.ts
 */
const RULES_COMMIT = "a7937073455b7b3c5be002300ef917c4527d8bd2";
const OUT = path.join(process.cwd(), "data", "backtest", "bias.json");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const HOLD = path.join(process.cwd(), "data", ".cache", "holdings");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const BENCH = new Set<string>(BENCHMARKS);
const JAB = new Set<string>(JAB_ETFS);
const CORE_RULES = withRules({ id: "earn-core", label: "今の187", atrMin: 3, priceMax: 550, gapThroughStop: true });
const WIDE_RULES = withRules({ id: "earn-wide", label: "上限なし", atrMin: 3, gapThroughStop: true });

type WindowSpec = { id: EarningsWindowId; from: string; to: string; asOf: string };

function round(value: number): number {
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

function stamp(cands: Candidate[], isSemi: (ticker: string) => boolean): Candidate[] {
  return cands.map((cand) => {
    const semi = isSemi(cand.ticker);
    return cand.semi === semi ? cand : { ...cand, semi };
  });
}

function judge(book: Book, spyRatio: number | null, judged: boolean): Pick<EarningsBridgeRow, "n" | "totalUsd" | "profitFactor" | "mtmDdUsd" | "ratio" | "ciLow" | "nRequired" | "verdict"> {
  const ratio = book.maxDrawdownUsd > 0 ? round(book.totalUsd / book.maxDrawdownUsd) : null;
  if (!judged) {
    return {
      n: book.n,
      totalUsd: book.totalUsd,
      profitFactor: book.profitFactor,
      mtmDdUsd: book.maxDrawdownUsd,
      ratio,
      ciLow: null,
      nRequired: null,
      verdict: "not-judged",
    };
  }
  const boot = bootstrapMean((book.fills ?? []).map((fill) => fill.pnlUsd), MAIN_Q, MAIN_Z);
  const verdict = windowVerdict({
    totalUsd: book.totalUsd,
    n: book.n,
    ratio,
    spyRatio,
    lower: boot.lower,
    nRequired: boot.nRequired,
  });
  return {
    n: book.n,
    totalUsd: book.totalUsd,
    profitFactor: book.profitFactor,
    mtmDdUsd: book.maxDrawdownUsd,
    ratio,
      ciLow: boot.lower == null ? null : Math.round(boot.lower * 10000) / 10000,
    nRequired: boot.nRequired == null ? null : round(boot.nRequired),
    verdict,
  };
}

function main() {
  const sp500 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp500.html"), "utf8"), "Symbol"));
  const sp400 = listedFrom(table(fs.readFileSync(path.join(WIKI, "sp400.html"), "utf8"), "Symbol"));
  const changes500 = changesFrom(expandRowspan(wikiTables(fs.readFileSync(path.join(WIKI, "sp500-hist.html"), "utf8")).find((item) => expandRowspan(item.rows).some((row) => row.includes("Effective Date") || (row.includes("Date") && row.includes("Added"))))?.rows ?? []));
  const changes400 = changesFrom(expandRowspan(wikiTables(fs.readFileSync(path.join(WIKI, "sp400.html"), "utf8")).find((item) => expandRowspan(item.rows).some((row) => row.includes("Date") && row.includes("Added")))?.rows ?? []));
  if (!changes500.changes.length || !changes400.changes.length) throw new Error("変更表が読めない");

  const gics = new Map<string, { sub: string | null }>();
  for (const row of [...sp500, ...sp400]) if (!gics.has(row.ticker)) gics.set(row.ticker, { sub: row.sub });
  const gicsSemi = (ticker: string) => isSemiSubIndustry(gics.get(ticker)?.sub);

  const watch = loadWatchlist();
  const coreSemi = new Map<string, boolean>();
  for (const group of watch.groups) {
    const semi = group.id === "semi" || group.id === "equipment";
    for (const ticker of group.tickers) {
      if (isIgnoredTicker(ticker.ticker)) continue;
      coreSemi.set(ticker.ticker, semi);
    }
  }

  const wanted = new Set<string>([...coreSemi.keys(), "SPY"]);
  for (const row of [...sp500, ...sp400]) wanted.add(row.ticker);
  for (const change of [...changes500.changes, ...changes400.changes]) {
    if (change.added) wanted.add(change.added);
    if (change.removed) wanted.add(change.removed);
  }
  let holdingNames = 0;
  for (const etf of SECTOR_HOLDING_ETFS) {
    for (const ticker of holdingTickers(etf)) {
      wanted.add(ticker);
      holdingNames += 1;
    }
  }
  console.log(`wanted ${wanted.size} holding rows ${holdingNames}`);

  const feats = new Map<string, Feat[]>();
  let missingBars = 0;
  for (const ticker of wanted) {
    const bars = readCachedBars(ticker);
    if (!bars || bars.length < 30) {
      missingBars += 1;
      continue;
    }
    feats.set(ticker, buildFeatures(bars));
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
  console.log(`bars ${feats.size} missing ${missingBars} last ${lastBar}`);

  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const reactions = new Map<string, string[]>();
  const filings = new Map<string, string[]>();
  let undated = 0;
  let edgarMissing = 0;
  const names: NameSeries[] = [];
  for (const [ticker, series] of feats) {
    if (ticker === "SPY" || BENCH.has(ticker) || JAB.has(ticker)) continue;
    const key = ticker.toUpperCase();
    const cik = cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, "."));
    if (!cik) {
      edgarMissing += 1;
      reactions.set(ticker, []);
      filings.set(ticker, []);
    } else {
      const blocks = loadBlocks(cik);
      if (!blocks.length) edgarMissing += 1;
      const parsed = reactionDaysFrom(blocks, calendar);
      undated += parsed.undated;
      reactions.set(ticker, parsed.days);
      filings.set(ticker, earningsDatesFrom(blocks).item202);
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
  console.log(`names ${names.length} undated ${undated} edgar missing ${edgarMissing}`);

  const advSeries = new Map<string, Map<string, number>>();
  const closes = new Map<string, Map<string, number>>();
  for (const name of names) {
    advSeries.set(name.ticker, trailingAvgDollar(name.feats, ADV_WINDOW));
    const days = new Map<string, number>();
    for (const bar of name.feats) days.set(bar.date, bar.c);
    closes.set(name.ticker, days);
  }

  const rows: EarningsBridgeRow[] = [];
  const preByUniverse = new Map<EarningsUniverseId, Verdict[]>();
  const spyRows: EarningsBridge["spy"] = [];

  for (const window of windows) {
    const windowSessions = calendar.filter((date) => date >= window.from && date <= window.to);
    const spyBook = runBuyHold("SPY", "SPY", spy, window.from, window.to);
    const spyRatio = spyBook.maxDrawdownUsd > 0 ? round(spyBook.totalUsd / spyBook.maxDrawdownUsd) : null;
    spyRows.push({ window: window.id, totalUsd: spyBook.totalUsd, mtmDdUsd: spyBook.maxDrawdownUsd, ratio: spyRatio });
    console.log(`spy ${window.id} ${spyBook.totalUsd} dd ${spyBook.maxDrawdownUsd} ratio ${spyRatio}`);

    const large = membershipAsOf(sp500.map((row) => row.ticker), changes500.changes, window.asOf);
    const mid = membershipAsOf(sp400.map((row) => row.ticker), changes400.changes, window.asOf);
    const pitSet = new Set([...large, ...mid].filter((ticker) => feats.has(ticker)));
    const leaders = advLeaders(advSeries, windowSessions, ADV_TOP_N);
    console.log(`${window.id} pit ${pitSet.size} sessions ${windowSessions.length}`);

    const plainCore: Candidate[] = [];
    const spanCore: Candidate[] = [];
    const plainWide: Candidate[] = [];
    const spanWide: Candidate[] = [];
    let built = 0;
    for (const name of names) {
      const days = reactions.get(name.ticker) ?? [];
      const force = (entry: string) => exitBarBeforeReaction(name.feats, entry, days, calendar);
      if (name.core) {
        plainCore.push(...rangeCandidates(name, CORE_RULES, market, calendar, { from: window.from, to: window.to }));
        spanCore.push(...rangeCandidates(name, CORE_RULES, market, calendar, { from: window.from, to: window.to }, force));
      }
      plainWide.push(...rangeCandidates(name, WIDE_RULES, market, calendar, { from: window.from, to: window.to }));
      spanWide.push(...rangeCandidates(name, WIDE_RULES, market, calendar, { from: window.from, to: window.to }, force));
      built += 1;
      if (built % 250 === 0) console.log(`${window.id} built ${built}/${names.length}`);
    }
    console.log(`${window.id} signals core ${plainCore.length} wide ${plainWide.length}`);

    const dropPre = (list: Candidate[]) => list.filter((cand) => !entryBeforeEarnings(cand.entryDate, reactions.get(cand.ticker) ?? [], calendar));
    const dropPost = (list: Candidate[]) => list.filter((cand) => !entryAfterEarnings(cand.entryDate, reactions.get(cand.ticker) ?? [], calendar));
    const dropFiling = (list: Candidate[]) => list.filter((cand) => !nearEarnings(calendar, cand.signalDate, filings.get(cand.ticker) ?? []));

    const books: Array<{ id: EarningsRowId; universe: EarningsUniverseId; cands: Candidate[] }> = [
      { id: "none", universe: "core", cands: plainCore },
      { id: "filing", universe: "core", cands: dropFiling(plainCore) },
      { id: "pre", universe: "core", cands: dropPre(plainCore) },
      { id: "post", universe: "core", cands: dropPost(plainCore) },
      { id: "span", universe: "core", cands: spanCore },
      { id: "none", universe: "pit", cands: stamp(plainWide.filter((cand) => pitSet.has(cand.ticker)), gicsSemi) },
      { id: "filing", universe: "pit", cands: stamp(dropFiling(plainWide).filter((cand) => pitSet.has(cand.ticker)), gicsSemi) },
      { id: "pre", universe: "pit", cands: stamp(dropPre(plainWide).filter((cand) => pitSet.has(cand.ticker)), gicsSemi) },
      { id: "post", universe: "pit", cands: stamp(dropPost(plainWide).filter((cand) => pitSet.has(cand.ticker)), gicsSemi) },
      { id: "span", universe: "pit", cands: stamp(spanWide.filter((cand) => pitSet.has(cand.ticker)), gicsSemi) },
      { id: "none", universe: "adv", cands: stamp(plainWide.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)), gicsSemi) },
      { id: "filing", universe: "adv", cands: stamp(dropFiling(plainWide).filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)), gicsSemi) },
      { id: "pre", universe: "adv", cands: stamp(dropPre(plainWide).filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)), gicsSemi) },
      { id: "post", universe: "adv", cands: stamp(dropPost(plainWide).filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)), gicsSemi) },
      { id: "span", universe: "adv", cands: stamp(spanWide.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)), gicsSemi) },
    ];

    for (const spec of books) {
      const book = runPortfolio(
        {
          id: spec.id,
          label: spec.id,
          universe: spec.universe,
          rank: "rs",
          sessions: windowSessions,
          flatten: true,
          withRestart: false,
          yearSplit: YEAR2_FROM,
          closes,
          maxSemi: 2,
          keepFills: spec.id === "pre",
        },
        spec.cands,
      );
      const scored = judge(book, spyRatio, spec.id === "pre");
      rows.push({ id: spec.id, universe: spec.universe, window: window.id, ...scored });
      if (spec.id === "pre") {
        const list = preByUniverse.get(spec.universe) ?? [];
        list.push(scored.verdict);
        preByUniverse.set(spec.universe, list);
      }
      console.log(`${window.id} ${spec.universe} ${spec.id} n ${scored.n} pnl ${scored.totalUsd} pf ${scored.profitFactor} ${scored.verdict}`);
    }
  }

  const universes: EarningsBridge["candidate"]["universes"] = (["core", "pit", "adv"] as const).map((universe) => ({
    universe,
    verdict: overallVerdict(preByUniverse.get(universe) ?? []),
  }));
  const report: EarningsBridge = {
    rulesCommit: RULES_COMMIT,
    undated,
    edgarMissing,
    spy: spyRows,
    rows,
    candidate: { id: "E1", verdict: overallVerdict(universes.map((row) => row.verdict)), universes },
  };
  if (!fs.existsSync(OUT)) throw new Error("bias.json が無い");
  const existing = JSON.parse(fs.readFileSync(OUT, "utf8")) as { earningsBridge?: unknown };
  existing.earningsBridge = report;
  fs.writeFileSync(OUT, JSON.stringify(existing));
  console.log(`wrote earnings bridge E1 ${report.candidate.verdict}`);
}

main();
