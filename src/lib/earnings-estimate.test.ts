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

  it("merged ORCL Yahoo date keeps future-only label window", () => {
    const est = estimateNextFrom202Dates(["2025-09-10"], "2026-10-04");
    assert.ok(est);
    const merged = mergeEstimatedWithHistory("2027-01-25", est);
    assert.equal(merged.date, "2026-12-09");
    assert.ok(merged.estimateEarliest! >= "2026-10-04");
    assert.ok(merged.estimateLatest! >= merged.estimateEarliest!);
    assert.match(merged.estimateLabel!, /12\/2〜12\/16/);
  });

  it("keeps estimate window future-only with end >= start >= today", () => {
    const today = "2026-10-04";
    for (const last of ["2025-09-10", "2025-07-23", "2025-08-05"]) {
      const est = estimateNextFrom202Dates([last], today);
      assert.ok(est);
      assert.ok(est.earliest >= today, `earliest ${est.earliest}`);
      assert.ok(est.latest >= est.earliest, `latest ${est.latest} < ${est.earliest}`);
      assert.ok(est.date >= today);
      const parts = est.label.match(/〜(.+)$/);
      if (parts && est.earliest.slice(0, 4) === est.latest.slice(0, 4)) {
        const endMd = parts[1].replace(/前後$/, "");
        const startMd = est.label.match(/推定 (\d+\/\d+)/)?.[1];
        if (startMd && endMd.includes("/") && !endMd.includes("/20")) {
          const [sm, sd] = startMd.split("/").map(Number);
          const [em, ed] = endMd.split("/").map(Number);
          assert.ok(em > sm || (em === sm && ed >= sd), `label order ${est.label}`);
        }
      }
    }
  });
});
