import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAPER_START } from "./paper";
import { PAPER_SCREEN_START, excludeReasons, lineHit, lotFlags, sharesForRisk30, spyFilter } from "./morning";
import { canOpen, closePosition, daySnapshot, emptyLedger, openPosition, parseLedger } from "./paper-ledger";
import { themeOf } from "./themes";

const quote = {
  close: 20,
  low20: 10,
  high20: 30,
  line15: 13,
  line25: 15,
  boxPct: 15,
  brokeHigh: false,
};

describe("morning paper candidates", () => {
  it("uses the frozen paper start date", () => {
    assert.equal(PAPER_SCREEN_START, PAPER_START);
  });

  it("sizes a $30 loss down to the box low and flags a lot over $450 or a $550 share", () => {
    assert.equal(sharesForRisk30(13, 10), 10);
    const sized = lotFlags(quote, "15");
    assert.equal(sized.shares, 10);
    assert.equal(sized.cost, 130);
    assert.equal(sized.flags.overCost, false);
    const wide = lotFlags({ ...quote, close: 600, line15: 500, low20: 490 }, "15");
    assert.equal(wide.shares, 3);
    assert.equal(wide.flags.overCost, true);
    assert.equal(wide.flags.overPrice, true);
    assert.equal(lotFlags({ ...quote, line15: 40.1, low20: 10 }, "15").flags.oneShareTooWide, true);
  });

  it("calls a close within two box points of 15% or 25% that line", () => {
    assert.equal(lineHit(quote), "15");
    assert.equal(lineHit({ ...quote, boxPct: 24 }), "25");
    assert.equal(lineHit({ ...quote, boxPct: 20 }), null);
    assert.equal(lineHit({ ...quote, boxPct: 12.9 }), null);
  });

  it("keeps SPCX, greys a loss, a theme, a box break, and the financials group", () => {
    assert.deepEqual(excludeReasons({ ticker: "SPCX", sectorId: "space", trailingEps: -1, brokeHigh: false }), []);
    assert.deepEqual(excludeReasons({ ticker: "AAA", sectorId: "semi", trailingEps: -0.2, brokeHigh: false }), ["loss"]);
    assert.deepEqual(excludeReasons({ ticker: "AAA", sectorId: "semi", trailingEps: null, brokeHigh: false }), []);
    assert.ok(excludeReasons({ ticker: "CEG", sectorId: "generation", trailingEps: 1, brokeHigh: true }).includes("aboveBox"));
    assert.equal(themeOf("IONQ"), "quantum");
    assert.equal(themeOf("QMCO"), null);
    assert.equal(themeOf("SPCX"), null);
    assert.ok(excludeReasons({ ticker: "BAC", sectorId: "financials", trailingEps: 3, brokeHigh: false }).includes("financials"));
  });

  it("turns the SPY filter on at or above the 20-day average", () => {
    assert.equal(spyFilter({ close: 100, ma20: 99 }), "on");
    assert.equal(spyFilter({ close: 99, ma20: 99 }), "on");
    assert.equal(spyFilter({ close: 98, ma20: 99 }), "off");
    assert.equal(spyFilter(null), "unknown");
  });
});

describe("paper ledger", () => {
  it("allows one open 15% lot and one 25% lot, then a full exit", () => {
    const first = openPosition(emptyLedger(), {
      ticker: "aaa",
      line: "15",
      entry: 13,
      shares: 10,
      stop: 10,
      target: 30,
      openedOn: "2026-10-05",
    });
    assert.ok(first);
    assert.equal(canOpen(first, "AAA", "15"), false);
    const second = openPosition(first, {
      ticker: "AAA",
      line: "25",
      entry: 15,
      shares: 6,
      stop: 10,
      target: 30,
      openedOn: "2026-10-06",
    });
    assert.ok(second);
    assert.equal(canOpen(second, "AAA", "15"), false);
    const closed = closePosition(second, second.positions[0].id, 16, "2026-10-07");
    assert.equal(closed?.closed[0].pnl, 30);
    assert.equal(closed?.positions.length, 1);
    const day = daySnapshot(closed, "2026-10-07", new Map([["AAA", 16]]));
    assert.equal(day.realizedUsd, 30);
    assert.equal(day.open, 1);
    assert.equal(day.trades, 1);
    assert.equal(day.unrealizedUsd, 6);
  });

  it("drops a stored ledger that is not version 1", () => {
    assert.equal(parseLedger('{"v":2,"positions":[]}').positions.length, 0);
    assert.equal(parseLedger("nope").positions.length, 0);
  });
});
