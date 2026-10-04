import {
  EPS_CACHE_TTL_MS,
  EPS_FAIL_TTL_MS,
  EPS_RATE_LIMIT_TTL_MS,
  EPS_TIMEOUT_TTL_MS,
  PE_RECOVERY_MULTIPLE,
} from "./constants";
import type { EpsSnapshot, PeView } from "./types";

export const PE_SOURCE_NOTE = `出典: Yahoo Finance（実績=過去12か月EPS、予想=アナリスト予想EPS）。実績PERが予想PERの${PE_RECOVERY_MULTIPLE}倍以上のとき「利益回復中」。`;

export function parseQuoteSummary(json: unknown): EpsSnapshot | null {
  if (!json || typeof json !== "object") return null;
  const summary = "quoteSummary" in json ? json.quoteSummary : null;
  if (!summary || typeof summary !== "object") return null;
  const result = "result" in summary ? summary.result : null;
  const first = Array.isArray(result) ? result[0] : null;
  if (!first || typeof first !== "object") return null;

  const stats = "defaultKeyStatistics" in first ? first.defaultKeyStatistics : null;
  const financial = "financialData" in first ? first.financialData : null;
  const ttmNetIncome = incomeFromModules(stats, financial, first as Record<string, unknown>);
  const profitSource = ttmNetIncome != null ? "yahoo:quoteSummary" : null;
  const nextEarningsDate = parseYahooNextEarningsFromSummary(first);
  return {
    trailingEps: firstEps(stats, financial, "trailingEps"),
    forwardEps: firstEps(stats, financial, "forwardEps"),
    ttmNetIncome,
    profitSource,
    nextEarningsDate,
    error: null,
  };
}

