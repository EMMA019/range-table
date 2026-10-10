import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeQuote } from "./compute";
import type { Bar, EarningsView } from "./types";
import {
  SOXX_TAG,
  WEEKLY_CALL,
  boxWeekText,
  earningsBlocksWeeklyRebound,
  emptyWeekly,
  formatUpDays,
  formatWeekChange,
  resolveWeeklyCall,
  soxxCorrelationTag,
  weeklySharesText,
  weeklyStats,
} from "./weekly";

function bar(i: number, o: number, h: number, l: number, c: number): Bar {
  const day = String((i % 28) + 1).padStart(2, "0");
  const month = String(Math.floor(i / 28) + 1).padStart(2, "0");
  return { date: `2026-${month}-${day}`, o, h, l, c, v: 1_000_000 };
}

/** 20 quiet bars, then an optional tail. Quiet box is low 100, high 110. */
function quiet(n: number, tail: Array<[number, number, number, number]> = []): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < n; i++) bars.push(bar(i, 108, 110, 100, 108));
  tail.forEach(([o, h, l, c], offset) => {
    bars.push(bar(n + offset, o, h, l, c));
  });
  return bars;
}

describe("weeklyStats", () => {
  it("reads last week's box from bars that end that day", () => {
    const bars = quiet(20, [
      [108, 112, 103, 108],
      [108, 200, 116, 150],
      [150, 200, 116, 160],
      [160, 200, 116, 170],
      [170, 200, 116, 150],
    ]);
    const stats = weeklyStats(bars, 2, 150, 115);
    assert.equal(stats.boxPctPrev, 80);
    assert.equal(stats.touchedBottom, false, "Monday's low was above that day's 15% line");
    assert.equal(stats.boxPctSpark.length, 6);
    const full = computeQuote(bars);
    assert.equal(full.ok, true);
    if (!full.ok) return;
    assert.equal(full.quote.weekly.boxPctPrev, 80);
    assert.equal(full.quote.boxPct, 50);
  });

  it("counts a touch only against that day's own box", () => {
    const bars = quiet(20);
    bars.push(bar(20, 108, 110, 100, 102));
    const stats = weeklyStats(bars, 2, 102, bars.length ? 101.5 : 0);
    assert.equal(stats.touchedBottom, true);
    assert.equal(stats.newLowLast, true);
  });

  it("measures the week from the five sessions before the close", () => {
    const bars = quiet(20, [
      [100, 110, 90, 95],
      [95, 110, 94, 100],
      [100, 110, 96, 99],
      [99, 112, 98, 110],
      [110, 120, 100, 115],
    ]);
    const stats = weeklyStats(bars, 4, 115, 100);
    assert.equal(stats.upDays, 3);
    assert.equal(formatUpDays(stats.upDays), "3/5");
    assert.equal(stats.weekChangePct, Math.round((115 / 108 - 1) * 100 * 10000) / 10000);
    assert.equal(formatWeekChange(-2), "−2.00%");
    assert.equal(formatWeekChange(0), "0.00%");
    const weekLow = 90;
    const weekHigh = 120;
    const expectedPos = Math.round(((115 - weekLow) / (weekHigh - weekLow)) * 100 * 10000) / 10000;
    assert.equal(stats.weekClosePos, expectedPos);
    assert.deepEqual(boxWeekText(80, 60), { text: "80.0% → 60.0% ↓", direction: "down" });
    assert.equal(boxWeekText(null, 60).direction, "none");
  });

  it("sizes shares to $15 of risk and a $450 position", () => {
    const wide = weeklyStats(quiet(20), 20, 130, 110);
    assert.equal(wide.stop, 90);
    assert.equal(wide.shares, 0);
    assert.equal(wide.riskUsd, 0);
    assert.equal(weeklySharesText(wide, 130), "0株（1株で$15を超える）");

    const capped = weeklyStats(quiet(20), 0.2, 100, 99.5);
    assert.equal(capped.stop, 99.9);
    assert.equal(capped.shares, 4);
    assert.equal(capped.riskUsd, 0.4);

    const expensive = quiet(20).map((item) => ({ ...item, l: 490, h: 510, c: 500, o: 500 }));
    const pricey = weeklyStats(expensive, 2, 500, 493);
    assert.equal(pricey.shares, 0);
    assert.equal(weeklySharesText(pricey, 500), "0株（1株が$450を超える）");
  });

  it("flags a narrow range when ATR is under 3% of the close", () => {
    const narrow = weeklyStats(quiet(25), 2, 100, 101.5);
    assert.equal(narrow.atrPct, 2);
    assert.equal(narrow.narrowRange, true);
    const wide = weeklyStats(quiet(29), 4, 100, 101.5);
    assert.equal(wide.narrowRange, false);
    assert.equal(wide.boxPctSpark.length, 10);
  });
});

