import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastEarningsRelatedFilingDate } from "./edgar-earnings-date";

describe("edgar earnings date", () => {
  it("picks the latest 8-K 2.02 or 10-Q date", () => {
    const json = {
      filings: {
        recent: {
          form: ["10-Q", "8-K", "10-K"],
          filingDate: ["2025-05-01", "2025-08-15", "2024-11-01"],
          items: ["", "2.02,9.01", ""],
        },
      },
    };
    assert.equal(lastEarningsRelatedFilingDate(json), "2025-08-15");
  });
});
