import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenureBucket, recentAdditionDate, ROUND20_PIT_MIN_START } from "./round20-tenure";
import type { Sp500Interval } from "./sp500-pit";

describe("round20 tenure buckets", () => {
  it("marks unknown when stint starts at PIT min and tenure < 5y", () => {
    assert.equal(tenureBucket(ROUND20_PIT_MIN_START, "1998-06-30"), "unknown");
  });

  it("uses gte5 when tenure from PIT min is at least 5y", () => {
    assert.equal(tenureBucket(ROUND20_PIT_MIN_START, "2002-01-31"), "gte5");
  });

  it("finds recent addition for active stint", () => {
    const rows: Sp500Interval[] = [
      { ticker: "X", startDate: "2010-01-01", endDate: "2014-01-01" },
      { ticker: "X", startDate: "2018-06-01", endDate: null },
    ];
    assert.equal(recentAdditionDate(rows, "2019-12-31"), "2018-06-01");
    assert.equal(tenureBucket("2018-06-01", "2019-12-31"), "1to5");
  });
});
