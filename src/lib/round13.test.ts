import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ATR_OF, absentFills, atrPercent, dropReason, flowOf, stockLargeLoss, type SleeveFill } from "./round13";

describe("round-13 ATR cap", () => {
  it("skips only a percent strictly above the locked threshold", () => {
    assert.equal(atrPercent(8, 100), 8);
    assert.equal(dropReason({ atr: 8, close: 100, inWindow: true, voided: false, id: "A8" }), "keep");
    assert.equal(dropReason({ atr: 8.0001, close: 100, inWindow: true, voided: false, id: "A8" }), "atr");
    assert.equal(dropReason({ atr: 8.0001, close: 100, inWindow: true, voided: false, id: "B" }), "keep");
    assert.equal(dropReason({ atr: 8.0001, close: 100, inWindow: false, voided: false, id: "A8" }), "keep");
    assert.equal(dropReason({ atr: 8.0001, close: 100, inWindow: true, voided: true, id: "A8" }), "keep");
    assert.equal(dropReason({ atr: 7, close: 100, inWindow: true, voided: false, id: "A7" }), "keep");
    assert.equal(dropReason({ atr: 7.01, close: 100, inWindow: true, voided: false, id: "A7" }), "atr");
    assert.equal(dropReason({ atr: 9, close: 100, inWindow: true, voided: false, id: "A10" }), "keep");
    assert.equal(dropReason({ atr: 10.01, close: 100, inWindow: true, voided: false, id: "A10" }), "atr");
    assert.equal(ATR_OF.A8, 8);
    assert.throws(() => atrPercent(Number.NaN, 100));
    assert.throws(() => atrPercent(1, 0));
  });
});

describe("removed winners and replacement fills", () => {
  const base: SleeveFill[] = [
    { ticker: "HIMS", entryDate: "a", pnlUsd: 80, sleeve: "stock" },
    { ticker: "CLS", entryDate: "a", pnlUsd: 40, sleeve: "stock" },
    { ticker: "SMCI", entryDate: "a", pnlUsd: -70, sleeve: "stock" },
    { ticker: "NVDA", entryDate: "a", pnlUsd: 10, sleeve: "stock" },
    { ticker: "SOXX", entryDate: "a", pnlUsd: 5, sleeve: "etf" },
  ];
  const next: SleeveFill[] = [
    { ticker: "NVDA", entryDate: "a", pnlUsd: 10, sleeve: "stock" },
    { ticker: "AMD", entryDate: "b", pnlUsd: -12, sleeve: "stock" },
    { ticker: "SOXX", entryDate: "b", pnlUsd: 3, sleeve: "etf" },
  ];

  it("splits removed baseline trades and keeps HIMS, CLS, and SMCI", () => {
    const gone = absentFills(base, next, "stock");
    assert.deepEqual(
      gone.map((fill) => fill.ticker),
      ["HIMS", "CLS", "SMCI"],
    );
    const flow = flowOf(gone);
    assert.equal(flow.side.wins, 2);
    assert.equal(flow.side.winsUsd, 120);
    assert.equal(flow.side.losses, 1);
    assert.equal(flow.side.lossesUsd, -70);
    assert.equal(flow.tickers.find((row) => row.ticker === "HIMS")?.winsUsd, 80);
    assert.equal(flow.tickers.find((row) => row.ticker === "CLS")?.wins, 1);
    assert.equal(flow.tickers.find((row) => row.ticker === "SMCI")?.lossesUsd, -70);
  });

  it("counts a fill the baseline did not take as a replacement", () => {
    const added = flowOf(absentFills(next, base, "stock"));
    assert.equal(added.side.n, 1);
    assert.equal(added.side.pnlUsd, -12);
    assert.equal(added.tickers.find((row) => row.ticker === "HIMS")?.n, 0);
    assert.equal(stockLargeLoss([{ pnlUsd: -60 }, { pnlUsd: -59.99 }, { pnlUsd: 10 }]).n, 1);
  });
});
