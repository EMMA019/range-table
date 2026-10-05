import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drawdownFromCurve, type SakaEquityPoint } from "./round19-saka";

describe("drawdownFromCurve", () => {
  it("peak date is before trough for max drawdown", () => {
    const curve: SakaEquityPoint[] = [
      { date: "2020-01-02", equity: 100 },
      { date: "2020-03-23", equity: 70 },
      { date: "2026-06-01", equity: 150 },
      { date: "2026-08-13", equity: 160 },
    ];
    const dd = drawdownFromCurve(curve, "2020-01-02", "2026-08-13");
    assert.equal(dd.troughDate, "2020-03-23");
    assert.equal(dd.peakDate, "2020-01-02");
    assert.ok(dd.peakDate < dd.troughDate);
    assert.ok(Math.abs(dd.maxDd - -0.3) < 1e-9);
  });
});
