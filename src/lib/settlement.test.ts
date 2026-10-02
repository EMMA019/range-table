import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSettlementDay, isUnsettled, settleDate } from "./settlement";

describe("T+1 settlement calendar", () => {
  it("skips weekends", () => {
    assert.equal(settleDate("2026-10-01"), "2026-10-02");
    assert.equal(settleDate("2026-10-02"), "2026-10-05");
  });

  it("skips bank holidays when the NYSE is open", () => {
    assert.equal(isSettlementDay("2026-10-12"), false);
    assert.equal(settleDate("2026-10-09"), "2026-10-13");
    assert.equal(isSettlementDay("2026-11-11"), false);
    assert.equal(settleDate("2026-11-10"), "2026-11-12");
  });

  it("skips NYSE holidays", () => {
    assert.equal(settleDate("2026-11-25"), "2026-11-27");
    assert.equal(settleDate("2026-12-24"), "2026-12-28");
    assert.equal(settleDate("2026-12-31"), "2027-01-04");
  });

  it("does not observe a Saturday Veterans Day", () => {
    assert.equal(isSettlementDay("2028-11-10"), true);
  });

  it("knows when sale proceeds are still unsettled", () => {
    assert.equal(isUnsettled("2026-10-09", "2026-10-12"), true);
    assert.equal(isUnsettled("2026-10-09", "2026-10-13"), false);
  });
});
