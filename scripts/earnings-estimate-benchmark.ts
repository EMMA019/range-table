/**
 * Compare legacy vs new earnings estimates against observed 8-K 2.02 dates.
 *   SEC_USER_AGENT='range-table research contact@example.com' npx tsx scripts/earnings-estimate-benchmark.ts
 */
import { todayEt } from "../src/lib/calendar";
import { fetchEdgarItem202Dates, lastEarningsRelatedFilingDate } from "../src/lib/edgar-earnings-date";
import {
  addCalendarDays,
  estimateNextFrom202Dates,
  legacyMixedFilingEstimate,
  mergeEstimatedWithHistory,
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

type RollStats = {
  n: number;
  meanSignedDays: number;
  maxAbsDays: number;
  pctEstimateLaterThanActual: number;
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
): { old: RollStats; new: RollStats; samples: Array<{ asOf: string; actual: string; oldDate: string; newDate: string; oldErr: number; newErr: number }> } {
  const samples: Array<{ asOf: string; actual: string; oldDate: string; newDate: string; oldErr: number; newErr: number }> = [];
  if (dates.length < 2) return { old: aggregate([]), new: aggregate([]), samples };

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
    const oldErr = daysBetween(oldDate, actual);
    const newErr = daysBetween(newDate, actual);
    samples.push({ asOf, actual, oldDate, newDate, oldErr, newErr });
  }
  return {
    old: aggregate(samples.map((s) => s.oldErr)),
    new: aggregate(samples.map((s) => s.newErr)),
    samples,
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
  const backtest: Record<string, { old: RollStats; new: RollStats; item202Count: number }> = {};

  for (const ticker of BENCHMARK_TICKERS) {
    const dates = await fetchEdgarItem202Dates(ticker);
    const json = await submissionsJson(ticker);
    const mixed = json ? lastEarningsRelatedFilingDate(json) : null;
    const roll = rollingBacktest(dates, mixed);
    backtest[ticker] = { old: roll.old, new: roll.new, item202Count: dates.length };
  }

  const candidates: Record<string, unknown> = {};
  for (const ticker of CANDIDATES) {
    const dates = await fetchEdgarItem202Dates(ticker);
    const edgarEst = dates.length ? estimateNextFrom202Dates(dates, today) : null;
    const oldLive = LIVE_OLD[ticker];
    const merged = oldLive ? mergeEstimatedWithHistory(oldLive, edgarEst) : edgarEst;
    candidates[ticker] = {
      liveOld: oldLive,
      new: merged,
      item202Count: dates.length,
      last202: dates.length ? dates[dates.length - 1] : null,
      edgarOnly: edgarEst,
    };
  }

  console.log(JSON.stringify({ today, backtest, candidates }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
