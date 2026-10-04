import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySectorCaps,
  compareRound18Configs,
  round18Configs,
  selectRound18Config,
  type Round18Meta,
} from "./round18-portfolio";

describe("round18-portfolio", () => {
  it("has 36 preregistered configs", () => {
    assert.equal(round18Configs().length, 36);
  });

  it("caps semi+equipment bucket at 30%", () => {
    const meta = new Map<string, Round18Meta>([
      ["A", { ticker: "A", sectorId: "semi", semiBucket: true, profitable: true, firstDate: "2016-01-01", shares: 1 }],
      ["B", { ticker: "B", sectorId: "equipment", semiBucket: true, profitable: true, firstDate: "2016-01-01", shares: 1 }],
      ["C", { ticker: "C", sectorId: "software", semiBucket: false, profitable: true, firstDate: "2016-01-01", shares: 1 }],
    ]);
    const capped = applySectorCaps({ A: 0.5, B: 0.3, C: 0.2 }, meta);
    const semiSum = (capped.A ?? 0) + (capped.B ?? 0);
    assert.ok(semiSum <= 0.3001, `semi sum ${semiSum}`);
    assert.ok((capped.C ?? 0) <= 0.3001);
  });

  it("selects by CAGR then shallower drawdown then lexicographic config", () => {
    const chosen = selectRound18Config([
      { config: { method: "equal", n: 10, rebal: "monthly" }, cagr: 0.12, maxDrawdown: -0.2 },
      { config: { method: "mcap", n: 10, rebal: "monthly" }, cagr: 0.12, maxDrawdown: -0.15 },
      { config: { method: "equal", n: 20, rebal: "annual" }, cagr: 0.15, maxDrawdown: -0.25 },
    ]);
    assert.deepEqual(chosen, { method: "equal", n: 20, rebal: "annual" });
    assert.ok(compareRound18Configs({ method: "equal", n: 10, rebal: "annual" }, { method: "mcap", n: 10, rebal: "annual" }) < 0);
  });
});
