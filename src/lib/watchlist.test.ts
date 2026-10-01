import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadWatchlist } from "./watchlist";

describe("watchlist", () => {
  const list = loadWatchlist();
  const tickers = list.groups.flatMap((group) => group.tickers);

  it("loads the grouped list without duplicate tickers", () => {
    assert.equal(tickers.length, 87);
    assert.equal(new Set(tickers.map((item) => item.ticker)).size, 87);
    assert.deepEqual(
      list.groups.map((group) => group.tickers.length),
      [21, 10, 10, 8, 11, 9, 10, 8],
    );
  });

  it("keeps earnings status and the watch-only flag", () => {
    const tsm = tickers.find((item) => item.ticker === "TSM");
    const nvda = tickers.find((item) => item.ticker === "NVDA");
    const mu = tickers.find((item) => item.ticker === "MU");
    const mod = tickers.find((item) => item.ticker === "MOD");
    assert.equal(tsm?.watchOnly, true);
    assert.deepEqual(tsm?.earnings, { date: "2026-10-15", status: "confirmed" });
    assert.equal(nvda?.watchOnly, false);
    assert.equal(nvda?.earnings, null);
    assert.deepEqual(mu?.earnings, { date: "2026-09-30", status: "confirmed" });
    assert.equal(mod?.tags.includes("事業分離"), true);
    assert.match(mod?.notes ?? "", /事業分離/);
  });
});
