import { item202Dates } from "./robustness";

/**
 * Pure helpers for the survivorship study. Nothing here places an order or
 * changes the paper rules. Wikipedia text and filing blocks are inputs.
 */

export const OOS_FROM = "2022-10-03";
export const OOS_TO = "2024-10-02";
export const OOS_YEAR2 = "2023-10-03";
export const IN_FROM = "2024-10-03";
export const IN_TO = "2026-10-02";
export const SECTOR_TOP_N = 12;
export const ADV_TOP_N = 200;
export const ADV_WINDOW = 63;
export const BREADTH_WINDOW = 200;
export const REGIME_WINDOW = 60;
export const BELLWETHER_BEFORE = 3;
export const ETF_ATR_LOW = 1;
/** A fully-filtered earnings book is published only when at least this share of names has a date. */
export const FULL_EARNINGS_COVERAGE = 0.8;

export const SECTOR_ETFS = {
  "Information Technology": "XLK",
  Financials: "XLF",
  "Health Care": "XLV",
  Energy: "XLE",
  Industrials: "XLI",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  Utilities: "XLU",
  "Real Estate": "XLRE",
  "Communication Services": "XLC",
  Materials: "XLB",
} as const;

export const SECTOR_HOLDING_ETFS = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLU", "XLRE", "XLC", "XLB"] as const;

export const JAB_ETFS = ["IWM", "RSP", "MDY", "DIA", "XLF", "XLE", "XLV", "XLI", "XLK", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"] as const;

export const BENCHMARKS = ["IWM", "RSP", "MDY", "DIA", "XLF", "XLE", "XLV", "XLI", "XLK", "SPY", "QQQ", "SOXX"] as const;

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

export type RawCell = { text: string; rowspan: number; colspan: number };
export type WikiTable = { id: string | null; rows: RawCell[][] };
export type IndexChange = { date: string; added: string | null; removed: string | null; reason: string };
export type EndClass = "acquisition" | "bankruptcy" | "unknown";
export type EndEvent = { date: string; kind: "bankruptcy" | "acquisition" };
export type EndPenalty = {
  penalized: number;
  acquisitions: number;
  bankruptcies: number;
  unknown: number;
  n: number;
  totalUsd: number;
  profitFactor: number | null;
  /** True only when profit factor is strictly above 1. */
  profitable: boolean | null;
};
export type Listed = { ticker: string; sector: string | null; sub: string | null };
export type FilingBlock = {
  form?: string[];
  filingDate?: string[];
  items?: string[];
  primaryDocDescription?: string[];
};

export type SlimBook = {
  id: string;
  window: "oos" | "in";
  label: string;
  n: number | null;
  totalUsd: number | null;
  mtmDdUsd: number | null;
  realizedDdUsd: number | null;
  profitFactor: number | null;
  /** Acquisitions stay at the last close. Bankruptcies and unknown endings are repriced at a 50% loss. */
  headline: EndPenalty | null;
  /** Every data-truncated trade is repriced at a 100% loss. A stress test, not the headline. */
  stress: EndPenalty | null;
  note?: string;
};

export type BiasMath = {
  window: "oos" | "in";
  coreUsd: number | null;
  pitUsd: number | null;
  exSemiUsd: number | null;
  survivorship: number | null;
  semisTailwind: number | null;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " ", apos: "'" };

function decode(text: string): string {
  return text
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body: string) => {
      if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      return ENTITIES[body] ?? all;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "September 21, 2026" or "2026-09-21". Anything else is null and must not be guessed. */
export function parseWikiDate(text: string): string | null {
  const raw = text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return validIso(`${iso[1]}-${iso[2]}-${iso[3]}`);
  const named = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(raw);
  if (!named) return null;
  const month = MONTHS[named[1].toLowerCase()];
  if (!month) return null;
  return validIso(`${named[3]}-${month}-${named[2].padStart(2, "0")}`);
}

function validIso(date: string): string | null {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === date ? date : null;
}

/** Uppercase ticker, or null when the cell is a name, a dash, or a footnote. */
export function cleanTicker(text: string): string | null {
  const token = text.replace(/\[[^\]]*\]/g, "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,10}$/.test(token)) return null;
  return token;
}

export function wikiTables(html: string): WikiTable[] {
  const tables: WikiTable[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.toLowerCase().indexOf("<table", cursor);
    if (start < 0) break;
    const tagEnd = html.indexOf(">", start);
    if (tagEnd < 0) break;
    const open = html.slice(start, tagEnd + 1);
    if (!/\bwikitable\b/i.test(open)) {
      cursor = tagEnd + 1;
      continue;
    }
    const id = /\bid="([^"]*)"/i.exec(open)?.[1] ?? null;
    let depth = 1;
    let scan = tagEnd + 1;
    let end = -1;
    const lower = html.toLowerCase();
    while (scan < html.length && depth > 0) {
      const nextOpen = lower.indexOf("<table", scan);
      const nextClose = lower.indexOf("</table>", scan);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        scan = nextOpen + 6;
      } else {
        depth -= 1;
        scan = nextClose + 8;
        if (depth === 0) end = nextClose;
      }
    }
    if (end < 0) break;
    tables.push({ id, rows: parseRows(html.slice(tagEnd + 1, end)) });
    cursor = end + 8;
  }
  return tables;
}

