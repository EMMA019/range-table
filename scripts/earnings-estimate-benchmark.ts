/**
 * Compare legacy vs new earnings estimates against the next observed 8-K 2.02 date.
 *   npx tsx scripts/earnings-estimate-benchmark.ts
 */
import { todayEt } from "../src/lib/calendar";
import { fetchEdgarItem202Dates } from "../src/lib/edgar-earnings-date";
import {
  estimateNextFrom202Dates,
  legacyMixedFilingEstimate,
  mergeEstimatedWithHistory,
} from "../src/lib/earnings-estimate";
import { lastEarningsRelatedFilingDate } from "../src/lib/edgar-earnings-date";
import { edgarGet } from "../src/lib/edgar-client";
import { submissionsUrl } from "../src/lib/edgar-filings";
import { cikForTicker } from "../src/lib/edgar-companyfacts";

const TICKERS = ["ORCL", "NKE", "NOW", "BA", "DVN", "FDX", "MU"] as const;
/** Representative last 2.02 when SEC is unavailable (for doc cross-check). */
const SAMPLE_LAST202: Record<string, string> = {
  ORCL: "2025-09-10",
  NKE: "2025-09-30",
  NOW: "2025-07-23",
  BA: "2025-07-29",
  DVN: "2025-08-05",
  FDX: "2025-09-18",
  MU: "2025-09-24",
};
const CANDIDATES = ["AKAM", "VST", "VRT", "DVN", "NOW", "BA", "ORCL", "NKE"] as const;

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
  const history: Array<{
    ticker: string;
    last202: string;
    actualNext202: string;
    oldDaysOff: number;
    newDaysOff: number;
    oldDate: string;
    newDate: string;
  }> = [];

  for (const ticker of TICKERS) {
    const json = await submissionsJson(ticker);
    if (!json) continue;
    const dates = await fetchEdgarItem202Dates(ticker);
    if (dates.length < 2) continue;
    const last = dates[dates.length - 2];
    const actualNext = dates[dates.length - 1];
    const mixed = lastEarningsRelatedFilingDate(json) ?? last;
    const oldDate = legacyMixedFilingEstimate(mixed).date;
    const newEst = estimateNextFrom202Dates([last], last);
    const newDate = newEst?.date ?? oldDate;
    history.push({
      ticker,
      last202: last,
      actualNext202: actualNext,
      oldDate,
      newDate,
      oldDaysOff: daysBetween(oldDate, actualNext),
      newDaysOff: daysBetween(newDate, actualNext),
    });
  }

  const candidates: Record<string, unknown> = {};
  for (const ticker of CANDIDATES) {
    let dates = await fetchEdgarItem202Dates(ticker);
    if (!dates.length && SAMPLE_LAST202[ticker]) dates = [SAMPLE_LAST202[ticker]];
    const edgarEst = dates.length ? estimateNextFrom202Dates(dates, today) : null;
    const oldLive = LIVE_OLD[ticker];
    const merged = oldLive ? mergeEstimatedWithHistory(oldLive, edgarEst) : edgarEst;
    candidates[ticker] = {
      liveOld: oldLive,
      new: merged,
      item202Count: dates.length,
      last202: dates.length ? dates[dates.length - 1] : null,
    };
  }

  console.log(JSON.stringify({ today, history, candidates }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
