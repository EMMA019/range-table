import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  ADV_WINDOW,
  IN_FROM,
  IN_TO,
  OOS_FROM,
  OOS_TO,
  advLeaders,
  changesFrom,
  expandRowspan,
  isSemiSubIndustry,
  listedFrom,
  membershipAsOf,
  trailingAvgDollar,
  wikiTables,
} from "../src/lib/bias";
import {
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
import type { FilingBlock } from "../src/lib/bias";
import {
  MAIN_Q,
  MAIN_Z,
  PRIMED_Q,
  PRIMED_Z,
  ROUND2_PREREG,
  bootstrapMean,
  commonStockTitle,
  driftCandidates,
  dropMonthTurn,
  entryBeforeEarnings,
  flagIsPlan,
  footnoteIsPlan,
  gapFillCandidates,
  ibkrFixedFee,
  insiderFilingSignals,
  insiderRole,
  monthTurnSessions,
  overallVerdict,
  plannedExit,
  reactionDay,
  windowVerdict,
  type InsiderLot,
  type Verdict,
} from "../src/lib/round2";
import type { Bar } from "../src/lib/types";
import { BAR_CACHE, readCachedBars, yahooSymbol } from "./cache-bars";
import { fetchDailyBars } from "../src/lib/yahoo";

/**
 * Strategy round 2. Rules are locked in docs/ROUND2_PREREG.md.
 *   npx tsx scripts/round2-study.ts
 */
const UA = "range-table mimiko.neko.neko@gmail.com";
const OUT = path.join(process.cwd(), "data", "backtest", "round2.json");
const WIKI = path.join(process.cwd(), "data", ".cache", "wiki");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FORM345 = path.join(process.cwd(), "data", ".cache", "form345");
const PUBLISHED_SPY = { oos: 1661.54, in: 982.45 };
const PUBLISHED_ADV = { oos: 1056.66, in: 975.4 };

const BOX3 = withRules({ id: "r2-box3", label: "箱・ATR3%以上・ギャップ抜け", atrMin: 3, gapThroughStop: true });
const BOX46 = withRules({ id: "r2-box46", label: "箱・ATR4〜6%・ギャップ抜け", atrMin: 4, atrMax: 6, gapThroughStop: true });

type WindowId = "oos" | "in";
type UniverseId = "pit" | "adv";

const WINDOWS: Array<{ id: WindowId; from: string; to: string; asOf: string }> = [
  { id: "oos", from: OOS_FROM, to: OOS_TO, asOf: OOS_FROM },
  { id: "in", from: IN_FROM, to: IN_TO, asOf: IN_FROM },
];

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function secDate(text: string): string | null {
  const match = text.trim().toUpperCase().match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[2] ?? ""];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
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

async function ensureBars(ticker: string): Promise<Bar[] | null> {
  const cached = readCachedBars(ticker);
  if (cached && cached.length >= 30) return cached;
  try {
    const { bars } = await fetchDailyBars(yahooSymbol(ticker), { range: "5y", keep: 1600 });
    if (bars.length < 30) return null;
    fs.mkdirSync(BAR_CACHE, { recursive: true });
    fs.writeFileSync(path.join(BAR_CACHE, `${yahooSymbol(ticker)}.json`), JSON.stringify(bars));
    return bars;
  } catch {
    return null;
  }
}

async function forEachTsv(zip: string, member: string, onRow: (header: string[], cols: string[]) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("unzip", ["-p", zip, member], { stdio: ["ignore", "pipe", "pipe"] });
    const lines = readline.createInterface({ input: child.stdout });
    let header: string[] | null = null;
    let failed = "";
    child.stderr.on("data", (chunk: Buffer) => {
      failed += chunk.toString();
    });
    lines.on("line", (line) => {
      if (!line) return;
      const cols = line.split("\t");
      if (!header) {
        header = cols;
        return;
      }
      if (cols.length < header.length) return;
      onRow(header, cols);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`unzip ${member} ${code} ${failed.slice(0, 200)}`));
    });
  });
}

