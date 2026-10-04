import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { passesDefaultBuyScreen, screenExclusionReasons } from "./candidate-screen";
import type { Profitability } from "./loss-filter";

const profit = (): Profitability => ({
  status: "profit",
  source: "test",
  ttmNetIncome: 1,
  trailingEps: 1,
});

const base = {
  sectorId: "semi",
  profitability: profit(),
  brokeHigh: false,
  atr14: 4,
  close: 100,
};

describe("candidate-screen", () => {
  it("blocks space and crypto themes on the default buy screen", () => {
    assert.ok(screenExclusionReasons({ ticker: "ASTS", ...base }).includes("theme:space"));
    assert.ok(screenExclusionReasons({ ...base, ticker: "CORZ", sectorId: "cloud" }).includes("theme:crypto"));
    assert.equal(passesDefaultBuyScreen(screenExclusionReasons({ ticker: "ASTS", ...base })), false);
    assert.equal(passesDefaultBuyScreen(screenExclusionReasons({ ...base, ticker: "SPCX", sectorId: "space" })), true);
  });

  it("still drops only financials when that is the sole reason", () => {
    const reasons = screenExclusionReasons({ ...base, ticker: "BAC", sectorId: "financials" });
    assert.equal(passesDefaultBuyScreen(reasons), false);
    const onlyFin = reasons.filter((r) => r !== "financials");
    assert.equal(onlyFin.length, 0);
  });
});
