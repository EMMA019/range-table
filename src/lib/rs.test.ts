import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { return20, rs20 } from "./rs";
import type { Bar } from "./types";

function bars(closes: number[], date = (i: number) => `2026-01-${String(i + 1).padStart(2, "0")}`): Bar[] {
  return closes.map((c, i) => ({ date: date(i), o: c, h: c, l: c, c, v: 1 }));
}

describe("rs20", () => {
  it("subtracts SPY's 20-session return on the same date", () => {
    const stock = bars([100, ...Array.from({ length: 20 }, () => 110)]);
    const spy = bars([100, ...Array.from({ length: 20 }, () => 105)]);
    assert.ok(Math.abs((return20(stock) ?? 0) - 0.1) < 1e-12);
    assert.ok(Math.abs((return20(spy) ?? 0) - 0.05) < 1e-12);
    assert.ok(Math.abs((rs20(stock, spy) ?? 0) - 0.05) < 1e-12);
  });

  it("is null when a series is short, the earlier close is not positive, or the SPY date is missing", () => {
    const stock = bars([100, ...Array.from({ length: 20 }, () => 110)]);
    assert.equal(rs20(stock.slice(0, 20), stock), null);
    assert.equal(return20(bars([0, ...Array.from({ length: 20 }, () => 110)])), null);
    const shifted = bars(
      [100, ...Array.from({ length: 20 }, () => 105)],
      (i) => `2026-02-${String(i + 1).padStart(2, "0")}`,
    );
    assert.equal(rs20(stock, shifted), null);
  });
});
