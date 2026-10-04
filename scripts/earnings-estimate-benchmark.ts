/**
 * Compare legacy vs new earnings estimates against observed 8-K 2.02 dates.
 *   SEC_USER_AGENT='range-table research contact@example.com' npx tsx scripts/earnings-estimate-benchmark.ts
 */
import { todayEt } from "../src/lib/calendar";
import { enrichEarningsDate, warmNasdaqEarningsCalendar } from "../src/lib/earnings-enrich";
import { fetchEdgarItem202Dates, lastEarningsRelatedFilingDate } from "../src/lib/edgar-earnings-date";
import {
  addCalendarDays,
  estimateNextFrom202Dates,
  legacyMixedFilingEstimate,
} from "../src/lib/earnings-estimate";
import { edgarGet } from "../src/lib/edgar-client";
import { submissionsUrl } from "../src/lib/edgar-filings";
import { cikForTicker } from "../src/lib/edgar-companyfacts";

const BENCHMARK_TICKERS = ["ORCL", "NKE", "NOW", "BA", "DVN", "FDX", "MU"] as const;
const CANDIDATES = ["AKAM", "VST", "VRT", "DVN", "NOW", "BA", "ORCL", "NKE"] as const;
const ROLLING_QUARTERS = 8;

const LIVE_OLD: Record<string, string> = {
  AKAM: "2026-11-05",
  VST: "2026-11-06",
  VRT: "2026-10-28",
  DVN: "2026-11-04",
  NOW: "2026-11-04",
  BA: "2026-11-04",
  ORCL: "2027-01-25",
  NKE: "2027-02-16",
};

function daysBetween(a: string, b: string): number {
  const t0 = Date.parse(`${a}T12:00:00Z`);
  const t1 = Date.parse(`${b}T12:00:00Z`);
  return Math.round((t1 - t0) / 86_400_000);
}

/** Signed error: estimate − actual (positive = estimate later than actual). */
function signedError(estimate: string, actual: string): number {
  return daysBetween(actual, estimate);
}

type RollStats = {
  n: number;
  meanSignedDays: number;
  maxAbsDays: number;
  pctEstimateLaterThanActual: number;
};

type RollSample = {
  asOf: string;
  last202: string;
  actual: string;
  oldDate: string;
  newDate: string;
  oldErr: number;
  newErr: number;
};

function aggregate(errors: number[]): RollStats {
  if (!errors.length) {
    return { n: 0, meanSignedDays: 0, maxAbsDays: 0, pctEstimateLaterThanActual: 0 };
  }
  const meanSignedDays = errors.reduce((a, b) => a + b, 0) / errors.length;
  const maxAbsDays = Math.max(...errors.map((e) => Math.abs(e)));
  const pctEstimateLaterThanActual = (errors.filter((e) => e > 0).length / errors.length) * 100;
  return { n: errors.length, meanSignedDays, maxAbsDays, pctEstimateLaterThanActual };
}

function rollingBacktest(
  dates: string[],
  mixedAtEnd: string | null,
): { old: RollStats; new: RollStats; samples: RollSample[]; worstNew: RollSample | null } {
  const samples: RollSample[] = [];
  if (dates.length < 2) return { old: aggregate([]), new: aggregate([]), samples, worstNew: null };

  const startIdx = Math.max(1, dates.length - ROLLING_QUARTERS);
  for (let i = startIdx; i < dates.length; i += 1) {
    const actual = dates[i];
    const history = dates.slice(0, i);
    const last202 = history[history.length - 1];
    const asOf = addCalendarDays(last202, 1);
    const mixed = mixedAtEnd && i === dates.length - 1 ? mixedAtEnd : last202;
    const oldDate = legacyMixedFilingEstimate(mixed).date;
    const newEst = estimateNextFrom202Dates(history, asOf);
    const newDate = newEst?.date ?? oldDate;
    samples.push({
      asOf,
      last202,
      actual,
      oldDate,
      newDate,
      oldErr: signedError(oldDate, actual),
      newErr: signedError(newDate, actual),
    });
  }
  const worstNew = samples.reduce(
    (best, s) => (!best || Math.abs(s.newErr) > Math.abs(best.newErr) ? s : best),
    null as RollSample | null,
  );
  return {
    old: aggregate(samples.map((s) => s.oldErr)),
    new: aggregate(samples.map((s) => s.newErr)),
    samples,
    worstNew,
  };
}

async function submissionsJson(ticker: string): Promise<unknown | null> {
  const cik = cikForTicker(ticker);
  if (!cik) return null;
  try {
    return JSON.parse(await edgarGet(submissionsUrl(cik)));
  } catch {
    return null;
  }
}

async function main() {
  const today = todayEt();
  await warmNasdaqEarningsCalendar(today);

  const backtest: Record<
    string,
    { old: RollStats; new: RollStats; item202Count: number; worstNew: RollSample | null }
  > = {};

  for (const ticker of BENCHMARK_TICKERS) {
    const dates = await fetchEdgarItem202Dates(ticker);
    const json = await submissionsJson(ticker);
    const mixed = json ? lastEarningsRelatedFilingDate(json) : null;
    const roll = rollingBacktest(dates, mixed);
    backtest[ticker] = {
      old: roll.old,
      new: roll.new,
      item202Count: dates.length,
      worstNew: roll.worstNew,
    };
  }

  const candidates: Record<string, unknown> = {};
  for (const ticker of CANDIDATES) {
    const oldLive = LIVE_OLD[ticker];
    const enrich = await enrichEarningsDate(ticker, null, oldLive ? { nextEarningsDate: oldLive } : null);
    const dates = await fetchEdgarItem202Dates(ticker);
    candidates[ticker] = {
      liveOld: oldLive,
      status: enrich.status,
      date: enrich.date,
      source: enrich.source,
      estimateLabel: enrich.estimateLabel ?? null,
      item202Count: dates.length,
      last202: dates.length ? dates[dates.length - 1] : null,
    };
  }

  console.log(JSON.stringify({ today, backtest, candidates }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
