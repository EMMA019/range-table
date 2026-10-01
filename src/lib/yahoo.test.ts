import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySplits, dropPartialBar, parseChart } from "./yahoo";
import type { Bar } from "./types";

describe("yahoo adjustments", () => {
  it("divides prices before a 2-for-1 split when the close actually halves", () => {
    const bars: Array<Bar & { t: number }> = [
      { t: 100, date: "2026-01-01", o: 20, h: 22, l: 18, c: 20 },
      { t: 300, date: "2026-01-03", o: 11, h: 12, l: 10, c: 11 },
    ];
    const adjusted = applySplits(bars, [
      { date: 200, numerator: 2, denominator: 1 },
    ]);
    assert.equal(adjusted[0].c, 10);
    assert.equal(adjusted[0].h, 11);
    assert.equal(adjusted[1].c, 11);
  });

  it("leaves an already adjusted series alone", () => {
    const bars: Array<Bar & { t: number }> = [
      { t: 100, date: "2026-01-01", o: 20, h: 22, l: 18, c: 20 },
      { t: 300, date: "2026-01-03", o: 21, h: 22, l: 19, c: 21 },
    ];
    const adjusted = applySplits(bars, [
      { date: 200, numerator: 2, denominator: 1 },
    ]);
    assert.equal(adjusted[0].c, 20);
    assert.equal(adjusted[1].c, 21);
  });

  it("drops today's bar while the regular session is still open", () => {
    const bars: Array<Bar & { t: number }> = [
      { t: 1_790_798_400, date: "2026-09-30", o: 1, h: 2, l: 1, c: 1 },
      { t: 1_790_861_400, date: "2026-10-01", o: 1, h: 3, l: 1, c: 2 },
    ];
    const during = dropPartialBar(
      bars,
      { currentTradingPeriod: { regular: { start: 1_790_861_400, end: 1_790_884_800 } } },
      1_790_870_000,
    );
    assert.equal(during.dropped, true);
    assert.equal(during.bars.length, 1);
    assert.equal(during.bars[0].date, "2026-09-30");

    const after = dropPartialBar(
      bars,
      { currentTradingPeriod: { regular: { start: 1_790_861_400, end: 1_790_884_800 } } },
      1_790_890_000,
    );
    assert.equal(after.dropped, false);
    assert.equal(after.bars.length, 2);
  });

  it("parses a minimal chart and keeps completed bars", () => {
    const day = 86_400;
    const start = 1_790_000_000;
    const timestamp: number[] = [];
    const open: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    for (let i = 0; i < 25; i++) {
      timestamp.push(start + i * day);
      open.push(10);
      high.push(12);
      low.push(9);
      close.push(11);
    }
    const parsed = parseChart(
      {
        timestamp,
        indicators: { quote: [{ open, high, low, close }] },
        meta: {},
      },
      start + 30 * day,
    );
    assert.equal(parsed.bars.length, 25);
    assert.equal(parsed.bars[0].c, 11);
    assert.equal(parsed.droppedPartial, false);
  });
});
