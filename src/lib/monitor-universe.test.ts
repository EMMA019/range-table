import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { indexMonitorTickers, loadMonitorIndex, validateMonitorIndex, watchlistTickerSet } from "./monitor-universe";
import { loadWatchlist } from "./watchlist";

describe("monitor-universe", () => {
  it("loads committed monitor_index.json", () => {
    const file = path.join(process.cwd(), "data", "monitor_index.json");
    const index = loadMonitorIndex(file);
    assert.ok(index.union.length >= 500);
    assert.ok(index.sp500.length >= 490);
    assert.ok(index.ndx100.length >= 95);
    assert.equal(new Set(index.union).size, index.union.length);
  });

  it("validates shape", () => {
    const sample = {
      generatedAt: "2026-10-05T00:00:00.000Z",
      asOfDate: "2026-10-02",
      sources: { sp500: "a", ndx100: "b" },
      sp500: ["AAPL"],
      ndx100: ["MSFT"],
      union: ["AAPL", "MSFT"],
    };
    assert.deepEqual(validateMonitorIndex(sample).union, ["AAPL", "MSFT"]);
  });

  it("index-only count matches union minus watchlist", () => {
    const wl = loadWatchlist();
    const index = loadMonitorIndex();
    const wlSet = watchlistTickerSet(wl);
    const only = indexMonitorTickers(wl);
    const expected = index.union.filter((t) => !wlSet.has(t)).length;
    assert.equal(only.length, expected);
    assert.ok(only.length >= 300);
  });

  it("index monitor tickers exclude watchlist duplicates", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-"));
    const file = path.join(dir, "monitor_index.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        generatedAt: "x",
        asOfDate: "2026-01-01",
        sources: { sp500: "a", ndx100: "b" },
        sp500: ["ZZZZ"],
        ndx100: ["NVDA"],
        union: ["NVDA", "ZZZZ"],
      }),
    );
    const wl = loadWatchlist();
    const set = watchlistTickerSet(wl);
    const extras = loadMonitorIndex(file).union.filter((t) => !set.has(t));
    assert.ok(extras.includes("ZZZZ") || extras.includes("NVDA"));
  });
});
