import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { sharesOutstandingAsOf } from "./pit-shares";

describe("pit-shares", () => {
  it("resolves META weighted-average fallback", () => {
    const f = path.join(process.cwd(), "data", ".cache", "pit", "facts", "META.json");
    if (!fs.existsSync(f)) return;
    const json = JSON.parse(fs.readFileSync(f, "utf8"));
    const sh = sharesOutstandingAsOf(json, "2026-10-01");
    assert.ok(sh != null && sh > 2e9);
  });
});
