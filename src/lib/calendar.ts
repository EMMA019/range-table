/**
 * NYSE full-day closures. Weekends are handled separately.
 * Early closes still count as trading days.
 * Source: NYSE holiday calendar. Update this set when a new year rolls in.
 */
const NYSE_HOLIDAYS = new Set<string>([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
  "2027-12-31",
  "2028-01-17",
  "2028-02-21",
  "2028-04-14",
  "2028-05-29",
  "2028-06-19",
  "2028-07-04",
  "2028-09-04",
  "2028-11-23",
  "2028-12-25",
]);

/** Shared formatter. Creating one per bar retains native memory across a full refresh. */
const etDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayEt(now = new Date()): string {
  return etDate.format(now);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function isWeekend(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

export function isTradingDay(iso: string): boolean {
  return !isWeekend(iso) && !NYSE_HOLIDAYS.has(iso);
}

/**
 * Trading sessions strictly after `todayEt` through `earningsDate`, inclusive
 * when that date is itself a session. Zero when earnings is today.
 */
export function tradingDaysUntil(today: string, earningsDate: string): number {
  if (earningsDate <= today) return 0;
  let days = 0;
  let cursor = addDays(today, 1);
  let guard = 0;
  while (cursor <= earningsDate && guard < 500) {
    if (isTradingDay(cursor)) days += 1;
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return days;
}

export function sessionDate(unixSec: number): string {
  return etDate.format(new Date(unixSec * 1000));
}

const etOffset = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  timeZoneName: "shortOffset",
});

const etClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since midnight on the US Eastern wall clock. */
export function minutesEt(now = new Date()): number {
  const parts = etClock.formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

/** Eastern offset from UTC in minutes at that instant: −240 in summer, −300 in winter. */
export function etOffsetMinutes(at: Date): number {
  const name = etOffset.formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "GMT-5";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return -300;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** UTC epoch ms for an Eastern wall-clock time on an ET date. */
export function etWallTimeMs(date: string, minutes: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  const offset = etOffsetMinutes(new Date(wall + 5 * 3_600_000));
  return wall - offset * 60_000;
}

/** Yahoo's daily close settles a few minutes after the bell. Bars before this are provisional. */
export const CLOSE_FINAL_MINUTES = 16 * 60 + 20;

/** True while the latest bar is today's and the closing print may still be revised. */
export function closeIsProvisional(barDate: string | null, now = new Date()): boolean {
  if (!barDate) return false;
  return barDate === todayEt(now) && minutesEt(now) < CLOSE_FINAL_MINUTES;
}
