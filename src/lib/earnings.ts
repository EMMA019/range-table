import { EARNINGS_ESTIMATED_WARN_DAYS, EARNINGS_WARN_DAYS } from "./constants";
import { tradingDaysUntil } from "./calendar";
import type { EarningsInput, EarningsView } from "./types";

export function classifyEarnings(
  today: string,
  earnings: EarningsInput | null,
): EarningsView | null {
  if (!earnings) return null;
  const session = earnings.session ?? null;
  if (earnings.date < today) {
    return {
      date: earnings.date,
      status: earnings.status,
      state: "past",
      tradingDays: null,
      warn: false,
      session,
    };
  }
  if (earnings.date === today) {
    return {
      date: earnings.date,
      status: earnings.status,
      state: "today",
      tradingDays: 0,
      warn: true,
      session,
    };
  }
  const tradingDays = tradingDaysUntil(today, earnings.date);
  const warnDays = earnings.status === "estimated" ? EARNINGS_ESTIMATED_WARN_DAYS : EARNINGS_WARN_DAYS;
  return {
    date: earnings.date,
    status: earnings.status,
    state: "upcoming",
    tradingDays,
    warn: tradingDays <= warnDays,
    session,
  };
}
