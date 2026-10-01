import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atr14, computeQuote } from "./compute";
import type { Bar } from "./types";

function bar(date: string, o: number, h: number, l: number, c: number): Bar {
  return { date, o, h, l, c };
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
});
