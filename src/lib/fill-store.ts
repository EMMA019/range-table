import type { Fill } from "./ibkr-parse";
import { isFill } from "./trade-log";

/** Browser storage only. Holds parsed fills, never the CSV and never an account number. */
export const FILLS_KEY = "rt.fills.v1";

export type FillsBackup = { v: 1; exportedAt: string; fills: Fill[] };

export function loadFills(storage: Pick<Storage, "getItem"> = window.localStorage): Fill[] {
  try {
    const raw = storage.getItem(FILLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isFill) : [];
  } catch {
    return [];
  }
}

export function saveFills(fills: Fill[], storage: Pick<Storage, "setItem" | "removeItem"> = window.localStorage): void {
  if (fills.length === 0) storage.removeItem(FILLS_KEY);
  else storage.setItem(FILLS_KEY, JSON.stringify(fills));
}

export function backupOf(fills: Fill[], now = new Date()): FillsBackup {
  return { v: 1, exportedAt: now.toISOString(), fills };
}

/** Accepts a backup object or a bare array; rows that do not look like fills are dropped and counted. */
export function readBackup(text: string): { fills: Fill[]; rejected: number } {
  const parsed = JSON.parse(text) as unknown;
  const rows = Array.isArray(parsed) ? parsed : (parsed as { fills?: unknown })?.fills;
  if (!Array.isArray(rows)) throw new Error("約定の一覧が無いJSON");
  const fills = rows.filter(isFill);
  return { fills, rejected: rows.length - fills.length };
}
