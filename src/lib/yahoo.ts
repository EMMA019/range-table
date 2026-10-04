import https from "node:https";
import { sessionDate } from "./calendar";
import { CHART_SESSIONS, FETCH_CONCURRENCY } from "./constants";
import { yahooGate } from "./rate-gate";
import type { Bar } from "./types";

const HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const chartAgent = new https.Agent({
  keepAlive: true,
  maxSockets: FETCH_CONCURRENCY,
  maxFreeSockets: 1,
});

type YahooSplit = {
  date?: number;
  numerator?: number;
  denominator?: number;
};

type YahooResult = {
  meta?: {
    regularMarketTime?: number;
    currentTradingPeriod?: { regular?: { start?: number; end?: number } };
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
  };
  events?: { splits?: Record<string, YahooSplit> };
};

export type ParsedSeries = {
  bars: Bar[];
  droppedPartial: boolean;
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Yahoo's chart `quote` series is often already split-adjusted, while `events.splits`
 * is still present. Adjust only when the close actually jumps by about the split ratio.
 */
export function splitNeedsAdjust(
  bars: Array<Bar & { t: number }>,
  split: { date: number; numerator: number; denominator: number },
): boolean {
  const before = [...bars].reverse().find((bar) => bar.t < split.date);
  const after = bars.find((bar) => bar.t >= split.date);
  if (!before || !after || !(before.c > 0) || !(after.c > 0)) return false;
  const jump = after.c / before.c;
  const expectedIfRaw = split.denominator / split.numerator;
  if (!(expectedIfRaw > 0) || !(jump > 0)) return false;
  const distRaw = Math.abs(Math.log(jump) - Math.log(expectedIfRaw));
  const distAdjusted = Math.abs(Math.log(jump));
  return distRaw + 0.15 < distAdjusted;
}

export function applySplits(
  bars: Array<Bar & { t: number }>,
  splits: YahooSplit[],
): Array<Bar & { t: number }> {
  const usable = splits.filter(
    (split): split is { date: number; numerator: number; denominator: number } =>
      typeof split.date === "number" &&
      typeof split.numerator === "number" &&
      typeof split.denominator === "number" &&
      split.numerator > 0 &&
      split.denominator > 0 &&
      splitNeedsAdjust(bars, {
        date: split.date,
        numerator: split.numerator,
        denominator: split.denominator,
      }),
  );
  if (usable.length === 0) return bars;

  return bars.map((bar) => {
    let factor = 1;
    for (const split of usable) {
      if (bar.t < split.date) factor *= split.denominator / split.numerator;
    }
    if (factor === 1) return bar;
    return {
      ...bar,
      o: bar.o * factor,
      h: bar.h * factor,
      l: bar.l * factor,
      c: bar.c * factor,
      v: bar.v / factor,
    };
  });
}

/**
 * Drop the in-progress daily bar. Yahoo's currentTradingPeriod is the session
 * that is open now, or the next one when the market is closed.
 */
export function dropPartialBar(
  bars: Array<Bar & { t: number }>,
  meta: YahooResult["meta"],
  nowSec: number,
): { bars: Array<Bar & { t: number }>; dropped: boolean } {
  if (bars.length === 0) return { bars, dropped: false };
  const end = meta?.currentTradingPeriod?.regular?.end;
  const start = meta?.currentTradingPeriod?.regular?.start;
  if (typeof end !== "number" || typeof start !== "number") {
    return { bars, dropped: false };
  }
  if (nowSec >= end + 90) return { bars, dropped: false };
  const last = bars[bars.length - 1];
  const session = sessionDate(start);
  const today = sessionDate(nowSec);
  if (last.date === session || last.date === today) {
    return { bars: bars.slice(0, -1), dropped: true };
  }
  return { bars, dropped: false };
}

export type ParseChartOptions = {
  /** Use Yahoo adjclose (split + dividend adjusted) for bar close; skips manual split adjustment. */
  useTotalReturn?: boolean;
};

export function parseChart(
  result: YahooResult,
  nowSec = Date.now() / 1000,
  keep = CHART_SESSIONS,
  options: ParseChartOptions = {},
): ParsedSeries {
  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0];
  const adjSeries = options.useTotalReturn ? result.indicators?.adjclose?.[0]?.adjclose : undefined;
  if (!timestamps || !quote) {
    throw new Error("日足が空");
  }

  const raw: Array<Bar & { t: number }> = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    let c = quote.close?.[i];
    const adjC = adjSeries?.[i];
    if (options.useTotalReturn && adjC != null && Number.isFinite(adjC)) {
      c = adjC;
    }
    const v = quote.volume?.[i];
    if (
      o == null ||
      h == null ||
      l == null ||
      c == null ||
      v == null ||
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c) ||
      !Number.isFinite(v)
    ) {
      continue;
    }
    const t = timestamps[i];
    raw.push({ t, date: sessionDate(t), o, h, l, c, v });
  }

  raw.sort((a, b) => a.t - b.t);

  const splits = Object.values(result.events?.splits ?? {});
  const adjusted = options.useTotalReturn ? raw : applySplits(raw, splits);
  const { bars: completed, dropped } = dropPartialBar(adjusted, result.meta, nowSec);

  const byDate = new Map<string, Bar>();
  for (const bar of completed) {
    byDate.set(bar.date, {
      date: bar.date,
      o: round4(bar.o),
      h: round4(bar.h),
      l: round4(bar.l),
      c: round4(bar.c),
      v: Math.round(bar.v),
    });
  }

  const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (bars.length === 0) throw new Error("確定日足が0本");
  const kept = bars.length > keep ? bars.slice(-keep) : bars;
  return { bars: kept, droppedPartial: dropped };
}

