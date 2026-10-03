import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeTrades, mannWhitneyP, median, sectorRows, sharedLosses, sliceFacts, standardizedDiff, topLosses, type LedgerTrade } from "./decompose";

function trade(patch: Partial<LedgerTrade> & Pick<LedgerTrade, "ticker" | "pnlUsd">): LedgerTrade {
  return {
    entryDate: "2024-01-02",
    exitDate: "2024-01-03",
    sector: "Information Technology",
    atrPct: 4,
    boxWidthPct: 10,
    entryPosPct: 20,
    rs20: 0.01,
    above50: true,
    weekday: "Tue",
    holdSessions: 1,
    daysToNextReaction: 8,
    gapThrough: false,
    spyAbove20: true,
    exitReason: "target",
    slices: ["core/in"],
    ...patch,
  };
}

describe("ledger stats", () => {
  it("takes the middle of an even sample", () => {
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([3, 1, 2]), 2);
  });

  it("separates two shifted samples", () => {
    const low = [1, 2, 3, 4, 5];
    const high = [6, 7, 8, 9, 10];
    const diff = standardizedDiff(high, low);
    assert.ok(diff != null && diff > 2);
    const p = mannWhitneyP(low, high);
    assert.ok(p != null && p < 0.02);
  });

  it("sums a sector and keeps a loss negative", () => {
    const rows = sectorRows([
      trade({ ticker: "AAA", pnlUsd: 10, sector: "Energy" }),
      trade({ ticker: "BBB", pnlUsd: -4, sector: "Energy" }),
      trade({ ticker: "CCC", pnlUsd: 1, sector: "unmapped" }),
    ]);
    assert.equal(rows[0]?.sector, "Energy");
    assert.equal(rows[0]?.n, 2);
    assert.equal(rows[0]?.totalUsd, 6);
    assert.equal(rows[0]?.worstUsd, -4);
    assert.equal(rows[0]?.avgWinUsd, 10);
    assert.equal(rows[0]?.avgLossUsd, -4);
  });

  it("collapses the same fill across universes and counts a different pnl", () => {
    const same = trade({ ticker: "AAA", pnlUsd: -5, slices: ["core/in"] });
    const copy = trade({ ticker: "AAA", pnlUsd: -5, slices: ["pit/in"] });
    const other = trade({ ticker: "AAA", pnlUsd: -8, slices: ["adv/in"] });
    const merged = dedupeTrades([same, copy, other]);
    assert.equal(merged.trades.length, 2);
    assert.equal(merged.conflicts, 1);
    const kept = merged.trades.find((row) => row.pnlUsd === -5);
    assert.deepEqual(kept?.slices.sort(), ["core/in", "pit/in"]);
  });

  it("ranks a wide gap ahead of a tied feature and lists the worst losses", () => {
    const trades = [
      trade({ ticker: "WIN", pnlUsd: 10, atrPct: 8, weekday: "Mon" }),
      trade({ ticker: "WIN2", pnlUsd: 12, atrPct: 9, weekday: "Mon" }),
      trade({ ticker: "LOSE", pnlUsd: -3, atrPct: 3, weekday: "Fri" }),
      trade({ ticker: "LOSE2", pnlUsd: -9, atrPct: 2, weekday: "Fri", gapThrough: true, exitReason: "stop" }),
    ];
    const facts = sliceFacts(trades);
    assert.equal(facts.rank[0]?.feature, "atrPct");
    assert.ok((facts.rank[0]?.absEffect ?? 0) > 1);
    const worst = topLosses(trades, 1);
    assert.equal(worst[0]?.ticker, "LOSE2");
    const shared = sharedLosses(worst);
    assert.equal(shared.gapThrough, 1);
    assert.equal(shared.exitReasons[0]?.bucket, "stop");
  });
});
