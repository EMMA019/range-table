import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCompanyFactsTtm } from "./edgar-companyfacts";

describe("companyfacts TTM", () => {
  it("sums four quarterly NetIncomeLoss values", () => {
    const json = {
      facts: {
        "us-gaap": {
          NetIncomeLoss: {
            units: {
              USD: [
                { end: "2025-03-31", val: 10, fp: "Q1", fy: 2025, form: "10-Q" },
                { end: "2024-12-31", val: 20, fp: "Q4", fy: 2024, form: "10-Q" },
                { end: "2024-09-30", val: -5, fp: "Q3", fy: 2024, form: "10-Q" },
                { end: "2024-06-30", val: 15, fp: "Q2", fy: 2024, form: "10-Q" },
                { end: "2024-03-31", val: 1, fp: "Q1", fy: 2024, form: "10-Q" },
              ],
            },
          },
        },
      },
    };
    const parsed = parseCompanyFactsTtm(json);
    assert.equal(parsed?.ttmNetIncome, 40);
    assert.match(parsed?.source ?? "", /ttm4q/);
  });
});
