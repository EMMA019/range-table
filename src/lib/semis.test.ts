import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { semiSlotsFull, semiTickerSet } from "./semis";

const groups = [
  { id: "semi", tickers: [{ ticker: "NVDA" }, { ticker: "AMD" }] },
  { id: "equipment", tickers: [{ ticker: "AMAT" }] },
  { id: "other", tickers: [{ ticker: "AAPL" }] },
];

describe("semiconductor slots", () => {
  const semis = semiTickerSet(groups);

  it("counts semiconductor and equipment names, and ignores ONDS", () => {
    assert.equal(semis.has("AMAT"), true);
    assert.equal(semis.has("AAPL"), false);
    assert.equal(semiSlotsFull([{ ticker: "NVDA" }, { ticker: "AAPL" }], semis), false);
    assert.equal(semiSlotsFull([{ ticker: "NVDA" }, { ticker: "AMAT" }], semis), true);
    assert.equal(semiSlotsFull([{ ticker: "NVDA" }, { ticker: "NVDA" }], semis), false);
    assert.equal(semiSlotsFull([{ ticker: "ONDS" }, { ticker: "NVDA" }, { ticker: "AMD" }], semis), true);
    assert.equal(semiSlotsFull([{ ticker: "ONDS" }, { ticker: "NVDA" }], semis), false);
  });
});
