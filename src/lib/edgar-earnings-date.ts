import { item202Dates } from "./robustness";
import { cikForTicker } from "./edgar-companyfacts";
import { edgarGet, EdgarDisabledError } from "./edgar-client";
import { submissionsUrl } from "./edgar-filings";

const EARNINGS_FORMS = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A"]);

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
  return [...new Set(item202Dates(form, filingDate, items))].sort();
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
