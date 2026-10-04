import { themeOf, THEME_KEEP } from "./themes";
import type { Sp500Interval } from "./sp500-pit";
import { isSp500MemberOnDate } from "./sp500-pit";

export const ROUND20_PIT_MIN_START = "1996-01-02";
export const ROUND20_FORMATION_START = "2010-01-01";
export const ROUND20_FORMATION_END = "2025-10-31";
export const ROUND20_FORWARD_DAYS = 252;
export const ROUND20_BOOTSTRAP_N = 2000;

export type TenureBucket = "lt1" | "1to5" | "gte5" | "unknown";

export type ForwardMetrics = {
  totalReturn: number;
  annVol: number;
  maxDrawdown: number;
};

export type TenureObservation = {
  monthEnd: string;
  formationYear: number;
  ticker: string;
  bucket: TenureBucket;
  metrics: ForwardMetrics;
  spyMetrics: ForwardMetrics;
  excessReturn: number;
};

export type RemovalObservation = {
  removalDate: string;
  ticker: string;
  scenario: "actual" | "stress50" | "stress100";
  totalReturn: number;
  spyTotalReturn: number;
  excessReturn: number;
};

export function buildMembershipIndex(intervals: Sp500Interval[]): Map<string, Sp500Interval[]> {
  const by = new Map<string, Sp500Interval[]>();
  for (const row of intervals) {
    const list = by.get(row.ticker) ?? [];
    list.push(row);
    by.set(row.ticker, list);
  }
  return by;
}

/** Start date of the membership stint active on `asOf`. */
export function recentAdditionDate(intervals: Sp500Interval[], asOf: string): string | null {
  for (const row of intervals) {
    if (row.startDate > asOf) continue;
    if (row.endDate && row.endDate < asOf) continue;
    return row.startDate;
  }
  return null;
}

export function tenureYears(addDate: string, asOf: string): number {
  const a = new Date(`${addDate}T12:00:00Z`).getTime();
  const b = new Date(`${asOf}T12:00:00Z`).getTime();
  return (b - a) / (365.25 * 24 * 3600 * 1000);
}

export function tenureBucket(addDate: string, asOf: string, pitMinStart = ROUND20_PIT_MIN_START): TenureBucket {
  const years = tenureYears(addDate, asOf);
  if (addDate <= pitMinStart && years < 5) return "unknown";
  if (years < 1) return "lt1";
  if (years < 5) return "1to5";
  return "gte5";
}

export function monthEndDates(calendar: string[], from: string, to: string): string[] {
  const byMonth = new Map<string, string>();
  for (const d of calendar) {
    if (d < from || d > to) continue;
    const key = d.slice(0, 7);
    byMonth.set(key, d);
  }
  return [...byMonth.values()].sort((a, b) => a.localeCompare(b));
}

