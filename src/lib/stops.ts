/** Stop used by the locked comparison. The box low and ATR14 are the signal session's. */
export type StopId = "low" | "pct5" | "pct10" | "atr15";

export const STOP_IDS: readonly StopId[] = ["low", "pct5", "pct10", "atr15"];

export function classStop(id: StopId, inClass: boolean, low20: number, atr: number): number {
  if (!inClass || id === "low") return low20;
  if (id === "pct5") return low20 * 0.95;
  if (id === "pct10") return low20 * 0.9;
  return low20 - 1.5 * atr;
}

export type StopWindowId = "oos" | "in";
export type StopUniverseId = "core" | "pit" | "adv";

export type StopSemi = {
  n: number;
  totalUsd: number;
  worstUsd: number | null;
};

export type StopRow = {
  id: StopId;
  universe: StopUniverseId;
  window: StopWindowId;
  totalUsd: number;
  worstUsd: number | null;
  n: number;
  winRate: number | null;
  trades10Share: number | null;
  daysMtm10Share: number | null;
  mtmDdUsd: number;
  semis: StopSemi;
};

export type StopReport = {
  v: 1;
  rulesCommit: string;
  generatedAt: string;
  rows: StopRow[];
};
