import type { TtmStatus } from "./round4";

/** Descriptive labels for the top-trade ledger. Not a pass/fail rule. */

export type ExitLabel = "take-profit" | "stop" | "gap-through-stop" | "timeout" | "window";
export type ProfitLabel = "profit" | "loss" | "unknown";

export type TradeIdentity = {
  ticker: string;
  entryDate: string;
  exitDate: string;
  pnlUsd: number;
  seenIn: string[];
};

/** Planned exit, or a window flatten when the fill date differs from the plan. */
export function exitLabel(reason: string, timing: string, planned: boolean): ExitLabel {
  if (!planned) return "window";
  if (reason === "target") return "take-profit";
  if (reason === "stop" && timing === "open") return "gap-through-stop";
  if (reason === "stop") return "stop";
  if (reason === "timeout") return "timeout";
  return "window";
}

export function profitLabel(status: TtmStatus): ProfitLabel {
  if (status === "negative") return "loss";
  if (status === "nonnegative") return "profit";
  return "unknown";
}

export function dedupeFills<T extends TradeIdentity>(rows: readonly T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.ticker}|${row.entryDate}|${row.exitDate}|${row.pnlUsd}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row, seenIn: [...row.seenIn] });
      continue;
    }
    for (const slice of row.seenIn) if (!prev.seenIn.includes(slice)) prev.seenIn.push(slice);
  }
  return [...map.values()];
}

export function topByPnl<T extends { pnlUsd: number; ticker: string; entryDate: string }>(rows: readonly T[], count: number, side: "winner" | "loser"): T[] {
  const sorted = [...rows].sort((a, b) => {
    const gap = side === "winner" ? b.pnlUsd - a.pnlUsd : a.pnlUsd - b.pnlUsd;
    return gap || a.ticker.localeCompare(b.ticker) || a.entryDate.localeCompare(b.entryDate);
  });
  return sorted.slice(0, count);
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function counts(rows: readonly string[]): Array<{ bucket: string; n: number }> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row, (map.get(row) ?? 0) + 1);
  return [...map.entries()].map(([bucket, n]) => ({ bucket, n })).sort((a, b) => b.n - a.n || a.bucket.localeCompare(b.bucket));
}
