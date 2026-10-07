import fs from "node:fs";
import path from "node:path";
import { isIgnoredTicker } from "./holdings";
import type { Bar } from "./types";

export type StopRule =
  | { ticker: string; kind: "price"; price: number }
  | { ticker: string; kind: "belowMa20" };

const STOPS_PATH = path.join(process.cwd(), "data", "stops.json");

export function loadStopRules(file = STOPS_PATH): StopRule[] {
  try {
    return parseStopRules(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
  } catch (error) {
    console.error("[range] stops", error);
    return [];
  }
}

export function parseStopRules(json: unknown): StopRule[] {
  const root = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const rows = Array.isArray(root.rules) ? root.rules : [];
  const out: StopRule[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
    if (!ticker || isIgnoredTicker(ticker)) continue;
    if (row.kind === "belowMa20") {
      out.push({ ticker, kind: "belowMa20" });
      continue;
    }
    if (row.kind === "price" && typeof row.price === "number" && row.price > 0) {
      out.push({ ticker, kind: "price", price: row.price });
    }
  }
  return out;
}

export function ma20Close(bars: Bar[] | undefined): number | null {
  if (!bars || bars.length < 20) return null;
  const slice = bars.slice(-20);
  const sum = slice.reduce((total, bar) => total + bar.c, 0);
  return sum / 20;
}

/** Price to review against. A 20-day average rule needs bars. ONDS never gets a level. */
export function stopLevel(ticker: string, bars: Bar[] | undefined, rules: StopRule[]): number | null {
  const symbol = ticker.trim().toUpperCase();
  if (isIgnoredTicker(symbol)) return null;
  const rule = rules.find((item) => item.ticker === symbol);
  if (!rule) return null;
  if (rule.kind === "price") return rule.price;
  return ma20Close(bars);
}

export function stopsPath(): string {
  return STOPS_PATH;
}
