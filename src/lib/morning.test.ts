import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAPER_START } from "./paper";
import {
  PAPER_SCREEN_START,
  atrBelowMin,
  buySlot,
  excludeReasons,
  inMorningBand,
  lotFlags,
  morningBuyLines,
  sharesForRisk30,
  spyFilter,
} from "./morning";
import { canOpen, closePosition, daySnapshot, emptyLedger, openPosition, parseLedger } from "./paper-ledger";
import { themeOf } from "./themes";

const quote = {
  close: 20,
  low20: 10,
  high20: 30,
  line25: 15,
  line35: 17,
  boxPct: 25,
  brokeHigh: false,
  reboundDays: 1,
};

describe("morning paper candidates", () => {
  it("uses the frozen paper start date", () => {
    assert.equal(PAPER_SCREEN_START, PAPER_START);
  });

  it("sizes a $30 loss down to the box low and flags a lot over $450 or a $550 share", () => {
    assert.equal(sharesForRisk30(15, 10), 6);
    const sized = lotFlags(quote, "25");
    assert.equal(sized.shares, 6);
    assert.equal(sized.cost, 90);
    assert.equal(sized.flags.overCost, false);
    assert.equal(sized.flags.capBinding, false);
    const wide = lotFlags({ ...quote, close: 600, line25: 500, line35: 510, low20: 490 }, "25");
    assert.equal(wide.shares, 3);
    assert.equal(wide.flags.overCost, true);
    assert.equal(wide.flags.overPrice, true);
    assert.equal(wide.flags.capBinding, false);
    assert.equal(lotFlags({ ...quote, line25: 40.1, low20: 10 }, "25").flags.oneShareTooWide, true);
  });

  it("caps shares at floor($450 / entry) and shows the stop loss for that count", () => {
    const capped = lotFlags({ ...quote, close: 13, line25: 13, low20: 12.5 }, "25");
    assert.equal(capped.shares, 34);
    assert.equal(capped.cost, 442);
    assert.equal(capped.maxLoss, 17);
    assert.equal(capped.flags.capBinding, true);
    assert.equal(capped.flags.overCost, false);
    const tight = lotFlags({ ...quote, close: 460, line25: 460, line35: 465, low20: 450 }, "25");
    assert.equal(tight.shares, 3);
    assert.equal(tight.flags.capBinding, false);
    assert.equal(tight.flags.overCost, true);
  });

  it("uses the 25–35% band with ±2 pt tolerance and two buy lines", () => {
    assert.equal(inMorningBand(25), true);
    assert.equal(inMorningBand(23), true);
    assert.equal(inMorningBand(37), true);
    assert.equal(inMorningBand(22.9), false);
    assert.deepEqual(morningBuyLines(quote), ["25"]);
    assert.deepEqual(morningBuyLines({ ...quote, boxPct: 35 }), ["35"]);
    assert.equal(buySlot("25"), 1);
    assert.equal(buySlot("35"), 2);
    assert.deepEqual(morningBuyLines({ ...quote, boxPct: 30 }), ["25"]);
    assert.deepEqual(morningBuyLines({ ...quote, boxPct: 32 }), ["35"]);
    assert.equal(morningBuyLines({ ...quote, boxPct: 20 }).length, 0);
  });

  it("keeps SPCX, greys a loss, a theme, a box break, the financials group, and ATR under 3%", () => {
    const ok = { atr14: 4, close: 100 };
    const profit = (status: "profit" | "loss" | "unknown", trailingEps: number | null = 1) => ({
      status,
      source: status === "unknown" ? null : "test",
      ttmNetIncome: null,
      trailingEps,
    });
    assert.deepEqual(excludeReasons({ ticker: "SPCX", sectorId: "space", profitability: profit("loss", -1), brokeHigh: false, ...ok }), []);
    assert.deepEqual(excludeReasons({ ticker: "AAA", sectorId: "semi", profitability: profit("loss", -0.2), brokeHigh: false, ...ok }), ["loss"]);
    assert.deepEqual(excludeReasons({ ticker: "AAA", sectorId: "semi", profitability: profit("unknown", null), brokeHigh: false, ...ok }), []);
    assert.ok(excludeReasons({ ticker: "CEG", sectorId: "generation", profitability: profit("profit"), brokeHigh: true, ...ok }).includes("aboveBox"));
    assert.equal(themeOf("IONQ"), "quantum");
    assert.equal(themeOf("QMCO"), null);
    assert.equal(themeOf("SPCX"), null);
    assert.ok(excludeReasons({ ticker: "BAC", sectorId: "financials", profitability: profit("profit"), brokeHigh: false, ...ok }).includes("financials"));
    assert.equal(atrBelowMin(3, 100), false);
    assert.equal(atrBelowMin(2.99, 100), true);
    assert.ok(excludeReasons({ ticker: "AAA", sectorId: "semi", profitability: profit("profit"), brokeHigh: false, atr14: 2, close: 100 }).includes("atr"));
    assert.equal(excludeReasons({ ticker: "AAA", sectorId: "semi", profitability: profit("profit"), brokeHigh: false, atr14: 3, close: 100 }).includes("atr"), false);
    assert.ok(excludeReasons({ ticker: "AAA", sectorId: "semi", profitability: profit("profit"), brokeHigh: false, atr14: null, close: 100 }).includes("atr"));
  });

  it("turns the SPY filter on at or above the 20-day average", () => {
    assert.equal(spyFilter({ close: 100, ma20: 99 }), "on");
    assert.equal(spyFilter({ close: 99, ma20: 99 }), "on");
    assert.equal(spyFilter({ close: 98, ma20: 99 }), "off");
    assert.equal(spyFilter(null), "unknown");
  });
});

describe("paper ledger", () => {
  it("allows one open 25% lot and one 35% lot, then a full exit", () => {
    const first = openPosition(emptyLedger(), {
      ticker: "aaa",
      line: "25",
      entry: 15,
      shares: 6,
      stop: 10,
      target: 30,
      openedOn: "2026-10-05",
    });
    assert.ok(first);
    assert.equal(canOpen(first, "AAA", "25"), false);
    const second = openPosition(first, {
      ticker: "AAA",
      line: "35",
      entry: 17,
      shares: 5,
      stop: 10,
      target: 30,
      openedOn: "2026-10-06",
    });
    assert.ok(second);
    assert.equal(canOpen(second, "AAA", "25"), false);
    const closed = closePosition(second, second.positions[0].id, 16, "2026-10-07");
    assert.equal(closed?.closed[0].pnl, 6);
    assert.equal(closed?.positions.length, 1);
    const day = daySnapshot(closed, "2026-10-07", new Map([["AAA", 16]]));
    assert.equal(day.realizedUsd, 6);
    assert.equal(day.open, 1);
    assert.equal(day.trades, 1);
    assert.equal(day.unrealizedUsd, -5);
  });

  it("drops a stored ledger that is not version 1", () => {
    assert.equal(parseLedger('{"v":2,"positions":[]}').positions.length, 0);
    assert.equal(parseLedger("nope").positions.length, 0);
  });
});
