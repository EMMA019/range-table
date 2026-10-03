import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isIgnoredTicker } from "./holdings";
import {
  EXCEPTION_KEEP,
  KEEP,
  LOSS_MAKING,
  NUCLEAR,
  OTHER_REMOVE,
  REMOVE,
  TRANSITION,
  cellOf,
  listOf,
  rowMembers,
  themeOf,
  themeTotals,
  type Round7bName,
} from "./round7b";
import { loadWatchlist } from "./watchlist";

describe("round 7b reference lists", () => {
  it("partitions the names the engine already trades", () => {
    const traded = loadWatchlist().groups.flatMap((group) => group.tickers.map((row) => row.ticker)).filter((ticker) => !isIgnoredTicker(ticker));
    const proposed = [...KEEP, ...EXCEPTION_KEEP, ...TRANSITION, ...REMOVE];
    assert.equal(new Set(proposed).size, proposed.length);
    assert.equal(KEEP.length, 153);
    assert.equal(REMOVE.length, 27);
    assert.equal(TRANSITION.length, 5);
    assert.deepEqual([...proposed].sort(), [...traded].sort());
    assert.deepEqual(rowMembers("keepC").length, 154);
    assert.deepEqual(rowMembers("keepTransitionC").length, 159);
    assert.deepEqual(rowMembers("currentC").length, traded.length);
    assert.equal(listOf("SPCX"), "exception");
    assert.equal(themeOf("SPCX"), null);
    assert.equal(themeOf("OKLO"), "nuclear");
    assert.equal(themeOf("IREN"), "transition");
    assert.equal(themeOf("NVTS"), "lossMaking");
    assert.equal(themeOf("LITE"), "other");
  });

  it("puts every removed or transition name in one theme", () => {
    const themed = [...NUCLEAR, ...LOSS_MAKING, ...TRANSITION, ...OTHER_REMOVE];
    assert.equal(new Set(themed).size, themed.length);
    assert.deepEqual([...themed].sort(), [...REMOVE, ...TRANSITION].sort());
  });

  it("sums a ticker's fills and a theme", () => {
    const cell = cellOf(
      [
        { ticker: "OKLO", entryDate: "2024-08-07", exitDate: "2024-08-20", pnlUsd: -58.38 },
        { ticker: "OKLO", entryDate: "2024-01-02", exitDate: "2024-01-10", pnlUsd: 10 },
      ],
      "A",
      "core",
      "oos",
    );
    assert.equal(cell.n, 2);
    assert.equal(cell.wins, 1);
    assert.equal(cell.losses, 1);
    assert.equal(cell.totalUsd, -48.38);
    assert.equal(cell.worst?.pnlUsd, -58.38);
    const name: Round7bName = {
      ticker: "OKLO",
      list: "remove",
      theme: "nuclear",
      cells: (["A", "C"] as const).flatMap((exit) =>
        (["core", "pit", "adv"] as const).flatMap((universe) =>
          (["oos", "in"] as const).map((window) => (exit === "A" && universe === "core" && window === "oos" ? cell : { ...cell, exit, universe, window, n: 0, wins: 0, losses: 0, flats: 0, totalUsd: 0, worst: null })),
        ),
      ),
    };
    const totals = themeTotals([name]);
    const nuclear = totals.find((item) => item.exit === "A" && item.universe === "core" && item.window === "oos");
    assert.equal(nuclear?.totalUsd, -48.38);
    assert.equal(nuclear?.worst?.ticker, "OKLO");
  });
});
