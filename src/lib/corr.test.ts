import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  basketReturnSeries,
  buildCorrelations,
  corrOnWindow,
  dailyReturns,
  loadCorrBasket,
  parseCorrBasket,
  pearson,
} from "./corr";

function bars(closes: number[]): Array<{ date: string; c: number }> {
  return closes.map((c, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, c }));
}

describe("correlation", () => {
  it("reads the committed basket", () => {
    const basket = loadCorrBasket();
    assert.equal(basket?.window, 60);
    assert.equal(basket?.benchmark, "SOXX");
    assert.deepEqual(
      basket?.holdings.map((holding) => [holding.ticker, holding.shares]),
      [
        ["ON", 3],
        ["AVGO", 1],
        ["VRT", 3],
        ["ONDS", 15],
      ],
    );
    assert.equal(parseCorrBasket({ holdings: [] }), null);
    assert.equal(parseCorrBasket({ holdings: [{ ticker: "ON", shares: 0 }] }), null);
  });

  it("uses close-to-close simple returns", () => {
    const returns = dailyReturns(bars([100, 110, 99]));
    assert.ok(Math.abs((returns.get("2026-01-02") ?? 0) - 0.1) < 1e-12);
    assert.ok(Math.abs((returns.get("2026-01-03") ?? 0) - (99 / 110 - 1)) < 1e-12);
  });

  it("matches the Pearson formula and the signed extremes", () => {
    const same = [0.01, -0.02, 0.03, 0];
    assert.equal(pearson(same, same), 1);
    assert.equal(pearson(same, same.map((n) => -n)), -1);
    assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
    const value = pearson([1, 2, 3, 4], [1, 2, 3, 5]);
    assert.ok(value != null && Math.abs(value - 0.9827076298239907) < 1e-12);
  });

  it("weights the basket by shares times the latest close", () => {
    const series = basketReturnSeries([
      { weight: 1 * 10, returns: new Map([["d1", 0.1], ["d2", 0]]) },
      { weight: 1 * 30, returns: new Map([["d1", 0], ["d2", 0.1]]) },
    ]);
    assert.equal(series.get("d1"), 0.025);
    assert.equal(series.get("d2"), 0.075);
  });

  it("needs a full window and lines the benchmark up with the basket", () => {
    const up = bars([100, 110, 99, 120]);
    const down = bars([100, 90, 99, 78]);
    const flat = bars([50, 50, 50, 50]);
    const soxx = bars([10, 11, 9.9, 12]);
    const corr = buildCorrelations(
      { AAA: up, BBB: down, CCC: flat, ON: up, BENCH: soxx },
      { window: 3, benchmark: "BENCH", holdings: [{ ticker: "ON", shares: 2 }] },
    );
    assert.equal(corr.get("AAA")?.basket, 1);
    assert.equal(corr.get("AAA")?.soxx, 1);
    assert.equal(corr.get("BBB")?.basket, -1);
    assert.equal(corr.get("CCC")?.basket, null);
    assert.equal(corrOnWindow(dailyReturns(up), dailyReturns(soxx), 4), null);
  });
});