async function zipMembers(zip: string): Promise<string[]> {
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn("unzip", ["-Z1", zip], { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (chunk: Buffer) => {
      text += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(text) : reject(new Error(`unzip list ${code}`))));
  });
  return out.split(/\r?\n/).filter(Boolean);
}

function memberNamed(members: string[], name: string): string {
  const found = members.find((member) => member.toUpperCase().endsWith(`/${name}.TSV`) || member.toUpperCase().endsWith(`${name}.TSV`));
  if (!found) throw new Error(`${name} がZIPに無い`);
  return found;
}

async function loadInsiders(symbols: Set<string>): Promise<{ lots: InsiderLot[]; lastFiling: string | null; quarters: string[]; missingQuarters: string[]; flagColumns: string[] }> {
  fs.mkdirSync(FORM345, { recursive: true });
  const quarters: string[] = [];
  for (let year = 2022; year <= 2026; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      if (year === 2022 && quarter < 2) continue;
      if (year === 2026 && quarter > 3) continue;
      quarters.push(`${year}q${quarter}`);
    }
  }
  const lots: InsiderLot[] = [];
  const missingQuarters: string[] = [];
  const flagColumns = new Set<string>();
  let lastFiling: string | null = null;
  for (const quarter of quarters) {
    const file = path.join(FORM345, `${quarter}_form345.zip`);
    if (!fs.existsSync(file)) {
      const url = `https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/${quarter}_form345.zip`;
      const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/zip" } });
      if (response.status === 404) {
        missingQuarters.push(quarter);
        console.log(`form345 ${quarter} 404`);
        continue;
      }
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const members = await zipMembers(file);
    const submissionFile = memberNamed(members, "SUBMISSION");
    const ownerFile = memberNamed(members, "REPORTINGOWNER");
    const transFile = memberNamed(members, "NONDERIV_TRANS");
    const noteFile = memberNamed(members, "FOOTNOTES");
    const kept = new Map<string, { filing: string; ticker: string; planned: boolean }>();
    await forEachTsv(file, submissionFile, (header, cols) => {
      const col = (name: string) => cols[header.indexOf(name)] ?? "";
      const doc = col("DOCUMENT_TYPE").toUpperCase();
      if (doc !== "4") return;
      const symbol = col("ISSUERTRADINGSYMBOL").toUpperCase().trim();
      const ticker = symbols.has(symbol) ? symbol : symbols.has(symbol.replace(/-/g, ".")) ? symbol.replace(/-/g, ".") : symbols.has(symbol.replace(/\./g, "-")) ? symbol.replace(/\./g, "-") : "";
      if (!ticker || !symbols.has(ticker)) return;
      const filing = secDate(col("FILING_DATE"));
      if (!filing) return;
      const accession = col("ACCESSION_NUMBER");
      let planned = false;
      for (const name of ["AFF10B5ONE", "IS10B51", "RULE10B51"]) {
        const index = header.findIndex((item) => item.toUpperCase() === name);
        if (index < 0) continue;
        flagColumns.add(header[index] ?? name);
        if (flagIsPlan(cols[index])) planned = true;
      }
      kept.set(accession, { filing, ticker, planned });
      if (!lastFiling || filing > lastFiling) lastFiling = filing;
    });
    const owners = new Map<string, Array<{ owner: string; role: boolean }>>();
    await forEachTsv(file, ownerFile, (header, cols) => {
      const col = (name: string) => cols[header.indexOf(name)] ?? "";
      const accession = col("ACCESSION_NUMBER");
      if (!kept.has(accession)) return;
      const list = owners.get(accession) ?? [];
      list.push({ owner: col("RPTOWNERCIK"), role: insiderRole(col("RPTOWNER_RELATIONSHIP"), col("RPTOWNER_TITLE")) });
      owners.set(accession, list);
    });
    const plannedNote = new Set<string>();
    await forEachTsv(file, noteFile, (header, cols) => {
      const col = (name: string) => cols[header.indexOf(name)] ?? "";
      const accession = col("ACCESSION_NUMBER");
      if (!kept.has(accession)) return;
      if (footnoteIsPlan(col("FOOTNOTE_TXT"))) plannedNote.add(accession);
    });
    const sums = new Map<string, InsiderLot>();
    await forEachTsv(file, transFile, (header, cols) => {
      const col = (name: string) => cols[header.indexOf(name)] ?? "";
      const accession = col("ACCESSION_NUMBER");
      const meta = kept.get(accession);
      if (!meta || meta.planned || plannedNote.has(accession)) return;
      if (col("TRANS_CODE").toUpperCase() !== "P" || col("TRANS_ACQUIRED_DISP_CD").toUpperCase() !== "A") return;
      if (!commonStockTitle(col("SECURITY_TITLE"))) return;
      let rowPlan = false;
      for (const name of ["AFF10B5ONE", "IS10B51", "RULE10B51"]) {
        const index = header.findIndex((item) => item.toUpperCase() === name);
        if (index < 0) continue;
        flagColumns.add(header[index] ?? name);
        if (flagIsPlan(cols[index])) rowPlan = true;
      }
      if (rowPlan) return;
      const shares = Number(col("TRANS_SHARES"));
      const price = Number(col("TRANS_PRICEPERSHARE"));
      if (!(shares > 0) || !(price > 0)) return;
      const people = (owners.get(accession) ?? []).filter((owner) => owner.role && owner.owner);
      for (const person of people) {
        const key = `${meta.ticker}|${person.owner}|${meta.filing}`;
        const prior = sums.get(key);
        if (prior) prior.valueUsd += shares * price;
        else sums.set(key, { ticker: meta.ticker, owner: person.owner, filingDate: meta.filing, valueUsd: shares * price });
      }
    });
    lots.push(...sums.values());
    console.log(`form345 ${quarter} filings ${kept.size} lots ${sums.size}`);
  }
  return { lots, lastFiling, quarters: quarters.filter((quarter) => !missingQuarters.includes(quarter)), missingQuarters, flagColumns: [...flagColumns] };
}

