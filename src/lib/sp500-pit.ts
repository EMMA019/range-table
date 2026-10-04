import fs from "node:fs";
import path from "node:path";

/** Membership intervals from fja05680/sp500 `sp500_ticker_start_end.csv`. */
export type Sp500Interval = { ticker: string; startDate: string; endDate: string | null };

export type Sp500Gics = {
  ticker: string;
  security: string;
  sector: string;
  subIndustry: string;
  cik: number | null;
};

const PIT_URL =
  "https://raw.githubusercontent.com/fja05680/sp500/master/sp500_ticker_start_end.csv";
const GICS_URL = "https://raw.githubusercontent.com/fja05680/sp500/master/sp500.csv";

export function parseTickerStartEndCsv(text: string): Sp500Interval[] {
  const lines = text.trim().split(/\r?\n/);
  const out: Sp500Interval[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const [ticker, startDate, endDate] = lines[i].split(",");
    if (!ticker || !startDate) continue;
    out.push({
      ticker: ticker.trim().toUpperCase(),
      startDate: startDate.trim(),
      endDate: endDate?.trim() ? endDate.trim() : null,
    });
  }
  return out;
}

/** Parse one CSV record line with quoted fields (RFC-style). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function parseSp500GicsCsv(text: string): Map<string, Sp500Gics> {
  const lines = text.trim().split(/\r?\n/);
  const out = new Map<string, Sp500Gics>();
  for (let i = 1; i < lines.length; i += 1) {
    const parts = parseCsvLine(lines[i]);
    if (parts.length < 4) continue;
    const ticker = parts[0].trim().toUpperCase();
    const security = parts[1]?.trim() ?? "";
    const sector = parts[2]?.trim() ?? "";
    const subIndustry = parts[3]?.trim() ?? "";
    const cikRaw = parts[6]?.trim();
    const cik = cikRaw && /^\d+$/.test(cikRaw) ? Number(cikRaw) : null;
    out.set(ticker, { ticker, security, sector, subIndustry, cik });
  }
  return out;
}

export function buildMembershipIndex(intervals: Sp500Interval[]): Map<string, Sp500Interval[]> {
  const by = new Map<string, Sp500Interval[]>();
  for (const row of intervals) {
    const list = by.get(row.ticker) ?? [];
    list.push(row);
    by.set(row.ticker, list);
  }
  return by;
}

/** True if ticker was in the S&P 500 on `date` (YYYY-MM-DD). */
export function isSp500MemberOnDate(intervals: Sp500Interval[], date: string): boolean {
  for (const row of intervals) {
    if (row.startDate > date) continue;
    if (row.endDate && row.endDate < date) continue;
    return true;
  }
  return false;
}

export function membersOnDate(all: Sp500Interval[], date: string): string[] {
  const byTicker = buildMembershipIndex(all);
  const out: string[] = [];
  for (const [ticker, intervals] of byTicker) {
    if (isSp500MemberOnDate(intervals, date)) out.push(ticker);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export function uniqueTickersInRange(all: Sp500Interval[], from: string, to: string): string[] {
  const set = new Set<string>();
  for (const row of all) {
    if (row.startDate > to) continue;
    if (row.endDate && row.endDate < from) continue;
    set.add(row.ticker);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function loadSp500PitFiles(cacheDir: string): Promise<{ intervals: Sp500Interval[]; gics: Map<string, Sp500Gics> }> {
  fs.mkdirSync(cacheDir, { recursive: true });
  const pitPath = path.join(cacheDir, "sp500_ticker_start_end.csv");
  const gicsPath = path.join(cacheDir, "sp500.csv");
  if (!fs.existsSync(pitPath)) {
    const res = await fetch(PIT_URL);
    if (!res.ok) throw new Error(`sp500 PIT download failed: ${res.status}`);
    fs.writeFileSync(pitPath, await res.text());
  }
  if (!fs.existsSync(gicsPath)) {
    const res = await fetch(GICS_URL);
    if (!res.ok) throw new Error(`sp500 GICS download failed: ${res.status}`);
    fs.writeFileSync(gicsPath, await res.text());
  }
  return {
    intervals: parseTickerStartEndCsv(fs.readFileSync(pitPath, "utf8")),
    gics: parseSp500GicsCsv(fs.readFileSync(gicsPath, "utf8")),
  };
}
