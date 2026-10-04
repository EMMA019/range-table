import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { earningsDateUnknown, resolveEarningsInput } from "./earnings-enrich";

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
});
