import { addDays, isTradingDay, tradingDaysUntil } from "./calendar";
import type { EarningsInput } from "./types";

export type EarningsEstimate = {
  date: string;
  earliest: string;
  latest: string;
  label: string;
};

function parseYmd(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

function toYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Calendar add (NYSE holiday-agnostic; good enough for ± earnings windows). */
export function addCalendarDays(date: string, days: number): string {
  const { y, m, d } = parseYmd(date);
  const utc = Date.UTC(y, m - 1, d);
  return new Date(utc + days * 86_400_000).toISOString().slice(0, 10);
}

/** Last year's 2.02 date + 364 calendar days (same weekday as the anchor). */
export function yoyFromItem202(last202: string): string {
  return addCalendarDays(last202, 364);
}

function advanceWhileBefore(date: string, stepDays: number, bound: string): string {
  let cursor = date;
  for (let i = 0; i < 8; i += 1) {
    if (cursor >= bound) return cursor;
    cursor = addCalendarDays(cursor, stepDays);
  }
  return cursor;
}

function shortMd(date: string): string {
  const { m, d } = parseYmd(date);
  return `${m}/${d}`;
}

export function formatEstimateLabel(earliest: string, latest: string): string {
  if (earliest === latest) return `推定 ${shortMd(earliest)}前後`;
  return `推定 ${shortMd(earliest)}〜${shortMd(latest)}`;
}

/**
 * Next earnings estimate from sorted 8-K Item 2.02 filing dates.
 * Candidates: YoY (+364d) and sequential (+91 calendar days). Point = earlier; window spans both.
 */
export function estimateNextFrom202Dates(dates: readonly string[], today: string): EarningsEstimate | null {
  const sorted = [...dates]
    .map((d) => d.slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (!sorted.length) return null;
  const last = sorted[sorted.length - 1];

  let yoy = yoyFromItem202(last);
  let seq = addCalendarDays(last, 91);
  yoy = advanceWhileBefore(yoy, 364, today);
  seq = advanceWhileBefore(seq, 91, today);

  const earliest = yoy < seq ? yoy : seq;
  const latest = yoy > seq ? yoy : seq;
  const date = earliest;
  return { date, earliest, latest, label: formatEstimateLabel(earliest, latest) };
}

/** Legacy: last related filing + 91 **trading** sessions (systematically late vs calendar quarter). */
export function legacyTradingDayEstimate(lastDate: string): string {
  let date = lastDate;
  for (let i = 0; i < 120; i += 1) {
    date = addDays(date, 1);
    if (!isTradingDay(date)) continue;
    let count = 0;
    let cursor = date;
    while (count < 91) {
      cursor = addDays(cursor, 1);
      if (isTradingDay(cursor)) count += 1;
    }
    return cursor;
  }
  return addCalendarDays(lastDate, 91);
}

export function legacyMixedFilingEstimate(lastMixed: string): EarningsEstimate {
  const date = legacyTradingDayEstimate(lastMixed);
  return { date, earliest: date, latest: date, label: formatEstimateLabel(date, date) };
}

export function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

export function mergeEstimatedWithHistory(
  candidateDate: string,
  estimate: EarningsEstimate | null,
): Pick<EarningsInput, "date" | "estimateEarliest" | "estimateLatest" | "estimateLabel"> {
  if (!estimate) {
    return { date: candidateDate, estimateEarliest: candidateDate, estimateLatest: candidateDate, estimateLabel: formatEstimateLabel(candidateDate, candidateDate) };
  }
  const date = minYmd(candidateDate, estimate.date);
  const earliest = minYmd(candidateDate, estimate.earliest);
  const latest = date === estimate.date ? estimate.latest : minYmd(candidateDate, estimate.latest);
  return {
    date,
    estimateEarliest: earliest,
    estimateLatest: latest < earliest ? earliest : latest,
    estimateLabel: formatEstimateLabel(earliest, latest < earliest ? earliest : latest),
  };
}

/** Warn when within N trading sessions of the earliest plausible estimate. */
export function estimatedWarn(today: string, earnings: EarningsInput, warnDays: number): boolean {
  const anchor = earnings.estimateEarliest ?? earnings.date;
  if (anchor < today) return false;
  return tradingDaysUntil(today, anchor) <= warnDays;
}
