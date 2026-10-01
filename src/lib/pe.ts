import { PE_RECOVERY_MULTIPLE } from "./constants";
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
  };
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
  return {
    trailingEps,
    forwardEps,
    trailingPe,
    forwardPe,
    recovering: isRecovering(trailingPe, forwardPe),
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
