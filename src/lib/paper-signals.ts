import type { AlertItem } from "./alerts";
import { isIgnoredTicker } from "./holdings";
import { morningBuyLines, type MorningQuote } from "./morning";

export const SOURCE_ALERT = "alerts_entry_in_ok";
export const SOURCE_MORNING = "morning_entry_near_到達";

export type PaperSignal = {
  signal_date: string;
  symbol: string;
  ref_close: number;
  low20: number;
  source: string;
};

export type MorningEntryInput = {
  ticker: string;
  /** False for index-monitor names. The morning page only lists the watchlist. */
  onMorningList: boolean;
  /** Default morning screen: financials off, other exclusions hidden. */
  screenPass: boolean;
  closeDate: string;
  quote: MorningQuote | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function signalKey(signal: Pick<PaperSignal, "signal_date" | "symbol">): string {
  return `${signal.signal_date}\0${signal.symbol.trim().toUpperCase()}`;
}

function asSignal(raw: unknown): PaperSignal | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const signalDate = typeof row.signal_date === "string" ? row.signal_date : "";
  const symbol = typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
  const ref = typeof row.ref_close === "number" ? row.ref_close : null;
  const low = typeof row.low20 === "number" ? row.low20 : null;
  const source = typeof row.source === "string" ? row.source : "";
  if (!DATE_RE.test(signalDate) || !symbol || isIgnoredTicker(symbol)) return null;
  if (ref == null || !(ref > 0) || low == null || !Number.isFinite(low) || !source) return null;
  return { signal_date: signalDate, symbol, ref_close: ref, low20: low, source };
}

/** Accepts `{ signals: [...] }` or a bare array. Drops ONDS and broken rows. */
export function parseSignals(raw: unknown): PaperSignal[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { signals?: unknown }).signals)
      ? (raw as { signals: unknown[] }).signals
      : [];
  return rows.flatMap((row) => {
    const signal = asSignal(row);
    return signal ? [signal] : [];
  });
}

/**
 * First row for a (signal_date, symbol) pair wins, so a later run cannot
 * replace a seeded ref close. ONDS is dropped.
 */
export function mergeSignals(existing: PaperSignal[], incoming: PaperSignal[]): PaperSignal[] {
  const out: PaperSignal[] = [];
  const seen = new Set<string>();
  for (const signal of [...existing, ...incoming]) {
    if (isIgnoredTicker(signal.symbol)) continue;
    const key = signalKey(signal);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...signal, symbol: signal.symbol.trim().toUpperCase() });
  }
  return out;
}

/** One row per entry_in_ok alert. The 25% and 35% lines share a close, so they collapse later. */
export function signalFromEntryAlert(item: AlertItem): PaperSignal | null {
  if (item.kind !== "entry_in_ok" || !item.ticker || isIgnoredTicker(item.ticker)) return null;
  const signalDate = item.facts.barDate;
  const ref = item.facts.close;
  const low = item.facts.low20;
  if (typeof signalDate !== "string" || !DATE_RE.test(signalDate)) return null;
  if (typeof ref !== "number" || typeof low !== "number") return null;
  if (!(ref > 0) || !Number.isFinite(low)) return null;
  return {
    signal_date: signalDate,
    symbol: item.ticker.trim().toUpperCase(),
    ref_close: round2(ref),
    low20: round2(low),
    source: SOURCE_ALERT,
  };
}

/**
 * A morning-page row on the default screen (line reached, exclusions hidden).
 * Index-only names are not on that page.
 */
export function morningEntrySignal(input: MorningEntryInput): PaperSignal | null {
  if (!input.onMorningList || !input.screenPass || !input.quote) return null;
  if (isIgnoredTicker(input.ticker)) return null;
  if (!DATE_RE.test(input.closeDate)) return null;
  if (morningBuyLines(input.quote).length === 0) return null;
  if (!(input.quote.close > 0) || !Number.isFinite(input.quote.low20)) return null;
  return {
    signal_date: input.closeDate,
    symbol: input.ticker.trim().toUpperCase(),
    ref_close: round2(input.quote.close),
    low20: round2(input.quote.low20),
    source: SOURCE_MORNING,
  };
}

/**
 * Alerts win the source when the same name is also a morning row.
 * Existing log rows are applied by the caller via mergeSignals, and those stay put.
 */
export function collectEntrySignals(alerts: AlertItem[], morning: MorningEntryInput[]): PaperSignal[] {
  const fromAlerts = alerts.flatMap((item) => {
    const signal = signalFromEntryAlert(item);
    return signal ? [signal] : [];
  });
  const fromMorning = morning.flatMap((row) => {
    const signal = morningEntrySignal(row);
    return signal ? [signal] : [];
  });
  return mergeSignals(fromAlerts, fromMorning);
}
