import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPortfolio, sharesForBudget, type Candidate } from "./backtest-study";
import { bucketOf, bucketTable, flowOf, sectorOf, sectorTable, type StockTrade } from "./round12b";

describe("unlimited budget book", () => {
  const sessions = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"];

  function cand(ticker: string): Candidate {
    return {
      ticker,
      sector: "",
      semi: false,
      signalIndex: 0,
      entryIndex: 1,
      exitIndex: 2,
      signalDate: sessions[0],
      entryDate: sessions[1],
      exitDate: sessions[2],
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

  it("takes the name the cash test refused and records the refusal", () => {
    const names = ["AAA", "BBB"];
    const cands = names.map(cand);
    const closes = new Map(names.map((ticker) => [ticker, new Map(sessions.map((date) => [date, 100]))]));
    const cost = (sharesForBudget(100) ?? 0) * 100;
    assert.equal(cost, 400);
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
      keepRefusals: true,
      keepDeployed: true,
    };
    const limited = runPortfolio(base, cands);
    const open = runPortfolio({ ...base, id: "open", unlimited: true, capital: 3200 }, cands);
    assert.equal(limited.n, 1);
    assert.equal(limited.skippedCash, 1);
    assert.equal(limited.refusals?.[0]?.ticker, "BBB");
    assert.equal(limited.refusals?.[0]?.reason, "cash");
    assert.equal(open.n, 2);
    assert.equal(open.skippedCash, 0);
    assert.equal(open.deployed?.usd, 800);
    assert.equal(open.deployed?.date, sessions[1]);
    assert.equal(open.totalUsd, 80 - 1.4);
  });

  it("skips a later signal in a ticker the earlier extra fill is still holding", () => {
    const sessions = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09"];
    const named = (ticker: string, entryIndex: number, exitIndex: number): Candidate => ({
      ticker,
      sector: "",
      semi: false,
      signalIndex: entryIndex - 1,
      entryIndex,
      exitIndex,
      signalDate: sessions[entryIndex - 1],
      entryDate: sessions[entryIndex],
      exitDate: sessions[exitIndex],
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
    });
    const cands = [named("AAA", 1, 2), named("MMM", 1, 4), named("MMM", 3, 5)];
    const closes = new Map(["AAA", "MMM"].map((ticker) => [ticker, new Map(sessions.map((date) => [date, 100]))]));
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
      keepRefusals: true,
    };
    const limited = runPortfolio(base, cands);
    const open = runPortfolio({ ...base, id: "open", unlimited: true, capital: 3200 }, cands);
    const ids = (book: { fills?: Array<{ ticker: string; entryDate: string }> }) =>
      (book.fills ?? []).map((fill) => `${fill.ticker}|${fill.entryDate}`).sort();
    assert.deepEqual(ids(limited), ["AAA|2024-01-03", "MMM|2024-01-05"]);
    assert.deepEqual(ids(open), ["AAA|2024-01-03", "MMM|2024-01-03"]);
    assert.equal(limited.refusals?.some((row) => row.ticker === "MMM" && row.entryDate === "2024-01-03" && row.reason === "cash"), true);
  });
});

describe("sector and ATR tables", () => {
  const trades: StockTrade[] = [
    { ticker: "A", entryDate: "a", pnlUsd: 10, sells: 1, sector: "Tech", source: "gics", atrPct: 3 },
    { ticker: "B", entryDate: "a", pnlUsd: -70, sells: 1, sector: "Tech", source: "gics", atrPct: 8 },
    { ticker: "C", entryDate: "a", pnlUsd: 5, sells: 1, sector: "Energy", source: "watchlist", atrPct: 10 },
  ];

  it("sorts sectors by total and keeps every ATR bucket", () => {
    const sectors = sectorTable(trades);
    assert.equal(sectors[0]?.key, "Energy");
    assert.equal(sectors[1]?.totalUsd, -60);
    assert.equal(sectors[1]?.largeN, 1);
    assert.equal(sectors[1]?.winRate, 0.5);
    const buckets = bucketTable(trades);
    assert.equal(buckets.length, 7);
    assert.equal(buckets.find((row) => row.key === "<3")?.n, 0);
    assert.equal(buckets.find((row) => row.key === "3-4")?.n, 1);
    assert.equal(buckets.find((row) => row.key === "8-10")?.largeN, 1);
    assert.equal(buckets.find((row) => row.key === ">=10")?.n, 1);
    assert.equal(bucketOf(10), ">=10");
    assert.equal(bucketOf(9.999), "8-10");
    assert.deepEqual(sectorOf(null, "半導体"), { sector: "半導体", source: "watchlist" });
    assert.equal(sectorOf("Financials", "銀行").source, "gics");
    assert.equal(flowOf(trades).n, 3);
    assert.equal(flowOf(trades).pnlUsd, -55);
  });
});
