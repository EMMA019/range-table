import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLossExcluded, lossUnknown, resolveProfitability } from "./loss-filter";

describe("loss filter", () => {
  it("treats negative trailing EPS as a loss except SPCX", () => {
    const loss = resolveProfitability("AAA", { trailingEps: -0.2, forwardEps: 1, error: null });
    assert.equal(loss.status, "loss");
    assert.equal(isLossExcluded("AAA", loss), true);
    const spcx = resolveProfitability("SPCX", { trailingEps: -1, forwardEps: null, error: null });
    assert.equal(isLossExcluded("SPCX", spcx), false);
  });

  it("flags unknown profitability instead of passing silently", () => {
    const unknown = resolveProfitability("AAA", { trailingEps: null, forwardEps: null, error: "EPSが空" });
    assert.equal(unknown.status, "unknown");
    assert.equal(isLossExcluded("AAA", unknown), false);
    assert.equal(lossUnknown(unknown, "AAA"), true);
  });

  it("uses EDGAR TTM net income when Yahoo EPS is empty", () => {
    const profit = resolveProfitability("TSM", { trailingEps: null, forwardEps: null, error: null }, { ttmNetIncome: 1e10, source: "edgar:ifrs-full:ProfitLoss:ttm4q" });
    assert.equal(profit.status, "profit");
    const loss = resolveProfitability("ASTS", { trailingEps: null, forwardEps: null, error: null }, { ttmNetIncome: -50_000_000, source: "edgar:us-gaap:NetIncomeLoss:ttm4q" });
    assert.equal(loss.status, "loss");
  });
});
