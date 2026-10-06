import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BENCHMARKS } from "./constants";
import { loadMonitorIndex } from "./monitor-universe";
import {
  countUniverseMetaGaps,
  enrichTickerMeta,
  monitoredUniverseSymbols,
} from "./ticker-meta";

describe("ticker meta", () => {
  it("covers the monitored universe with name and GICS sector", () => {
    const symbols = monitoredUniverseSymbols();
    const index = loadMonitorIndex();
    assert.ok(symbols.length >= index.union.length);
    assert.ok(symbols.includes("JNJ"));
    for (const bench of BENCHMARKS) assert.ok(symbols.includes(bench));

    const gaps = countUniverseMetaGaps(symbols);
    assert.equal(
      gaps.missingName.length,
      0,
      `missing name: ${gaps.missingName.slice(0, 20).join(", ")}`,
    );
    assert.equal(
      gaps.missingSector.length,
      0,
      `missing sector: ${gaps.missingSector.slice(0, 20).join(", ")}`,
    );
  });

  it("resolves ETFs and large caps", () => {
    assert.equal(enrichTickerMeta("SPY").sector, "指数・ETF");
    assert.equal(enrichTickerMeta("JNJ").name, "Johnson & Johnson");
    assert.equal(enrichTickerMeta("JNJ").sector, "ヘルスケア");
    assert.equal(enrichTickerMeta("META").name, "Meta Platforms");
    assert.match(enrichTickerMeta("CTVA").name, /Corteva|CTVA/i);
  });
});
