import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aboveBoxTop, admits, conceptTtm, filterFlow, readConceptFacts, round4Verdict, ttmAt, type IncomeFact } from "./round4";

function fact(patch: Partial<IncomeFact> & Pick<IncomeFact, "start" | "end" | "val" | "filed">): IncomeFact {
  return { form: "10-Q", accn: "0001", ...patch };
}

const year = fact({ start: "2023-01-01", end: "2023-12-31", val: 100, filed: "2024-02-15", form: "10-K" });
const q1 = fact({ start: "2023-01-01", end: "2023-03-31", val: 10, filed: "2023-05-01" });
const q2 = fact({ start: "2023-04-01", end: "2023-06-30", val: 20, filed: "2023-08-01" });
const q3 = fact({ start: "2023-07-01", end: "2023-09-30", val: 30, filed: "2023-11-01" });

describe("trailing income", () => {
  it("derives the fourth quarter and sums the year", () => {
    assert.equal(conceptTtm([year, q1, q2, q3], "2024-03-01"), 100);
  });

  it("treats a sequence older than 200 days as unknown", () => {
    assert.equal(conceptTtm([year, q1, q2, q3], "2024-08-01"), null);
  });

  it("ignores a filing after the signal date", () => {
    assert.equal(conceptTtm([year, q1, q2, q3], "2024-02-01"), null);
  });

  it("ignores a 20-F and a year-to-date fact", () => {
    const foreign = fact({ start: "2023-01-01", end: "2023-03-31", val: 10, filed: "2023-05-01", form: "20-F" });
    const ytd = fact({ start: "2023-01-01", end: "2023-06-30", val: 30, filed: "2023-08-01" });
    assert.equal(conceptTtm([foreign, ytd, q3, year], "2024-03-01"), null);
  });

  it("keeps a zero total and skips a negative total", () => {
    const even = [q1, q2, q3, fact({ start: "2023-10-01", end: "2023-12-31", val: -60, filed: "2024-02-01" })];
    assert.equal(ttmAt({ NetIncomeLoss: even }, "2024-03-01").status, "nonnegative");
    const loss = [q1, q2, q3, fact({ start: "2023-10-01", end: "2023-12-31", val: -61, filed: "2024-02-01" })];
    assert.equal(ttmAt({ NetIncomeLoss: loss }, "2024-03-01").status, "negative");
  });

  it("falls through to the next concept and does not mix them", () => {
    const thin = [q1, q2];
    const full = [q1, q2, q3, fact({ start: "2023-10-01", end: "2023-12-31", val: 5, filed: "2024-02-01" })];
    const picked = ttmAt({ NetIncomeLoss: thin, ProfitLoss: full }, "2024-03-01");
    assert.equal(picked.concept, "ProfitLoss");
    assert.equal(picked.ttm, 65);
    const first = ttmAt({ NetIncomeLoss: full, ProfitLoss: [fact({ ...q1, val: 999 }), q2, q3, fact({ start: "2023-10-01", end: "2023-12-31", val: 1, filed: "2024-02-01" })] }, "2024-03-01");
    assert.equal(first.concept, "NetIncomeLoss");
    assert.equal(first.ttm, 65);
  });

  it("uses the latest filing on or before the signal date", () => {
    const q4 = fact({ start: "2023-10-01", end: "2023-12-31", val: 40, filed: "2024-02-01" });
    const revised = fact({ ...q1, val: 40, filed: "2023-06-01", accn: "0002", form: "10-Q/A" });
    const later = fact({ ...q1, val: 80, filed: "2024-06-01", accn: "0003", form: "10-Q/A" });
    assert.equal(conceptTtm([q1, revised, later, q2, q3, q4], "2024-03-01"), 130);
  });

  it("reads only the USD GAAP arrays", () => {
    const parsed = readConceptFacts({
      facts: { "us-gaap": { NetIncomeLoss: { units: { USD: [q1], shares: [{ val: 1 }] } }, ProfitLoss: { units: { EUR: [q2] } } } },
    });
    assert.equal(parsed.NetIncomeLoss?.length, 1);
    assert.equal(parsed.ProfitLoss, undefined);
  });
});

describe("filters", () => {
  it("allows an entry on the box high and skips one above it", () => {
    assert.equal(aboveBoxTop(10, 10), false);
    assert.equal(aboveBoxTop(10.01, 10), true);
    assert.equal(aboveBoxTop(10, null), true);
  });

  it("splits unknown names by variant", () => {
    assert.equal(admits("F1x", "unknown", false), false);
    assert.equal(admits("F1i", "unknown", false), true);
    assert.equal(admits("F1i", "negative", false), false);
    assert.equal(admits("F1xF2", "nonnegative", true), false);
    assert.equal(admits("F2", "negative", false), true);
  });

  it("separates a removed trade from one that appears after a slot opens", () => {
    const baseline = [
      { ticker: "LOSS", entryDate: "2024-01-02", pnlUsd: -5 },
      { ticker: "KEEP", entryDate: "2024-01-03", pnlUsd: 2 },
    ];
    const filtered = [
      { ticker: "KEEP", entryDate: "2024-01-03", pnlUsd: 2 },
      { ticker: "NEW", entryDate: "2024-01-04", pnlUsd: 4 },
    ];
    const flow = filterFlow(baseline, filtered, (trade) => trade.ticker !== "LOSS");
    assert.deepEqual(flow.excludedOriginal, { n: 1, pnlUsd: -5 });
    assert.deepEqual(flow.newlyAdmitted, { n: 1, pnlUsd: 4 });
    assert.deepEqual(flow.crowdedOut, { n: 0, pnlUsd: 0 });
  });

  it("holds a judged window below 100 trades before a loss can fail it", () => {
    assert.equal(round4Verdict({ judged: true, totalUsd: -20, n: 99, ratio: null, spyRatio: 4.37, lower: -1, nRequired: 10 }), "hold");
    assert.equal(round4Verdict({ judged: false, totalUsd: 10, n: 200, ratio: 9, spyRatio: 4.37, lower: 1, nRequired: 10 }), "not-judged");
  });
});
