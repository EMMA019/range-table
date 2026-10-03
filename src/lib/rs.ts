import type { Bar } from "./types";

/** 20-session close return: close ÷ close 20 sessions earlier − 1. */
export function return20(bars: readonly Bar[], end = bars.length - 1): number | null {
  if (end < 20 || end >= bars.length) return null;
  const prev = bars[end - 20]?.c;
  const last = bars[end]?.c;
  if (prev == null || last == null || !(prev > 0) || !Number.isFinite(last)) return null;
  return last / prev - 1;
}

/**
 * Stock 20-session return minus SPY's 20-session return on the stock's last bar date.
 * Same excess as the backtest RS rank. Null when either series is short or that SPY date is missing.
 */
export function rs20(stockBars: readonly Bar[], spyBars: readonly Bar[]): number | null {
  if (stockBars.length < 21) return null;
  const end = stockBars.length - 1;
  const stock = return20(stockBars, end);
  const date = stockBars[end]?.date;
  if (stock == null || !date) return null;
  let spyEnd = -1;
  for (let i = spyBars.length - 1; i >= 0; i -= 1) {
    if (spyBars[i]?.date === date) {
      spyEnd = i;
      break;
    }
  }
  const spy = spyEnd >= 0 ? return20(spyBars, spyEnd) : null;
  if (spy == null) return null;
  return stock - spy;
}

export function roundRs(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1e6) / 1e6;
}
