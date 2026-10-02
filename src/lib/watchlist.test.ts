import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadWatchlist } from "./watchlist";

describe("watchlist", () => {
  const list = loadWatchlist();
  const tickers = list.groups.flatMap((group) => group.tickers);

  it("loads the grouped list without duplicate tickers", () => {
    assert.equal(tickers.length, 187);
    assert.equal(new Set(tickers.map((item) => item.ticker)).size, 187);
    assert.equal(list.groups[0]?.id, "ibkr");
    assert.equal(list.groups.at(-1)?.id, "realestate");
    assert.equal(list.groups.at(-1)?.name, "不動産");
    assert.equal(list.groups.some((group) => group.id === "jab_sp500"), false);
    assert.deepEqual(
      list.groups.map((group) => group.tickers.length),
      [22, 20, 9, 10, 8, 9, 8, 10, 8, 12, 11, 10, 10, 5, 9, 8, 6, 7, 2, 3],
    );
    for (const removed of ["QRVO", "HUT", "AMAT", "NVT", "DLR"]) {
      assert.equal(tickers.some((item) => item.ticker === removed), false);
    }
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
    assert.equal(nvda?.sectorLabel, null);
  });

  it("splits the S&P jab names into sectors and keeps the shared tag", () => {
    const groupOf = (ticker: string) => list.groups.find((group) => group.tickers.some((item) => item.ticker === ticker));
    const jab = tickers.filter((item) => item.tags.includes("安定ジャブ"));
    assert.equal(jab.length, 83);
    assert.equal(jab.every((item) => item.sectorLabel == null), true);
    assert.equal(tickers.filter((item) => !item.tags.includes("安定ジャブ")).length, 104);
    assert.deepEqual(
      jab.map((item) => item.ticker).sort(),
      [
        "AAPL", "ABNB", "ADM", "ADSK", "AMGN", "AMT", "APD", "BA", "BAC", "BKNG", "BSX", "C", "CDNS", "CHTR", "CI",
        "CMG", "COF", "COP", "CPRT", "CVX", "DAL", "DGX", "DHR", "DIS", "DRI", "DVN", "EIX", "EOG", "ETR", "EW", "F",
        "FANG", "FCX", "FERG", "FTNT", "GE", "GEHC", "HON", "IBKR", "IFF", "ISRG", "KHC", "LYV", "MCO", "MDT", "MMM",
        "MO", "MOS", "MPC", "MRK", "MS", "MSCI", "NEM", "NFLX", "NKE", "NOW", "OXY", "PGR", "PM", "PYPL", "RCL", "RTX",
        "SBUX", "SCHW", "SHW", "SPGI", "STLD", "T", "TJX", "TMUS", "TSLA", "TTWO", "TYL", "UBER", "UNH", "VLO", "VMRK",
        "VRSK", "VZ", "WELL", "WFC", "WMT", "XOM",
      ],
    );
    assert.equal(groupOf("NFLX")?.name, "通信");
    assert.equal(groupOf("VMRK")?.name, "不動産");
    assert.equal(groupOf("VMRK")?.tickers.find((item) => item.ticker === "VMRK")?.description, "賃貸住宅REIT");
    assert.equal(groupOf("NKE")?.tickers.find((item) => item.ticker === "NKE")?.earnings, null);
    assert.deepEqual(groupOf("DAL")?.tickers.find((item) => item.ticker === "DAL")?.earnings, {
      date: "2026-10-09",
      status: "estimated",
    });
    assert.equal(groupOf("NOW")?.name, "IT・ソフト");
    assert.deepEqual(groupOf("NOW")?.tickers.find((item) => item.ticker === "NOW")?.earnings, {
      date: "2026-11-04",
      status: "estimated",
    });
    assert.equal(groupOf("FERG")?.name, "資本財・工業");
    assert.equal(groupOf("FERG")?.tickers.find((item) => item.ticker === "FERG")?.earnings, null);
    assert.equal(tickers.find((item) => item.ticker === "NVDA")?.tags.includes("安定ジャブ"), false);
  });
});
