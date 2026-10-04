import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addCalendarDays,
  estimateNextFrom202Dates,
  mergeEstimatedWithHistory,
  yoyFromItem202,
} from "./earnings-estimate";

describe("earnings-estimate", () => {
  it("YoY adds 364 calendar days", () => {
    assert.equal(yoyFromItem202("2024-12-11"), "2025-12-10");
  });

  it("picks the earlier of YoY and +91d sequential", () => {
    const est = estimateNextFrom202Dates(["2025-09-10"], "2025-10-01");
    assert.ok(est);
    assert.equal(est.date, addCalendarDays("2025-09-10", 91));
    assert.ok(est.earliest <= est.latest);
    assert.match(est.label, /^推定 /);
  });

  it("merge takes the earlier Yahoo/calendar candidate", () => {
    const merged = mergeEstimatedWithHistory("2027-01-25", {
      date: "2025-12-11",
      earliest: "2025-12-11",
      latest: "2025-12-18",
      label: "推定 12/11前後",
    });
    assert.equal(merged.date, "2025-12-11");
  });

  it("ORCL-like: Sept 2.02 implies next December before Yahoo Jan 2027", () => {
    const est = estimateNextFrom202Dates(["2025-09-10"], "2026-10-04");
    assert.ok(est);
    assert.equal(est.date, "2026-12-09");
    const merged = mergeEstimatedWithHistory("2027-01-25", est);
    assert.equal(merged.date, "2026-12-09");
  });
});
