import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeShareClassesByCik } from "./pit-share-class";

describe("pit-share-class", () => {
  it("keeps one of GOOG/GOOGL per CIK", () => {
    const cik = new Map([["GOOGL", 1], ["GOOG", 1], ["AAPL", 2]]);
    const rank = (t: string) => (t === "GOOGL" ? 100 : 50);
    const out = dedupeShareClassesByCik(["GOOG", "GOOGL", "AAPL"], (t) => cik.get(t) ?? null, rank);
    assert.ok(out.includes("GOOGL"));
    assert.ok(!out.includes("GOOG"));
    assert.ok(out.includes("AAPL"));
  });
});
