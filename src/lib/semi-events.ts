import fs from "node:fs";
import path from "node:path";
import { tradingDaysUntil } from "./calendar";
import { isIgnoredTicker } from "./holdings";
import type { EarningsSession } from "./earnings-session";

/** Names whose results move the semiconductor complex, not a single small supplier. */
export const SEMI_BELLWETHERS = [
  "NVDA",
  "AVGO",
  "TSM",
  "ASML",
  "AMD",
  "AMAT",
  "LRCX",
  "KLAC",
  "MU",
  "ARM",
  "TXN",
  "QCOM",
  "INTC",
  "MRVL",
  "ON",
  "SNPS",
  "CDNS",
] as const;

const EXTRA_PATH = path.join(process.cwd(), "data", "semi_events.json");

export type EarningsEventInput = {
  ticker: string;
  date: string;
  status: "confirmed" | "estimated";
  session: EarningsSession | null;
};

export type ExtraSemiEvent = { date: string; title: string };

export type ListedSemiEvent = { date: string; label: string };

export function loadExtraSemiEvents(file = EXTRA_PATH): ExtraSemiEvent[] {
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { events?: unknown };
    if (!Array.isArray(json.events)) return [];
    const out: ExtraSemiEvent[] = [];
    for (const raw of json.events) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const date = typeof row.date === "string" ? row.date : "";
      const title = typeof row.title === "string" ? row.title.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) continue;
      out.push({ date, title });
    }
    return out;
  } catch {
    return [];
  }
}

function sessionWord(session: EarningsSession | null): string {
  if (session === "pre") return "寄り前";
  if (session === "post") return "引け後";
  return "場は未登録";
}

/**
 * Up to five semiconductor-wide dates inside the next 10 trading days.
 * Bellwether earnings come from the calendar. Other dates only from data/semi_events.json.
 */
export function upcomingSemiEvents(input: {
  today: string;
  earnings: EarningsEventInput[];
  extra?: ExtraSemiEvent[];
  limit?: number;
  horizon?: number;
}): ListedSemiEvent[] {
  const limit = input.limit ?? 5;
  const horizon = input.horizon ?? 10;
  const bell = new Set<string>(SEMI_BELLWETHERS);
  const rows: ListedSemiEvent[] = [];
  for (const event of input.earnings) {
    const ticker = event.ticker.trim().toUpperCase();
    if (!bell.has(ticker) || isIgnoredTicker(ticker)) continue;
    if (event.date < input.today) continue;
    if (tradingDaysUntil(input.today, event.date) > horizon) continue;
    const status = event.status === "confirmed" ? "確" : "推定";
    rows.push({
      date: event.date,
      label: `${ticker} 決算 ${status}・${sessionWord(event.session)}`,
    });
  }
  for (const event of input.extra ?? []) {
    if (event.date < input.today) continue;
    if (tradingDaysUntil(input.today, event.date) > horizon) continue;
    rows.push({ date: event.date, label: event.title });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, "ja"));
  return rows.slice(0, limit);
}
