import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { PIT_CACHE } from "./pit-dataset";
import { loadPitBars } from "./pit-dataset";
import { loadMergedPitFacts } from "./pit-facts-index";
import { detectMcapJump, pitMarketCapForTicker } from "./pit-mcap";
import { loadPitSplits } from "./pit-splits";

describe("pit mcap split alignment", { skip: !fs.existsSync(PIT_CACHE) }, () => {
  it("NVDA mcap stable across 2024-06-10 10:1 split", () => {
    const bars = loadPitBars("NVDA", PIT_CACHE);
    const facts = loadMergedPitFacts("NVDA", null, new Map(), PIT_CACHE);
    const splits = loadPitSplits("NVDA", PIT_CACHE);
    assert.ok(splits.some((s) => s.date.startsWith("2024-06")), "NVDA split cache");
    const m0 = pitMarketCapForTicker("NVDA", bars, facts, "2024-06-07", PIT_CACHE);
    const m1 = pitMarketCapForTicker("NVDA", bars, facts, "2024-06-11", PIT_CACHE);
    assert.ok(m0 > 2e12 && m0 < 4e12, `m0=${m0 / 1e12}T`);
    const ratio = m1 / m0;
    assert.ok(ratio > 0.85 && ratio < 1.15, `split jump ratio ${ratio}`);
  });

  it("NVDA mcap sane at 2021-10-01 (post 4:1 split)", () => {
    const m = pitMarketCapForTicker(
      "NVDA",
      loadPitBars("NVDA", PIT_CACHE),
      loadMergedPitFacts("NVDA", null, new Map(), PIT_CACHE),
      "2021-10-01",
      PIT_CACHE,
    );
    assert.ok(m > 400e9 && m < 700e9, `NVDA 2021-10-01 mcap ${m / 1e9}B`);
  });

  it("NVDA in eligible top 10 at 2025-01-02 by mcap magnitude", () => {
    const m = pitMarketCapForTicker(
      "NVDA",
      loadPitBars("NVDA", PIT_CACHE),
      loadMergedPitFacts("NVDA", null, new Map(), PIT_CACHE),
      "2025-01-02",
      PIT_CACHE,
    );
    assert.ok(m > 3e12, `NVDA mcapB ${m / 1e12}`);
  });

  it("no >40% mcap jumps on NVDA around 2024-06-10 split", () => {
    const bars = loadPitBars("NVDA", PIT_CACHE);
    const facts = loadMergedPitFacts("NVDA", null, new Map(), PIT_CACHE);
    const splits = loadPitSplits("NVDA", PIT_CACHE);
    const jumps = detectMcapJump(bars, facts, splits, 0.4).filter(
      (j) => j.from >= "2024-05-01" && j.to <= "2024-07-31",
    );
    assert.equal(jumps.length, 0, jumps.map((j) => `${j.from}->${j.to} x${j.ratio}`).join("; "));
  });
});