describe("weekly call", () => {
  const earn = (tradingDays: number, state: EarningsView["state"] = "upcoming"): EarningsView => ({
    date: "2026-10-15",
    status: "confirmed",
    state,
    tradingDays,
    warn: tradingDays <= 5,
  });

  function call(partial: Parameters<typeof emptyWeekly>[0], boxPct: number, slope: number | null, earnings: EarningsView | null = null) {
    return resolveWeeklyCall(
      { boxPct, maSlopePct: slope, weekly: emptyWeekly(partial) },
      earnings,
    );
  }

  it("names the rebound only when every price rule holds", () => {
    const setup = {
      touchedBottom: true,
      weekClosePos: 62,
      newLowLast: false,
      atrPct: 6.28,
      reboundSetup: true,
    };
    assert.equal(call(setup, 26.2, -0.29), WEEKLY_CALL.rebound);
    assert.equal(call({ ...setup, touchedBottom: false, reboundSetup: false }, 26.2, -0.29), null);
    assert.equal(call({ ...setup, weekClosePos: 31, reboundSetup: false }, 14.1, 0.3), WEEKLY_CALL.wait);
    assert.equal(call({ ...setup, newLowLast: true, reboundSetup: false }, 12.8, 0.52), WEEKLY_CALL.wait);
    assert.equal(call({ ...setup, atrPct: 2.2, reboundSetup: false }, 24.8, -1), WEEKLY_CALL.wait);
  });

  it("keeps a low box that already rebounded on the green list", () => {
    assert.equal(
      call(
        { touchedBottom: true, weekClosePos: 55.7, newLowLast: false, atrPct: 3.21, reboundSetup: true },
        22.4,
        -2.39,
      ),
      WEEKLY_CALL.rebound,
    );
  });

  it("replaces the rebound with an earnings tag inside 5 trading days", () => {
    const setup = { touchedBottom: true, reboundSetup: true, newLowLast: false, atrPct: 4, weekClosePos: 80 };
    assert.equal(earningsBlocksWeeklyRebound(earn(5)), true);
    assert.equal(earningsBlocksWeeklyRebound(earn(6)), false);
    assert.equal(earningsBlocksWeeklyRebound(earn(0, "today")), false);
    assert.equal(earningsBlocksWeeklyRebound(earn(0, "past")), false);
    assert.equal(call(setup, 40, 1, earn(5)), WEEKLY_CALL.earnings);
    assert.equal(call(setup, 20, 1, earn(5)), WEEKLY_CALL.earnings);
    assert.equal(call(setup, 40, 1, earn(6)), WEEKLY_CALL.rebound);
  });

  it("marks a fresh 20-day low with any negative 20-day slope, ahead of the wait badge", () => {
    assert.equal(call({ newLowLast: true, reboundSetup: false }, 0.7, -0.48), WEEKLY_CALL.avoid);
    assert.equal(call({ newLowLast: true, reboundSetup: false }, 12.8, 0.52), WEEKLY_CALL.wait);
    assert.equal(call({ newLowLast: true, reboundSetup: false }, 12.6, 0), WEEKLY_CALL.wait);
    assert.equal(call({ newLowLast: true, reboundSetup: false }, 12.6, null), WEEKLY_CALL.wait);
    assert.equal(call({ newLowLast: false, reboundSetup: false }, 16.8, -1), WEEKLY_CALL.wait);
    assert.equal(call({ newLowLast: false, reboundSetup: false }, 25, -1), null);
  });
});

describe("SOXX tag", () => {
  it("splits 0.30 and 0.50 on the two-decimal figure", () => {
    assert.equal(soxxCorrelationTag(0.501), SOXX_TAG.semi);
    assert.equal(soxxCorrelationTag(0.495), SOXX_TAG.semi);
    assert.equal(soxxCorrelationTag(0.4835), SOXX_TAG.mid);
    assert.equal(soxxCorrelationTag(0.3207), SOXX_TAG.mid);
    assert.equal(soxxCorrelationTag(0.304), SOXX_TAG.low);
    assert.equal(soxxCorrelationTag(0.2876), SOXX_TAG.low);
    assert.equal(soxxCorrelationTag(-0.1), SOXX_TAG.low);
    assert.equal(soxxCorrelationTag(null), null);
  });
});
