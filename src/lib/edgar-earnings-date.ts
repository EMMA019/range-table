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

/** Latest 8-K (2.02) or 10-Q/10-K filing date from a submissions JSON, if any. */
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

export async function fetchEdgarLastEarningsFilingDate(ticker: string): Promise<string | null> {
  const cik = cikForTicker(ticker);
  if (!cik) return null;
  try {
    const text = await edgarGet(submissionsUrl(cik));
    return lastEarningsRelatedFilingDate(JSON.parse(text));
  } catch (error) {
    if (error instanceof EdgarDisabledError) return null;
    return null;
  }
}
