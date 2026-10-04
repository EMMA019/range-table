import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySplits, dropPartialBar, parseChart } from "./yahoo";
import type { Bar } from "./types";

describe("yahoo adjustments", () => {
  it("divides prices before a 2-for-1 split when the close actually halves", () => {
    const bars: Array<Bar & { t: number }> = [
      { t: 100, date: "2026-01-01", o: 20, h: 22, l: 18, c: 20, v: 100 },
      { t: 300, date: "2026-01-03", o: 11, h: 12, l: 10, c: 11, v: 200 },
    ];
    const adjusted = applySplits(bars, [
      { date: 200, numerator: 2, denominator: 1 },
    ]);
    assert.equal(adjusted[0].c, 10);
    assert.equal(adjusted[0].h, 11);
    assert.equal(adjusted[0].v, 200);
    assert.equal(adjusted[1].c, 11);
    assert.equal(adjusted[1].v, 200);
  });

  it("leaves an already adjusted series alone", () => {
    const bars: Array<Bar & { t: number }> = [
      { t: 100, date: "2026-01-01", o: 20, h: 22, l: 18, c: 20, v: 100 },
      { t: 300, date: "2026-01-03", o: 21, h: 22, l: 19, c: 21, v: 110 },
    ];
    const adjusted = applySplits(bars, [
      { date: 200, numerator: 2, denominator: 1 },
    ]);
    assert.equal(adjusted[0].c, 20);
    assert.equal(adjusted[0].v, 100);
    assert.equal(adjusted[1].c, 21);
    assert.equal(adjusted[1].v, 110);
  });

  it("drops today's bar while the regular session is still open", () => {
    const bars: Array<Bar & { t: number }> = [
      { t: 1_790_798_400, date: "2026-09-30", o: 1, h: 2, l: 1, c: 1, v: 10 },
      { t: 1_790_861_400, date: "2026-10-01", o: 1, h: 3, l: 1, c: 2, v: 11 },
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
    const volume: number[] = [];
    for (let i = 0; i < 25; i++) {
      timestamp.push(start + i * day);
      open.push(10);
      high.push(12);
      low.push(9);
      close.push(11);
      volume.push(1_000 + i);
    }
    const parsed = parseChart(
      {
        timestamp,
        indicators: { quote: [{ open, high, low, close, volume }] },
        meta: {},
      },
      start + 30 * day,
    );
    assert.equal(parsed.bars.length, 25);
    assert.equal(parsed.bars[0].c, 11);
    assert.equal(parsed.bars[0].v, 1000);
    assert.equal(parsed.bars[24].v, 1024);
    assert.equal(parsed.droppedPartial, false);
  });

  it("keeps only the sessions the chart and the 20-day stats need", () => {
    const day = 86_400;
    const start = 1_790_000_000;
    const timestamp: number[] = [];
    const open: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    const volume: number[] = [];
    for (let i = 0; i < 80; i++) {
      timestamp.push(start + i * day);
      open.push(10);
      high.push(12);
      low.push(9);
      close.push(i);
      volume.push(100);
    }
    const parsed = parseChart(
      { timestamp, indicators: { quote: [{ open, high, low, close, volume }] }, meta: {} },
      start + 120 * day,
    );
    assert.equal(parsed.bars.length, 66);
    assert.equal(parsed.bars[0].c, 14);
    assert.equal(parsed.bars[65].c, 79);
  });

  it("uses adjclose for total-return mode", () => {
    const day = 86_400;
    const start = 1_790_000_000;
    const timestamp = [start, start + day];
    const open = [10, 10];
    const high = [12, 12];
    const low = [9, 9];
    const close = [100, 110];
    const volume = [1000, 1000];
    const adjclose = [100, 121];
    const parsed = parseChart(
      {
        timestamp,
        indicators: {
          quote: [{ open, high, low, close, volume }],
          adjclose: [{ adjclose }],
        },
        meta: {},
      },
      start + 5 * day,
      10,
      { useTotalReturn: true },
    );
    assert.equal(parsed.bars.length, 2);
    assert.equal(parsed.bars[0].c, 100);
    assert.equal(parsed.bars[1].c, 121);
  });
});
