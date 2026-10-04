import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPortfolio, sharesForBudget, type Candidate } from "./backtest-study";
import { meanNet190, planRound7Exit, round7Verdict, type ExitBar } from "./round7";

function bar(date: string, o: number, h: number, l: number, c: number): ExitBar {
  return { date, o, h, l, c };
}

const days = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"];

describe("round 7 exits", () => {
  it("sells all at the close when the same bar hits the target and the stop", () => {
    const plan = planRound7Exit({
      variant: "A",
      bars: [bar(days[0], 100, 101, 99, 100), bar(days[1], 100, 100, 98, 100), bar(days[2], 100, 112, 80, 89)],
      entryIndex: 1,
      atr: 10,
      stop: 90,
      high20: 130,
      qty: 4,
    });
    assert.equal(plan?.reason, "stop");
    assert.equal(plan?.exit, 89);
    assert.equal(plan?.exitIndex, 2);
    assert.equal(plan?.legs.length, 1);
    assert.equal(plan?.legs[0]?.timing, "close");
  });

  it("still sells the target when the close holds the stop", () => {
    const plan = planRound7Exit({
      variant: "A",
      bars: [bar(days[0], 100, 101, 99, 100), bar(days[1], 100, 100, 98, 100), bar(days[2], 100, 112, 95, 108)],
      entryIndex: 1,
      atr: 10,
      stop: 90,
      high20: 130,
      qty: 4,
    });
    assert.equal(plan?.reason, "target");
    assert.equal(plan?.exit, 110);
  });

  it("treats one share as a full sale at +1 ATR", () => {
    const bars = [bar(days[0], 100, 101, 99, 100), bar(days[1], 100, 100, 98, 100), bar(days[2], 100, 112, 95, 108)];
    const single = planRound7Exit({ variant: "B", bars, entryIndex: 1, atr: 10, stop: 90, high20: 130, qty: 1 });
    const all = planRound7Exit({ variant: "A", bars, entryIndex: 1, atr: 10, stop: 90, high20: 130, qty: 1 });
    assert.deepEqual(single?.legs, all?.legs);
  });

  it("sells the floored half at +1 ATR and the rest at +2 ATR", () => {
    const plan = planRound7Exit({
      variant: "B",
      bars: [bar(days[0], 100, 101, 99, 100), bar(days[1], 100, 100, 98, 100), bar(days[2], 100, 125, 99, 124)],
      entryIndex: 1,
      atr: 10,
      stop: 80,
      high20: 140,
      qty: 5,
    });
    assert.deepEqual(
      plan?.legs.map((leg) => ({ qty: leg.qty, price: leg.price, reason: leg.reason })),
      [
        { qty: 2, price: 110, reason: "target" },
        { qty: 3, price: 120, reason: "target" },
      ],
    );
  });

  it("moves the remainder to the entry after the half fills", () => {
    const plan = planRound7Exit({
      variant: "B",
      bars: [
        bar(days[0], 100, 101, 99, 100),
        bar(days[1], 100, 105, 99, 104),
        bar(days[2], 100, 115, 99, 112),
        bar(days[3], 99, 101, 98, 100),
      ],
      entryIndex: 1,
      atr: 10,
      stop: 80,
      high20: 140,
      qty: 4,
    });
    assert.deepEqual(
      plan?.legs.map((leg) => ({ qty: leg.qty, price: leg.price, reason: leg.reason })),
      [
        { qty: 2, price: 110, reason: "target" },
        { qty: 2, price: 99, reason: "breakeven" },
      ],
    );
  });

  it("does not take the remainder target when that bar closes through the entry", () => {
    const plan = planRound7Exit({
      variant: "B",
      bars: [bar(days[0], 100, 101, 99, 100), bar(days[1], 100, 105, 99, 104), bar(days[2], 100, 125, 90, 99)],
      entryIndex: 1,
      atr: 10,
      stop: 80,
      high20: 140,
      qty: 4,
    });
    assert.equal(plan?.legs[0]?.reason, "target");
    assert.equal(plan?.legs[0]?.price, 110);
    assert.equal(plan?.legs[1]?.reason, "breakeven");
    assert.equal(plan?.legs[1]?.price, 99);
  });

  it("sells all at the box high", () => {
    const plan = planRound7Exit({
      variant: "C",
      bars: [bar(days[0], 100, 108, 99, 100), bar(days[1], 100, 107, 99, 106), bar(days[2], 101, 109, 100, 108)],
      entryIndex: 1,
      atr: 10,
      stop: 90,
      high20: 108,
      qty: 2,
    });
    assert.equal(plan?.reason, "target");
    assert.equal(plan?.exit, 108);
  });

  it("does not sell when +1 ATR is touched, then sells a later break of the prior low", () => {
    const plan = planRound7Exit({
      variant: "D",
      bars: [
        bar(days[0], 100, 101, 99, 100),
        bar(days[1], 100, 112, 100, 111),
        bar(days[2], 111, 112, 100, 110),
      ],
      entryIndex: 1,
      atr: 10,
      stop: 80,
      high20: 140,
      qty: 2,
    });
    assert.equal(plan?.reason, "priorLow");
    assert.equal(plan?.exit, 100);
    assert.equal(plan?.exitDate, days[2]);
  });

  it("fills a gap under the prior low at the open, and a gap under the box stop first", () => {
    const gap = planRound7Exit({
      variant: "D",
      bars: [bar(days[0], 100, 101, 99, 100), bar(days[1], 100, 112, 100, 111), bar(days[2], 95, 96, 94, 95)],
      entryIndex: 1,
      atr: 10,
      stop: 80,
      high20: 140,
      qty: 2,
    });
    assert.equal(gap?.reason, "priorLow");
    assert.equal(gap?.exit, 95);
    assert.equal(gap?.timing, "open");
    const through = planRound7Exit({
      variant: "D",
      bars: [bar(days[0], 100, 101, 99, 100), bar(days[1], 100, 112, 100, 111), bar(days[2], 79, 96, 78, 90)],
      entryIndex: 1,
      atr: 10,
      stop: 80,
      high20: 140,
      qty: 2,
    });
    assert.equal(through?.reason, "stop");
    assert.equal(through?.exit, 79);
  });

  it("replaces the engine sell fees with one $1.90 round trip", () => {
    assert.ok(Math.abs((meanNet190([{ pnlUsd: 10, sells: 1 }]) ?? 0) - 8.8) < 1e-9);
    assert.ok(Math.abs((meanNet190([{ pnlUsd: 10, sells: 2 }]) ?? 0) - 9.5) < 1e-9);
  });

  it("holds a judged window below 100 trades before a loss can fail", () => {
    assert.equal(round7Verdict({ judged: true, totalUsd: -1, n: 99, ratio: null, spyRatio: 4.37, lower: -1, nRequired: 10 }), "hold");
    assert.equal(round7Verdict({ judged: false, totalUsd: -1, n: 200, ratio: 0, spyRatio: 4.37, lower: -1, nRequired: 10 }), "not-judged");
  });

  it("charges $0.70 on each round-7 sell and keeps one trade", () => {
    assert.equal(sharesForBudget(100), 4);
    const bars = [bar(days[0], 100, 101, 99, 100), bar(days[1], 100, 105, 99, 104), bar(days[2], 100, 125, 99, 124), bar(days[3], 124, 125, 123, 124)];
    const plan = planRound7Exit({ variant: "B", bars, entryIndex: 1, atr: 10, stop: 80, high20: 140, qty: 4 });
    const cand: Candidate = {
      ticker: "AAA",
      sector: "",
      semi: false,
      signalIndex: 0,
      entryIndex: 1,
      exitIndex: plan?.exitIndex ?? 1,
      signalDate: days[0],
      entryDate: days[1],
      exitDate: plan?.exitDate ?? days[2],
      entry: 100,
      exit: plan?.exit ?? 100,
      atr: 10,
      atrPct: 10,
      boxPct: 10,
      rebound: 1,
      rs20: 0,
      stop: 80,
      qty10: 1,
      reason: "target",
      exitTiming: plan?.timing ?? "intraday",
      voided: false,
      round7Legs: plan?.legs,
    };
    const book = runPortfolio(
      {
        id: "b",
        label: "b",
        universe: "core",
        rank: "ticker",
        sessions: days.slice(0, 4),
        flatten: true,
        withRestart: false,
        closes: new Map([["AAA", new Map(bars.map((row) => [row.date, row.c]))]]),
        keepFills: true,
        keepRound7: true,
      },
      [cand],
    );
    assert.equal(book.n, 1);
    assert.equal(book.fills?.[0]?.pnlUsd, 58.6);
    assert.deepEqual(
      book.fills?.[0]?.legs?.map((leg) => leg.reason),
      ["target", "target"],
    );
  });
});
