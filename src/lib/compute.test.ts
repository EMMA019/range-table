import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atr14, computeQuote, maSlopePct, volumeStats } from "./compute";
import { formatCompactShares, formatVolumeRatio, slopeLabel } from "./format";
import type { Bar } from "./types";

function bar(date: string, o: number, h: number, l: number, c: number, v = 1_000_000): Bar {
  return { date, o, h, l, c, v };
}

function flat(n: number, price = 10): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    return bar(`2026-01-${day}`, price, price + 1, price - 1, price);
  });
}

describe("computeQuote", () => {
  it("rejects a series shorter than 21 bars", () => {
    const result = computeQuote(flat(20));
    assert.equal(result.ok, false);
  });

  it("puts the close inside the 20-day high and low", () => {
    const bars = flat(21, 30);
    bars[20] = bar("2026-01-21", 18, 22, 16, 18);
    const result = computeQuote(bars);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.quote.close, 18);
    assert.equal(result.quote.low20, 16);
    assert.equal(result.quote.high20, 31);
    assert.equal(result.quote.brokeHigh, false);
    const expected = ((18 - 16) / (31 - 16)) * 100;
    assert.ok(Math.abs(result.quote.boxPct - expected) < 0.001);
  });

  it("flags a close above the prior 20-day high", () => {
    const bars = flat(21, 10);
    for (const item of bars) {
      item.h = 12;
      item.l = 8;
      item.c = 10;
    }
    bars[20] = bar("2026-01-21", 12, 16, 11, 15);
    const result = computeQuote(bars);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.quote.priorHigh20, 12);
    assert.equal(result.quote.brokeHigh, true);
    assert.equal(result.quote.high20, 16);
    assert.equal(result.quote.low20, 8);
  });

  it("averages the last 14 true ranges", () => {
    const bars = flat(20, 10);
    for (let i = 0; i < bars.length; i++) {
      bars[i].h = 12;
      bars[i].l = 10;
      bars[i].c = 11;
    }
    const atr = atr14(bars);
    assert.equal(atr, 2);
  });

  it("measures the 20-day average against five trading days earlier", () => {
    const bars = flat(25, 100);
    for (let i = 5; i < bars.length; i++) bars[i].c = 110;
    const slope = maSlopePct(bars);
    assert.ok(slope != null && Math.abs(slope - (110 / 107.5 - 1) * 100) < 0.001);
    assert.equal(slopeLabel(slope ?? 0), "上向き");
    assert.equal(maSlopePct(flat(24, 100)), null);
    assert.equal(slopeLabel(0.4), "横ばい");
    assert.equal(slopeLabel(1), "上向き");
    assert.equal(slopeLabel(-1), "下向き");
    const quote = computeQuote(bars);
    assert.equal(quote.ok, true);
    if (!quote.ok) return;
    assert.equal(quote.quote.maSlopePct, slope);
  });

  it("compares the latest volume with the prior 20 sessions", () => {
    const bars = flat(21, 10);
    for (const item of bars) item.v = 100;
    bars[20].v = 180;
    const stats = volumeStats(bars);
    assert.equal(stats.volume, 180);
    assert.equal(stats.avgVolume20, 100);
    assert.equal(stats.volumeRatio, 1.8);
    assert.equal(stats.avgDollarVolume20, 1000);
    const quote = computeQuote(bars);
    assert.equal(quote.ok, true);
    if (!quote.ok) return;
    assert.equal(quote.quote.volumeRatio, 1.8);

    for (const item of bars) item.v = 0;
    bars[20].v = 50;
    assert.equal(volumeStats(bars).volumeRatio, null);
    assert.equal(volumeStats(bars).avgVolume20, 0);
    assert.equal(formatVolumeRatio(1.76), "1.8倍");
    assert.equal(formatCompactShares(12_300_000), "12.3M");
    assert.equal(formatVolumeRatio(0.69), "0.7倍");
  });
});
