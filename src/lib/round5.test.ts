import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { riskShares } from "./round3";
import { inRound5Class, round5Verdict, tickerExtremes, uncappedRiskShares } from "./round5";

describe("round 5 class", () => {
  it("keeps semiconductors, equipment, and the adjacent groups, and drops AKAM", () => {
    assert.equal(inRound5Class("NVDA", "semi", "Semiconductors"), true);
    assert.equal(inRound5Class("AMAT", null, "Semiconductor Materials & Equipment"), true);
    assert.equal(inRound5Class("FSLR", null, "Semiconductors"), true);
    assert.equal(inRound5Class("CSCO", "network", "Communications Equipment"), true);
    assert.equal(inRound5Class("SNDK", "semi", "Technology Hardware, Storage & Peripherals"), true);
    assert.equal(inRound5Class("AKAM", "network", "Internet Services & Infrastructure"), false);
    assert.equal(inRound5Class("BE", "generation", "Electrical Components & Equipment"), false);
    assert.equal(inRound5Class("META", "cloud", "Interactive Media & Services"), false);
    assert.equal(inRound5Class("AAPL", null, "Technology Hardware, Storage & Peripherals"), false);
  });
});

describe("round 5 size", () => {
  it("drops the $450 cap on the reference row and keeps the $32 distance skip", () => {
    assert.equal(uncappedRiskShares(50, 49), 32);
    assert.equal(riskShares(50, 49), 9);
    assert.equal(uncappedRiskShares(500, 480), 1);
    assert.equal(riskShares(500, 480), null);
    assert.equal(uncappedRiskShares(100, 60), null);
    assert.equal(uncappedRiskShares(100, 100), null);
  });
});

describe("round 5 report helpers", () => {
  it("sums a ticker and lists the five ends", () => {
    const fills = [
      { ticker: "BBB", pnlUsd: 5 },
      { ticker: "AAA", pnlUsd: 5 },
      { ticker: "CCC", pnlUsd: -2 },
      { ticker: "CCC", pnlUsd: -3 },
    ];
    const ends = tickerExtremes(fills, 2);
    assert.deepEqual(ends.top.map((row) => row.ticker), ["AAA", "BBB"]);
    assert.deepEqual(ends.bottom.map((row) => row.ticker), ["CCC", "AAA"]);
    assert.equal(ends.bottom[0]?.pnlUsd, -5);
  });

  it("holds a judged window below 100 trades before a loss can fail", () => {
    assert.equal(round5Verdict({ judged: true, n: 99, totalUsd: -10, ratio: 2, spyRatio: 1, lower: 1, nRequired: 10 }), "hold");
    assert.equal(round5Verdict({ judged: false, n: 200, totalUsd: 10, ratio: 9, spyRatio: 1, lower: 1, nRequired: 10 }), "not-judged");
  });
});
