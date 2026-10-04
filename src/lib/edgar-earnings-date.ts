import { item202Dates } from "./robustness";
import { cikForTicker } from "./edgar-companyfacts";
import { edgarGet, EdgarDisabledError } from "./edgar-client";
import { submissionsUrl } from "./edgar-filings";

const EARNINGS_FORMS = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A"]);

/** Drop 2.02 clusters closer than this (duplicate/amended 8-Ks, not separate quarters). */
export const MIN_ITEM202_FILING_GAP_DAYS = 60;

function calendarDaysBetween(a: string, b: string): number {
  const t0 = Date.parse(`${a.slice(0, 10)}T12:00:00Z`);
  const t1 = Date.parse(`${b.slice(0, 10)}T12:00:00Z`);
  return Math.round((t1 - t0) / 86_400_000);
}

/** Keep the first 2.02 in each cluster; skip later filings within {@link MIN_ITEM202_FILING_GAP_DAYS}. */
export function thinItem202ToQuarterlyCadence(dates: readonly string[]): string[] {
  const sorted = [...dates]
    .map((d) => d.slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const out: string[] = [];
  for (const d of sorted) {
    if (!out.length) {
      out.push(d);
      continue;
    }
    if (calendarDaysBetween(out[out.length - 1], d) < MIN_ITEM202_FILING_GAP_DAYS) continue;
    out.push(d);
  }
  return out;
}

function column(recent: Record<string, unknown>, key: string): string[] {
  const raw = recent[key];
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => String(value ?? ""));
}

/** All 8-K Item 2.02 filing dates from submissions (sorted ascending). */
export function item202FilingDates(json: unknown): string[] {
  const recent = (json as { filings?: { recent?: Record<string, unknown> } })?.filings?.recent;
  if (!recent) return [];
  const form = column(recent, "form");
  const filingDate = column(recent, "filingDate");
  const items = column(recent, "items");
  const raw = [...new Set(item202Dates(form, filingDate, items))].sort();
  return thinItem202ToQuarterlyCadence(raw);
}

/** Latest 8-K (2.02) or 10-Q/10-K filing date — do not use for next-earnings projection (10-Q lags 2.02). */
export function lastEarningsRelatedFilingDate(json: unknown): string | null {
  const recent = (json as { filings?: { recent?: Record<string, unknown> } })?.filings?.recent;
  if (!recent) return null;
  const form = column(recent, "form");
  const filingDate = column(recent, "filingDate");
  const items = column(recent, "items");
  const candidates: string[] = [...item202Dates(form, filingDate, items)];
  for (let i = 0; i < form.length; i += 1) {
    if (EARNINGS_FORMS.has(form[i]) && filingDate[i]) candidates.push(filingDate[i]);
  }
  if (!candidates.length) return null;
  candidates.sort();
  return candidates[candidates.length - 1];
}

export async function fetchEdgarItem202Dates(ticker: string): Promise<string[]> {
  const cik = cikForTicker(ticker);
  if (!cik) return [];
  try {
    const text = await edgarGet(submissionsUrl(cik));
    return item202FilingDates(JSON.parse(text));
  } catch (error) {
    if (error instanceof EdgarDisabledError) return [];
    return [];
  }
}

export async function fetchEdgarLastEarningsFilingDate(ticker: string): Promise<string | null> {
  const dates = await fetchEdgarItem202Dates(ticker);
  return dates.length ? dates[dates.length - 1] : null;
}
