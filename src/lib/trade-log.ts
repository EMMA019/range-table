import { IGNORED_TICKERS } from "./constants";
import type { Fill } from "./ibkr-parse";

/** All sells of one symbol on one US session date make one trade. */
export type ClosedTrade = {
  id: string;
  symbol: string;
  openDate: string;
  closeDate: string;
  qty: number;
  /** Lot cost plus the buy commission allocated per share. */
  cost: number;
  /** Sale amount minus the sell commission. */
  proceeds: number;
  pnl: number;
  fees: number;
  holdDays: number;
  /** "ibkr" when part of the position was bought before the imported period and IBKR's figure is used. */
  basis: "fifo" | "ibkr";
};

export type OpenLot = { symbol: string; qty: number; cost: number; since: string };

export type Kpi = {
  trades: number;
  wins: number;
  winRate: number | null;
  avgPnl: number | null;
  totalPnl: number;
  totalFees: number;
  /** Session dates whose realized total is at least the target, out of dates with a closing trade. */
  days10: { hit: number; tradingDays: number };
  byDay: Array<{ date: string; pnl: number; trades: number }>;
  bySymbol: Array<{ symbol: string; trades: number; pnl: number }>;
  /** Symbols where our fee-inclusive FIFO and IBKR's realized P/L differ by more than 5 cents. */
  reconcile: Array<{ symbol: string; ours: number; ibkr: number }>;
};

export type TradeLog = { trades: ClosedTrade[]; open: OpenLot[]; kpi: Kpi; warnings: string[] };

export const DAY_TARGET_USD = 10;
const EPS = 1e-9;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Time order; without times, buys come before sells on the same date (a cash account cannot short). */
export function sortFills(fills: Fill[]): Fill[] {
  return [...fills].sort(
    (a, b) =>
      a.tradeDate.localeCompare(b.tradeDate) ||
      (a.tradeAt && b.tradeAt ? a.tradeAt.localeCompare(b.tradeAt) : 0) ||
      (a.side === b.side ? 0 : a.side === "BUY" ? -1 : 1) ||
      a.id.localeCompare(b.id),
  );
}

type Lot = { qty: number; unitCost: number; date: string };
type Leg = { symbol: string; date: string; qty: number; cost: number; proceeds: number; fees: number; openDate: string; basis: "fifo" | "ibkr"; pnl: number };

export function buildTradeLog(fills: Fill[], ignored: readonly string[] = IGNORED_TICKERS): TradeLog {
  const skip = new Set(ignored);
  const used = sortFills(fills.filter((fill) => !skip.has(fill.symbol)));
  const lots = new Map<string, Lot[]>();
  const legs: Leg[] = [];
  const warnings: string[] = [];
  const unknown = new Set<string>();
  const ours = new Map<string, number>();
  const theirs = new Map<string, number>();

  for (const fill of used) {
    const queue = lots.get(fill.symbol) ?? [];
    lots.set(fill.symbol, queue);
    if (fill.side === "BUY") {
      queue.push({ qty: fill.qty, unitCost: (fill.qty * fill.price - fill.commission) / fill.qty, date: fill.tradeDate });
      continue;
    }
    const proceeds = fill.qty * fill.price + fill.commission;
    const held = queue.reduce((sum, lot) => sum + lot.qty, 0);
    let remaining = fill.qty;
    let cost = 0;
    let openDate = fill.tradeDate;
    while (remaining > EPS && queue.length > 0) {
      const lot = queue[0];
      const take = Math.min(lot.qty, remaining);
      cost += take * lot.unitCost;
      if (lot.date < openDate) openDate = lot.date;
      lot.qty -= take;
      remaining -= take;
      if (lot.qty <= EPS) queue.shift();
    }
    const base = { symbol: fill.symbol, date: fill.tradeDate, qty: fill.qty, proceeds, fees: -fill.commission, openDate };
    if (held + EPS >= fill.qty) {
      const pnl = proceeds - cost;
      legs.push({ ...base, cost, basis: "fifo", pnl });
      if (fill.ibkrRealized != null) {
        ours.set(fill.symbol, (ours.get(fill.symbol) ?? 0) + pnl);
        theirs.set(fill.symbol, (theirs.get(fill.symbol) ?? 0) + fill.ibkrRealized);
      }
    } else if (fill.ibkrRealized != null) {
      legs.push({ ...base, cost: proceeds - fill.ibkrRealized, basis: "ibkr", pnl: fill.ibkrRealized });
      if (!unknown.has(fill.symbol)) warnings.push(`${fill.symbol}: 期間より前に買った分があるので、IBKRの実現損益を使った`);
      unknown.add(fill.symbol);
    } else {
      if (!unknown.has(fill.symbol)) warnings.push(`${fill.symbol}: 期間より前に買った分の取得額が分からないため、その売りは集計から外した`);
      unknown.add(fill.symbol);
    }
  }

  const grouped = new Map<string, Leg[]>();
  for (const leg of legs) {
    const key = `${leg.symbol}:${leg.date}`;
    grouped.set(key, [...(grouped.get(key) ?? []), leg]);
  }
  const trades: ClosedTrade[] = [...grouped.entries()].map(([key, group]) => {
    const openDate = group.reduce((min, leg) => (leg.openDate < min ? leg.openDate : min), group[0].openDate);
    const sum = (pick: (leg: Leg) => number) => group.reduce((total, leg) => total + pick(leg), 0);
    return {
      id: `trade:${key}`,
      symbol: group[0].symbol,
      openDate,
      closeDate: group[0].date,
      qty: sum((leg) => leg.qty),
      cost: round2(sum((leg) => leg.cost)),
      proceeds: round2(sum((leg) => leg.proceeds)),
      pnl: round2(sum((leg) => leg.pnl)),
      fees: round2(sum((leg) => leg.fees)),
      holdDays: daysBetween(openDate, group[0].date),
      basis: group.some((leg) => leg.basis === "ibkr") ? "ibkr" : "fifo",
    };
  });
  trades.sort((a, b) => b.closeDate.localeCompare(a.closeDate) || a.symbol.localeCompare(b.symbol));

  const open: OpenLot[] = [];
  for (const [symbol, queue] of lots) {
    const qty = queue.reduce((sum, lot) => sum + lot.qty, 0);
    if (qty <= EPS) continue;
    open.push({
      symbol,
      qty,
      cost: round2(queue.reduce((sum, lot) => sum + lot.qty * lot.unitCost, 0)),
      since: queue[0].date,
    });
  }
  open.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const reconcile = [...ours.entries()]
    .map(([symbol, value]) => ({ symbol, ours: round2(value), ibkr: round2(theirs.get(symbol) ?? 0) }))
    .filter((row) => Math.abs(row.ours - row.ibkr) > 0.05);

  const totalFees = round2(used.reduce((sum, fill) => sum - fill.commission, 0));
  return { trades, open, kpi: kpiOf(trades, totalFees, reconcile), warnings };
}

