import { formatJst } from "./format";
import { isTradingDay, minutesEt, todayEt } from "./calendar";

/**
 * Actionable feed for an external assistant that polls /api/alerts and sends the
 * notifications. Every id is derived only from market or filing data, so the same event
 * keeps the same id across restarts and the assistant dedupes by id alone.
 */
export type AlertKind =
  | "entry_in_ok"
  | "earnings_hold"
  | "review_break"
  | "material_news"
  | "sec_8k"
  | "sec_form4_sell"
  | "sec_offering"
  | "anthropic_s1";

export type AlertPriority = "critical" | "high" | "normal" | "low";

export type AlertItem = {
  id: string;
  kind: AlertKind;
  priority: AlertPriority;
  ticker: string | null;
  /** One Japanese line, usable as the notification text. */
  title: string;
  /** Two or three short lines with the numbers behind it. */
  body: string;
  /** UTC ISO. Signals use that session's 16:00 ET close; filings use EDGAR's acceptance time. */
  eventAt: string;
  eventAtJst: string;
  url: string | null;
  flags: string[];
  facts: Record<string, string | number | boolean | null>;
};

export type AlertSlot = "post_close" | "pre_open" | "session";

export type AlertSourceStatus = {
  ok: boolean;
  enabled: boolean;
  checkedAtJst: string | null;
  error: string | null;
  /** False while a sweep is still running. Poll again in about a minute. */
  complete: boolean;
};

export type AlertsPayload = {
  v: 1;
  generatedAt: string;
  generatedAtJst: string;
  slot: AlertSlot;
  barDate: string | null;
  /** False when any source is still filling in. */
  complete: boolean;
  sources: {
    prices: AlertSourceStatus & { provisional: boolean; failCount: number; staleCount: number };
    edgar: AlertSourceStatus;
    /** Review-line alerts: only for a caller with ALERTS_TOKEN or the holdings session. */
    holdings: AlertSourceStatus;
    /** Overnight headlines for holdings. Same gate as holdings. Empty hook means no items. */
    news: AlertSourceStatus;
  };
  counts: { total: number } & Partial<Record<AlertKind, number>>;
  items: AlertItem[];
};

const PRIORITY_ORDER: Record<AlertPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

function rsFact(item: AlertItem): number | null {
  const value = item.facts.rs20;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Higher relative strength first. Missing values last, then ticker. */
export function compareEntryRs(a: AlertItem, b: AlertItem): number {
  const av = rsFact(a);
  const bv = rsFact(b);
  if (av == null && bv == null) return (a.ticker ?? "").localeCompare(b.ticker ?? "") || a.id.localeCompare(b.id);
  if (av == null) return 1;
  if (bv == null) return -1;
  if (av !== bv) return av > bv ? -1 : 1;
  return (a.ticker ?? "").localeCompare(b.ticker ?? "") || a.id.localeCompare(b.id);
}

/**
 * Keeps non-entry items where they are and orders the entry_in_ok block by relative strength.
 * The block stays at the first entry item, so a critical filing still leads the feed.
 */
export function orderEntryAlertsByRs(items: AlertItem[]): AlertItem[] {
  const first = items.findIndex((item) => item.kind === "entry_in_ok");
  if (first < 0) return items;
  const entries = items.filter((item) => item.kind === "entry_in_ok").sort(compareEntryRs);
  const others = items.filter((item) => item.kind !== "entry_in_ok");
  return [...others.slice(0, first), ...entries, ...others.slice(first)];
}

/** Critical first, then newest first, then id so the order is stable. */
export function sortAlerts(items: AlertItem[]): AlertItem[] {
  return [...items].sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      b.eventAt.localeCompare(a.eventAt) ||
      a.id.localeCompare(b.id),
  );
}

/** Keeps the first item per id. Sources should not collide, but the feed must never repeat an id. */
export function dedupeAlerts(items: AlertItem[]): AlertItem[] {
  const seen = new Set<string>();
  const out: AlertItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function countAlerts(items: AlertItem[]): AlertsPayload["counts"] {
  const counts: AlertsPayload["counts"] = { total: items.length };
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
}

/**
 * post_close: from 16:20 ET (close is final) until 04:00 ET, and all day when the market is closed.
 * pre_open: 04:00–09:30 ET on a trading day. session: 09:30–16:20 ET.
 */
export function alertSlot(now = new Date()): AlertSlot {
  if (!isTradingDay(todayEt(now))) return "post_close";
  const minutes = minutesEt(now);
  if (minutes < 4 * 60) return "post_close";
  if (minutes < 9 * 60 + 30) return "pre_open";
  if (minutes < 16 * 60 + 20) return "session";
  return "post_close";
}

export function jst(iso: string): string {
  return formatJst(new Date(iso));
}

export function siteUrl(path: string): string {
  const base = (process.env.RENDER_EXTERNAL_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

export function filterSince(items: AlertItem[], since: string | null): AlertItem[] {
  if (!since) return items;
  const at = Date.parse(since);
  if (!Number.isFinite(at)) return items;
  return items.filter((item) => Date.parse(item.eventAt) >= at);
}
