import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Feat } from "./backtest-study";
import {
  boxLinePrice,
  paperShares,
  reboundQualifies,
  touchQualifies,
  verdictForFlavor,
  type Round16Row,
} from "./round16";

describe("round-16 entry line", () => {
  it("paperShares matches min risk and cost cap", () => {
    assert.equal(paperShares(100, 95), 4);
    assert.equal(paperShares(500, 490), 3);
    assert.equal(paperShares(50, 49), 9);
    assert.equal(paperShares(10, 5), null);
  });

  it("box line price", () => {
    assert.equal(boxLinePrice(100, 200, 25), 125);
    assert.equal(boxLinePrice(100, 200, 35), 135);
  });

  it("touch and rebound at the line", () => {
    const base = {
      date: "2024-01-02",
      o: 10,
      h: 11,
      l: 9,
      c: 10,
      atr: 0.5,
      ret20: 0,
      low20: 8,
      high20: 12,
      boxPct: 50,
      gapWarning: false,
      rebound: 0,
    } as Feat;
    assert.equal(touchQualifies({ ...base, l: 9.5 }, 9.6), true);
    assert.equal(touchQualifies({ ...base, l: 9.7 }, 9.6), false);
    assert.equal(reboundQualifies({ ...base, l: 9.5, c: 9.6, rebound: 1 }, 9.6), true);
    assert.equal(reboundQualifies({ ...base, l: 9.5, c: 9.5, rebound: 1 }, 9.6), false);
    assert.equal(reboundQualifies({ ...base, l: 9.5, c: 9.7, rebound: 0 }, 9.6), false);
  });

  it("verdict rules", () => {
    const mk = (pct: number, flavor: "touch" | "rebound", window: "in" | "oos", pnl: number, trades: number, dd: number): Round16Row => ({
      id: `L${pct}-${flavor}`,
      pct: pct as 25 | 30 | 35 | 15,
      flavor,
      window,
      trades,
      winRate: 0.5,
      totalNet190Usd: pnl,
      avgNet190Usd: pnl / trades,
      mtmDdUsd: dd,
      lowDate: "2024-01-01",
      lowUsd: 3000,
      engineTotalUsd: pnl,
    });
    const gap = [mk(25, "touch", "in", 100, 40, 200), mk(30, "touch", "in", 150, 40, 220), mk(35, "touch", "in", 120, 40, 210)];
    const vGap = verdictForFlavor(gap, "touch");
    assert.equal(vGap.kind, "no-meaningful-difference");
    const rows = [
      mk(25, "touch", "in", 300, 40, 200),
      mk(30, "touch", "in", 500, 40, 220),
      mk(35, "touch", "in", 200, 40, 210),
      mk(25, "touch", "oos", 100, 40, 200),
      mk(30, "touch", "oos", 200, 40, 200),
      mk(35, "touch", "oos", 50, 40, 200),
    ];
    const confirmed = verdictForFlavor(rows, "touch");
    assert.equal(confirmed.kind, "confirmed");
    assert.equal(confirmed.kind === "confirmed" ? confirmed.pct : null, 30);
  });
});
