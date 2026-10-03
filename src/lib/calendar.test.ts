import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTradingDay, tradingDaysUntil } from "./calendar";
import { classifyEarnings } from "./earnings";
import { EARNINGS_AVOID_BADGE, EARNINGS_UNKNOWN, earningsBadge, formatEarnings } from "./format";

describe("trading days", () => {
  it("skips the weekend between Thursday Oct 1 and Monday Oct 5 2026", () => {
    assert.equal(tradingDaysUntil("2026-10-01", "2026-10-05"), 2);
  });

  it("counts five sessions through Thursday Oct 8", () => {
    assert.equal(tradingDaysUntil("2026-10-01", "2026-10-08"), 5);
  });

  it("does not count Labor Day 2026", () => {
    assert.equal(isTradingDay("2026-09-07"), false);
    assert.equal(tradingDaysUntil("2026-09-04", "2026-09-08"), 1);
  });

  it("warns inside five sessions and not on the sixth", () => {
    const near = classifyEarnings("2026-10-01", {
      date: "2026-10-08",
      status: "estimated",
    });
    const far = classifyEarnings("2026-10-01", {
      date: "2026-10-09",
      status: "confirmed",
    });
    assert.equal(near?.warn, true);
    assert.equal(near?.tradingDays, 5);
    assert.equal(far?.warn, false);
    assert.equal(far?.tradingDays, 6);
  });

  it("marks a past date and earnings today", () => {
    const past = classifyEarnings("2026-10-01", {
      date: "2026-09-30",
      status: "confirmed",
    });
    const today = classifyEarnings("2026-10-01", {
      date: "2026-10-01",
      status: "estimated",
    });
    assert.equal(past?.state, "past");
    assert.equal(past?.warn, false);
    assert.equal(today?.state, "today");
    assert.equal(today?.tradingDays, 0);
    assert.equal(today?.warn, true);
  });

  it("shows the countdown, the avoid badge inside five sessions, and an unknown date", () => {
    const near = classifyEarnings("2026-10-01", { date: "2026-10-08", status: "estimated" });
    const far = classifyEarnings("2026-10-01", { date: "2026-10-09", status: "confirmed" });
    const past = classifyEarnings("2026-10-01", { date: "2026-09-30", status: "confirmed" });
    assert.equal(formatEarnings(near), "決算まであと5営業日");
    assert.equal(earningsBadge(near), EARNINGS_AVOID_BADGE);
    assert.equal(formatEarnings(far), "決算まであと6営業日");
    assert.equal(earningsBadge(far), null);
    assert.match(formatEarnings(past), /^決算済 /);
    assert.equal(earningsBadge(past), null);
    assert.equal(formatEarnings(null), EARNINGS_UNKNOWN);
    assert.equal(earningsBadge(null), null);
  });
});
