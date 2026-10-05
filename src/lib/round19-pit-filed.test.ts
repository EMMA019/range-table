import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ttmNetIncomeAsOf, ttmNetIncomePitAudit } from "./round19-saka";

describe("PIT TTM net income filed date", () => {
  it("excludes quarters filed after asOf", () => {
    const f = path.join(process.cwd(), "data", ".cache", "round19", "facts", "AAPL.json");
    if (!fs.existsSync(f)) return;
    const json = JSON.parse(fs.readFileSync(f, "utf8"));
    const early = ttmNetIncomePitAudit(json, "2010-06-01");
    const late = ttmNetIncomePitAudit(json, "2020-01-02");
    if (early.quarters.length >= 4 && late.quarters.length >= 4) {
      for (const q of early.quarters) {
        if (q.filed) assert.ok(q.filed <= "2010-06-01");
      }
      assert.notEqual(early.ttmNetIncome, late.ttmNetIncome);
    }
    assert.ok(ttmNetIncomeAsOf(json, "2020-01-02") != null);
  });
});