function fetchHost(
  host: string,
  symbol: string,
  range: string,
  maxBytes: number,
  useTotalReturn = false,
): Promise<YahooResult> {
  const events = useTotalReturn ? "div,split" : "split";
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}&events=${events}&includePrePost=false`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: new URL(host).hostname,
        path,
        method: "GET",
        headers: { "User-Agent": UA, Accept: "application/json" },
        agent: chartAgent,
        timeout: 15_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let received = 0;
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          res.destroy();
          reject(error);
        };
        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          received += chunk.length;
          if (received > maxBytes) {
            fail(new Error("日足が大きすぎる"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status}`));
            return;
          }
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              chart?: { result?: Array<YahooResult | null>; error?: { description?: string; code?: string } };
            };
            if (json.chart?.error) {
              reject(new Error(json.chart.error.description || json.chart.error.code || "日足がない"));
              return;
            }
            const result = json.chart?.result?.[0];
            if (!result) {
              reject(new Error("日足が空"));
              return;
            }
            resolve(result);
          } catch (error) {
            reject(error instanceof Error ? error : new Error("日足を読めなかった"));
          }
        });
        res.on("error", (error) => fail(error));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

const NOT_FOUND_RE = /HTTP 404|not found|No data/i;
const ATTEMPTS = [HOSTS[0], HOSTS[1], HOSTS[0]];

export type FetchBarsOptions = {
  /** Yahoo range. 6mo covers the 60-return correlation window. */
  range?: string;
  /** Completed sessions to keep from the end. */
  keep?: number;
  /** Split + dividend adjusted closes (Yahoo adjclose). */
  totalReturn?: boolean;
};

/**
 * Every attempt waits on the shared Yahoo cooldown. A 429 extends that cooldown for all
 * callers instead of hammering the other host right away.
 */
export async function fetchDailyBars(symbol: string, options: FetchBarsOptions = {}): Promise<ParsedSeries> {
  const range = options.range ?? "6mo";
  const keep = options.keep ?? CHART_SESSIONS;
  const totalReturn = options.totalReturn ?? false;
  const maxBytes = range === "6mo" ? 256_000 : 2_000_000;
  let lastError: Error | null = null;
  for (let i = 0; i < ATTEMPTS.length; i++) {
    await yahooGate.wait();
    try {
      const result = await fetchHost(ATTEMPTS[i], symbol, range, maxBytes, totalReturn);
      yahooGate.ok();
      return parseChart(result, Date.now() / 1000, keep, { useTotalReturn: totalReturn });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (NOT_FOUND_RE.test(lastError.message)) break;
      if (/HTTP 429/.test(lastError.message)) {
        const pause = yahooGate.penalize();
        console.error(`[range] yahoo 429 ${symbol} cooldown=${pause}ms`);
      } else if (i === 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  }
  throw lastError ?? new Error("日足を取得できなかった");
}
