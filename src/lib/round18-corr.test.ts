import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  correlationMatrix,
  hierarchicalClusterOrder,
  pickCorrGreedy,
  pearsonCorrelation,
  pruneHighCorrPairs,
} from "./round18-corr";

describe("round18-corr", () => {
  it("pearson correlation on perfect positive series", () => {
    const a = [0.01, -0.02, 0.03, 0.01];
    const b = [0.02, -0.04, 0.06, 0.02];
    const c = pearsonCorrelation(a, b);
    assert.ok(c != null && c > 0.99);
  });

  it("greedy skips high pair correlation", () => {
    const tickers = ["A", "B", "C"];
    const corr = new Map<string, Map<string, number>>([
      ["A", new Map([["B", 0.95], ["C", 0.2]])],
      ["B", new Map([["A", 0.95], ["C", 0.2]])],
      ["C", new Map([["A", 0.2], ["B", 0.2]])],
    ]);
    const picked = pickCorrGreedy(tickers, corr, 2);
    assert.equal(picked.length, 2);
    assert.ok(!picked.includes("A") || !picked.includes("B"));
  });

  it("vol prune drops higher vol name in correlated pair", () => {
    const tickers = ["A", "B"];
    const returns = new Map([
      ["A", [0.01, 0.02, 0.01, 0.02]],
      ["B", [0.01, 0.019, 0.011, 0.019]],
    ]);
    const inputs = { tickers, returns, vol: new Map([["A", 0.5], ["B", 0.2]]) };
    const corr = correlationMatrix(inputs);
    const pruned = pruneHighCorrPairs(tickers, corr, inputs.vol);
    assert.deepEqual(pruned, ["B"]);
  });

  it("hierarchical order returns all labels", () => {
    const tickers = ["X", "Y", "Z"];
    const returns = new Map([
      ["X", [0.01, -0.01, 0.02, 0.0]],
      ["Y", [0.02, -0.02, 0.01, 0.01]],
      ["Z", [-0.02, 0.03, -0.01, 0.02]],
    ]);
    const corr = correlationMatrix({ tickers, returns, vol: new Map() });
    const order = hierarchicalClusterOrder(corr, tickers);
    assert.equal(order.length, 3);
  });
});
