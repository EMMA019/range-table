import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAtrAlertFragment, formatAtrWithPct } from "./format";

describe("ATR display format", () => {
  it("shows dollar ATR and one-decimal percent of close", () => {
    assert.equal(formatAtrWithPct(0.62, 21.57), "$0.62 (2.9%)");
    assert.equal(formatAtrAlertFragment(0.62, 21.57), "ATR $0.62 (2.9%)");
  });

  it("returns dollars only when close is missing", () => {
    assert.equal(formatAtrWithPct(1.5, 0), "$1.50");
  });
});
