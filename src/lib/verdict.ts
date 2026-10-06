import { BOX_BOTTOM_MAX, BOX_REBOUND_MAX, MA_SLOPE_FLAT_PCT } from "./constants";
import { boxShown } from "./format";
import { boxMetricsUnreliable } from "./compute";
import type { EarningsView, Quote } from "./types";

export type VerdictState = "見送り" | "待ち" | "候補";

export type VerdictView = {
  state: VerdictState;
  reason: string;
};

/**
 * One-glance monitoring label (not a buy recommendation). Evaluated in order:
 *
 * **見送り** — do not treat as a swing entry candidate:
 * - Corporate-action warning (unreliable 20-day box), or
 * - Downtrend flag (see downtrend.ts: 5-day ×3 lower highs/lows + falling 20DMA), or
 * - 20-day low touched within the last 3 sessions while 20DMA is falling (≤ −MA_SLOPE_FLAT_PCT%).
 *
 * **待ち** — watch, not ready:
 * - Earnings within the warn window (≤5 sessions confirmed), or
 * - Box bottom zone (≤BOX_BOTTOM_MAX%) without rebound confirmation (reboundDays null or 0), or
 * - Default when not skip/candidate.
 *
 * **候補** — meets rebound / IN OK conditions and not 見送り:
 * - entrySignal `in_ok`, or
 * - Box ≤ BOX_REBOUND_MAX% with reboundDays ≥ 1 (反発待ち圏), and box metrics reliable.
 */
export function computeVerdict(quote: Quote, earnings: EarningsView | null): VerdictView {
  if (quote.corpActionWarning) {
    return { state: "見送り", reason: "分割/スピンオフ疑い（箱は参考外）" };
  }
  if (quote.downtrend.active) {
    return { state: "見送り", reason: "高値・安値切り下げ中" };
  }
  if (
    quote.low20DaysAgo <= 3 &&
    quote.maSlopePct != null &&
    quote.maSlopePct <= -MA_SLOPE_FLAT_PCT
  ) {
    return { state: "見送り", reason: "安値更新直後・20日線下向き" };
  }

  if (earnings?.warn) {
    return { state: "待ち", reason: "決算が近い" };
  }

  const boxOk = !boxMetricsUnreliable(quote);
  const reboundConfirmed =
    boxOk &&
    quote.reboundDays != null &&
    quote.reboundDays >= 1 &&
    boxShown(quote.boxPct) <= BOX_REBOUND_MAX;
  const inOk = boxOk && quote.entrySignal === "in_ok";

  if (inOk || reboundConfirmed) {
    return {
      state: "候補",
      reason: inOk ? "IN OK!（反発＋15〜25%帯）" : "反発確認・底圏",
    };
  }

  if (boxOk && boxShown(quote.boxPct) <= BOX_BOTTOM_MAX && (quote.reboundDays == null || quote.reboundDays <= 0)) {
    return { state: "待ち", reason: "底圏・反発未確認" };
  }

  return { state: "待ち", reason: "エントリー条件外" };
}

export function attachVerdict(quote: Quote, earnings: EarningsView | null): Quote {
  return { ...quote, verdict: computeVerdict(quote, earnings) };
}

export function isCandidateVerdict(quote: Quote | null | undefined): boolean {
  return quote?.verdict.state === "候補";
}