function parseRows(tableHtml: string): RawCell[][] {
  const rows: RawCell[][] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableHtml))) {
    const cells: RawCell[] = [];
    const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[2];
      const rowspan = Math.max(1, Number(/\browspan="(\d+)"/i.exec(attrs)?.[1] ?? 1));
      const colspan = Math.max(1, Number(/\bcolspan="(\d+)"/i.exec(attrs)?.[1] ?? 1));
      cells.push({ text: decode(cellMatch[3]), rowspan, colspan });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/** Carry rowspan and colspan so a date on the first line applies to the rows under it. */
export function expandRowspan(rows: readonly RawCell[][]): string[][] {
  const carry: Array<{ text: string; left: number } | null> = [];
  const out: string[][] = [];
  for (const raw of rows) {
    const expanded: string[] = [];
    let col = 0;
    let index = 0;
    while (index < raw.length || (carry[col] != null && carry[col]!.left > 0)) {
      const pending = carry[col];
      if (pending && pending.left > 0) {
        expanded[col] = pending.text;
        pending.left -= 1;
        if (pending.left === 0) carry[col] = null;
        col += 1;
        continue;
      }
      if (index >= raw.length) break;
      const cell = raw[index];
      index += 1;
      const span = Math.max(1, cell.colspan);
      for (let slot = 0; slot < span; slot += 1) {
        expanded[col] = cell.text;
        if (cell.rowspan > 1) carry[col] = { text: cell.text, left: cell.rowspan - 1 };
        col += 1;
      }
    }
    out.push(expanded);
  }
  return out;
}

export function listedFrom(expanded: readonly string[][]): Listed[] {
  const headerIndex = expanded.findIndex((row) => row.includes("Symbol") && row.includes("GICS Sector"));
  if (headerIndex < 0) return [];
  const header = expanded[headerIndex];
  const symbolCol = header.indexOf("Symbol");
  const sectorCol = header.indexOf("GICS Sector");
  const subCol = header.indexOf("GICS Sub-Industry");
  const out: Listed[] = [];
  for (const row of expanded.slice(headerIndex + 1)) {
    const ticker = cleanTicker(row[symbolCol] ?? "");
    if (!ticker) continue;
    out.push({
      ticker,
      sector: row[sectorCol]?.trim() || null,
      sub: subCol >= 0 ? row[subCol]?.trim() || null : null,
    });
  }
  return out;
}

export function changesFrom(expanded: readonly string[][]): { changes: IndexChange[]; skippedDates: string[] } {
  const changes: IndexChange[] = [];
  const skippedDates: string[] = [];
  for (const row of expanded) {
    const rawDate = (row[0] ?? "").trim();
    const date = parseWikiDate(rawDate);
    if (!date) {
      if (/\d{4}/.test(rawDate) && !/ticker|date|effective/i.test(rawDate)) skippedDates.push(rawDate);
      continue;
    }
    const added = cleanTicker(row[1] ?? "");
    const removed = cleanTicker(row[3] ?? "");
    if (!added && !removed) continue;
    const reason = (row[5] ?? "").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
    changes.push({ date, added, removed, reason });
  }
  return { changes, skippedDates };
}

/**
 * Current members, with every change dated after `asOf` undone.
 * A change on `asOf` stays in effect. Same-day rows keep their incoming order.
 */
export function membershipAsOf(current: readonly string[], changes: readonly IndexChange[], asOf: string): string[] {
  const set = new Set(current);
  const future = changes.filter((change) => change.date > asOf);
  future.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const change of future) {
    if (change.added) set.delete(change.added);
    if (change.removed) set.add(change.removed);
  }
  return [...set].sort();
}

