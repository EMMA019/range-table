import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { pitPriceTicker } from "./pit-dataset";
import { forwardShareMultiplier, loadPitSplits, type PitSplit } from "./pit-splits";
import { parseChart, type YahooSplit } from "./yahoo";

const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type YahooRefException = { ticker: string; reason: string; until?: string };

export function loadMcapRefExceptions(filePath: string): YahooRefException[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as { exceptions?: YahooRefException[] };
    return raw.exceptions ?? [];
  } catch {
    return [];
  }
}

function isExcepted(ticker: string, asOf: string, list: YahooRefException[]): boolean {
  const key = ticker.trim().toUpperCase();
  return list.some((e) => {
    if (e.ticker.trim().toUpperCase() !== key) return false;
    if (e.until && asOf > e.until) return false;
    return true;
  });
}

function chartPeriodUrl(symbol: string, period1: number, period2: number): string {
  return `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}&events=split&includePrePost=false`;
}

async function fetchChartPeriod(symbol: string, period1: number, period2: number): Promise<unknown> {
  let last: Error | null = null;
  for (const host of HOSTS) {
    try {
      const json = await new Promise<unknown>((resolve, reject) => {
        const req = https.request(
          {
            hostname: new URL(host).hostname,
            path: chartPeriodUrl(symbol, period1, period2),
            method: "GET",
            headers: { "User-Agent": UA, Accept: "application/json" },
            timeout: 20_000,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
              if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
              }
              try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
              } catch (e) {
                reject(e);
              }
            });
          },
        );
        req.on("error", reject);
        req.end();
      });
      const chart = json as { chart?: { result?: unknown[] } };
      const result = chart.chart?.result?.[0];
      if (!result) throw new Error("empty chart");
      return result;
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw last ?? new Error("chart fetch failed");
}

async function fetchSharesOutstanding(symbol: string): Promise<number | null> {
  for (const host of HOSTS) {
    try {
      const url = `${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics`;
      const body = await new Promise<string>((resolve, reject) => {
        const req = https.request(
          url,
          { headers: { "User-Agent": UA, Accept: "application/json" }, timeout: 15_000 },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          },
        );
        req.on("error", reject);
        req.end();
      });
      const json = JSON.parse(body) as {
        quoteSummary?: { result?: Array<{ defaultKeyStatistics?: { sharesOutstanding?: { raw?: number } } }> };
      };
      const raw = json.quoteSummary?.result?.[0]?.defaultKeyStatistics?.sharesOutstanding?.raw;
      return typeof raw === "number" && raw > 0 ? raw : null;
    } catch {
      /* try next host */
    }
  }
  return null;
}

function closeOnOrBefore(bars: Array<{ date: string; c: number }>, asOf: string): number | null {
  let best: number | null = null;
  for (const b of bars) {
    if (b.date <= asOf && b.c > 0) best = b.c;
  }
  return best;
}

/** Yahoo nominal close × split-adjusted sharesOutstanding (independent of PIT EDGAR). */
export async function referenceMcapFromYahoo(
  ticker: string,
  asOf: string,
  pitRoot?: string,
): Promise<number | null> {
  const symbol = pitPriceTicker(ticker);
  const t0 = Date.parse(`${asOf}T12:00:00Z`) / 1000 - 45 * 86_400;
  const t1 = Date.parse(`${asOf}T12:00:00Z`) / 1000 + 2 * 86_400;
  const result = await fetchChartPeriod(symbol, Math.floor(t0), Math.floor(t1));
  const { bars } = parseChart(result as Parameters<typeof parseChart>[0], t1, 120, {
    applySplitAdjustment: false,
  });
  const px = closeOnOrBefore(bars, asOf);
  if (px == null) return null;
  const shNow = await fetchSharesOutstanding(symbol);
  if (shNow == null) return null;
  const splits = loadPitSplits(ticker, pitRoot);
  const shAsOf = shNow / forwardShareMultiplier(splits, asOf, "2099-12-31");
  return px * shAsOf;
}

export function logMcapRatio(pit: number, ref: number): number {
  if (!(pit > 0) || !(ref > 0)) return Number.NaN;
  return Math.log(pit / ref);
}

export function mcapRefWithinBand(pit: number, ref: number, maxAbsLog = 0.28): boolean {
  const lr = logMcapRatio(pit, ref);
  return Number.isFinite(lr) && Math.abs(lr) <= maxAbsLog;
}

export { isExcepted };
