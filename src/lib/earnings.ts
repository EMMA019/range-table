import { EARNINGS_ESTIMATED_WARN_DAYS, EARNINGS_WARN_DAYS } from "./constants";
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
  const warnAnchor = earnings.status === "estimated" ? (earnings.estimateEarliest ?? earnings.date) : earnings.date;
  const daysToAnchor = tradingDaysUntil(today, warnAnchor);
  const warnDays = earnings.status === "estimated" ? EARNINGS_ESTIMATED_WARN_DAYS : EARNINGS_WARN_DAYS;
  const warn =
    earnings.status === "estimated"
      ? daysToAnchor <= warnDays || tradingDays <= warnDays
      : tradingDays <= warnDays;
  return {
    date: earnings.date,
    status: earnings.status,
    state: "upcoming",
    tradingDays,
    warn,
    estimateEarliest: earnings.estimateEarliest,
    estimateLatest: earnings.estimateLatest,
    estimateLabel: earnings.estimateLabel,
  };
}