const BANKRUPT_RE = /bankrupt|chapter\s*11|chapter\s*7|liquidat/i;
const ACQUIRE_RE = /\bacquired\b|\bacquisition\b|\bmerger\b|\bmerged\b/i;

export const NOTE_WINDOW_DAYS = 30;
export const FILING_BEFORE_DAYS = 15;
export const FILING_AFTER_DAYS = 30;

export function shiftDate(iso: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** A removal note names an acquisition or a bankruptcy. Index moves and bare delistings do not. */
export function classifyEndNote(reason: string): Exclude<EndClass, "unknown"> | null {
  const text = reason.replace(/\[[^\]]*\]/g, " ");
  if (BANKRUPT_RE.test(text)) return "bankruptcy";
  if (ACQUIRE_RE.test(text)) return "acquisition";
  return null;
}

export function endEventsFrom(blocks: readonly FilingBlock[]): EndEvent[] {
  const out: EndEvent[] = [];
  for (const block of blocks) {
    const forms = block.form ?? [];
    const dates = block.filingDate ?? [];
    const items = block.items ?? [];
    const descriptions = block.primaryDocDescription ?? [];
    const n = Math.min(forms.length, dates.length);
    for (let i = 0; i < n; i += 1) {
      if (!dates[i]) continue;
      const parts = (items[i] ?? "").split(",").map((part) => part.trim());
      const blob = `${forms[i] ?? ""} ${descriptions[i] ?? ""}`;
      if (parts.includes("1.03") || BANKRUPT_RE.test(blob)) {
        out.push({ date: dates[i], kind: "bankruptcy" });
        continue;
      }
      if (parts.includes("2.01")) out.push({ date: dates[i], kind: "acquisition" });
    }
  }
  return out;
}

/** Use a Wikipedia reason only when its effective date is near the last bar. */
export function noteEndClass(
  notes: readonly { date: string; reason: string }[],
  lastBar: string,
  windowDays = NOTE_WINDOW_DAYS,
): Exclude<EndClass, "unknown"> | null {
  const from = shiftDate(lastBar, -windowDays);
  const to = shiftDate(lastBar, windowDays);
  if (!from || !to) return null;
  let acquisition = false;
  for (const note of notes) {
    if (note.date < from || note.date > to) continue;
    const kind = classifyEndNote(note.reason);
    if (kind === "bankruptcy") return "bankruptcy";
    if (kind === "acquisition") acquisition = true;
  }
  return acquisition ? "acquisition" : null;
}

/** 8-K Item 2.01 counts only near the last bar. Item 1.03 is bankruptcy. */
export function filingEndClass(
  events: readonly EndEvent[],
  lastBar: string,
  beforeDays = FILING_BEFORE_DAYS,
  afterDays = FILING_AFTER_DAYS,
): Exclude<EndClass, "unknown"> | null {
  const from = shiftDate(lastBar, -beforeDays);
  const to = shiftDate(lastBar, afterDays);
  if (!from || !to) return null;
  let acquisition = false;
  for (const event of events) {
    if (event.date < from || event.date > to) continue;
    if (event.kind === "bankruptcy") return "bankruptcy";
    if (event.kind === "acquisition") acquisition = true;
  }
  return acquisition ? "acquisition" : null;
}

export function resolveEndClass(note: EndClass | null, filing: EndClass | null): EndClass {
  if (note === "bankruptcy" || filing === "bankruptcy") return "bankruptcy";
  if (note === "acquisition" || filing === "acquisition") return "acquisition";
  return "unknown";
}

/** The series stopped before the window ended and the rule had not exited yet. */
export function dataEndedMidTrade(exitDate: string, reason: string, lastBar: string | undefined, windowEnd: string): boolean {
  if (!lastBar || !(lastBar < windowEnd)) return false;
  return reason === "window" && exitDate >= lastBar;
}

/** Exit price after a loss of `fraction` of the entry. 1 is a total loss. */
export function lossExit(entry: number, fraction: number): number {
  if (!(entry > 0)) return entry;
  const kept = Math.min(1, Math.max(0, 1 - fraction));
  return entry * kept;
}

export function staysProfitable(profitFactor: number | null, n: number): boolean | null {
  if (n <= 0 || profitFactor == null) return null;
  return profitFactor > 1;
}

