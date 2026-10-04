import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candidate, Feat } from "./backtest-study";
import { lossPastRisk, pathMarks, stopDistanceShares, withCQty } from "./round10";

function bar(date: string, o: number, h: number, l: number, c: number, high20: number | null = null): Feat {
  return { date, o, h, l, c, high20 } as Feat;
}

describe("stop-distance shares", () => {
  it("sizes to the dollar risk and lets the $500 cap reduce the count", () => {
    assert.deepEqual(stopDistanceShares(100, 90, 30), { units: 3 });
    assert.deepEqual(stopDistanceShares(100, 99, 30), { units: 5 });
    assert.deepEqual(stopDistanceShares(10, 9.5, 30), { units: 50 });
    assert.deepEqual(stopDistanceShares(30, 0, 30), { units: 1 });
    assert.deepEqual(stopDistanceShares(500, 490, 30), { units: 1 });
  });

  it("skips a non-positive distance, a wide stop, and a price above $500 as separate reasons", () => {
    assert.deepEqual(stopDistanceShares(100, 100, 30), { skip: "flat" });
    assert.deepEqual(stopDistanceShares(100, 101, 35), { skip: "flat" });
    assert.deepEqual(stopDistanceShares(0, -1, 30), { skip: "flat" });
    assert.deepEqual(stopDistanceShares(40, 0, 30), { skip: "wide" });
    assert.deepEqual(stopDistanceShares(501, 500, 35), { skip: "cap" });
  });

  it("keeps the C exit when the share count changes", () => {
    const feats = [bar("d0", 9, 11, 8, 10, 12), bar("d1", 10, 10.2, 9, 10), bar("d2", 7, 8, 6.5, 7)];
    const cand = {
      ticker: "AAA",
      entryIndex: 1,
      signalIndex: 0,
      entryDate: "d1",
      atr: 1,
      stop: 8,
      entry: 10,
    } as Candidate;
    const two = withCQty(cand, feats, 2);
    const four = withCQty(cand, feats, 4);
    assert.equal(two.exitDate, "d2");
    assert.equal(four.exitDate, two.exitDate);
    assert.equal(four.exit, two.exit);
    assert.equal(two.round7Legs?.reduce((sum, leg) => sum + leg.qty, 0), 2);
    assert.equal(four.round7Legs?.reduce((sum, leg) => sum + leg.qty, 0), 4);
    assert.equal(withCQty(two, feats, 2), two);
  });

  it("counts only an open through the low as a gap past R", () => {
    assert.equal(lossPastRisk({ pnlUsd: -31, risk: 30, reason: "stop", exitOpen: 9, low: 10 }), "gap");
    assert.equal(lossPastRisk({ pnlUsd: -31, risk: 30, reason: "stop", exitOpen: 10, low: 10 }), "other");
    assert.equal(lossPastRisk({ pnlUsd: -30, risk: 30, reason: "stop", exitOpen: 9, low: 10 }), null);
    assert.equal(lossPastRisk({ pnlUsd: -40, risk: 30, reason: "target", exitOpen: 9, low: 10 }), "other");
  });

  it("reads the drawdown from the cent path and keeps a one-cent engine difference visible", () => {
    const path = pathMarks([
      { date: "a", equity: 3300 },
      { date: "b", equity: 3100.1 },
    ]);
    assert.equal(path.peakDate, "a");
    assert.equal(path.peakUsd, 3300);
    assert.equal(path.troughDate, "b");
    assert.equal(path.troughUsd, 3100.1);
    assert.equal(path.pathDdUsd, 199.9);
    assert.equal(path.lowDate, "b");
    assert.equal(path.lowVsStartUsd, -99.9);
  });
});