type EdgarPack = { reactions: Map<string, string[]>; blocked: Map<string, Set<string>>; missing: string[]; undated: number };

function loadEdgar(tickers: string[], sessions: string[]): EdgarPack {
  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const reactions = new Map<string, string[]>();
  const blocked = new Map<string, Set<string>>();
  const missing: string[] = [];
  let undated = 0;
  const sessionSet = new Set(sessions);
  for (const ticker of tickers) {
    const key = ticker.toUpperCase();
    const cik = cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, "."));
    const file = cik ? path.join(EDGAR, `${cik}.json`) : "";
    if (!cik || !fs.existsSync(file)) {
      missing.push(ticker);
      blocked.set(ticker, new Set(sessions));
      continue;
    }
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { filings?: { recent?: FilingBlock; files?: Array<{ name: string }> } };
    const blocks: FilingBlock[] = [];
    if (json.filings?.recent) blocks.push(json.filings.recent);
    for (const extra of json.filings?.files ?? []) {
      const extraFile = path.join(EDGAR, extra.name);
      if (fs.existsSync(extraFile)) blocks.push(JSON.parse(fs.readFileSync(extraFile, "utf8")) as FilingBlock);
    }
    const reaction: string[] = [];
    const filings: string[] = [];
    for (const block of blocks) {
      const forms = block.form ?? [];
      const dates = block.filingDate ?? [];
      const items = block.items ?? [];
      const accepted = (block as FilingBlock & { acceptanceDateTime?: string[] }).acceptanceDateTime ?? [];
      const n = Math.min(forms.length, dates.length);
      for (let i = 0; i < n; i += 1) {
        const form = forms[i];
        if (form !== "8-K" && form !== "8-K/A") continue;
        if (dates[i]) filings.push(dates[i]);
        if (form !== "8-K") continue;
        const parts = (items[i] ?? "").split(",").map((part) => part.trim());
        if (!parts.includes("2.02")) continue;
        const stamp = accepted[i];
        if (!stamp) {
          undated += 1;
          continue;
        }
        const day = reactionDay(stamp, sessions);
        if (day) reaction.push(day);
      }
    }
    reactions.set(ticker, [...new Set(reaction)].sort());
    const filingSet = new Set(filings);
    const block = new Set<string>();
    for (let i = 0; i < sessions.length; i += 1) {
      const prev = i > 0 ? sessions[i - 1] : "";
      if (filingSet.has(sessions[i]) || (prev && filingSet.has(prev))) block.add(sessions[i]);
    }
    blocked.set(ticker, block);
    void sessionSet;
  }
  return { reactions, blocked, missing, undated };
}

