/** Idle-cash ETF sleeve. The stock walker calls these rules; it does not change them. */

export const ETF_FEE = 0.7;
export const ETF_RISK = 32;
export const ETF_HOLD = 20;

export type EtfBar = { date: string; o: number; h: number; l: number; c: number };
export type EtfReason = "target" | "stop" | "timeout" | "preempted" | "window";

export function line15(low: number, high: number): number | null {
  if (!(high > low)) return null;
  return Math.round((low + 0.15 * (high - low)) * 10000) / 10000;
}

export function boxAt(bars: readonly { h: number; l: number }[], index: number, n: number): { low: number; high: number } | null {
  if (n < 1 || index < n - 1 || index >= bars.length) return null;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let i = index - n + 1; i <= index; i += 1) {
    const bar = bars[i];
    if (bar.l < low) low = bar.l;
    if (bar.h > high) high = bar.h;
  }
  return { low, high };
}

/** Fresh cross of the 15% line. Entry is the next clock session, filled at that open by the walker. */
export function etfOrders(bars: readonly EtfBar[], n: number, sessions: readonly string[]): Map<string, { stop: number; target: number }> {
  const out = new Map<string, { stop: number; target: number }>();
  const next = new Map<string, string>();
  for (let i = 0; i < sessions.length - 1; i += 1) next.set(sessions[i], sessions[i + 1]);
  const index = new Map(bars.map((bar, i) => [bar.date, i]));
  for (let i = 1; i < bars.length; i += 1) {
    const box = boxAt(bars, i, n);
    const prev = boxAt(bars, i - 1, n);
    if (!box || !prev) continue;
    const line = line15(box.low, box.high);
    const prevLine = line15(prev.low, prev.high);
    if (line == null || prevLine == null) continue;
    if (!(bars[i].c >= line) || !(bars[i - 1].c < prevLine)) continue;
    let entry = next.get(bars[i].date) ?? null;
    if (!entry) {
      entry = sessions.find((date) => date > bars[i].date) ?? null;
    }
    if (!entry || out.has(entry) || !index.has(entry)) continue;
    out.set(entry, { stop: box.low, target: box.high });
  }
  return out;
}

/** Whole shares from the $32 risk budget and the idle cash. Zero skips the entry. */
export function etfShares(entry: number, stop: number, cash: number): number {
  if (!(entry > stop) || !(entry > 0) || !(cash >= entry)) return 0;
  const risk = Math.floor(ETF_RISK / (entry - stop));
  const room = Math.floor(cash / entry);
  const qty = Math.min(risk, room);
  return qty >= 1 ? qty : 0;
}

/**
 * Minimum whole shares whose open proceeds, after the flat fee, cover `shortfall`.
 * Null means even the whole position cannot fund the stock, so nothing is sold.
 */
export function preemptQty(shortfall: number, open: number, held: number, fee = ETF_FEE): number | null {
  if (shortfall <= 1e-9) return 0;
  if (!(open > 0) || held < 1) return null;
  let qty = Math.ceil((shortfall + fee) / open - 1e-9);
  if (!Number.isFinite(qty) || qty < 1) qty = 1;
  while (qty > 1 && (qty - 1) * open - fee >= shortfall - 1e-6) qty -= 1;
  if (qty > held || qty * open - fee < shortfall - 1e-6) return null;
  return qty;
}

export function etfOpenExit(args: { entryDay: boolean; open: number; stop: number; target: number }): { price: number; reason: "stop" | "target" } | null {
  if (args.entryDay) return null;
  const gapStop = args.open < args.stop;
  const gapTarget = args.open >= args.target;
  if (gapStop) return { price: args.open, reason: "stop" };
  if (gapTarget) return { price: args.open, reason: "target" };
  return null;
}

export function etfRestExit(args: { high: number; close: number; stop: number; target: number; timeout: boolean }): { price: number; reason: "stop" | "target" | "timeout" } | null {
  const closeStop = args.close < args.stop;
  const highTarget = args.high >= args.target;
  if (closeStop) return { price: args.close, reason: "stop" };
  if (highTarget) return { price: args.target, reason: "target" };
  if (args.timeout) return { price: args.close, reason: "timeout" };
  return null;
}

export function timeoutDate(sessions: readonly string[], entryDate: string, hold = ETF_HOLD): string | null {
  const index = sessions.indexOf(entryDate);
  if (index < 0) return null;
  return sessions[index + hold] ?? null;
}
