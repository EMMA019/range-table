import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  indexMonitorTickers,
  indexTagMap,
  loadMonitorIndex,
  preferMonitorIndex,
  validateMonitorIndex,
  watchlistTickerSet,
} from "./monitor-universe";
import { loadWatchlist } from "./watchlist";

describe("monitor-universe", () => {
  it("loads committed monitor_index.json", () => {
    const file = path.join(process.cwd(), "data", "monitor_index.json");
    const index = loadMonitorIndex(file);
    assert.ok(index.union.length >= 500);
    assert.ok(index.sp500.length >= 490);
    assert.ok(index.ndx100.length >= 95);
    assert.ok(index.sp400.length >= 390);
    assert.ok(index.sp600.length >= 590);
    assert.ok(index.union.length >= 1500);
    assert.equal(new Set(index.union).size, index.union.length);
    const tags = indexTagMap(file);
    assert.ok(tags.get("AAMI")?.includes("sp600"));
    assert.ok(tags.get("AAPL")?.includes("sp500"));
  });

  it("keeps the bundled universe when the on-disk list is the old 518-name file", () => {
    const bundled = loadMonitorIndex();
    const stale = {
      ...bundled,
      sp400: [],
      sp600: [],
      union: bundled.union.slice(0, 518),
    };
    const chosen = preferMonitorIndex(stale, bundled);
    assert.equal(chosen.union.length, bundled.union.length);
    assert.ok(chosen.sp600.length >= 590);
    assert.equal(preferMonitorIndex(null, bundled), bundled);
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
