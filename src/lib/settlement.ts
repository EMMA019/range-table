import { addDays, isTradingDay } from "./calendar";

/**
 * US bank holidays when the NYSE is open but securities do not settle.
 * Holidays that fall on a Saturday are not observed by the Federal Reserve.
 * Update together with NYSE_HOLIDAYS in calendar.ts.
 */
export const BANK_ONLY_HOLIDAYS = new Set<string>([
  "2026-10-12", // Columbus Day
  "2026-11-11", // Veterans Day
  "2027-10-11",
  "2027-11-11",
  "2028-10-09",
]);

/**
 * A settlement day needs the NYSE open and the banks open. Days when only one of them
 * is open are skipped, which can push the date later than the broker's but never earlier,
 * so a good-faith warning errs on the safe side.
 */
export function isSettlementDay(iso: string): boolean {
  return isTradingDay(iso) && !BANK_ONLY_HOLIDAYS.has(iso);
}

/** Settlement date for a trade on `tradeDate` (ET). Cash accounts settle T+1. */
export function settleDate(tradeDate: string, businessDays = 1): string {
  let cursor = tradeDate;
  let left = businessDays;
  let guard = 0;
  while (left > 0 && guard < 60) {
    cursor = addDays(cursor, 1);
    if (isSettlementDay(cursor)) left -= 1;
    guard += 1;
  }
  return cursor;
}

/** True while money from a sale on `tradeDate` is still unsettled on `today`. */
export function isUnsettled(tradeDate: string, today: string): boolean {
  return today < settleDate(tradeDate);
}
