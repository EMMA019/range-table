import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyEarnings } from "./earnings";

describe("classifyEarnings", () => {
  it("warns estimated dates within 10 trading days but not confirmed beyond 5", () => {
    const est = classifyEarnings("2026-10-01", { date: "2026-10-13", status: "estimated" });
    assert.ok(est?.warn);
    const conf = classifyEarnings("2026-10-01", { date: "2026-10-13", status: "confirmed" });
    assert.equal(conf?.warn, false);
  });
});
