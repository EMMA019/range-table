import { EPS_CACHE_TTL_MS, EPS_FAIL_TTL_MS, PE_RECOVERY_MULTIPLE } from "./constants";
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
  return {
    trailingEps: firstEps(stats, financial, "trailingEps"),
    forwardEps: firstEps(stats, financial, "forwardEps"),
    error: null,
  };
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

/** Successful EPS stays for a day. Empty or failed reads expire after about 10 minutes. */
export function epsIsFresh(
  entry: { trailingEps: number | null; forwardEps: number | null; fetchedAt: number } | undefined,
  now: number,
): boolean {
  if (!entry || !Number.isFinite(entry.fetchedAt)) return false;
  const ttl = hasEpsValue(entry) ? EPS_CACHE_TTL_MS : EPS_FAIL_TTL_MS;
  return now - entry.fetchedAt < ttl;
}

export function friendlyEpsError(detail: string | null): string {
  if (!detail) return "EPSを取得できなかった";
  if (/HTTP 429/.test(detail)) return "データ元が混んでいる";
  if (/HTTP 401|HTTP 403|crumb|cookie/i.test(detail)) return "データ元がEPSを返さなかった";
  if (/HTTP 404/.test(detail)) return "ティッカーが見つからない";
  if (/timeout|aborted|AbortError/i.test(detail)) return "EPSの取得がタイムアウトした";
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
