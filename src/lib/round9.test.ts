import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etfOrders, lineOf } from "./etf-sleeve";
import { belowByDate, belowShare, keepEtfOrder, keepStock, selectBest, type Round9Row } from "./round9";
import type { Round3Universe, Round3Window } from "./round3";

function row(patch: Pick<Round9Row, "base" | "filter" | "universe" | "window" | "totalUsd">): Round9Row {
  return {
    totalNet190Usd: 0,
    stockN: 100,
    etfN: 0,
    n: 100,
    winRate: 0.5,
    avgWinUsd: 1,
    avgLossUsd: -1,
    mtmDdUsd: 1,
    jointLossDays: 0,
    stockUtil: 0,
    etfUtil: 0,
    belowShare: 0.5,
    etfPnlUsd: 0,
    ratio: 1,
    ciLow: -1,
    nRequired: 10,
    meanUsd: 1,
    verdict: "hold",
    ...patch,
  };
}

describe("round 9 spy regime", () => {
  it("marks a close strictly below the 20-session average", () => {
    const flat = Array.from({ length: 19 }, (_, index) => ({ date: `d${index}`, c: 10 }));
    const below = belowByDate([...flat, { date: "d19", c: 9 }]);
    assert.equal(below.get("d18"), false);
    assert.equal(below.get("d19"), true);
    const even = belowByDate([...flat, { date: "d19", c: 10 }]);
    assert.equal(even.get("d19"), false);
    assert.equal(belowShare(["d19", "missing"], below), 0.5);
  });

  it("keeps the 15% band and adds the 30% line only on a below day", () => {
    const below = new Map([["sig", true], ["up", false]]);
    const low = 10;
    const high = 20;
    assert.equal(lineOf(low, high, 0.15), 11.5);
    assert.equal(lineOf(low, high, 0.3), 13);
    assert.equal(keepStock("off", "sig", below, 12, low, high), true);
    assert.equal(keepStock("stop", "sig", below, 12, low, high), false);
    assert.equal(keepStock("stop", "up", below, 12, low, high), true);
    assert.equal(keepStock("strict", "sig", below, 12, low, high), false);
    assert.equal(keepStock("strict", "sig", below, 13, low, high), true);
    assert.equal(keepStock("strict", "up", below, 12, low, high), true);
    assert.equal(keepStock("stop-all", "sig", below, 13, low, high), false);
    assert.equal(keepEtfOrder("stop", "sig", below), true);
    assert.equal(keepEtfOrder("stop-all", "sig", below), false);
    assert.equal(keepEtfOrder("stop-all", "up", below), true);
  });

  it("stores the E30 signal date on the order", () => {
    const bars = [
      { date: "d0", o: 10, h: 12, l: 8, c: 11 },
      { date: "d1", o: 9, h: 12, l: 8, c: 8.5 },
      { date: "d2", o: 9, h: 12, l: 8, c: 10 },
    ];
    const hit = etfOrders(bars, 2, ["d0", "d1", "d2"], "E30").get("d2");
    assert.equal(hit?.signalDate, "d1");
  });

  it("picks the largest four-cell gain and keeps an earlier tie", () => {
    const cells: Array<[Round3Universe, Round3Window]> = [
      ["pit", "oos"],
      ["pit", "in"],
      ["adv", "oos"],
      ["adv", "in"],
    ];
    const rows: Round9Row[] = [];
    for (const base of ["C", "SOXX"] as const) {
      for (const [universe, window] of cells) {
        rows.push(row({ base, filter: "off", universe, window, totalUsd: 100 }));
        rows.push(row({ base, filter: "stop", universe, window, totalUsd: base === "C" ? 110 : 90 }));
        rows.push(row({ base, filter: "strict", universe, window, totalUsd: 110 }));
        rows.push(row({ base, filter: "stop-all", universe, window, totalUsd: 80 }));
      }
    }
    const tied = selectBest(rows);
    assert.equal(tied.bestBase, "C");
    assert.equal(tied.bestFilter, "stop");
    assert.equal(tied.sumDeltaUsd, 40);
    assert.equal(tied.consistent, true);
    rows.find((item) => item.base === "C" && item.filter === "stop" && item.universe === "adv" && item.window === "in")!.totalUsd = 90;
    const mixed = selectBest(rows);
    assert.equal(mixed.bestBase, "C");
    assert.equal(mixed.bestFilter, "strict");
    assert.equal(mixed.consistent, true);
  });
});
