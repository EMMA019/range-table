import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atrBandOf, DEFAULT_RULES, isSignal, runTicker, statsOf, summarize, type Trade } from "./backtest";
import { computeQuote } from "./compute";
import type { Bar } from "./types";

function day(i: number): string {
  const d = new Date(Date.UTC(2026, 0, 5));
  let n = 0;
  while (n < i) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() % 6 !== 0) n += 1;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * 24 choppy sessions, a drop to a 92 low, then two bullish candles: bar 26 closes at 97.5 inside
 * the 15–25% band (a signal for both rules). ATR(14) there is 15.7143, so the target is open + 15.7143.
 */
function series(after: Array<[number, number, number, number]>): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < 24; i++) {
    const c = i % 2 ? 118 : 104;
    bars.push({ date: day(i), o: c, h: c + 3, l: c - 3, c, v: 1e6 });
  }
  bars.push({ date: day(24), o: 104, h: 104, l: 92, c: 93, v: 1e6 });
  bars.push({ date: day(25), o: 93, h: 97, l: 92.5, c: 96, v: 1e6 });
  bars.push({ date: day(26), o: 96, h: 98, l: 95.5, c: 97.5, v: 1e6 });
  after.forEach(([o, h, l, c], k) => bars.push({ date: day(27 + k), o, h, l, c, v: 1e6 }));
  return bars;
}

const ATR = 15.7143;
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);

describe("backtest exits", () => {
  it("takes the target intraday at entry + ATR, buying at the next open", () => {
    const { trades } = runTicker("AAA", series([[98, 100, 97, 97.8], [99, 114, 98, 110]]));
    assert.equal(trades.length, 1);
    const [trade] = trades;
    assert.equal(trade.signalDate, day(26));
    assert.equal(trade.entryDate, day(27));
    assert.equal(trade.entry, 98);
    near(trade.exit, 98 + ATR);
    assert.equal(trade.reason, "target");
    assert.equal(trade.qty, 1);
    near(trade.pnlUsd, ATR - 0.7);
    near(trade.pnlAtr, 1);
    assert.equal(trade.holdSessions, 1);
  });

  it("fills a gap above the target at the open", () => {
    const [trade] = runTicker("AAA", series([[98, 100, 97, 97.8], [120, 125, 119, 122]])).trades;
    assert.equal(trade.exit, 120);
    assert.equal(trade.reason, "target");
  });

  it("stops on a close under the signal day's 20-day low, at that close or the next open", () => {
    const bars = series([[98, 100, 97, 97.8], [97, 98, 90, 91], [89, 90, 88, 89.5]]);
    const [atClose] = runTicker("AAA", bars).trades;
    assert.equal(atClose.reason, "stop");
    assert.equal(atClose.exit, 91);
    assert.equal(atClose.exitDate, day(28));
    const [nextOpen] = runTicker("AAA", bars, { ...DEFAULT_RULES, stopFill: "next_open" }).trades;
    assert.equal(nextOpen.exit, 89);
    assert.equal(nextOpen.exitDate, day(29));
  });

  it("lets the target win when one day reaches it and closes under the stop", () => {
    const [trade] = runTicker("AAA", series([[98, 100, 97, 97.8], [99, 115, 90, 91]])).trades;
    assert.equal(trade.reason, "target");
  });

  it("closes at the 20th session when neither side hits", () => {
    const flat = Array.from({ length: 22 }, () => [98, 99, 97, 97.6] as [number, number, number, number]);
    const [trade] = runTicker("AAA", series(flat)).trades;
    assert.equal(trade.reason, "timeout");
    assert.equal(trade.holdSessions, 20);
    assert.equal(trade.exitDate, day(47));
  });

  it("holds one position at a time and counts one still open at the end", () => {
    const result = runTicker("AAA", series([[98, 100, 97, 99], [99, 101, 98, 100]]));
    assert.equal(result.trades.length, 0);
    assert.equal(result.open, 1);
  });

  it("can buy at the signal close instead", () => {
    const [trade] = runTicker("AAA", series([[98, 114, 97, 110]]), { ...DEFAULT_RULES, fill: "signal_close" }).trades;
    assert.equal(trade.entry, 97.5);
    assert.equal(trade.entryDate, day(26));
    near(trade.exit, 97.5 + ATR);
  });
});

describe("signal rule", () => {
  it("matches the live in_ok classification bar by bar", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const bars: Bar[] = [];
    let c = 100;
    for (let i = 0; i < 260; i++) {
      const o = c * (1 + (rand() - 0.5) * 0.04);
      c = o * (1 + (rand() - 0.5) * 0.06);
      bars.push({ date: day(i), o, h: Math.max(o, c) * (1 + rand() * 0.02), l: Math.min(o, c) * (1 - rand() * 0.02), c, v: 1e6 });
    }
    let inOk = 0;
    for (let i = 20; i < bars.length; i++) {
      const result = computeQuote(bars.slice(Math.max(0, i - 65), i + 1));
      if (!result.ok) continue;
      assert.equal(isSignal(result.quote, "in_ok"), result.quote.entrySignal === "in_ok");
      if (result.quote.entrySignal === "in_ok") {
        inOk += 1;
        assert.ok(isSignal(result.quote, "rebound15"), "in_ok is a subset of rebound15");
      }
    }
    assert.ok(inOk > 0, "the random walk produced some in_ok bars");
  });

  it("puts ATR% band edges in the upper band", () => {
    assert.equal(atrBandOf(1.999), "<2%");
    assert.equal(atrBandOf(2), "2-3%");
    assert.equal(atrBandOf(4), "4-6%");
    assert.equal(atrBandOf(6), "≥6%");
  });
});

describe("stats", () => {
  const t = (exitDate: string, pnlUsd: number, atrPct = 3): Trade => ({
    ticker: "AAA",
    signalDate: exitDate,
    entryDate: exitDate,
    exitDate,
    entry: 10,
    exit: 10,
    atr: 1,
    atrPct,
    qty: 10,
    pnlUsd,
    pnlAtr: pnlUsd / 10,
    holdSessions: 2,
    reason: pnlUsd > 0 ? "target" : "stop",
  });

  it("computes win rate, expectancy, profit factor and the worst losing streak in exit order", () => {
    const stats = statsOf([t("2026-01-05", 10), t("2026-01-07", -4), t("2026-01-06", -2), t("2026-01-08", 6)]);
    assert.equal(stats.n, 4);
    assert.equal(stats.winRate, 0.5);
    assert.equal(stats.expectancyUsd, 2.5);
    assert.equal(stats.profitFactor, 2.67);
    assert.equal(stats.maxConsecLosses, 2);
    assert.equal(stats.targets, 2);
    assert.equal(statsOf([]).winRate, null);
    assert.equal(statsOf([t("2026-01-05", 1)]).profitFactor, null);
  });

  it("summarizes with ATR thresholds 2, 3 and 4 percent", () => {
    const summary = summarize([{ ticker: "AAA", bars: series([[98, 100, 97, 97.8], [99, 114, 98, 110]]) }], ["ZZZ"], new Date(0));
    assert.deepEqual(
      summary.byAtrThreshold.map((row) => row.minAtrPct),
      [null, 2, 3, 4],
    );
    assert.equal(summary.byAtrThreshold[0].rebound15.n, 1);
    assert.equal(summary.byAtrThreshold[3].rebound15.n, 1, "ATR is 16% of the close");
    assert.deepEqual(summary.universe, { tickers: 2, withData: 1, missing: ["ZZZ"] });
    assert.ok(!JSON.stringify(summary).match(/"(shares|avgCost|reviewLine)"/));
  });
});