function priced(cands: Candidate[], closeOf: Map<string, number>): Candidate[] {
  return cands.filter((cand) => {
    const close = closeOf.get(`${cand.ticker}|${cand.signalDate}`);
    return close != null && close < 550 && cand.entry < 550 && sharesForBudget(cand.entry) != null;
  });
}

function spyPath(spy: Feat[], from: string, to: string): { totalUsd: number; mtmDdUsd: number; ratio: number | null } {
  const bars = spy.filter((bar) => bar.date >= from && bar.date <= to);
  if (!bars.length || !(bars[0].o > 0)) return { totalUsd: 0, mtmDdUsd: 0, ratio: null };
  const qty = Math.floor(3200 / bars[0].o);
  const entryFee = ibkrFixedFee(qty, bars[0].o);
  const cash = 3200 - qty * bars[0].o - entryFee;
  let peak = 3200;
  let maxDd = 0;
  bars.forEach((bar, index) => {
    const exitFee = index === bars.length - 1 ? ibkrFixedFee(qty, bar.c) : 0;
    const equity = cash + qty * bar.c - exitFee;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  });
  const last = bars[bars.length - 1];
  const total = qty * (last.c - bars[0].o) - entryFee - ibkrFixedFee(qty, last.c);
  return { totalUsd: round(total), mtmDdUsd: round(maxDd), ratio: maxDd > 0 ? round(total / maxDd) : null };
}

function judge(book: Book, spyRatio: number | null, z: number, q: number): {
  n: number;
  totalUsd: number;
  mtmDdUsd: number;
  ratio: number | null;
  profitFactor: number | null;
  maxConsecLosses: number;
  realized10Share: number | null;
  meanUsd: number | null;
  sdUsd: number | null;
  ciLow: number | null;
  nRequired: number | null;
  verdict: Verdict;
} {
  const pnls = (book.fills ?? []).map((fill) => fill.pnlUsd);
  const boot = bootstrapMean(pnls, q, z);
  const ratio = book.maxDrawdownUsd > 0 ? round(book.totalUsd / book.maxDrawdownUsd) : null;
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
    mtmDdUsd: book.maxDrawdownUsd,
    ratio,
    profitFactor: book.profitFactor,
    maxConsecLosses: book.maxConsecLosses,
    realized10Share: book.sessions > 0 ? round(book.daysRealized10 / book.sessions) : null,
    meanUsd: boot.mean == null ? null : round(boot.mean),
    sdUsd: boot.sd == null ? null : round(boot.sd),
    ciLow: boot.lower == null ? null : round(boot.lower),
    nRequired: boot.nRequired == null ? null : round(boot.nRequired),
    verdict,
  };
}

