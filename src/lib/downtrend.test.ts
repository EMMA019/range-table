import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOX_WINDOW, MA_SLOPE_LOOKBACK } from "./constants";
import { computeQuote } from "./compute";
import { DOWNTREND_REASON, lowerHighsAndLows5x3 } from "./downtrend";
import type { Bar } from "./types";

function bar(date: string, o: number, h: number, l: number, c: number): Bar {
  return { date, o, h, l, c, v: 1_000_000 };
}

/** Last 15 sessions: three 5-bar blocks with lower highs/lows; prefix lifts MA for a down slope. */
function chrtLikeBars(): Bar[] {
  const bars: Bar[] = [];
  let d = 1;
  const day = () => {
    const iso = `2026-09-${String(d).padStart(2, "0")}`;
    d += 1;
    return iso;
  };
  const need = BOX_WINDOW + MA_SLOPE_LOOKBACK;
  for (let i = 0; i < need - 15; i++) {
    bars.push(bar(day(), 150, 152, 148, 150));
  }
  for (let i = 0; i < 15; i++) {
    const h = 130 - i * 2;
    const l = 125 - i * 2;
    const c = (h + l) / 2;
    bars.push(bar(day(), c, h, l, c));
  }
  return bars;
}

describe("downtrend", () => {
  it("detects lower highs and lows across three 5-day blocks", () => {
    const bars = chrtLikeBars();
    assert.equal(lowerHighsAndLows5x3(bars), true);
    const computed = computeQuote(bars);
    assert.equal(computed.ok, true);
    if (!computed.ok) return;
    assert.equal(computed.quote.low20DaysAgo, 0);
    assert.equal(computed.quote.downtrend.active, true);
    assert.equal(computed.quote.downtrend.reason, DOWNTREND_REASON);
  });
});
