import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPortfolio, type Candidate } from "./backtest-study";
import { legSplit, scaleActions, scaleFlatIndex } from "./scale-exit";
import { activeScale, boxedExit, expectancyR, feeRoomOk, riskShares, round3Verdict, strengthOk } from "./round3";

describe("risk shares", () => {
  it("floors the $32 budget and the $450 cap", () => {
    assert.equal(riskShares(100, 84), 2);
    assert.equal(riskShares(100, 68), 1);
    assert.equal(riskShares(10, 9), 32);
    assert.equal(riskShares(450, 440), 1);
  });

  it("skips a non-positive distance, a share that risks more than $32, and a share over $450", () => {
    assert.equal(riskShares(100, 100), null);
    assert.equal(riskShares(100, 101), null);
    assert.equal(riskShares(100, 67.99), null);
    assert.equal(riskShares(450.01, 440), null);
  });
});

describe("round 3 screens", () => {
  it("requires the midpoint room to cover $7", () => {
    assert.equal(feeRoomOk(10, 8, 4), true);
    assert.equal(feeRoomOk(10, 8, 3), false);
    assert.equal(feeRoomOk(8, 8, 10), false);
    assert.equal(feeRoomOk(null, 8, 10), false);
  });

  it("treats a null strength side as false", () => {
    assert.equal(strengthOk(null, 10, null), false);
    assert.equal(strengthOk(0.01, 10, null), true);
    assert.equal(strengthOk(null, 11, 10), true);
    assert.equal(strengthOk(-1, 10, 10), false);
  });

  it("drops a scale price that is not above the entry", () => {
    assert.deepEqual(activeScale(10, 10, 12), { mid: null, top: 12 });
    assert.deepEqual(activeScale(10, 9, 10), { mid: null, top: null });
  });

  it("holds a window under 100 trades before a loss can fail it", () => {
    const loss = { totalUsd: -20, ratio: null, spyRatio: 4.37, lower: -1, nRequired: 10 };
    assert.equal(round3Verdict({ judged: true, n: 99, ...loss }), "hold");
    assert.equal(round3Verdict({ judged: true, n: 100, ...loss }), "fail");
    assert.equal(round3Verdict({ judged: false, n: 400, totalUsd: 10, ratio: 9, spyRatio: 1.69, lower: 1, nRequired: 10 }), "not-judged");
  });

  it("averages R only where initial risk is positive", () => {
    assert.equal(expectancyR([10, -5], [20, 10]), 0);
    assert.equal(expectancyR([10], [0]), null);
    assert.equal(expectancyR([], []), null);
  });
});

describe("scale-out", () => {
  it("rounds the first half down", () => {
    assert.deepEqual(legSplit(1, true), { halfLeft: 0, restLeft: 1 });
    assert.deepEqual(legSplit(5, true), { halfLeft: 2, restLeft: 3 });
    assert.deepEqual(legSplit(5, false), { halfLeft: 0, restLeft: 5 });
  });

  it("sells the half at the midpoint and the rest at the top on the entry day", () => {
    const actions = scaleActions({
      phase: "rest",
      isEntryDay: true,
      open: 100,
      high: 130,
      close: 120,
      entry: 100,
      mid: 110,
      top: 130,
      stop: 80,
      halfOpen: true,
      restOpen: true,
      timeStop: false,
      timeout: false,
    });
    assert.deepEqual(actions, [
      { qty: "half", price: 110, timing: "intraday", reason: "target" },
      { qty: "rest", price: 130, timing: "intraday", reason: "target" },
    ]);
  });

  it("uses the later open for a gap through the top, and does not stop out on the entry open", () => {
    const gap = scaleActions({
      phase: "open",
      isEntryDay: false,
      open: 140,
      high: 141,
      close: 139,
      entry: 100,
      mid: 110,
      top: 130,
      stop: 80,
      halfOpen: true,
      restOpen: true,
      timeStop: false,
      timeout: false,
    });
    assert.deepEqual(gap, [{ qty: "all", price: 140, timing: "open", reason: "target" }]);
    const entryOpen = scaleActions({ ...gapArgs(), phase: "open", isEntryDay: true, open: 70 });
    assert.deepEqual(entryOpen, []);
  });

  it("sells only the unsold half when the open clears the midpoint", () => {
    const actions = scaleActions({
      phase: "open",
      isEntryDay: false,
      open: 115,
      high: 116,
      close: 114,
      entry: 100,
      mid: 110,
      top: 130,
      stop: 80,
      halfOpen: true,
      restOpen: true,
      timeStop: false,
      timeout: false,
    });
    assert.deepEqual(actions, [{ qty: "half", price: 115, timing: "open", reason: "target" }]);
  });

  it("checks the day-5 close after an intraday target", () => {
    const held = scaleActions({
      phase: "rest",
      isEntryDay: false,
      open: 101,
      high: 109,
      close: 100,
      entry: 100,
      mid: 110,
      top: 130,
      stop: 80,
      halfOpen: true,
      restOpen: true,
      timeStop: true,
      timeout: false,
    });
    assert.equal(held.length, 1);
    assert.equal(held[0].reason, "window");
    assert.equal(held[0].price, 100);
    const targeted = scaleActions({ ...heldArgs(), high: 130, close: 90 });
    assert.equal(targeted.some((action) => action.reason === "window"), false);
    assert.equal(targeted[targeted.length - 1].reason, "target");
  });

  it("flattens on the planned session", () => {
    const bars = [
      { o: 100, h: 112, c: 111 },
      { o: 111, h: 112, c: 111 },
      { o: 140, h: 141, c: 139 },
    ];
    assert.equal(scaleFlatIndex(bars, 0, { entry: 100, mid: 110, top: 130, stop: 80, timeStopIndex: null, maxHold: 20 }), 2);
  });
});

