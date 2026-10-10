import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachVerdict, computeVerdict } from "./verdict";
import type { EarningsView, Quote } from "./types";
import { emptyWeekly } from "./weekly";

function baseQuote(partial: Partial<Quote> = {}): Quote {
  return {
    close: 100,
    closeDate: "2026-10-05",
    ma20: 110,
    devPct: -10,
    low20: 95,
    high20: 120,
    priorHigh20: 118,
    low5: null,
    high5: null,
    low10: null,
    high10: null,
    boxPct: 20,
    atr14: 3,
    shares10: 4,
    cost10: 400,
    brokeHigh: false,
    gapWarning: false,
    corpActionWarning: null,
    maSlopePct: -5,
    volume: 1e6,
    avgVolume20: 1e6,
    volumeRatio: 1,
    avgDollarVolume20: 1e8,
    line15: 98.75,
    line25: 101.25,
    line35: 103.75,
    reboundDays: 2,
    entrySignal: "in_ok",
    low20DaysAgo: 10,
    high20DaysAgo: 10,
    downtrend: { active: false, reason: null, lowDaysAgo: 10, highDaysAgo: 10 },
    weekly: emptyWeekly(),
    verdict: { state: "待ち", reason: "—" },
    ...partial,
  };
}

describe("verdict", () => {
  it("marks downtrend as 見送り", () => {
    const q = baseQuote({
      downtrend: { active: true, reason: "x", lowDaysAgo: 0, highDaysAgo: 5 },
    });
    assert.equal(computeVerdict(q, null).state, "見送り");
    assert.match(computeVerdict(q, null).reason, /切り下げ/);
  });

  it("marks fresh low with falling MA as 見送り", () => {
    const q = baseQuote({
      low20DaysAgo: 1,
      maSlopePct: -3,
      downtrend: { active: false, reason: null, lowDaysAgo: 1, highDaysAgo: 5 },
    });
    assert.equal(computeVerdict(q, null).state, "見送り");
  });

  it("marks IN OK as 候補 when clear", () => {
    const q = baseQuote({ entrySignal: "in_ok", reboundDays: 2, boxPct: 20 });
    assert.equal(computeVerdict(q, null).state, "候補");
  });

  it("prefers 待ち when earnings warn over 候補", () => {
    const q = baseQuote({ entrySignal: "in_ok" });
    const earn: EarningsView = {
      date: "2026-10-08",
      status: "confirmed",
      state: "upcoming",
      tradingDays: 3,
      warn: true,
    };
    assert.equal(computeVerdict(q, earn).state, "待ち");
  });

  it("attachVerdict sets quote.verdict", () => {
    const q = attachVerdict(baseQuote(), null);
    assert.equal(q.verdict.state, "候補");
  });
});

export function countVerdictStates(quotes: Quote[]): Record<Quote["verdict"]["state"], number> {
  const out: Record<Quote["verdict"]["state"], number> = { 見送り: 0, 待ち: 0, 候補: 0 };
  for (const q of quotes) out[q.verdict.state] += 1;
  return out;
}
