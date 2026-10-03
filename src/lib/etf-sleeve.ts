/** Idle-cash ETF sleeve. The stock walker calls these rules; it does not change them. */

export const ETF_FEE = 0.7;
export const ETF_RISK = 32;
export const ETF_HOLD = 20;

export type EtfBar = { date: string; o: number; h: number; l: number; c: number };
export type EtfReason = "target" | "stop" | "timeout" | "preempted" | "window";
export type EtfOrder = { stop: number; target: number; atr: number | null };
export type EtfEntryName = "E15" | "E25" | "E30";

const ATR_WINDOW = 14;

export function lineOf(low: number, high: number, fraction: number): number | null {
  if (!(high > low) || !(fraction > 0)) return null;
  return Math.round((low + fraction * (high - low)) * 10000) / 10000;
}

export function line15(low: number, high: number): number | null {
  return lineOf(low, high, 0.15);
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

/** Simple average of the 14 true ranges ending at `index`, rounded to 4 decimals. */
export function atr14At(bars: readonly { h: number; l: number; c: number }[], index: number): number | null {
  if (index < ATR_WINDOW || index >= bars.length) return null;
  let sum = 0;
  for (let i = index - ATR_WINDOW + 1; i <= index; i += 1) {
    const prev = bars[i - 1].c;
    const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - prev), Math.abs(bars[i].l - prev));
    sum += tr;
  }
  return Math.round((sum / ATR_WINDOW) * 10000) / 10000;
}

/** Stop and target from the fill and the signal ATR. Both prices are rounded to 4 decimals. */
export function atrExit(entry: number, atr: number): { stop: number; target: number } | null {
  if (!(entry > 0) || !(atr > 0)) return null;
  const stop = Math.round((entry - 1.5 * atr) * 10000) / 10000;
  const target = Math.round((entry + 2 * atr) * 10000) / 10000;
  if (!(stop < entry) || !(target > entry)) return null;
  return { stop, target };
}

/**
 * Whole shares from $32 over 1.5×ATR and the idle cash.
 * A risk budget of zero shares becomes one flagged share when the cash can buy it.
 */
export function etfAtrShares(entry: number, atr: number, cash: number): { qty: number; forcedOne: boolean } {
  if (!(entry > 0) || !(atr > 0) || !(cash >= entry)) return { qty: 0, forcedOne: false };
  const risk = Math.floor(ETF_RISK / (1.5 * atr));
  const room = Math.floor(cash / entry);
  if (risk >= 1) return { qty: Math.min(risk, room), forcedOne: false };
  if (room >= 1) return { qty: 1, forcedOne: true };
  return { qty: 0, forcedOne: false };
}

/**
 * E15 and E25 are a fresh cross of that session's own line.
 * E30 is a close strictly above the box low and at or below the 30% line.
 * Entry is the next clock session, filled at that open by the walker.
 */
export function etfOrders(bars: readonly EtfBar[], n: number, sessions: readonly string[], entryName: EtfEntryName = "E15"): Map<string, EtfOrder> {
  const out = new Map<string, EtfOrder>();
  const next = new Map<string, string>();
  for (let i = 0; i < sessions.length - 1; i += 1) next.set(sessions[i], sessions[i + 1]);
  const index = new Map(bars.map((bar, i) => [bar.date, i]));
  const fraction = entryName === "E25" ? 0.25 : entryName === "E30" ? 0.3 : 0.15;
  for (let i = 1; i < bars.length; i += 1) {
    const box = boxAt(bars, i, n);
    if (!box) continue;
    const line = lineOf(box.low, box.high, fraction);
    if (line == null) continue;
    if (entryName === "E30") {
      if (!(bars[i].c > box.low) || !(bars[i].c <= line)) continue;
    } else {
      const prev = boxAt(bars, i - 1, n);
      if (!prev) continue;
      const prevLine = lineOf(prev.low, prev.high, fraction);
      if (prevLine == null) continue;
      if (!(bars[i].c >= line) || !(bars[i - 1].c < prevLine)) continue;
    }
    let entry = next.get(bars[i].date) ?? null;
    if (!entry) {
      entry = sessions.find((date) => date > bars[i].date) ?? null;
    }
    if (!entry || out.has(entry) || !index.has(entry)) continue;
    out.set(entry, { stop: box.low, target: box.high, atr: atr14At(bars, i) });
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
