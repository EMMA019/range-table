import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPortfolio, sharesForBudget, type Candidate, type ParkBar } from "./backtest-study";
import { equityChange, yearSlices } from "./round14";

describe("T-bill park", () => {
  const sessions = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"];

  function bars(price = 100): Map<string, ParkBar> {
    return new Map(sessions.map((date) => [date, { o: price, h: price, l: price, c: price, symbol: "SGOV" }]));
  }

  function cand(entryIndex: number): Candidate {
    return {
      ticker: "AAA",
      sector: "",
      semi: false,
      signalIndex: entryIndex - 1,
      entryIndex,
      exitIndex: entryIndex + 1,
      signalDate: sessions[entryIndex - 1],
      entryDate: sessions[entryIndex],
      exitDate: sessions[entryIndex + 1],
      entry: 100,
      exit: 110,
      atr: 4,
      atrPct: 4,
      boxPct: 20,
      rebound: 1,
      rs20: 0,
      qty10: 1,
      reason: "target",
      exitTiming: "close",
      voided: false,
    };
  }

  it("leaves the published walk unchanged when the park is omitted", () => {
    const closes = new Map([["AAA", new Map(sessions.map((date) => [date, 100]))]]);
    const base = {
      id: "base",
      label: "base",
      universe: "core",
      rank: "ticker" as const,
      sessions,
      flatten: true,
      withRestart: false,
      capital: 500,
      closes,
      keepFills: true,
    };
    const plain = runPortfolio(base, [cand(1)]);
    const parked = runPortfolio({ ...base, id: "off" }, [cand(1)]);
    assert.equal(plain.totalUsd, parked.totalUsd);
    assert.equal(plain.n, parked.n);
    assert.equal(plain.park, undefined);
    assert.equal(sharesForBudget(100), 4);
  });

  it("credits an ex-date dividend and charges one sell fee at the window close", () => {
    const closes = new Map<string, Map<string, number>>();
    const book = runPortfolio(
      {
        id: "park",
        label: "park",
        universe: "core",
        rank: "none",
        sessions,
        flatten: true,
        withRestart: false,
        capital: 3200,
        closes,
        park: { bars: bars(), dividends: new Map([[sessions[1], 0.5]]) },
      },
      [],
    );
    assert.equal(book.park?.cycles, 1);
    assert.equal(book.park?.sellN, 1);
    assert.equal(book.park?.dividendsUsd, 16);
    assert.equal(book.park?.priceUsd, -0.7);
    assert.equal(book.park?.feesUsd, 0.7);
    assert.equal(book.totalUsd, 15.3);
  });

  it("sells the minimum shares at the open before a stock buy", () => {
    const closes = new Map([["AAA", new Map(sessions.map((date) => [date, 100]))]]);
    const book = runPortfolio(
      {
        id: "fund",
        label: "fund",
        universe: "core",
        rank: "ticker",
        sessions,
        flatten: true,
        withRestart: false,
        capital: 500,
        closes,
        keepFills: true,
        park: { bars: bars(), dividends: new Map() },
      },
      [cand(2)],
    );
    assert.equal(book.n, 1);
    assert.equal(book.skippedCash, 0);
    assert.equal(book.park?.sellN, 1);
    assert.equal(book.park?.sells[0]?.reason, "fund");
    assert.equal(book.park?.sells[0]?.date, sessions[2]);
    assert.equal(book.park?.sells[0]?.qty, 5);
  });

  it("cuts a window into calendar years on the last session of each year", () => {
    const sessions = ["2024-12-30", "2024-12-31", "2025-01-02", "2025-01-03"];
    assert.deepEqual(yearSlices(sessions), [
      { year: "2024", from: "2024-12-30", to: "2024-12-31" },
      { year: "2025", from: "2025-01-02", to: "2025-01-03" },
    ]);
    const daily = [
      { date: "2024-12-30", equity: 3210 },
      { date: "2024-12-31", equity: 3220 },
      { date: "2025-01-02", equity: 3230 },
      { date: "2025-01-03", equity: 3240 },
    ];
    assert.equal(equityChange(daily, "2024-12-30", "2024-12-31", 3200), 20);
    assert.equal(equityChange(daily, "2025-01-02", "2025-01-03", 3200), 20);
  });
});
