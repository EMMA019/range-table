import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TickerRow } from "./types";
import { applyView, withDividers } from "./view";

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
      brokeHigh: false,
      gapWarning: false,
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
    ...partial,
  };
}

const filters = {
  sector: "all",
  bottom: false,
  top: false,
  breakout: false,
  earnings: false,
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

  it("inserts zone dividers in box order", () => {
    const items = withDividers(applyView(rows, filters), "boxAsc");
    assert.deepEqual(
      items.filter((item) => item.type === "divider").map((item) => item.id),
      ["bottom", "mid", "top", "failed"],
    );
  });
});
