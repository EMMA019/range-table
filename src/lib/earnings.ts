import { EARNINGS_WARN_DAYS } from "./constants";
import { tradingDaysUntil } from "./calendar";
import type { EarningsInput, EarningsView } from "./types";

export function classifyEarnings(
  today: string,
  earnings: EarningsInput | null,
): EarningsView | null {
  if (!earnings) return null;
  if (earnings.date < today) {
    return {
      date: earnings.date,
      status: earnings.status,
      state: "past",
      tradingDays: null,
      warn: false,
    };
  }
  if (earnings.date === today) {
    return {
      date: earnings.date,
      status: earnings.status,
      state: "today",
      tradingDays: 0,
      warn: true,
    };
  }
  const tradingDays = tradingDaysUntil(today, earnings.date);
  return {
    date: earnings.date,
    status: earnings.status,
    state: "upcoming",
    tradingDays,
    warn: tradingDays <= EARNINGS_WARN_DAYS,
  };
}