async function main() {
  console.log("wiki");
  const [sp500Html, histHtml, sp400Html] = await Promise.all([
    readText("https://en.wikipedia.org/api/rest_v1/page/html/List_of_S%26P_500_companies", path.join(WIKI, "sp500.html")),
    readText("https://en.wikipedia.org/api/rest_v1/page/html/Historical_components_of_the_S%26P_500", path.join(WIKI, "sp500-hist.html")),
    readText("https://en.wikipedia.org/api/rest_v1/page/html/List_of_S%26P_400_companies", path.join(WIKI, "sp400.html")),
  ]);
  const sp500 = listedFrom(table(sp500Html, "Symbol"));
  const sp400 = listedFrom(table(sp400Html, "Symbol"));
  const changes500 = pickChanges(histHtml);
  const changes400 = pickChanges(sp400Html);
  const gics = new Map(sp500.concat(sp400).map((row) => [row.ticker, row.sub]));
  const semiOf = (ticker: string) => isSemiSubIndustry(gics.get(ticker));
  const ever = new Set<string>([...sp500, ...sp400].map((row) => row.ticker));
  for (const change of [...changes500.changes, ...changes400.changes]) {
    if (change.added) ever.add(change.added);
    if (change.removed) ever.add(change.removed);
  }
  ever.add("SPY");
  console.log(`names ${ever.size - 1}`);
  const bars = new Map<string, Bar[]>();
  for (const ticker of ever) {
    const series = await ensureBars(ticker);
    if (series) bars.set(ticker, series);
  }
  const spyBars = bars.get("SPY");
  if (!spyBars?.length) throw new Error("SPYが無い");
  const lastBar = spyBars[spyBars.length - 1].date;
  const windows = WINDOWS.map((window) => ({ ...window, to: lastBar < window.to ? lastBar : window.to }));
  console.log("features");
  const feats = new Map<string, Feat[]>();
  for (const [ticker, series] of bars) feats.set(ticker, buildFeatures(series));
  const spy = feats.get("SPY") ?? [];
  const sessions = spy.map((bar) => bar.date);
  const market = marketByDate(spy, []);
  const spyRet = new Map(spy.map((bar) => [bar.date, bar.ret20]));
  const spyGapOk = new Map<string, boolean>();
  for (let i = 1; i < spy.length; i += 1) {
    const prior = spy[i - 1].c;
    spyGapOk.set(spy[i].date, prior > 0 && spy[i].o / prior - 1 >= -0.005);
  }
  const turns = monthTurnSessions(sessions);
  const closeOf = new Map<string, number>();
  const names: NameSeries[] = [];
  const adv = new Map<string, Map<string, number>>();
  for (const [ticker, series] of feats) {
    if (ticker === "SPY") continue;
    for (const bar of series) closeOf.set(`${ticker}|${bar.date}`, bar.c);
    adv.set(ticker, trailingAvgDollar(series, ADV_WINDOW));
    names.push({ ticker, sector: "", semi: semiOf(ticker), core: false, broad: true, feats: series, earnings: [] });
  }
  console.log(`edgar ${names.length}`);
  const edgar = loadEdgar(names.map((name) => name.ticker), sessions);
  console.log(`edgar missing ${edgar.missing.length} undated 2.02 ${edgar.undated}`);
  console.log("form345");
  const insiders = await loadInsiders(new Set(names.map((name) => name.ticker)));
  const signals = insiderFilingSignals(insiders.lots, sessions);
  console.log(`insider signals ${signals.length} last filing ${insiders.lastFiling}`);
  const signalsByTicker = new Map<string, string[]>();
  for (const signal of signals) {
    const list = signalsByTicker.get(signal.ticker) ?? [];
    list.push(signal.filingDate);
    signalsByTicker.set(signal.ticker, list);
  }

  const rows: Array<Record<string, unknown>> = [];
  const spyRows = windows.map((window) => ({ window: window.id, ...spyPath(spy, window.from, window.to), publishedUsd: PUBLISHED_SPY[window.id] }));
  const closes = new Map([...feats].map(([ticker, series]) => [ticker, new Map(series.map((bar) => [bar.date, bar.c]))]));
  const later: Array<{ id: string; label: string; universe: UniverseId; cands: Candidate[]; primed: "A1" | "A2"; window: WindowId; sessions: string[]; spyRatio: number | null }> = [];

  for (const window of windows) {
    const windowSessions = sessions.filter((date) => date >= window.from && date <= window.to);
    const member500 = membershipAsOf(sp500.map((row) => row.ticker), changes500.changes, window.asOf);
    const member400 = membershipAsOf(sp400.map((row) => row.ticker), changes400.changes, window.asOf);
    const pit = new Set([...member500, ...member400].filter((ticker) => feats.has(ticker)));
    const leaders = advLeaders(adv, windowSessions, 200);
    const bounds = { from: window.from, to: window.to };
    console.log(`window ${window.id} pit ${pit.size}`);
    const generated3: Candidate[] = [];
    const generated46: Candidate[] = [];
    const drift: Candidate[] = [];
    const gaps: Candidate[] = [];
    const insider: Candidate[] = [];
    for (const name of names) {
      const series = name.feats;
      generated3.push(...rangeCandidates(name, BOX3, market, sessions, bounds));
      generated46.push(...rangeCandidates(name, BOX46, market, sessions, bounds));
      drift.push(...driftCandidates(name.ticker, name.semi, series, edgar.reactions.get(name.ticker) ?? [], spyRet, bounds));
      const blocked = edgar.blocked.get(name.ticker) ?? new Set(sessions);
      gaps.push(...gapFillCandidates(name.ticker, name.semi, series, blocked, spyGapOk, spyRet, bounds));
      for (const filingDate of signalsByTicker.get(name.ticker) ?? []) {
        let signalIndex = -1;
        for (let i = series.length - 1; i >= 0; i -= 1) {
          if (series[i].date <= filingDate) {
            signalIndex = i;
            break;
          }
        }
        if (signalIndex < 0 || signalIndex + 1 >= series.length) continue;
        const sig = series[signalIndex];
        const atr = sig.atr;
        if (atr == null || !(atr > 0) || !(sig.c > 0) || !(sig.c < 550) || (atr / sig.c) * 100 < 3 || sig.low20 == null) continue;
        const plan = plannedExit(series, signalIndex, series[signalIndex + 1].o + atr, sig.low20, 20);
        const entryDate = plan ? series[plan.entryIndex].date : "";
        if (!plan || !(plan.entry < 550) || entryDate < window.from || entryDate > window.to) continue;
        if (!(entryDate > filingDate)) continue;
        const reactions = edgar.reactions.get(name.ticker) ?? [];
        if (entryBeforeEarnings(entryDate, reactions, sessions)) continue;
        const spy = spyRet.get(sig.date) ?? null;
        insider.push({
          ticker: name.ticker,
          sector: "",
          semi: name.semi,
          signalIndex,
          entryIndex: plan.entryIndex,
          exitIndex: plan.exitIndex,
          signalDate: sig.date,
          entryDate,
          exitDate: series[plan.exitIndex].date,
          entry: plan.entry,
          exit: plan.exit,
          atr,
          atrPct: (atr / sig.c) * 100,
          boxPct: sig.boxPct,
          rebound: sig.rebound,
          rs20: sig.ret20 == null || spy == null ? null : sig.ret20 - spy,
          qty10: 1,
          reason: plan.reason,
          exitTiming: plan.exitTiming,
          voided: false,
        });
      }
    }
    const s1base = priced(generated46, closeOf).filter((cand) => !entryBeforeEarnings(cand.entryDate, edgar.reactions.get(cand.ticker) ?? [], sessions));
    const box3 = priced(generated3, closeOf);
    const books: Array<{ id: string; label: string; universe: UniverseId; cands: Candidate[]; maxPositions?: number; maxSemi?: number; primed?: "A1" | "A2" }> = [
      { id: "A1", label: "決算反応日の翌日始値", universe: "pit", cands: priced(drift, closeOf).filter((cand) => pit.has(cand.ticker)) },
      { id: "A1", label: "決算反応日の翌日始値", universe: "adv", cands: priced(drift, closeOf).filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)) },
      { id: "A2", label: "材料なしのギャップ埋め", universe: "pit", cands: priced(gaps, closeOf).filter((cand) => pit.has(cand.ticker)) },
      { id: "A2", label: "材料なしのギャップ埋め", universe: "adv", cands: priced(gaps, closeOf).filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)) },
      { id: "S1", label: "箱・ATR4〜6%・決算の5日前まで見送り・半導体2", universe: "pit", cands: s1base.filter((cand) => pit.has(cand.ticker)), maxSemi: 2 },
      { id: "S1", label: "箱・ATR4〜6%・決算の5日前まで見送り・半導体2", universe: "adv", cands: s1base.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)), maxSemi: 2 },
      { id: "S2", label: "箱・ATR3%以上・同時3枠", universe: "pit", cands: box3.filter((cand) => pit.has(cand.ticker)), maxPositions: 3 },
      { id: "S2", label: "箱・ATR3%以上・同時3枠", universe: "adv", cands: box3.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)), maxPositions: 3 },
      { id: "N1", label: "インサイダーの市場買い", universe: "pit", cands: priced(insider, closeOf).filter((cand) => pit.has(cand.ticker)) },
      { id: "N1", label: "インサイダーの市場買い", universe: "adv", cands: priced(insider, closeOf).filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)) },
      { id: "B0", label: "参考・箱・ATR3%以上・枠5", universe: "pit", cands: box3.filter((cand) => pit.has(cand.ticker)) },
      { id: "B0", label: "参考・箱・ATR3%以上・枠5", universe: "adv", cands: box3.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)) },
    ];
    const spyRatio = spyRows.find((row) => row.window === window.id)?.ratio ?? null;
    const pricedDrift = priced(drift, closeOf);
    const pricedGaps = priced(gaps, closeOf);
    later.push(
      { id: "A1p", label: "決算反応日・月替わりを除く", universe: "pit", cands: dropMonthTurn(pricedDrift.filter((cand) => pit.has(cand.ticker)), turns), primed: "A1", window: window.id, sessions: windowSessions, spyRatio },
      { id: "A1p", label: "決算反応日・月替わりを除く", universe: "adv", cands: dropMonthTurn(pricedDrift.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)), turns), primed: "A1", window: window.id, sessions: windowSessions, spyRatio },
      { id: "A2p", label: "材料なしのギャップ埋め・月替わりを除く", universe: "pit", cands: dropMonthTurn(pricedGaps.filter((cand) => pit.has(cand.ticker)), turns), primed: "A2", window: window.id, sessions: windowSessions, spyRatio },
      { id: "A2p", label: "材料なしのギャップ埋め・月替わりを除く", universe: "adv", cands: dropMonthTurn(pricedGaps.filter((cand) => leaders.get(cand.signalDate)?.has(cand.ticker)), turns), primed: "A2", window: window.id, sessions: windowSessions, spyRatio },
    );
    for (const spec of books) {
      const book = runPortfolio(
        {
          id: `${spec.id}-${spec.universe}-${window.id}`,
          label: spec.label,
          universe: spec.universe,
          rank: "rs",
          sessions: windowSessions,
          flatten: true,
          withRestart: false,
          maxPositions: spec.maxPositions,
          maxSemi: spec.maxSemi,
          closes,
          orderFee: ibkrFixedFee,
          keepFills: true,
        },
        spec.cands,
      );
      const scored = judge(book, spyRatio, MAIN_Z, MAIN_Q);
      const verdict: Verdict = spec.id === "B0" ? "not-judged" : scored.verdict;
      rows.push({
        id: spec.id,
        universe: spec.universe,
        window: window.id,
        label: spec.label,
        judged: spec.id !== "B0",
        signals: spec.cands.length,
        ...scored,
        verdict,
      });
      console.log(`${window.id} ${spec.universe} ${spec.id} n ${book.n} pnl ${book.totalUsd} ${verdict}`);
    }
  }
  for (const spec of later) {
    const base = overallVerdict(rows.filter((row) => row.id === spec.primed && row.universe === spec.universe).map((row) => row.verdict as Verdict));
    const judged = base === "pass";
    const book = runPortfolio(
      {
        id: `${spec.id}-${spec.universe}-${spec.window}`,
        label: spec.label,
        universe: spec.universe,
        rank: "rs",
        sessions: spec.sessions,
        flatten: true,
        withRestart: false,
        closes,
        orderFee: ibkrFixedFee,
        keepFills: true,
      },
      spec.cands,
    );
    const scored = judge(book, spec.spyRatio, PRIMED_Z, PRIMED_Q);
    const verdict: Verdict = judged ? scored.verdict : "not-judged";
    rows.push({
      id: spec.id,
      universe: spec.universe,
      window: spec.window,
      label: spec.label,
      judged,
      signals: spec.cands.length,
      ...scored,
      verdict,
    });
    console.log(`${spec.window} ${spec.universe} ${spec.id} n ${book.n} pnl ${book.totalUsd} ${verdict}`);
  }

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.id}|${row.universe}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  const candidates = [...grouped.entries()].map(([key, list]) => {
    const [id, universe] = key.split("|");
    const verdicts = list.map((row) => row.verdict as Verdict);
    return { id, universe, label: list[0]?.label, verdict: overallVerdict(verdicts), windows: list };
  });
  const byId = new Map<string, Verdict[]>();
  for (const candidate of candidates) {
    if (candidate.id === "B0") continue;
    const list = byId.get(candidate.id) ?? [];
    list.push(candidate.verdict);
    byId.set(candidate.id, list);
  }
  const summary = [...byId.entries()].map(([id, verdicts]) => ({ id, verdict: overallVerdict(verdicts) }));
  const gaps = [
    "売買代金の上位200は、WikipediaのS&P500とS&P400の履歴にあって日足がある銘柄だけ。米国の全上場・上場廃止は未計算。",
    "GICSは現在の構成表だけ。表に無い銘柄は半導体ではない。",
    `8-K Item 2.02で受付時刻が無く、反応日にできなかった届出は ${edgar.undated} 件。その届出は反応日に使っていない。`,
    `提出ファイルが無い銘柄は材料なしギャップを取引していない: ${edgar.missing.length} 銘柄。`,
    insiders.missingQuarters.length ? `Form 345の四半期ZIPが無い: ${insiders.missingQuarters.join(", ")}。その期間の届出は入っていない。` : "依頼したForm 345の四半期ZIPは取得した。",
    insiders.lastFiling ? `Form 345の最終届出日は ${insiders.lastFiling}。それより後のインサイダー買いは未計算。` : "Form 345の届出日が取れなかった。",
    insiders.flagColumns.length ? `10b5-1の列を使った: ${insiders.flagColumns.join(", ")}。` : "Form 345の表に10b5-1のチェック列は無かった。脚注の10b5-1だけを除いた。",
    "週末の8-Kは、届出日が営業日と一致しないので、月曜を自動では塞いでいない。",
    "Novaは枠だけ残し、今回は走らせていない。",
  ];
  const report = {
    v: 1,
    prereg: "docs/ROUND2_PREREG.md",
    preregCommit: ROUND2_PREREG,
    generatedAt: new Date().toISOString(),
    windows: windows.map((window) => ({ id: window.id, from: window.from, to: window.to })),
    spy: spyRows,
    publishedAdv: PUBLISHED_ADV,
    gaps,
    summary,
    candidates,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log(`wrote ${OUT}`);
  console.log(summary.map((row) => `${row.id} ${row.verdict}`).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
