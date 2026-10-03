import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dropKind, pnlDelta, round6Verdict } from "./round6";

describe("round 6 drops", () => {
  it("counts a class fill as a semi drop even when the filter also fails", () => {
    assert.equal(dropKind(true, false), "semi");
    assert.equal(dropKind(true, true), "semi");
    assert.equal(dropKind(false, false), "filter");
    assert.equal(dropKind(false, true), "keep");
  });

  it("subtracts the round-4 total in cents", () => {
    assert.equal(pnlDelta(10.16, 135.08), -124.92);
    assert.equal(pnlDelta(-4.35, -4.35), 0);
  });

  it("holds a judged window below 100 trades before a loss can fail", () => {
    assert.equal(round6Verdict({ judged: true, n: 99, totalUsd: -10, ratio: 2, spyRatio: 1, lower: 1, nRequired: 10 }), "hold");
    assert.equal(round6Verdict({ judged: false, n: 400, totalUsd: 10, ratio: 9, spyRatio: 1, lower: 1, nRequired: 10 }), "not-judged");
  });
});