export function isSemiSubIndustry(sub: string | null | undefined): boolean {
  return sub != null && /semiconductor/i.test(sub);
}

/** SOXX for a semiconductor sub-industry. Null when GICS is missing. */
export function sectorEtf(sector: string | null | undefined, semi: boolean): string | null {
  if (semi) return "SOXX";
  if (!sector) return null;
  return SECTOR_ETFS[sector as keyof typeof SECTOR_ETFS] ?? null;
}

export function classifyExcess(stock: number | null | undefined, bench: number | null | undefined): "out" | "under" | "unclassified" {
  if (stock == null || bench == null) return "unclassified";
  const diff = stock - bench;
  if (diff > 0) return "out";
  if (diff < 0) return "under";
  return "unclassified";
}

export function classifySign(value: number | null | undefined): "negative" | "positive" | "unclassified" {
  if (value == null || value === 0) return "unclassified";
  return value < 0 ? "negative" : "positive";
}

export function breadthSide(ratio: number | null | undefined, sma: number | null | undefined): "above" | "below" | "unclassified" {
  if (ratio == null || sma == null || ratio === sma) return "unclassified";
  return ratio > sma ? "above" : "below";
}

export function aboveMovingAverage(close: number | null | undefined, ma: number | null | undefined): boolean | null {
  if (close == null || ma == null) return null;
  return close > ma;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Survivorship is the current book minus the point-in-time book. Tailwind is point-in-time minus point-in-time ex-semis. */
export function biasGap(core: number | null, pit: number | null, exSemi: number | null): Pick<BiasMath, "survivorship" | "semisTailwind"> {
  return {
    survivorship: core == null || pit == null ? null : round2(core - pit),
    semisTailwind: pit == null || exSemi == null ? null : round2(pit - exSemi),
  };
}

/** Sessions from the signal to the event. A non-session event maps to the next session. Positive means the event is later. */
export function sessionsAhead(sessions: readonly string[], signalDate: string, eventDate: string): number | null {
  const signal = sessions.indexOf(signalDate);
  if (signal < 0) return null;
  let event = sessions.indexOf(eventDate);
  if (event < 0) {
    event = sessions.findIndex((date) => date >= eventDate);
    if (event < 0) return null;
  }
  return event - signal;
}

/** True when a bellwether report falls 1 to `max` trading sessions after the signal. The report day itself is not "before". */
export function withinSessionsBefore(
  sessions: readonly string[],
  signalDate: string,
  dates: readonly string[],
  min = 1,
  max = BELLWETHER_BEFORE,
): boolean {
  for (const date of dates) {
    const ahead = sessionsAhead(sessions, signalDate, date);
    if (ahead != null && ahead >= min && ahead <= max) return true;
  }
  return false;
}

export function topTickersByDollar(rows: readonly { ticker: string; dollar: number | null }[], n: number): string[] {
  return rows
    .filter((row): row is { ticker: string; dollar: number } => row.dollar != null && row.dollar > 0)
    .sort((a, b) => b.dollar - a.dollar || a.ticker.localeCompare(b.ticker))
    .slice(0, n)
    .map((row) => row.ticker);
}

/** Average of close×volume over `window` sessions ending on each date. Earlier dates are absent. */
export function trailingAvgDollar(bars: readonly { date: string; c: number; v: number }[], window = ADV_WINDOW): Map<string, number> {
  const out = new Map<string, number>();
  if (window < 1) return out;
  let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars[i].c * bars[i].v;
    if (i >= window) sum -= bars[i - window].c * bars[i - window].v;
    if (i >= window - 1) out.set(bars[i].date, sum / window);
  }
  return out;
}

/** Latest average on or before `asOf`. */
export function dollarAsOf(series: ReadonlyMap<string, number>, asOf: string): number | null {
  if (series.has(asOf)) return series.get(asOf) ?? null;
  let best: string | null = null;
  for (const date of series.keys()) {
    if (date <= asOf && (best == null || date > best)) best = date;
  }
  return best == null ? null : (series.get(best) ?? null);
}

export function advLeaders(
  series: ReadonlyMap<string, ReadonlyMap<string, number>>,
  dates: readonly string[],
  n = ADV_TOP_N,
): Map<string, Set<string>> {
  const tickers = [...series.keys()];
  const out = new Map<string, Set<string>>();
  for (const date of dates) {
    const rows = tickers.map((ticker) => ({ ticker, dollar: series.get(ticker)?.get(date) ?? null }));
    out.set(date, new Set(topTickersByDollar(rows, n)));
  }
  return out;
}