export function kpiOf(trades: ClosedTrade[], totalFees: number, reconcile: Kpi["reconcile"] = []): Kpi {
  const days = new Map<string, { pnl: number; trades: number }>();
  const symbols = new Map<string, { trades: number; pnl: number }>();
  for (const trade of trades) {
    const day = days.get(trade.closeDate) ?? { pnl: 0, trades: 0 };
    days.set(trade.closeDate, { pnl: day.pnl + trade.pnl, trades: day.trades + 1 });
    const sym = symbols.get(trade.symbol) ?? { trades: 0, pnl: 0 };
    symbols.set(trade.symbol, { trades: sym.trades + 1, pnl: sym.pnl + trade.pnl });
  }
  const byDay = [...days.entries()]
    .map(([date, value]) => ({ date, pnl: round2(value.pnl), trades: value.trades }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const totalPnl = round2(trades.reduce((sum, trade) => sum + trade.pnl, 0));
  const wins = trades.filter((trade) => trade.pnl > 0).length;
  return {
    trades: trades.length,
    wins,
    winRate: trades.length ? wins / trades.length : null,
    avgPnl: trades.length ? round2(totalPnl / trades.length) : null,
    totalPnl,
    totalFees,
    days10: { hit: byDay.filter((day) => day.pnl >= DAY_TARGET_USD).length, tradingDays: byDay.length },
    byDay,
    bySymbol: [...symbols.entries()]
      .map(([symbol, value]) => ({ symbol, trades: value.trades, pnl: round2(value.pnl) }))
      .sort((a, b) => b.pnl - a.pnl || a.symbol.localeCompare(b.symbol)),
    reconcile,
  };
}

export type MergeResult = { fills: Fill[]; added: number; duplicates: number; overlapSkipped: number };

/**
 * Adds new fills by id. The two export formats describe the same executions differently, so a
 * symbol-day already loaded from the other format is left as it is instead of being doubled.
 */
export function mergeFills(existing: Fill[], incoming: Fill[]): MergeResult {
  const ids = new Set(existing.map((fill) => fill.id));
  const daySource = new Map<string, Fill["source"]>();
  for (const fill of existing) daySource.set(`${fill.symbol}:${fill.tradeDate}`, fill.source);
  const out = [...existing];
  let added = 0;
  let duplicates = 0;
  let overlapSkipped = 0;
  for (const fill of incoming) {
    if (ids.has(fill.id)) {
      duplicates += 1;
      continue;
    }
    const source = daySource.get(`${fill.symbol}:${fill.tradeDate}`);
    if (source && source !== fill.source) {
      overlapSkipped += 1;
      continue;
    }
    ids.add(fill.id);
    out.push(fill);
    added += 1;
  }
  return { fills: sortFills(out), added, duplicates, overlapSkipped };
}

/** Shape check for a JSON backup before it replaces the stored fills. */
export function isFill(value: unknown): value is Fill {
  if (!value || typeof value !== "object") return false;
  const fill = value as Record<string, unknown>;
  return (
    typeof fill.id === "string" &&
    (fill.source === "activity" || fill.source === "history") &&
    typeof fill.symbol === "string" &&
    typeof fill.tradeDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(fill.tradeDate) &&
    (fill.side === "BUY" || fill.side === "SELL") &&
    typeof fill.qty === "number" &&
    fill.qty > 0 &&
    typeof fill.price === "number" &&
    typeof fill.commission === "number" &&
    (fill.tradeAt === null || typeof fill.tradeAt === "string") &&
    (fill.ibkrRealized === null || typeof fill.ibkrRealized === "number")
  );
}
