import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPortfolio, sharesForBudget, type Candidate } from "./backtest-study";
import { atr14At, atrExit, etfAtrShares, etfOpenExit, etfOrders, etfRestExit, etfShares, preemptQty, type EtfBar } from "./etf-sleeve";
import { buyAndHold, totalNet190 } from "./round8";
import { planRound7Exit, type ExitBar } from "./round7";

function bar(date: string, o: number, h: number, l: number, c: number): EtfBar {
  return { date, o, h, l, c };
}

describe("round 8 etf sleeve", () => {
  it("signals a fresh cross of the 15% line and fills next session", () => {
    const bars = [
      bar("d0", 10, 12, 8, 9),
      bar("d1", 9, 12, 8, 8.2),
      bar("d2", 9, 12, 8, 11),
      bar("d3", 11, 12, 10, 11.5),
    ];
    const orders = etfOrders(bars, 2, ["d0", "d1", "d2", "d3"]);
    assert.equal(orders.has("d1"), false);
    const hit = orders.get("d3");
    assert.ok(hit);
    assert.equal(hit?.stop, 8);
    assert.equal(hit?.target, 12);
    assert.equal(etfShares(11, 8, 100), 9);
    assert.equal(etfShares(11, 12, 100), 0);
    assert.equal(preemptQty(30, 20, 5), 2);
    assert.equal(preemptQty(30, 20, 1), null);
    assert.equal(preemptQty(0, 20, 5), 0);
  });

  it("takes the stop when the same bar also reaches the target", () => {
    assert.deepEqual(etfOpenExit({ entryDay: false, open: 7, stop: 8, target: 12 }), { price: 7, reason: "stop" });
    assert.equal(etfOpenExit({ entryDay: true, open: 7, stop: 8, target: 12 }), null);
    assert.deepEqual(etfRestExit({ high: 13, close: 7, stop: 8, target: 12, timeout: true }), { price: 7, reason: "stop" });
    assert.deepEqual(etfRestExit({ high: 13, close: 10, stop: 8, target: 12, timeout: false }), { price: 12, reason: "target" });
  });

  it("sells the minimum ETF shares at the open to fund a stock", () => {
    const days = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"];
    const etf = [
      bar(days[0], 10, 11, 9, 9.5),
      bar(days[1], 9, 11, 8, 8.2),
      bar(days[2], 9, 12, 8.5, 10),
      bar(days[3], 10, 11, 9, 10.5),
      bar(days[4], 11.9, 11.95, 11, 11),
    ];
    const stockBars: ExitBar[] = days.map((date, index) => ({ date, o: 50, h: index === 4 ? 55 : 51, l: 49, c: 50 }));
    const qty = sharesForBudget(50) ?? 0;
    const plan = planRound7Exit({ variant: "C", bars: stockBars, entryIndex: 4, atr: 1, stop: 40, high20: 60, qty });
    assert.equal(qty, 9);
    const cand: Candidate = {
      ticker: "AAA",
      sector: "",
      semi: false,
      signalIndex: 3,
      entryIndex: 4,
      exitIndex: plan?.exitIndex ?? 4,
      signalDate: days[3],
      entryDate: days[4],
      exitDate: plan?.exitDate ?? days[4],
      entry: 50,
      exit: plan?.exit ?? 50,
      atr: 1,
      atrPct: 2,
      boxPct: 10,
      rebound: 1,
      rs20: 1,
      stop: 40,
      qty10: 1,
      reason: "window",
      exitTiming: plan?.timing ?? "close",
      voided: false,
      round7Legs: plan?.legs,
    };
    const closes = new Map([["AAA", new Map(stockBars.map((row) => [row.date, row.c]))]]);
    const orders = etfOrders(etf, 2, days);
    assert.equal(orders.get(days[3])?.stop, 8);
    assert.equal(orders.get(days[3])?.target, 12);
    const bare = runPortfolio({ id: "bare", label: "bare", universe: "core", rank: "ticker", sessions: days, flatten: true, withRestart: false, capital: 449, closes, keepFills: true, keepRound7: true }, [cand]);
    assert.equal(bare.n, 0);
    const tracked = runPortfolio({ id: "tracked", label: "tracked", universe: "core", rank: "ticker", sessions: days, flatten: true, withRestart: false, capital: 3200, closes, keepFills: true, keepRound7: true, keepSleeveStats: true }, [cand]);
    const rich = runPortfolio({ id: "rich", label: "rich", universe: "core", rank: "ticker", sessions: days, flatten: true, withRestart: false, capital: 3200, closes, keepFills: true, keepRound7: true }, [cand]);
    assert.equal(tracked.n, rich.n);
    assert.equal(tracked.totalUsd, rich.totalUsd);
    assert.equal(tracked.sleeve?.etfUtil, 0);
    const book = runPortfolio(
      {
        id: "sleeve",
        label: "sleeve",
        universe: "core",
        rank: "ticker",
        sessions: days,
        flatten: true,
        withRestart: false,
        capital: 449,
        closes,
        keepFills: true,
        keepRound7: true,
        keepSleeveStats: true,
        etfSleeve: { symbol: "QQQ", orders, bars: new Map(etf.map((row) => [row.date, row])), sessions: days },
      },
      [cand],
    );
    assert.equal(book.n, 1);
    assert.equal(book.totalUsd, 26.5);
    assert.equal(book.etfFills?.length, 1);
    const preempted = book.etfFills?.[0]?.legs.find((leg) => leg.reason === "preempted");
    const windowed = book.etfFills?.[0]?.legs.find((leg) => leg.reason === "window");
    assert.equal(preempted?.qty, 14);
    assert.equal(windowed?.qty, 2);
    assert.equal(book.sleeve?.sameDayStops, 0);
    assert.equal(totalNet190([{ pnlUsd: 10, sells: 1 }, { pnlUsd: -2, sells: 2 }]), 6.3);
  });

  it("keeps a planned ETF open exit unsettled until the next session", () => {
    const days = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09"];
    const etf = [
      bar(days[0], 10, 11, 9, 9.5),
      bar(days[1], 9, 11, 8, 8.2),
      bar(days[2], 9, 12, 8.5, 10),
      bar(days[3], 10, 11, 9, 10.5),
      bar(days[4], 13, 13.2, 12.5, 13),
      bar(days[5], 13, 13.2, 12.8, 13),
    ];
    const stockBars: ExitBar[] = days.map((date) => ({ date, o: 50, h: 51, l: 49, c: 50 }));
    const qty = sharesForBudget(50) ?? 0;
    const plan = planRound7Exit({ variant: "C", bars: stockBars, entryIndex: 4, atr: 1, stop: 40, high20: 60, qty });
    const cand: Candidate = {
      ticker: "AAA",
      sector: "",
      semi: false,
      signalIndex: 3,
      entryIndex: 4,
      exitIndex: plan?.exitIndex ?? 4,
      signalDate: days[3],
      entryDate: days[4],
      exitDate: plan?.exitDate ?? days[4],
      entry: 50,
      exit: plan?.exit ?? 50,
      atr: 1,
      atrPct: 2,
      boxPct: 10,
      rebound: 1,
      rs20: 1,
      stop: 40,
      qty10: 1,
      reason: "window",
      exitTiming: plan?.timing ?? "close",
      voided: false,
      round7Legs: plan?.legs,
    };
    const orders = etfOrders(etf, 2, days);
    const book = runPortfolio(
      {
        id: "gap",
        label: "gap",
        universe: "core",
        rank: "ticker",
        sessions: days,
        flatten: true,
        withRestart: false,
        capital: 420,
        closes: new Map([["AAA", new Map(stockBars.map((row) => [row.date, row.c]))]]),
        keepFills: true,
        keepRound7: true,
        keepSleeveStats: true,
        etfSleeve: { symbol: "QQQ", orders, bars: new Map(etf.map((row) => [row.date, row])), sessions: days },
      },
      [cand],
    );
    assert.equal(book.n, 0);
    assert.equal(book.etfFills?.[0]?.legs[0]?.reason, "target");
    assert.equal(book.etfFills?.[0]?.legs.some((leg) => leg.reason === "preempted"), false);
  });

  it("buys whole shares of a benchmark and marks the closes", () => {
    const bars = new Map([
      ["a", { o: 100, h: 100, l: 90, c: 90 }],
      ["b", { o: 100, h: 100, l: 100, c: 100 }],
    ]);
    const held = buyAndHold(["a", "b"], bars);
    assert.equal(held.shares, 32);
    assert.equal(held.pnlUsd, -0.7);
    assert.equal(held.mtmDdUsd, 320);
    assert.equal(held.pnlNet190Usd, -1.9);
  });

  it("sizes the ATR exit from 1.5 times ATR and flags a one-share entry", () => {
    const flat = Array.from({ length: 15 }, (_, index) => bar(`d${index}`, 11, 12, 10, 11));
    assert.equal(atr14At(flat, 14), 2);
    assert.equal(atr14At(flat, 13), null);
    assert.deepEqual(atrExit(100, 10), { stop: 85, target: 120 });
    assert.deepEqual(etfAtrShares(100, 10, 10000), { qty: 2, forcedOne: false });
    assert.deepEqual(etfAtrShares(100, 30, 10000), { qty: 1, forcedOne: true });
    assert.deepEqual(etfAtrShares(100, 30, 50), { qty: 0, forcedOne: false });
    const days = ["2024-01-02", "2024-01-03", "2024-01-04"];
    const etf = days.map((date) => bar(date, 10, 11, 9, 10));
    const orders = new Map([[days[0], { stop: 8, target: 12, atr: 30 }]]);
    const run = (exit: "box" | "atr") =>
      runPortfolio(
        {
          id: exit,
          label: exit,
          universe: "core",
          rank: "ticker",
          sessions: days,
          flatten: true,
          withRestart: false,
          capital: 500,
          closes: new Map(),
          keepFills: true,
          keepSleeveStats: true,
          etfSleeve: { symbol: "SOXX", orders, bars: new Map(etf.map((row) => [row.date, row])), sessions: days, exit },
        },
        [],
      );
    const atr = run("atr");
    const box = run("box");
    assert.equal(atr.etfFills?.[0]?.qty, 1);
    assert.equal(atr.etfFills?.[0]?.forcedOne, true);
    assert.equal(box.etfFills?.[0]?.qty, 16);
    assert.equal(box.etfFills?.[0]?.forcedOne, false);
  });
});
