import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { envHoldingsSource, parseHoldingsJson } from "./holdings";

describe("holdings from HOLDINGS_JSON", () => {
  it("is empty and quiet when unset", () => {
    const config = parseHoldingsJson(undefined);
    assert.deepEqual(config.holdings, []);
    assert.deepEqual(config.warnings, []);
    assert.equal(config.defenseLineJpy, null);
  });

  it("reads the full object shape", () => {
    const config = parseHoldingsJson(
      JSON.stringify({
        holdings: [
          { ticker: "aaa", shares: 3, avgCost: 101.5, reviewLine: 95, note: "demo" },
          { ticker: "BBB", shares: 1 },
        ],
        cash: { usdSettled: 250, usdUnsettled: [{ amountUsd: 120, settleDate: "2026-10-05" }], jpy: 10000 },
        defenseLineJpy: 123456,
      }),
    );
    assert.deepEqual(config.holdings, [
      { ticker: "AAA", shares: 3, avgCost: 101.5, reviewLine: 95, note: "demo" },
      { ticker: "BBB", shares: 1, avgCost: null, reviewLine: null, note: null },
    ]);
    assert.deepEqual(config.cash, {
      usdSettled: 250,
      usdUnsettled: [{ amountUsd: 120, settleDate: "2026-10-05" }],
      jpy: 10000,
    });
    assert.equal(config.defenseLineJpy, 123456);
    assert.deepEqual(config.warnings, []);
  });

  it("accepts a bare array and drops ONDS without a warning", () => {
    const config = parseHoldingsJson('[{"ticker":"AAA","shares":2},{"ticker":"ONDS","shares":50}]');
    assert.deepEqual(
      config.holdings.map((holding) => holding.ticker),
      ["AAA"],
    );
    assert.deepEqual(config.warnings, []);
  });

  it("skips bad rows and reports them without echoing values", () => {
    const config = parseHoldingsJson(
      JSON.stringify({ holdings: [{ ticker: "AAA", shares: -1 }, { ticker: "", shares: 1 }, "x", { ticker: "CCC", shares: 4 }] }),
    );
    assert.deepEqual(
      config.holdings.map((holding) => holding.ticker),
      ["CCC"],
    );
    assert.equal(config.warnings.length, 3);
    assert.equal(config.warnings.some((text) => text.includes("-1")), false);
  });

  it("survives invalid JSON", () => {
    const config = parseHoldingsJson("{not json");
    assert.deepEqual(config.holdings, []);
    assert.equal(config.warnings.length, 1);
  });

  it("memoizes by the raw value and changes stamp when it changes", () => {
    const env: Record<string, string | undefined> = { HOLDINGS_JSON: '[{"ticker":"AAA","shares":1}]' };
    const source = envHoldingsSource(env);
    const first = source.load();
    const stamp = source.stamp();
    assert.equal(source.load(), first);
    env.HOLDINGS_JSON = '[{"ticker":"AAA","shares":2}]';
    assert.notEqual(source.stamp(), stamp);
    assert.equal(source.load().holdings[0]?.shares, 2);
  });
});