export function tradingDayIndex(calendar: string[], date: string): number {
  let lo = 0;
  let hi = calendar.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (calendar[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function forwardMetricsFromCloses(closes: number[], startIdx: number, horizon = ROUND20_FORWARD_DAYS): ForwardMetrics | null {
  const endIdx = startIdx + horizon;
  if (startIdx < 0 || endIdx >= closes.length) return null;
  const p0 = closes[startIdx];
  const p1 = closes[endIdx];
  if (!(p0 > 0) || !(p1 > 0)) return null;

  const totalReturn = p1 / p0 - 1;
  const logRets: number[] = [];
  let peak = closes[startIdx];
  let maxDd = 0;
  for (let i = startIdx + 1; i <= endIdx; i += 1) {
    const pPrev = closes[i - 1];
    const p = closes[i];
    if (pPrev > 0 && p > 0) logRets.push(Math.log(p / pPrev));
    if (p > peak) peak = p;
    const dd = peak > 0 ? p / peak - 1 : 0;
    if (dd < maxDd) maxDd = dd;
  }
  const mean = logRets.length ? logRets.reduce((a, b) => a + b, 0) / logRets.length : 0;
  const var_ =
    logRets.length > 1
      ? logRets.reduce((s, r) => s + (r - mean) ** 2, 0) / (logRets.length - 1)
      : 0;
  const annVol = Math.sqrt(var_) * Math.sqrt(252);

  return { totalReturn, annVol, maxDrawdown: maxDd };
}

export function isExcludedTheme(ticker: string): boolean {
  if (ticker === "ONDS") return true;
  if (ticker === THEME_KEEP) return false;
  const t = themeOf(ticker);
  return t === "quantum" || t === "space" || t === "crypto" || t === "solar" || t === "nuclear";
}

export function isFinancialSector(sector: string): boolean {
  return sector === "Financials";
}

export function summarizeReturns(values: number[]): {
  n: number;
  mean: number;
  median: number;
  pctPositive: number;
} {
  if (values.length === 0) {
    return { n: 0, mean: 0, median: 0, pctPositive: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const pctPositive = values.filter((v) => v > 0).length / values.length;
  return { n: values.length, mean, median, pctPositive };
}

export type BucketSummary = {
  bucket: TenureBucket;
  n: number;
  meanTr: number;
  medianTr: number;
  pctPositive: number;
  meanExcess: number;
  meanVol: number;
  meanMaxDd: number;
};

export function summarizeByBucket(obs: TenureObservation[]): BucketSummary[] {
  const buckets: TenureBucket[] = ["lt1", "1to5", "gte5", "unknown"];
  return buckets.map((bucket) => {
    const slice = obs.filter((o) => o.bucket === bucket);
    const tr = summarizeReturns(slice.map((o) => o.metrics.totalReturn));
    const ex = summarizeReturns(slice.map((o) => o.excessReturn));
    const vol = slice.length ? slice.reduce((a, o) => a + o.metrics.annVol, 0) / slice.length : 0;
    const dd = slice.length ? slice.reduce((a, o) => a + o.metrics.maxDrawdown, 0) / slice.length : 0;
    return {
      bucket,
      n: tr.n,
      meanTr: tr.mean,
      medianTr: tr.median,
      pctPositive: tr.pctPositive,
      meanExcess: ex.mean,
      meanVol: vol,
      meanMaxDd: dd,
    };
  });
}

export function pooledByFormationYear(obs: TenureObservation[]): Map<number, Map<TenureBucket, number[]>> {
  const out = new Map<number, Map<TenureBucket, number[]>>();
  for (const o of obs) {
    let yearMap = out.get(o.formationYear);
    if (!yearMap) {
      yearMap = new Map();
      out.set(o.formationYear, yearMap);
    }
    const list = yearMap.get(o.bucket) ?? [];
    list.push(o.metrics.totalReturn);
    yearMap.set(o.bucket, list);
  }
  return out;
}

export type MonthlyBucketReturns = Map<string, { lt1: number[]; gte5: number[] }>;

export function groupReturnsByMonthLt1Gte5(obs: TenureObservation[]): MonthlyBucketReturns {
  const byMonth = new Map<string, { lt1: number[]; gte5: number[] }>();
  for (const o of obs) {
    if (o.bucket !== "lt1" && o.bucket !== "gte5") continue;
    const row = byMonth.get(o.monthEnd) ?? { lt1: [], gte5: [] };
    if (o.bucket === "lt1") row.lt1.push(o.metrics.totalReturn);
    else row.gte5.push(o.metrics.totalReturn);
    byMonth.set(o.monthEnd, row);
  }
  return byMonth;
}

/** Bootstrap CI for mean(lt1) - mean(gte5) resampling calendar months. */
export function bootstrapMeanDiffLt1VsGte5(
  byMonth: MonthlyBucketReturns,
  nSamples = ROUND20_BOOTSTRAP_N,
): { diff: number; ciLow: number; ciHigh: number; months: number } {
  const months = [...byMonth.keys()].sort();
  if (months.length === 0) return { diff: 0, ciLow: 0, ciHigh: 0, months: 0 };

  const pooledDiff = (): number => {
    const lt1: number[] = [];
    const gte5: number[] = [];
    for (const m of months) {
      const row = byMonth.get(m)!;
      lt1.push(...row.lt1);
      gte5.push(...row.gte5);
    }
    if (lt1.length === 0 || gte5.length === 0) return 0;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return mean(lt1) - mean(gte5);
  };

  const point = pooledDiff();
  const samples: number[] = [];
  for (let b = 0; b < nSamples; b += 1) {
    const lt1: number[] = [];
    const gte5: number[] = [];
    for (let i = 0; i < months.length; i += 1) {
      const m = months[Math.floor(Math.random() * months.length)];
      const row = byMonth.get(m)!;
      lt1.push(...row.lt1);
      gte5.push(...row.gte5);
    }
    if (lt1.length === 0 || gte5.length === 0) continue;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    samples.push(mean(lt1) - mean(gte5));
  }
  samples.sort((a, b) => a - b);
  const lo = samples[Math.floor(0.025 * samples.length)] ?? point;
  const hi = samples[Math.floor(0.975 * samples.length)] ?? point;
  return { diff: point, ciLow: lo, ciHigh: hi, months: months.length };
}

export function listRemovalEvents(intervals: Sp500Interval[], from: string, to: string): { ticker: string; removalDate: string }[] {
  const out: { ticker: string; removalDate: string }[] = [];
  for (const row of intervals) {
    if (!row.endDate) continue;
    if (row.endDate < from || row.endDate > to) continue;
    out.push({ ticker: row.ticker, removalDate: row.endDate });
  }
  out.sort((a, b) => a.removalDate.localeCompare(b.removalDate) || a.ticker.localeCompare(b.ticker));
  return out;
}

export function membersOnDateIndexed(byTicker: Map<string, Sp500Interval[]>, date: string): string[] {
  const out: string[] = [];
  for (const [ticker, intervals] of byTicker) {
    if (isSp500MemberOnDate(intervals, date)) out.push(ticker);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}
