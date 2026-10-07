import fs from "fs";
import path from "path";
import { CORR_WINDOW } from "./constants";
import { holdingsSource, isIgnoredTicker } from "./holdings";

export type CorrHolding = {
  ticker: string;
  shares: number;
};

export type CorrBasket = {
  window: number;
  benchmark: string;
  holdings: CorrHolding[];
};

export type CorrPair = {
  basket: number | null;
  soxx: number | null;
};

export type CorrSettings = {
  window: number;
  benchmark: string;
};

const SETTINGS_PATH = path.join(process.cwd(), "data", "corr_basket.json");

/** Window and benchmark only. Holdings come from the private source, never this file. */
export function loadCorrSettings(file = SETTINGS_PATH): CorrSettings {
  try {
    return parseCorrSettings(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
  } catch (error) {
    console.error("[range] corr settings", error);
    return { window: CORR_WINDOW, benchmark: "SOXX" };
  }
}

export function parseCorrSettings(json: unknown): CorrSettings {
  const row = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const window =
    typeof row.window === "number" && Number.isInteger(row.window) && row.window >= 2
      ? row.window
      : CORR_WINDOW;
  const benchmark = typeof row.benchmark === "string" && row.benchmark.trim() ? row.benchmark.trim().toUpperCase() : "SOXX";
  return { window, benchmark };
}

/** Null when no holding is left after dropping ignored tickers, so the UI shows a dash. */
export function buildCorrBasket(settings: CorrSettings, holdings: CorrHolding[]): CorrBasket | null {
  const kept: CorrHolding[] = [];
  for (const holding of holdings) {
    const ticker = holding.ticker.trim().toUpperCase();
    if (!ticker || isIgnoredTicker(ticker)) continue;
    if (!Number.isFinite(holding.shares) || !(holding.shares > 0)) continue;
    kept.push({ ticker, shares: holding.shares });
  }
  if (kept.length === 0) return null;
  return { ...settings, holdings: kept };
}

export function loadCorrBasket(): CorrBasket | null {
  const holdings = holdingsSource().load().holdings;
  return buildCorrBasket(loadCorrSettings(), holdings);
}

/** Close-to-close simple return, keyed by the date of the later bar. */
export function dailyReturns(bars: Array<{ date: string; c: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].c;
    const close = bars[i].c;
    if (!(prev > 0) || !Number.isFinite(close)) continue;
    out.set(bars[i].date, close / prev - 1);
  }
  return out;
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (!(vx > 0) || !(vy > 0)) return null;
  const value = cov / Math.sqrt(vx * vy);
  return Number.isFinite(value) ? value : null;
}

type Weighted = {
  weight: number;
  returns: Map<string, number>;
};

/**
 * Basket return on each date every holding has a return.
 * Weight is shares × that holding's latest close, held constant across the window.
 */
export function basketReturnSeries(holdings: Weighted[]): Map<string, number> {
  const out = new Map<string, number>();
  if (holdings.length === 0) return out;
  const weight = holdings.reduce((sum, holding) => sum + holding.weight, 0);
  if (!(weight > 0)) return out;
  const dates = [...holdings[0].returns.keys()].filter((date) =>
    holdings.every((holding) => holding.returns.has(date)),
  );
  for (const date of dates) {
    let acc = 0;
    for (const holding of holdings) acc += holding.weight * (holding.returns.get(date) as number);
    out.set(date, acc / weight);
  }
  return out;
}

/** Last `window` dates present in both series. Null when the overlap is shorter than the window. */
export function corrOnWindow(left: Map<string, number>, right: Map<string, number>, window: number): number | null {
  if (window < 2) return null;
  const dates = [...left.keys()].filter((date) => right.has(date)).sort();
  if (dates.length < window) return null;
  const use = dates.slice(-window);
  const value = pearson(
    use.map((date) => left.get(date) as number),
    use.map((date) => right.get(date) as number),
  );
  return value == null ? null : Math.round(value * 10000) / 10000;
}

export function buildCorrelations(
  closes: Record<string, Array<{ date: string; c: number }>>,
  basket: CorrBasket,
): Map<string, CorrPair> {
  const empty = new Map<string, CorrPair>();
  const weighted: Weighted[] = [];
  for (const holding of basket.holdings) {
    if (isIgnoredTicker(holding.ticker)) continue;
    const bars = closes[holding.ticker];
    const last = bars?.[bars.length - 1];
    if (!bars || !last || !(last.c > 0)) return empty;
    weighted.push({ weight: holding.shares * last.c, returns: dailyReturns(bars) });
  }
  if (weighted.length === 0) return empty;
  const basketReturns = basketReturnSeries(weighted);
  const benchmarkBars = closes[basket.benchmark];
  if (!benchmarkBars) return empty;
  const benchmarkReturns = dailyReturns(benchmarkBars);
  const out = new Map<string, CorrPair>();
  for (const symbol of Object.keys(closes)) {
    const returns = dailyReturns(closes[symbol] ?? []);
    out.set(symbol, {
      basket: corrOnWindow(returns, basketReturns, basket.window),
      soxx: corrOnWindow(returns, benchmarkReturns, basket.window),
    });
  }
  return out;
}

/** Benchmark correlation for every symbol that has closes. Does not need holdings. */
export function benchmarkCorrelations(
  closes: Record<string, Array<{ date: string; c: number }>>,
  settings: CorrSettings,
): Map<string, number | null> {
  const benchmarkBars = closes[settings.benchmark];
  if (!benchmarkBars) return new Map();
  const benchmarkReturns = dailyReturns(benchmarkBars);
  const out = new Map<string, number | null>();
  for (const symbol of Object.keys(closes)) {
    out.set(symbol, corrOnWindow(dailyReturns(closes[symbol] ?? []), benchmarkReturns, settings.window));
  }
  return out;
}
