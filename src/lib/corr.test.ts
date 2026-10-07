import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  basketReturnSeries,
  benchmarkCorrelations,
  buildCorrBasket,
  buildCorrelations,
  corrOnWindow,
  dailyReturns,
  loadCorrBasket,
  loadCorrSettings,
  parseCorrSettings,
  pearson,
} from "./corr";
import { envHoldingsSource, setHoldingsSource } from "./holdings";

function bars(closes: number[]): Array<{ date: string; c: number }> {
  return closes.map((c, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, c }));
}

describe("correlation", () => {
  it("reads only the window and benchmark from the committed file", () => {
    const settings = loadCorrSettings();
    assert.deepEqual(settings, { window: 60, benchmark: "SOXX" });
    assert.deepEqual(parseCorrSettings({ window: 1, benchmark: " qqq " }), { window: 60, benchmark: "QQQ" });
    assert.deepEqual(parseCorrSettings(null), { window: 60, benchmark: "SOXX" });
  });

  it("builds the basket from the private source and drops ONDS", () => {
    const settings = { window: 60, benchmark: "SOXX" };
    assert.equal(buildCorrBasket(settings, []), null);
    assert.equal(buildCorrBasket(settings, [{ ticker: "ONDS", shares: 9 }]), null);
    assert.equal(buildCorrBasket(settings, [{ ticker: "AAA", shares: 0 }]), null);
    assert.deepEqual(buildCorrBasket(settings, [{ ticker: "aaa", shares: 2 }, { ticker: "onds", shares: 9 }])?.holdings, [
      { ticker: "AAA", shares: 2 },
    ]);
  });

  it("falls back to no basket when HOLDINGS_JSON is unset", () => {
    setHoldingsSource(envHoldingsSource({}));
    try {
      assert.equal(loadCorrBasket(), null);
    } finally {
      setHoldingsSource(envHoldingsSource());
    }
  });

  it("ignores ONDS even when a basket is passed straight in", () => {
    const up = bars([100, 110, 99, 120]);
    const down = bars([100, 90, 99, 78]);
    const corr = buildCorrelations(
      { AAA: up, ONDS: down, BENCH: up },
      { window: 3, benchmark: "BENCH", holdings: [{ ticker: "AAA", shares: 1 }, { ticker: "ONDS", shares: 100 }] },
    );
    assert.equal(corr.get("AAA")?.basket, 1);
    const onlyIgnored = buildCorrelations(
      { ONDS: down, BENCH: up },
      { window: 3, benchmark: "BENCH", holdings: [{ ticker: "ONDS", shares: 1 }] },
    );
    assert.equal(onlyIgnored.size, 0);
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
      { AAA: up, BBB: down, CCC: flat, HHH: up, BENCH: soxx },
      { window: 3, benchmark: "BENCH", holdings: [{ ticker: "HHH", shares: 2 }] },
    );
    assert.equal(corr.get("AAA")?.basket, 1);
    assert.equal(corr.get("AAA")?.soxx, 1);
    assert.equal(corr.get("BBB")?.basket, -1);
    assert.equal(corr.get("CCC")?.basket, null);
    assert.equal(corrOnWindow(dailyReturns(up), dailyReturns(soxx), 4), null);
  });

  it("computes the benchmark correlation when there is no holdings basket", () => {
    const soxx = bars([10, 11, 9.9, 12]);
    const same = bars([10, 11, 9.9, 12]);
    const map = benchmarkCorrelations({ SOXX: soxx, AAA: same }, { window: 3, benchmark: "SOXX" });
    assert.equal(map.get("AAA"), 1);
    assert.equal(benchmarkCorrelations({ AAA: same }, { window: 3, benchmark: "SOXX" }).size, 0);
  });
});
