import fs from "node:fs";
import path from "node:path";
import { EPS_CACHE_TTL_MS } from "./constants";
import { EdgarDisabledError, edgarJson } from "./edgar-client";

export type TtmIncome = {
  ttmNetIncome: number;
  source: string;
};

type FactPoint = { end: string; val: number; fp?: string; fy?: number; form?: string };

const CACHE_PATH = path.join(process.cwd(), "data", ".cache", "companyfacts.json");

type CacheBody = {
  v: 1;
  quotes: Record<
    string,
    {
      ttmNetIncome: number | null;
      source: string | null;
      error: string | null;
      fetchedAt: number;
    }
  >;
};

let cikMap: Record<string, number> | null = null;

function loadCiks(): Record<string, number> {
  if (cikMap) return cikMap;
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "sec_cik.json"), "utf8")) as {
    ciks: Record<string, number>;
  };
  cikMap = raw.ciks;
  return cikMap;
}

export function cikForTicker(ticker: string): number | null {
  const key = ticker.trim().toUpperCase();
  const map = loadCiks();
  const cik = map[key];
  return typeof cik === "number" && cik > 0 ? cik : null;
}

export function companyFactsUrl(cik: number): string {
  const padded = String(cik).padStart(10, "0");
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`;
}

function readCache(): CacheBody {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CacheBody;
    if (raw?.v === 1 && raw.quotes) return raw;
  } catch {
    /* empty */
  }
  return { v: 1, quotes: {} };
}

function writeCache(body: CacheBody) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(body));
}

export function cachedTtmIncome(ticker: string, now = Date.now()): TtmIncome | null {
  const entry = readCache().quotes[ticker.trim().toUpperCase()];
  if (!entry || entry.ttmNetIncome == null || !entry.source) return null;
  if (now - entry.fetchedAt > EPS_CACHE_TTL_MS) return null;
  return { ttmNetIncome: entry.ttmNetIncome, source: entry.source };
}

/** Sum the last four quarterly NetIncomeLoss points, else the latest annual 10-K / 20-F / 40-F. */
export function parseCompanyFactsTtm(json: unknown): TtmIncome | null {
  if (!json || typeof json !== "object" || !("facts" in json)) return null;
  const facts = (json as { facts: Record<string, Record<string, { units?: Record<string, FactPoint[]> }>> }).facts;
  const taxonomies = [
    { ns: "us-gaap", tag: "NetIncomeLoss", source: "edgar:us-gaap:NetIncomeLoss" },
    { ns: "us-gaap", tag: "NetIncomeLossAvailableToCommonStockholdersBasic", source: "edgar:us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic" },
    { ns: "ifrs-full", tag: "ProfitLoss", source: "edgar:ifrs-full:ProfitLoss" },
  ];
  for (const { ns, tag, source } of taxonomies) {
    const block = facts[ns]?.[tag]?.units?.USD;
    if (!block || !Array.isArray(block)) continue;
    const quarterly = ttmFromQuarters(block);
    if (quarterly != null) return { ttmNetIncome: quarterly, source: `${source}:ttm4q` };
    const annual = latestAnnual(block);
    if (annual != null) return { ttmNetIncome: annual, source: `${source}:annual` };
  }
  return null;
}

function ttmFromQuarters(points: FactPoint[]): number | null {
  const quarterly = points
    .filter((p) => p.fp && /^Q[1-4]$/i.test(p.fp) && p.form !== "10-K" && p.form !== "20-F" && p.form !== "40-F")
    .sort((a, b) => b.end.localeCompare(a.end));
  const seen = new Set<string>();
  const uniq: FactPoint[] = [];
  for (const point of quarterly) {
    if (seen.has(point.end)) continue;
    seen.add(point.end);
    uniq.push(point);
    if (uniq.length >= 4) break;
  }
  if (uniq.length < 4) return null;
  const sum = uniq.reduce((total, point) => total + point.val, 0);
  return Number.isFinite(sum) ? sum : null;
}

function latestAnnual(points: FactPoint[]): number | null {
  const annual = points
    .filter((p) => p.fp === "FY" || p.form === "10-K" || p.form === "20-F" || p.form === "40-F")
    .sort((a, b) => b.end.localeCompare(a.end));
  const val = annual[0]?.val;
  return val != null && Number.isFinite(val) ? val : null;
}

export async function fetchTtmIncomeForTicker(ticker: string, now = Date.now()): Promise<TtmIncome | null> {
  const key = ticker.trim().toUpperCase();
  const cached = readCache().quotes[key];
  if (cached && now - cached.fetchedAt < EPS_CACHE_TTL_MS && cached.ttmNetIncome != null) {
    return { ttmNetIncome: cached.ttmNetIncome, source: cached.source ?? "edgar:cache" };
  }
  const cik = cikForTicker(key);
  if (!cik) return null;
  try {
    const json = await edgarJson<unknown>(companyFactsUrl(cik));
    const parsed = parseCompanyFactsTtm(json);
    const cache = readCache();
    cache.quotes[key] = {
      ttmNetIncome: parsed?.ttmNetIncome ?? null,
      source: parsed?.source ?? null,
      error: parsed ? null : "companyfactsにTTMが無い",
      fetchedAt: now,
    };
    writeCache(cache);
    return parsed;
  } catch (error) {
    if (error instanceof EdgarDisabledError) return null;
    const cache = readCache();
    cache.quotes[key] = {
      ttmNetIncome: null,
      source: null,
      error: error instanceof Error ? error.message.slice(0, 120) : "companyfacts失敗",
      fetchedAt: now,
    };
    writeCache(cache);
    return null;
  }
}
