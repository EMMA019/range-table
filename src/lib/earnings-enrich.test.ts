import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { earningsDateUnknown, pickEarningsEnrichSource, resolveEarningsInput } from "./earnings-enrich";

describe("earnings enrich", () => {
  it("prefers watchlist, then enrich cache, then Yahoo EPS", () => {
    assert.deepEqual(resolveEarningsInput({ date: "2026-11-01", status: "confirmed" }, null, null), {
      date: "2026-11-01",
      status: "confirmed",
    });
    assert.deepEqual(
      resolveEarningsInput(null, { nextEarningsDate: "2026-12-01" }, { date: "2026-10-15", status: "estimated", source: "estimate", error: null, fetchedAt: 0 }),
      { date: "2026-10-15", status: "estimated" },
    );
    assert.deepEqual(resolveEarningsInput(null, { nextEarningsDate: "2026-12-01" }, null), {
      date: "2026-12-01",
      status: "estimated",
    });
    assert.deepEqual(
      resolveEarningsInput(null, null, { date: "2026-10-15", status: "estimated", source: "nasdaq", error: null, fetchedAt: 0 }),
      { date: "2026-10-15", status: "estimated" },
    );
    assert.equal(resolveEarningsInput(null, null, null), null);
    assert.equal(earningsDateUnknown(null, null, null), true);
    assert.equal(earningsDateUnknown({ date: "2026-10-01", status: "confirmed" }, null, null), false);
  });

  it("nasdaq calendar beats yahoo and EDGAR merge (confirmed, no estimate label)", () => {
    const edgarEst = {
      date: "2026-11-03",
      earliest: "2026-10-27",
      latest: "2026-11-10",
      label: "推定 10/27〜11/10",
    };
    assert.equal(
      pickEarningsEnrichSource("2026-10-04", {
        nasdaqCalendarDate: "2026-11-05",
        yahooDate: "2026-11-05",
        nasdaqSummaryDate: null,
        edgarEst,
      }),
      "confirmed-calendar",
    );
    assert.deepEqual(
      resolveEarningsInput(null, { nextEarningsDate: "2026-11-05" }, {
        date: "2026-11-05",
        status: "confirmed",
        source: "nasdaq-calendar",
        error: null,
        fetchedAt: 0,
      }),
      { date: "2026-11-05", status: "confirmed" },
    );
  });
});
