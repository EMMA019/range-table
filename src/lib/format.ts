import { MA_SLOPE_FLAT_PCT } from "./constants";
import type { EarningsView } from "./types";

const px = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPx(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return px.format(n);
}

/** One decimal, with an explicit sign. Matches the morning sheet's 乖離%. */
export function devShown(pct: number): number {
  return Math.round(pct * 10) / 10;
}

export function formatDev(pct: number): string {
  const shown = devShown(pct);
  if (shown === 0) return "0.0%";
  const sign = shown > 0 ? "+" : "−";
  return `${sign}${Math.abs(shown).toFixed(1)}%`;
}

/** One decimal. Filters use this same rounding so the chip matches the figure. */
export function boxShown(pct: number): number {
  return Math.round(pct * 10) / 10;
}

export function formatBox(pct: number): string {
  return `${boxShown(pct).toFixed(1)}%`;
}

export function slopeShown(pct: number): number {
  return Math.round(pct * 10) / 10;
}

export function formatSlope(pct: number): string {
  const shown = slopeShown(pct);
  if (shown === 0) return "0.0%";
  const sign = shown > 0 ? "+" : "−";
  return `${sign}${Math.abs(shown).toFixed(1)}%`;
}

export type SlopeLabel = "横ばい" | "上向き" | "下向き";

export function slopeLabel(pct: number): SlopeLabel {
  const shown = slopeShown(pct);
  if (shown >= MA_SLOPE_FLAT_PCT) return "上向き";
  if (shown <= -MA_SLOPE_FLAT_PCT) return "下向き";
  return "横ばい";
}

/** One decimal, so 1.76 displays as 1.8倍. */
export function formatVolumeRatio(ratio: number): string {
  return `${(Math.round(ratio * 10) / 10).toFixed(1)}倍`;
}

/** Two decimals for the detail view. */
export function formatVolumeRatioExact(ratio: number): string {
  return `${(Math.round(ratio * 100) / 100).toFixed(2)}倍`;
}

/** 12345678 → 12.3M. Shares, not yen. */
export function formatCompactShares(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const scaled =
    abs >= 1_000_000_000 ? n / 1_000_000_000 : abs >= 1_000_000 ? n / 1_000_000 : abs >= 1_000 ? n / 1_000 : n;
  const suffix = abs >= 1_000_000_000 ? "B" : abs >= 1_000_000 ? "M" : abs >= 1_000 ? "K" : "";
  if (!suffix) return Math.round(n).toLocaleString("en-US");
  return `${(Math.round(scaled * 10) / 10).toFixed(1)}${suffix}`;
}

export function formatShares(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function formatDollarVolume(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function formatAtr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  if (!m || !d) return iso;
  return `${Number(m)}/${Number(d)}`;
}

export function formatJst(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} JST`;
}

export function formatAge(fetchedAt: number, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (sec < 45) return "たった今取得";
  if (sec < 90) return "1分前に取得";
  const min = Math.round(sec / 60);
  return `${min}分前に取得`;
}

export function formatEarnings(e: EarningsView | null): string {
  if (!e) return "決算日の記載なし";
  const when = shortDate(e.date);
  const status = e.status === "confirmed" ? "確" : "推定";
  if (e.state === "past") return `決算済 ${when}（${status}）`;
  if (e.state === "today") return `本日決算（${status}）`;
  return `決算 ${when}（${status}）· あと${e.tradingDays}営業日`;
}

export function earningsBadge(e: EarningsView | null): string | null {
  if (!e?.warn) return null;
  if (e.state === "today") return "本日決算";
  return `決算あと${e.tradingDays}営業日`;
}

export function friendlyFetchError(message: string): string {
  if (/確定日足が/.test(message)) return message;
  if (/HTTP 404|No data|not found|Quote not found/i.test(message)) {
    return "ティッカーが見つからない";
  }
  if (/HTTP 429/.test(message)) return "データ元が混んでいる";
  if (/HTTP 5\d\d/.test(message)) return "データ元がエラーを返した";
  if (/timeout|aborted|AbortError/i.test(message)) return "取得がタイムアウトした";
  return "日足を取得できなかった";
}