export function ratioSma(
  left: readonly { date: string; c: number }[],
  right: readonly { date: string; c: number }[],
  window = BREADTH_WINDOW,
): Map<string, { ratio: number; sma: number | null }> {
  const rightClose = new Map(right.map((bar) => [bar.date, bar.c]));
  const paired: Array<{ date: string; ratio: number }> = [];
  for (const bar of left) {
    const other = rightClose.get(bar.date);
    if (other == null || !(bar.c > 0)) continue;
    paired.push({ date: bar.date, ratio: other / bar.c });
  }
  const out = new Map<string, { ratio: number; sma: number | null }>();
  let sum = 0;
  for (let i = 0; i < paired.length; i += 1) {
    sum += paired[i].ratio;
    if (i >= window) sum -= paired[i - window].ratio;
    out.set(paired[i].date, { ratio: paired[i].ratio, sma: i >= window - 1 ? sum / window : null });
  }
  return out;
}

/** 6-K / 6-K/A whose description identifies an earnings release. A generic foreign-issuer report does not count. */
export const FOREIGN_EARNINGS_RE = /earnings|financial results|results of operations|quarterly results|annual results/i;

export function foreignEarningsDates(
  form: readonly string[],
  filingDate: readonly string[],
  description: readonly string[],
): string[] {
  const out: string[] = [];
  const n = Math.min(form.length, filingDate.length, description.length);
  for (let i = 0; i < n; i += 1) {
    if (form[i] !== "6-K" && form[i] !== "6-K/A") continue;
    if (!FOREIGN_EARNINGS_RE.test(description[i] ?? "")) continue;
    if (filingDate[i]) out.push(filingDate[i]);
  }
  return out;
}

export type RandomRow = {
  window: "oos" | "in";
  trials: number | null;
  mean: number | null;
  p50: number | null;
  p05: number | null;
  p95: number | null;
  ruleUsd: number | null;
  percentile: number | null;
  note?: string;
};

export type SectorRow = {
  window: "oos" | "in";
  etf: string;
  names: string[];
  holdings: number;
  withAdv: number;
  n: number | null;
  totalUsd: number | null;
  mtmDdUsd: number | null;
  realizedDdUsd: number | null;
  profitFactor: number | null;
  headline: EndPenalty | null;
  stress: EndPenalty | null;
};

export type BellWindow = {
  window: "oos" | "in";
  span: { n: number; totalUsd: number; avgUsd: number | null } | null;
  clear: { n: number; totalUsd: number; avgUsd: number | null } | null;
  semiTrades: number | null;
  base: { n: number; totalUsd: number; mtmDdUsd: number } | null;
  avoid: { n: number; totalUsd: number; mtmDdUsd: number } | null;
};

export type BiasReport = {
  v: 1;
  generatedAt: string;
  rules: string;
  windows: { oos: { from: string; to: string }; in: { from: string; to: string } };
  gaps: string[];
  benchmarks: SlimBook[];
  bestBenchmark: Array<{ window: "oos" | "in"; id: string; totalUsd: number }>;
  books: SlimBook[];
  sectors: SectorRow[];
  random: RandomRow[];
  bias: BiasMath[];
  bellwether: { dates: Record<string, string[]>; missing: string[]; note: string; byWindow: BellWindow[] };
  coverage: Array<{ window: "oos" | "in"; names: number; withDate: number; filings: number }>;
  universe: Array<{
    asOf: string;
    sp500: number;
    sp400: number;
    union: number;
    overlap: number;
    withBars: number;
    noBars: number;
    unknownGics: number;
    knownSemis: number;
  }>;
};

export function earningsDatesFrom(blocks: readonly FilingBlock[]): { item202: string[]; foreign6k: string[] } {
  const item202 = new Set<string>();
  const foreign6k = new Set<string>();
  for (const block of blocks) {
    for (const date of item202Dates(block.form ?? [], block.filingDate ?? [], block.items ?? [])) item202.add(date);
    for (const date of foreignEarningsDates(block.form ?? [], block.filingDate ?? [], block.primaryDocDescription ?? [])) foreign6k.add(date);
  }
  return { item202: [...item202].sort(), foreign6k: [...foreign6k].sort() };
}
