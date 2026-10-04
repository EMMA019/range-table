import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  item202FilingDates,
  lastEarningsRelatedFilingDate,
  thinItem202ToQuarterlyCadence,
} from "./edgar-earnings-date";

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

  it("lists only 8-K 2.02 dates for estimates", () => {
    const json = {
      filings: {
        recent: {
          form: ["8-K", "10-Q"],
          filingDate: ["2025-09-01", "2025-09-20"],
          items: ["2.02", ""],
        },
      },
    };
    assert.deepEqual(item202FilingDates(json), ["2025-09-01"]);
  });

  it("thins 2.02 filings closer than 60 days (NKE/BA duplicate clusters)", () => {
    assert.deepEqual(
      thinItem202ToQuarterlyCadence(["2026-06-23", "2026-06-30", "2026-10-01"]),
      ["2026-06-23", "2026-10-01"],
    );
    assert.deepEqual(
      thinItem202ToQuarterlyCadence(["2024-10-11", "2024-10-23", "2025-01-28"]),
      ["2024-10-11", "2025-01-28"],
    );
  });
});
