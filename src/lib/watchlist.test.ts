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
    assert.equal(list.groups.at(-1)?.id, "jab_sp500");
    assert.equal(list.groups.at(-1)?.name, "安定ジャブ（S&P500）");
    assert.deepEqual(
      list.groups.map((group) => group.tickers.length),
      [22, 20, 9, 10, 8, 9, 8, 10, 8, 83],
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

  it("keeps the S&P jab sector labels and estimated earnings", () => {
    const nflx = tickers.find((item) => item.ticker === "NFLX");
    const nke = tickers.find((item) => item.ticker === "NKE");
    const dal = tickers.find((item) => item.ticker === "DAL");
    const vmrk = tickers.find((item) => item.ticker === "VMRK");
    assert.equal(nflx?.sectorLabel, "通信");
    assert.equal(nke?.earnings, null);
    assert.deepEqual(dal?.earnings, { date: "2026-10-09", status: "estimated" });
    assert.equal(vmrk?.sectorLabel, "不動産");
    assert.equal(vmrk?.description, "賃貸住宅REIT");
    const now = tickers.find((item) => item.ticker === "NOW");
    const ferg = tickers.find((item) => item.ticker === "FERG");
    assert.equal(now?.sectorLabel, "IT・ソフト");
    assert.deepEqual(now?.earnings, { date: "2026-11-04", status: "estimated" });
    assert.equal(ferg?.sectorLabel, "資本財");
    assert.equal(ferg?.earnings, null);
    assert.equal(tickers.filter((item) => item.sectorLabel).length, 83);
  });
});