function gapArgs() {
  return {
    phase: "open" as const,
    isEntryDay: false,
    open: 140,
    high: 141,
    close: 139,
    entry: 100,
    mid: 110,
    top: 130,
    stop: 80,
    halfOpen: true,
    restOpen: true,
    timeStop: false,
    timeout: false,
  };
}

function heldArgs() {
  return {
    phase: "rest" as const,
    isEntryDay: false,
    open: 101,
    high: 109,
    close: 100,
    entry: 100,
    mid: 110,
    top: 130,
    stop: 80,
    halfOpen: true,
    restOpen: true,
    timeStop: true,
    timeout: false,
  };
}

describe("day-5 exit", () => {
  it("leaves a winner past day 5 and sells a flat close", () => {
    const bars = Array.from({ length: 8 }, () => ({ o: 101, h: 104, c: 102 }));
    bars[6] = { o: 101, h: 104, c: 100 };
    const cut = boxedExit(bars, 1, 120, 80, 20, true);
    assert.equal(cut?.exitIndex, 6);
    assert.equal(cut?.reason, "window");
    const kept = boxedExit(bars, 1, 120, 80, 20, false);
    assert.equal(kept?.reason, "window");
    assert.equal(kept?.exitIndex, 7);
  });
});

describe("scale portfolio", () => {
  const sessions = ["2024-01-02", "2024-01-03", "2024-01-04"];

  function cand(extra: Partial<Candidate> = {}): Candidate {
    return {
      ticker: "AAA",
      sector: "t",
      semi: false,
      signalIndex: 0,
      entryIndex: 1,
      exitIndex: 2,
      signalDate: sessions[0],
      entryDate: sessions[0],
      exitDate: sessions[2],
      entry: 100,
      exit: 130,
      atr: 2,
      atrPct: 3,
      boxPct: 20,
      rebound: 1,
      rs20: 1,
      stop: 80,
      qty10: 1,
      reason: "target",
      exitTiming: "close",
      voided: false,
      scale: {
        mid: 110,
        top: 130,
        stop: 80,
        timeStopDate: null,
        maxHoldDate: sessions[2],
      },
      ...extra,
    };
  }

  it("charges $0.70 on each scale sell and counts one trade", () => {
    const quotes = new Map([
      [
        "AAA",
        new Map([
          [sessions[0], { o: 100, h: 115, c: 112 }],
          [sessions[1], { o: 112, h: 131, c: 128 }],
          [sessions[2], { o: 128, h: 129, c: 127 }],
        ]),
      ],
    ]);
    const book = runPortfolio(
      {
        id: "scale",
        label: "scale",
        universe: "core",
        rank: "ticker",
        sessions,
        flatten: true,
        withRestart: false,
        closes: new Map([["AAA", new Map(sessions.map((date) => [date, 100]))]]),
        quotes,
        size: () => 4,
        keepFills: true,
        keepRisk: true,
        keepExposure: true,
      },
      [cand()],
    );
    assert.equal(book.n, 1);
    assert.equal(book.fills?.[0].pnlUsd, 78.6);
    assert.equal(book.fills?.[0].qty, 4);
    assert.equal(book.fills?.[0].riskUsd, 80);
    assert.equal(book.totalUsd, 78.6);
  });

  it("puts an odd share in the second half", () => {
    const quotes = new Map([
      [
        "AAA",
        new Map([
          [sessions[0], { o: 100, h: 140, c: 130 }],
          [sessions[1], { o: 130, h: 131, c: 130 }],
          [sessions[2], { o: 130, h: 131, c: 130 }],
        ]),
      ],
    ]);
    const book = runPortfolio(
      {
        id: "odd",
        label: "odd",
        universe: "core",
        rank: "ticker",
        sessions,
        flatten: true,
        withRestart: false,
        closes: new Map([["AAA", new Map(sessions.map((date) => [date, 100]))]]),
        quotes,
        size: () => 5,
        keepFills: true,
      },
      [cand()],
    );
    assert.equal(book.n, 1);
    assert.equal(book.fills?.[0].pnlUsd, 108.6);
  });
});
