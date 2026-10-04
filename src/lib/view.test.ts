import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TickerRow } from "./types";
import { applyView, continuedBreakoutText, sectorsOf, volumeSurge, volumeThin, waitingRebound, withDividers } from "./view";

function row(partial: Partial<TickerRow> & Pick<TickerRow, "ticker">): TickerRow {
  return {
    sectorId: "semi",
    sector: "半導体",
    description: partial.ticker,
    notes: "",
    tags: [],
    watchOnly: false,
    earnings: null,
    quote: {
      close: 10,
      closeDate: "2026-09-30",
      ma20: 10,
      devPct: 0,
      low20: 8,
      high20: 12,
      priorHigh20: 12,
      boxPct: 50,
      atr14: 1,
      shares10: 10,
      cost10: 100,
      brokeHigh: false,
      gapWarning: false,
      maSlopePct: null,
      volume: 1_000_000,
      avgVolume20: 1_000_000,
      volumeRatio: 1,
      avgDollarVolume20: 10_000_000,
      line15: 8.6,
      line25: 9,
      line35: 9.4,
      reboundDays: null,
      entrySignal: "chase",
    },
    pe: {
      trailingEps: null,
      forwardEps: null,
      trailingPe: null,
      forwardPe: null,
      recovering: false,
      error: null,
      errorDetail: null,
    },
    error: null,
    errorDetail: null,
    sectorLabel: null,
    corrBasket: null,
    corrSoxx: null,
    rs20: null,
    semi: false,
    semiFull: false,
    stale: false,
    ...partial,
  };
}

const filters = {
  sector: "all",
  bottom: false,
  top: false,
  breakout: false,
  continued: false,
  surge: false,
  earnings: false,
  lowCorr: false,
  rebound: false,
  inOk: false,
  hideWatch: false,
  sort: "boxAsc" as const,
  q: "",
};

