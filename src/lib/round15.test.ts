import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PUBLISHED_BASELINE } from "./round10";
import { listExcluded, QUANTUM, ROUND12_IDS } from "./round12";
import {
  FINANCIALS_GICS,
  PUBLISHED_PIT_ADV,
  ROUND15_PREREG,
  baselineMatches,
  dropFinancials,
  isGicsFinancials,
  removedFinancials,
  watchlistNotGics,
  winRateOf,
} from "./round15";

describe("round-15 financials drop", () => {
  const sector = (ticker: string) => (ticker === "JPM" || ticker === "BAC" ? FINANCIALS_GICS : ticker === "PYPL" ? "Information Technology" : null);
  const rows = [
    { ticker: "JPM", voided: false, entryDate: "2023-01-03" },
    { ticker: "JPM", voided: true, entryDate: "2023-02-01" },
    { ticker: "NVDA", voided: false, entryDate: "2023-01-04" },
    { ticker: "BAC", voided: false, entryDate: "2021-01-04" },
  ];
  const inWindow = (row: { entryDate: string }) => row.entryDate >= "2022-10-03";

  it("drops an in-window Financials candidate and keeps the rest", () => {
    const out = dropFinancials(rows, inWindow, sector, true);
    assert.equal(out.dropped, 1);
    assert.deepEqual(
      out.taken.map((row) => `${row.ticker}|${row.entryDate}`),
      ["JPM|2023-02-01", "NVDA|2023-01-04", "BAC|2021-01-04"],
    );
    assert.equal(dropFinancials(rows, inWindow, sector, false).dropped, 0);
    assert.equal(isGicsFinancials("Financials"), true);
    assert.equal(isGicsFinancials("financials"), false);
  });

  it("sums the removed Financials fills at the $1.90 restatement", () => {
    const removed = removedFinancials(
      [
        { ticker: "JPM", entryDate: "a", pnlUsd: 10, sells: 1 },
        { ticker: "BAC", entryDate: "b", pnlUsd: -5, sells: 1 },
        { ticker: "NVDA", entryDate: "c", pnlUsd: 40, sells: 1 },
      ],
      sector,
    );
    assert.equal(removed.n, 2);
    assert.equal(removed.engineUsd, 5);
    assert.equal(removed.net190Usd, 2.6);
    assert.deepEqual(removed.tickers, ["BAC", "JPM"]);
  });

  it("lists a watchlist financial that GICS does not call Financials", () => {
    const fills = [
      { ticker: "PYPL", entryDate: "a", pnlUsd: 1, sells: 1 },
      { ticker: "BAC", entryDate: "b", pnlUsd: 1, sells: 1 },
      { ticker: "C", entryDate: "c", pnlUsd: 1, sells: 1 },
    ];
    assert.deepEqual(watchlistNotGics(fills, sector, new Set(["PYPL", "BAC", "C"])), ["C", "PYPL"]);
  });

  it("counts a win only when engine P&L is strictly positive", () => {
    assert.equal(winRateOf([1, 0, -1, 2]), 0.5);
    assert.equal(winRateOf([]), null);
  });

  it("checks the four published PIT and ADV cells and leaves the quantum list out of round 12", () => {
    assert.equal(ROUND15_PREREG, "f7d4d3a5284961cb58948fce6e4812e6e782b3e5");
    assert.equal(PUBLISHED_PIT_ADV.length, 4);
    assert.equal(PUBLISHED_BASELINE.length, 6);
    const sample = {
      id: "baseline" as const,
      universe: "pit" as const,
      window: "oos" as const,
      totalUsd: 670.37,
      totalNet190Usd: 261.36,
      stockN: 319,
      etfN: 30,
      n: 349,
      winRate: 0.5,
      mtmDdUsd: 646.89,
      lowDate: "2022-10-14",
      lowUsd: 3100,
      etfPnlUsd: 334.61,
      jointLossDays: 82,
      dropped: 0,
    };
    assert.equal(baselineMatches(sample, PUBLISHED_PIT_ADV[0]!), true);
    assert.equal(baselineMatches({ ...sample, dropped: 1 }, PUBLISHED_PIT_ADV[0]!), false);
    assert.deepEqual(QUANTUM, ["IONQ", "RGTI", "QBTS", "QUBT", "ARQQ"]);
    for (const ticker of QUANTUM) for (const id of ROUND12_IDS) assert.equal(listExcluded(ticker, id), false);
  });
});
