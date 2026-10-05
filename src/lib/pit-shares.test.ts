import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { PIT_CACHE } from "./pit-dataset";
import { loadMergedPitFacts } from "./pit-facts-index";
import { sharesOutstandingAsOf } from "./pit-shares";

describe("pit shares", { skip: !fs.existsSync(PIT_CACHE) }, () => {
  it("HOLX uses ~240M shares not 300B issued at 2024-01-02", () => {
    const f = loadMergedPitFacts("HOLX", 859737, new Map(), PIT_CACHE);
    const sh = sharesOutstandingAsOf(f, "2024-01-02");
    assert.ok(sh != null && sh > 200_000_000 && sh < 300_000_000, `shares=${sh}`);
  });
});