describe("applyView", () => {
  const rows = [
    row({ ticker: "HIGH", quote: { ...row({ ticker: "HIGH" }).quote!, boxPct: 91 } }),
    row({ ticker: "LOW", quote: { ...row({ ticker: "LOW" }).quote!, boxPct: 12.2 } }),
    row({
      ticker: "WATCH",
      watchOnly: true,
      quote: { ...row({ ticker: "WATCH" }).quote!, boxPct: 4 },
    }),
    row({
      ticker: "BRK",
      quote: { ...row({ ticker: "BRK" }).quote!, boxPct: 40, brokeHigh: true },
    }),
    row({
      ticker: "EARN",
      earnings: {
        date: "2026-10-05",
        status: "estimated",
        state: "upcoming",
        tradingDays: 2,
        warn: true,
      },
    }),
    row({ ticker: "FAIL", quote: null, error: "日足を取得できなかった" }),
  ];

  it("sorts by box position ascending and leaves failures last", () => {
    const out = applyView(rows, filters).map((item) => item.ticker);
    assert.deepEqual(out, ["WATCH", "LOW", "BRK", "EARN", "HIGH", "FAIL"]);
  });

  it("filters the bottom, breakouts, earnings, and watch-only names", () => {
    assert.deepEqual(
      applyView(rows, { ...filters, bottom: true }).map((item) => item.ticker),
      ["WATCH", "LOW"],
    );
    assert.deepEqual(
      applyView(rows, { ...filters, hideWatch: true, bottom: true }).map((item) => item.ticker),
      ["LOW"],
    );
    assert.deepEqual(
      applyView(rows, { ...filters, breakout: true }).map((item) => item.ticker),
      ["BRK"],
    );
    assert.deepEqual(
      applyView(rows, { ...filters, earnings: true }).map((item) => item.ticker),
      ["EARN"],
    );
  });

  it("sorts by trailing P/E and leaves missing ratios last", () => {
    const pe = (
      trailingPe: number | null,
      forwardPe: number | null,
    ): TickerRow["pe"] => ({
      trailingEps: trailingPe,
      forwardEps: forwardPe,
      trailingPe,
      forwardPe,
      recovering: false,
      error: null,
      errorDetail: null,
    });
    const ordered = applyView(
      [
        row({ ticker: "HIGH", pe: pe(40, 30) }),
        row({ ticker: "LOW", pe: pe(10, 8) }),
        row({ ticker: "MISS", pe: pe(null, 4) }),
        row({ ticker: "RED", pe: pe(null, 12) }),
      ],
      { ...filters, sort: "trailPeAsc" },
    ).map((item) => item.ticker);
    assert.deepEqual(ordered, ["LOW", "HIGH", "MISS", "RED"]);

    const forward = applyView(
      [
        row({ ticker: "HIGH", pe: pe(10, 30) }),
        row({ ticker: "LOW", pe: pe(40, 8) }),
      ],
      { ...filters, sort: "fwdPeAsc" },
    ).map((item) => item.ticker);
    assert.deepEqual(forward, ["LOW", "HIGH"]);
  });

  it("filters a breakout that is still at the top of the box", () => {
    const topBreak = row({
      ticker: "TOP",
      quote: { ...row({ ticker: "TOP" }).quote!, boxPct: 88, brokeHigh: true, maSlopePct: 2.4 },
    });
    const topOnly = row({
      ticker: "CEIL",
      quote: { ...row({ ticker: "CEIL" }).quote!, boxPct: 84, brokeHigh: false, maSlopePct: -1.2 },
    });
    const midBreak = row({
      ticker: "MID",
      quote: { ...row({ ticker: "MID" }).quote!, boxPct: 40, brokeHigh: true, maSlopePct: 0.2 },
    });
    const names = [topBreak, topOnly, midBreak];
    assert.deepEqual(
      applyView(names, { ...filters, continued: true }).map((item) => item.ticker),
      ["TOP"],
    );
    assert.deepEqual(
      applyView(names, { ...filters, sort: "slopeDesc" }).map((item) => item.ticker),
      ["TOP", "MID", "CEIL"],
    );
  });

  it("sorts and filters by volume ratio", () => {
    const quoteOf = (ticker: string, volumeRatio: number | null) =>
      row({
        ticker,
        quote: { ...row({ ticker }).quote!, volumeRatio },
      });
    const names = [quoteOf("QUIET", 0.5), quoteOf("HOT", 1.8), quoteOf("FLAT", 1), quoteOf("NONE", null)];
    assert.equal(volumeThin(names[0].quote!), true);
    assert.equal(volumeThin(quoteOf("EDGE", 0.69).quote!), false);
    assert.equal(volumeSurge(names[1].quote!), true);
    assert.equal(volumeSurge(quoteOf("EDGE2", 1.46).quote!), true);
    assert.equal(volumeSurge(names[2].quote!), false);
    assert.equal(continuedBreakoutText(names[0].quote!), "上抜け継続？（売り急ぎ注意）（出来高伴わず）");
    names[0].quote!.brokeHigh = false;
    assert.equal(
      continuedBreakoutText({ ...names[1].quote!, brokeHigh: true, boxPct: 90, volumeRatio: 1.8 }),
      "上抜け継続？（売り急ぎ注意）",
    );
    assert.deepEqual(
      applyView(names, { ...filters, surge: true }).map((item) => item.ticker),
      ["HOT"],
    );
    assert.deepEqual(
      applyView(names, { ...filters, sort: "volDesc" }).map((item) => item.ticker),
      ["HOT", "FLAT", "QUIET", "NONE"],
    );
    const byRs = [
      row({ ticker: "WEAK", rs20: -0.02 }),
      row({ ticker: "STRONG", rs20: 0.08 }),
      row({ ticker: "FLATRS", rs20: 0 }),
      row({ ticker: "MISS", rs20: null }),
    ];
    assert.deepEqual(
      applyView(byRs, { ...filters, sort: "rsDesc" }).map((item) => item.ticker),
      ["STRONG", "FLATRS", "WEAK", "MISS"],
    );
  });

  it("filters a low basket correlation and the jab group", () => {
    const names = [
      row({ ticker: "LOW", corrBasket: 0.3, corrSoxx: 0.9 }),
      row({ ticker: "EDGE", corrBasket: 0.304, corrSoxx: 0.1 }),
      row({ ticker: "HIGH", corrBasket: 0.305, corrSoxx: 0.2 }),
      row({ ticker: "NEG", corrBasket: -0.2, corrSoxx: 0.4 }),
      row({ ticker: "NONE", corrBasket: null, corrSoxx: null }),
      row({ ticker: "JAB", sectorId: "financials", sector: "金融", tags: ["安定ジャブ"], corrBasket: 0.8 }),
      row({ ticker: "SOFT", sectorId: "software", sector: "IT・ソフト", tags: ["安定ジャブ"], corrBasket: 0.8 }),
    ];
    assert.deepEqual(
      applyView(names, { ...filters, lowCorr: true }).map((item) => item.ticker),
      ["EDGE", "LOW", "NEG"],
    );
    assert.deepEqual(
      applyView(names, { ...filters, sector: "financials" }).map((item) => item.ticker),
      ["JAB"],
    );
    assert.deepEqual(
      applyView(names, { ...filters, sector: "jab" }).map((item) => item.ticker),
      ["JAB", "SOFT"],
    );
    assert.deepEqual(
      applyView(names, { ...filters, sector: "jab_sp500" }).map((item) => item.ticker),
      ["JAB", "SOFT"],
    );
    const withIbkr = [
      ...names,
      row({ ticker: "HELD", sectorId: "semi", sector: "半導体", tags: ["IBKR元リスト"], corrBasket: 0.9 }),
    ];
    assert.deepEqual(
      applyView(withIbkr, { ...filters, sector: "ibkr" }).map((item) => item.ticker),
      ["HELD"],
    );
    assert.equal(sectorsOf(withIbkr)[0]?.id, "ibkr");
    assert.equal(sectorsOf(withIbkr)[0]?.name, "IBKR元リスト");
    assert.equal(sectorsOf(withIbkr)[0]?.count, 1);
    assert.deepEqual(
      sectorsOf(names).filter((sector) => sector.id === "jab" || sector.id === "financials" || sector.id === "software").map((sector) => [sector.id, sector.name, sector.count]),
      [
        ["jab", "安定ジャブ", 2],
        ["financials", "金融", 1],
        ["software", "IT・ソフト", 1],
      ],
    );
  });

  it("keeps names in the rebound-waiting zone", () => {
    const names = [
      row({ ticker: "IN", quote: { ...row({ ticker: "IN" }).quote!, boxPct: 25, reboundDays: 1 } }),
      row({ ticker: "ROUND", quote: { ...row({ ticker: "ROUND" }).quote!, boxPct: 25.04, reboundDays: 2 } }),
      row({ ticker: "HIGH", quote: { ...row({ ticker: "HIGH" }).quote!, boxPct: 25.06, reboundDays: 3 } }),
      row({ ticker: "FRESH", quote: { ...row({ ticker: "FRESH" }).quote!, boxPct: 12, reboundDays: 0 } }),
      row({ ticker: "NONE", quote: { ...row({ ticker: "NONE" }).quote!, boxPct: 10, reboundDays: null } }),
    ];
    assert.equal(waitingRebound(names[0].quote!), true);
    assert.equal(waitingRebound(names[2].quote!), false);
    assert.deepEqual(
      applyView(names, { ...filters, rebound: true }).map((item) => item.ticker),
      ["IN", "ROUND"],
    );
  });

  it("keeps only IN OK names", () => {
    const names = [
      row({ ticker: "OK", quote: { ...row({ ticker: "OK" }).quote!, entrySignal: "in_ok" } }),
      row({ ticker: "EARLY", quote: { ...row({ ticker: "EARLY" }).quote!, entrySignal: "early" } }),
      row({ ticker: "CHASE", quote: { ...row({ ticker: "CHASE" }).quote!, entrySignal: "chase" } }),
      row({ ticker: "LATE", quote: { ...row({ ticker: "LATE" }).quote!, entrySignal: "late" } }),
      row({ ticker: "NONE", quote: null }),
    ];
    assert.deepEqual(
      applyView(names, { ...filters, inOk: true }).map((item) => item.ticker),
      ["OK"],
    );
  });

  it("inserts zone dividers in box order", () => {
    const items = withDividers(applyView(rows, filters), "boxAsc");
    assert.deepEqual(
      items.filter((item) => item.type === "divider").map((item) => item.id),
      ["bottom", "mid", "top", "failed"],
    );
  });
});
