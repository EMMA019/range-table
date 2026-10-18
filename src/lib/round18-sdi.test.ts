import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { broadIndexForDate, pickSdiStocks, type SdiMeta } from "./round18-sdi";

describe("round18-sdi", () => {
  it("uses SPY proxy before SPTM inception", () => {
    assert.equal(broadIndexForDate("2016-06-01", "2017-01-01"), "SPY");
    assert.equal(broadIndexForDate("2018-01-01", "2017-01-01"), "SPTM");
  });

  it("picks by excess vs SPY with ticker tie-break and semi cap", () => {
    const meta = new Map<string, SdiMeta>([
      ["AAA", { ticker: "AAA", semiBucket: false, firstDate: "2016-01-01" }],
      ["BBB", { ticker: "BBB", semiBucket: false, firstDate: "2016-01-01" }],
      ["NVDA", { ticker: "NVDA", semiBucket: true, firstDate: "2016-01-01" }],
      ["AMD", { ticker: "AMD", semiBucket: true, firstDate: "2016-01-01" }],
    ]);
    const scores = new Map([
      ["AAA", 0.5],
      ["BBB", 0.5],
      ["NVDA", 0.9],
      ["AMD", 0.8],
    ]);
    const picked = pickSdiStocks([], ["AAA", "BBB", "NVDA", "AMD"], meta, scores, 3, 1);
    assert.deepEqual(picked, ["NVDA", "AAA", "BBB"]);
  });
});
