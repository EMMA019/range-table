import { ATR_COST_WARN, MA_SLOPE_FLAT_PCT } from "./constants";
import { EARNINGS_UNKNOWN_PROMINENT } from "./constants";
import type { EarningsView, EntrySignal } from "./types";

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

export function guideLineText(line15: number, line25: number): string {
  return `15%ライン $${formatPx(line15)} / 25%ライン $${formatPx(line25)}`;
}

export const ENTRY_SIGNAL_LABEL: Record<EntrySignal, string> = {
  in_ok: "IN OK!",
  early: "まだ早いよ！",
  chase: "追いかけ注意",
  late: "新規は遅いよ",
};

export function entrySignalLabel(signal: EntrySignal): string {
  return ENTRY_SIGNAL_LABEL[signal];
}

/** Green, gray, amber, and rust for the four entry badges. */
export function entrySignalClass(signal: EntrySignal): string {
  if (signal === "in_ok") return "bg-sage-soft text-sage";
  if (signal === "chase") return "bg-copper-soft text-copper";
  if (signal === "late") return "bg-rust-soft text-rust";
  return "bg-chip text-muted";
}

/** 0 is 安値更新中. Null is the em dash. A positive count is 反発確認N日目. */
export function reboundText(days: number | null): string {
  if (days == null) return "—";
  if (days <= 0) return "安値更新中";
  return `反発確認${days}日目`;
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

/** Two decimals, matching the card. Negative uses the same minus as the other percents. */
export function formatCorr(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const shown = Math.round(n * 100) / 100;
  const sign = shown < 0 ? "−" : "";
  return `${sign}${Math.abs(shown).toFixed(2)}`;
}

/** Four decimals for the detail view. */
export function formatCorrExact(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const shown = Math.round(n * 10000) / 10000;
  const sign = shown < 0 ? "−" : "";
  return `${sign}${Math.abs(shown).toFixed(4)}`;
}

export function formatAtr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

/** $423, or $423.50 when there are cents. */
export function formatDollar(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const cents = Math.round(n * 100) / 100;
  const [whole, frac] = cents.toFixed(2).split(".");
  const grouped = Number(whole).toLocaleString("en-US");
  return frac === "00" ? `$${grouped}` : `$${grouped}.${frac}`;
}

/** ¥1,234,567, rounded to the yen. */
export function formatYen(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const body = Math.round(Math.abs(n)).toLocaleString("en-US");
  return n < 0 ? `−¥${body}` : `¥${body}`;
}

/** +$53.60 / −$8 / $0 for realized P&L. */
export function formatPnl(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const body = formatDollar(Math.abs(n));
  if (Math.round(n * 100) === 0) return body;
  return n > 0 ? `+${body}` : `−${body}`;
}

export function formatShares10(shares: number | null, cost: number | null): string {
  if (shares == null || cost == null || !Number.isFinite(shares) || !Number.isFinite(cost)) return "—";
  return `${shares}株 / ${formatDollar(cost)}`;
}

export function sharesCostWarn(cost: number | null): boolean {
  return cost != null && Number.isFinite(cost) && cost > ATR_COST_WARN;
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

export const EARNINGS_UNKNOWN = "決算日不明";

export function formatEarningsForAlert(e: EarningsView | null, unknown: boolean): string {
  if (unknown || !e) return EARNINGS_UNKNOWN_PROMINENT;
  const text = formatEarnings(e);
  if (text === EARNINGS_UNKNOWN) return EARNINGS_UNKNOWN_PROMINENT;
  return text;
}
export const EARNINGS_AVOID_BADGE = "決算前・新規は避けて";
export const SEMI_CAP_BADGE = "半導体2枠埋まり";

/** Countdown for a known next earnings date. Null once that date is in the past. */
export function earningsCountdown(e: EarningsView | null): string | null {
  if (!e || e.state === "past") return null;
  return `決算まであと${e.tradingDays ?? 0}営業日`;
}

export function formatEarnings(e: EarningsView | null): string {
  if (!e) return EARNINGS_UNKNOWN;
  const countdown = earningsCountdown(e);
  if (countdown) return countdown;
  const when = shortDate(e.date);
  const status = e.status === "confirmed" ? "確" : "推定";
  return `決算済 ${when}（${status}）`;
}

/** Red badge once the next earnings date is inside five trading days, including today. */
export function earningsBadge(e: EarningsView | null): string | null {
  if (!e?.warn) return null;
  return EARNINGS_AVOID_BADGE;
}

/** Signed percent. `rs` is a return difference (0.024 = +2.4%). */
export function formatRs(rs: number | null): string {
  if (rs == null || !Number.isFinite(rs)) return "—";
  return formatDev(rs * 100);
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