/** Next earnings session from quoteSummary calendarEvents, if present. */
export function parseYahooNextEarningsFromSummary(first: unknown): string | null {
  if (!first || typeof first !== "object" || !("calendarEvents" in first)) return null;
  const calendar = (first as { calendarEvents?: { earnings?: { earningsDate?: unknown[] } } }).calendarEvents;
  const dates = calendar?.earnings?.earningsDate;
  if (!Array.isArray(dates) || dates.length === 0) return null;
  const raw = dates[0];
  if (typeof raw === "number" && Number.isFinite(raw)) return new Date(raw * 1000).toISOString().slice(0, 10);
  if (raw && typeof raw === "object" && "raw" in raw) {
    const n = (raw as { raw?: number }).raw;
    if (typeof n === "number" && Number.isFinite(n)) return new Date(n * 1000).toISOString().slice(0, 10);
  }
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

function incomeFromModules(stats: unknown, financial: unknown, root: Record<string, unknown>): number | null {
  for (const mod of [financial, stats]) {
    if (!mod || typeof mod !== "object") continue;
    if ("netIncomeToCommon" in mod) {
      const value = rawNumber((mod as Record<string, unknown>).netIncomeToCommon);
      if (value != null) return value;
    }
  }
  const history = "incomeStatementHistory" in root ? root.incomeStatementHistory : null;
  if (history && typeof history === "object" && "history" in history) {
    const rows = (history as { history?: unknown[] }).history;
    if (Array.isArray(rows)) {
      let sum = 0;
      let count = 0;
      for (const row of rows.slice(0, 4)) {
        if (!row || typeof row !== "object" || !("netIncome" in row)) continue;
        const value = rawNumber((row as Record<string, unknown>).netIncome);
        if (value == null) continue;
        sum += value;
        count += 1;
      }
      if (count >= 4) return sum;
    }
  }
  return null;
}

/** EPS embedded in the finance.yahoo.com quote page, escaped or plain JSON. */
export function parseQuotePage(html: string): EpsSnapshot | null {
  if (!html) return null;
  const trailingEps = readEmbeddedRaw(html, "trailingEps");
  const forwardEps = readEmbeddedRaw(html, "forwardEps");
  if (trailingEps == null && forwardEps == null) return null;
  return { trailingEps, forwardEps, error: null };
}

function readEmbeddedRaw(html: string, key: string): number | null {
  const patterns = [
    new RegExp(key + String.raw`\\":\{\\"raw\\":(-?\d+(?:\.\d+)?)`),
    new RegExp(`"${key}"\\s*:\\s*\\{\\s*"raw"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/** v7 /finance/quote fields. Numbers are plain, not `{raw}` objects. */
export function parseV7Quotes(json: unknown): Array<{ ticker: string } & EpsSnapshot> {
  if (!json || typeof json !== "object" || !("quoteResponse" in json)) return [];
  const response = json.quoteResponse;
  if (!response || typeof response !== "object" || !("result" in response)) return [];
  if (!Array.isArray(response.result)) return [];
  const out: Array<{ ticker: string } & EpsSnapshot> = [];
  for (const item of response.result) {
    if (!item || typeof item !== "object" || !("symbol" in item)) continue;
    const symbol = item.symbol;
    if (typeof symbol !== "string" || !symbol) continue;
    out.push({
      ticker: symbol.toUpperCase(),
      trailingEps: plainNumber("epsTrailingTwelveMonths" in item ? item.epsTrailingTwelveMonths : null),
      forwardEps: plainNumber("epsForward" in item ? item.epsForward : null),
      error: null,
    });
  }
  return out;
}

export function hasEpsValue(eps: { trailingEps: number | null; forwardEps: number | null }): boolean {
  return eps.trailingEps != null || eps.forwardEps != null;
}

type CachedEps = {
  trailingEps: number | null;
  forwardEps: number | null;
  fetchedAt: number;
  error?: string | null;
};

/** How long this read may be reused. Successes last a day. Timeouts and rate limits are shorter than other failures. */
export function epsTtlMs(entry: {
  trailingEps: number | null;
  forwardEps: number | null;
  error?: string | null;
}): number {
  if (hasEpsValue(entry)) return EPS_CACHE_TTL_MS;
  const error = entry.error ?? "";
  if (/timeout|aborted|AbortError/i.test(error)) return EPS_TIMEOUT_TTL_MS;
  if (/429/.test(error)) return EPS_RATE_LIMIT_TTL_MS;
  return EPS_FAIL_TTL_MS;
}

/** Successful EPS stays for a day. Empty or failed reads expire after about 10 minutes. */
export function epsIsFresh(entry: CachedEps | undefined, now: number): boolean {
  if (!entry || !Number.isFinite(entry.fetchedAt)) return false;
  return now - entry.fetchedAt < epsTtlMs(entry);
}

/**
 * Symbols that still need an EPS read, oldest attempt first.
 * Names that have never been fetched sort ahead of recent timeouts, so one slow batch cannot starve the list.
 */
export function pickEpsBatch(
  symbols: string[],
  quotes: Record<string, CachedEps>,
  now: number,
  limit: number,
): string[] {
  return symbols
    .filter((symbol) => !epsIsFresh(quotes[symbol], now))
    .sort((a, b) => (quotes[a]?.fetchedAt ?? 0) - (quotes[b]?.fetchedAt ?? 0))
    .slice(0, Math.max(0, limit));
}

export function friendlyEpsError(detail: string | null): string {
  if (!detail) return "EPSを取得できなかった";
  if (/HTTP 429/.test(detail)) return "データ元が混んでいる";
  if (/HTTP 401|HTTP 403|crumb|cookie/i.test(detail)) return "データ元がEPSを返さなかった";
  if (/HTTP 404/.test(detail)) return "ティッカーが見つからない";
  if (/timeout|aborted|AbortError/i.test(detail)) return "EPSの取得がタイムアウトした";
  if (/まだない/.test(detail)) return "EPSを取得中";
  if (/空/.test(detail)) return "EPSが空だった";
  return "EPSを取得できなかった";
}

export function computePe(price: number | null | undefined, eps: number | null): number | null {
  if (price == null || eps == null) return null;
  if (!Number.isFinite(price) || !Number.isFinite(eps)) return null;
  if (!(price > 0) || !(eps > 0)) return null;
  return price / eps;
}

export function peView(price: number | null | undefined, eps: EpsSnapshot | null): PeView {
  const trailingEps = eps?.trailingEps ?? null;
  const forwardEps = eps?.forwardEps ?? null;
  const trailingPe = computePe(price, trailingEps);
  const forwardPe = computePe(price, forwardEps);
  const gotEps = eps != null && hasEpsValue(eps);
  return {
    trailingEps,
    forwardEps,
    trailingPe,
    forwardPe,
    recovering: isRecovering(trailingPe, forwardPe),
    error: gotEps ? null : friendlyEpsError(eps?.error ?? (eps ? "EPSが空" : "EPSがまだない")),
    errorDetail: gotEps ? null : (eps?.error ?? null),
  };
}

export function isRecovering(trailingPe: number | null, forwardPe: number | null): boolean {
  if (trailingPe == null || forwardPe == null) return false;
  if (!(trailingPe > 0) || !(forwardPe > 0)) return false;
  return trailingPe >= forwardPe * PE_RECOVERY_MULTIPLE;
}

/** '赤字' when EPS is negative, one decimal when price and EPS are both positive, otherwise an em dash. */
export function formatPe(price: number | null | undefined, eps: number | null): string {
  if (eps != null && Number.isFinite(eps) && eps < 0) return "赤字";
  const pe = computePe(price, eps);
  if (pe == null) return "—";
  return (Math.round(pe * 10) / 10).toFixed(1);
}

function firstEps(
  stats: unknown,
  financial: unknown,
  key: "trailingEps" | "forwardEps",
): number | null {
  const fromStats = moduleEps(stats, key);
  if (fromStats != null) return fromStats;
  return moduleEps(financial, key);
}

function moduleEps(mod: unknown, key: "trailingEps" | "forwardEps"): number | null {
  if (!mod || typeof mod !== "object" || !(key in mod)) return null;
  return rawNumber((mod as Record<string, unknown>)[key]);
}

function plainNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function rawNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.raw === "number" && Number.isFinite(record.raw)) return record.raw;
  if (typeof record.fmt === "string") {
    const parsed = Number(record.fmt.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
